#!/usr/bin/env python3
"""SDK candidate: fail-closed, read-only passive README qualification. NOT a merge gate.

Only a future accepted universal policy may use PASS to bypass full acceptance.
The CLI's accepted image object is fixed; test-only injection is not exposed.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import posixpath
import re
import subprocess
import sys
from pathlib import Path
from urllib.parse import unquote, urlsplit

BANNER = "assets/readme-banner-PLACEHOLDER.png"
EXPECTED_BANNER_BLOB = "29273d499d3891ccc728f10eef601776884e639d"
ALLOWED_PATHS = frozenset(("README.md", BANNER))
SHA = re.compile(r"^[a-f0-9]{40}$")
MARKER = re.compile(r"<!--\s*(BEGIN|END)\s+([A-Z0-9_.:/ -]+?)\s*-->", re.I)
COLON_MARKER = re.compile(r"<!--\s*([A-Z0-9_.:/-]+):(begin|end)(?:\s*\([^)]*\))?\s*-->", re.I)
LINK = re.compile(r"!?\[[^\]]*\]\(\s*(?:<([^<>]+)>|([^\s)]+))(?:\s+['\"][^'\"]+['\"])?\s*\)")
HTML_LOCAL = re.compile(r"\b(?:src|href)\s*=\s*['\"]([^'\"]+)['\"]", re.I)
HEADER = re.compile(r"^#{1,6}\s+(.+?)\s*#*\s*$", re.M)
REFERENCE_USE = re.compile(r"!?\[[^\]\n]+\]\[[^\]\n]*\]")
REFERENCE_DEFINITION = re.compile(r"(?m)^[ \t]{0,3}\[[^\]\n]+\]:\s*\S+")


class Refused(Exception):
    pass


def git(root: Path, *args: str) -> bytes:
    command = ["git", "--no-replace-objects", "-C", str(root),
               "-c", "core.quotepath=false", "-c", "diff.ignoreSubmodules=none", *args]
    process = subprocess.run(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False)
    if process.returncode:
        raise Refused("git command failed: " + " ".join(args[:4]))
    return process.stdout


def blob(root: Path, ref: str, path: str) -> bytes:
    return git(root, "show", f"{ref}:{path}")


def mode(root: Path, ref: str, path: str) -> str | None:
    records = git(root, "ls-tree", "-z", ref, "--", path).split(b"\0")
    for record in records:
        if not record:
            continue
        meta, found = record.split(b"\t", 1)
        if found.decode("utf-8", errors="strict") == path:
            fields = meta.split(b" ")
            if len(fields) != 3 or fields[1] != b"blob":
                raise Refused("non-blob path: " + path)
            return fields[0].decode("ascii")
    return None


def protected_regions(source: str) -> dict[str, str]:
    if re.search(r"<!--\s*@generated\b", source, re.I):
        raise Refused("source-owned generated README cannot qualify as passive")
    open_region: tuple[str, int] | None = None
    protected: dict[str, str] = {}
    for token in re.finditer(r"<!--.*?-->", source, re.S):
        comment = token.group()
        standard = MARKER.fullmatch(comment)
        alternate = COLON_MARKER.fullmatch(comment)
        if standard:
            kind, name = standard.group(1).upper(), standard.group(2).strip().upper()
        elif alternate:
            name, kind = alternate.group(1).strip().upper(), alternate.group(2).upper()
        elif re.search(r"generated|release.targets|auto.?start|auto.?end", comment, re.I):
            raise Refused("unknown generated-region marker")
        else:
            continue
        if kind == "BEGIN":
            if open_region is not None or name in protected:
                raise Refused("nested or repeated protected region")
            open_region = (name, token.start())
        else:
            if open_region is None or open_region[0] != name:
                raise Refused("unmatched protected region")
            protected[name] = source[open_region[1]:token.end()]
            open_region = None
    if open_region is not None:
        raise Refused("unterminated protected region")
    return protected

def slug(label: str) -> str:
    label = re.sub(r"<[^>]*>", "", label)
    label = re.sub(r"\[([^\]]+)\]\([^)]*\)", r"\1", label)
    label = re.sub(r"[*_~]", "", label.replace(chr(96), "")).lower()
    label = "".join(c for c in label if c.isalnum() or c in " -_")
    return re.sub(r"\s+", "-", label.strip())


def markdown_prose(source: str) -> str:
    """Exclude fenced code samples from anchor and local-link interpretation."""
    outside: list[str] = []
    active: tuple[str, int] | None = None
    for line in source.splitlines(keepends=True):
        item = re.match(r"^ {0,3}((?:\x60{3,}|~{3,}))(.*)$", line.rstrip("\r\n"))
        if item:
            token, suffix = item.groups()
            if active is None:
                if token[0] == "\x60" and "\x60" in suffix:
                    raise Refused("backtick in Markdown fence info")
                active = (token[0], len(token))
            elif token[0] == active[0] and len(token) >= active[1] and not suffix.strip():
                active = None
            outside.append("\n")
        elif active is None:
            outside.append(line)
        else:
            outside.append("\n")
    if active is not None:
        raise Refused("unterminated Markdown fence")
    prose = "".join(outside)
    if re.search(r"\]\([^)]*<!--", prose, re.S):
        raise Refused("ambiguous Markdown comment marker")
    result: list[str] = []
    in_html_tag = False
    quote: str | None = None
    at = 0
    while at < len(prose):
        if prose.startswith("<!--", at):
            if in_html_tag:
                raise Refused("HTML comment marker in tag attribute")
            end = prose.find("-->", at + 4)
            if end == -1:
                raise Refused("unclosed HTML comment")
            result.append("".join("\n" if ch == "\n" else " " for ch in prose[at:end + 3]))
            at = end + 3
            continue
        if prose.startswith("-->", at):
            raise Refused("unmatched HTML comment terminator")
        ch = prose[at]
        if not in_html_tag and ch == "<" and at + 1 < len(prose) and (
            prose[at + 1].isalpha() or prose[at + 1] == "/"
        ):
            in_html_tag = True
        elif in_html_tag:
            if quote:
                if ch == quote:
                    quote = None
            elif ch in ("'", '"'):
                quote = ch
            elif ch == ">":
                in_html_tag = False
        result.append(ch)
        at += 1
    if in_html_tag and quote:
        raise Refused("unterminated HTML attribute")
    return "".join(result)


def check_readme_links(root: Path, head: str, readme: str) -> tuple[int, int]:
    readme = markdown_prose(readme)
    if REFERENCE_USE.search(readme) or REFERENCE_DEFINITION.search(readme):
        raise Refused("unsupported reference-style Markdown link")
    headings: dict[str, int] = {}
    anchors: set[str] = set(re.findall(r'<a\s+(?:name|id)=["\']([^"\']+)["\']', readme, re.I))
    for m in HEADER.finditer(readme):
        base_slug = slug(m.group(1))
        count = headings.get(base_slug, 0)
        headings[base_slug] = count + 1
        anchors.add(f"{base_slug}-{count}" if count else base_slug)
    markdown_links = list(LINK.finditer(readme))
    html_links = list(HTML_LOCAL.finditer(readme))
    if readme.count("](") != len(markdown_links):
        raise Refused("unsupported Markdown link syntax")
    if len(re.findall(r"\b(?:src|href)\s*=", readme, re.I)) != len(html_links):
        raise Refused("unsupported HTML link attribute")
    checked = 0
    for match in markdown_links + html_links:
        target = (match.group(1) or match.group(2)) if len(match.groups()) == 2 else match.group(1)
        if not target or target.startswith(("http:", "https:", "mailto:", "tel:", "data:", "//")):
            continue
        parts = urlsplit(target)
        path = unquote(parts.path)
        fragment = unquote(parts.fragment)
        if parts.scheme or parts.netloc or parts.query or "\\" in path or "\\" in fragment:
            raise Refused("unsafe or unsupported link: " + target)
        if not path:
            if not fragment or fragment not in anchors:
                raise Refused("unresolved README anchor: " + target)
        else:
            if path.startswith("/"):
                raise Refused("root-absolute local link: " + target)
            normalized = posixpath.normpath(path)
            if normalized == ".." or normalized.startswith("../"):
                raise Refused("local path escapes repository: " + target)
            if mode(root, head, normalized) != "100644":
                raise Refused("missing or non-regular link target: " + target)
            if fragment and normalized != "README.md":
                raise Refused("unsupported cross-document fragment: " + target)
            if normalized == "README.md" and fragment and fragment not in anchors:
                raise Refused("unresolved README anchor: " + target)
        checked += 1
    return checked, len(anchors)


def qualify(root: Path, base: str, head: str, expected_banner_blob: str = EXPECTED_BANNER_BLOB) -> dict:
    if not SHA.fullmatch(base) or not SHA.fullmatch(head) or base == head:
        raise Refused("invalid, equal, or missing full commit IDs")
    if git(root, "rev-parse", "HEAD").decode().strip() != head:
        raise Refused("working tree HEAD does not equal trusted pull-request head")
    git(root, "cat-file", "-e", f"{base}^{{commit}}")
    git(root, "cat-file", "-e", f"{head}^{{commit}}")
    ancestors = git(root, "merge-base", "--all", base, head).decode().splitlines()
    if ancestors != [base]:
        raise Refused("pull-request head must descend from one exact trusted base")
    merge_base = base
    raw = git(root, "diff", "--name-status", "-z", "--no-ext-diff", "--no-textconv",
              "--no-renames", "--ignore-submodules=none", merge_base, head)
    fields = [p.decode("utf-8", errors="strict") for p in raw.split(b"\0") if p]
    if not fields or len(fields) % 2:
        raise Refused("empty or unparseable changed-path list")
    changes = list(zip(fields[::2], fields[1::2]))
    for status, path in changes:
        if status not in ("M", "A") or path not in ALLOWED_PATHS:
            raise Refused("not passive: " + status + " " + path)
        if mode(root, head, path) != "100644":
            raise Refused("non-regular or executable presentation file: " + path)
        if status == "M" and mode(root, merge_base, path) != "100644":
            raise Refused("modified presentation source has wrong base mode")
    if not any(path == "README.md" for _, path in changes):
        raise Refused("no README change")
    if mode(root, head, BANNER) != "100644":
        raise Refused("missing regular placeholder PNG")
    image_id = git(root, "rev-parse", f"{head}:{BANNER}").decode().strip()
    if image_id != expected_banner_blob:
        raise Refused("unapproved placeholder image bytes")
    old = blob(root, merge_base, "README.md").decode("utf-8", errors="strict")
    new = blob(root, head, "README.md").decode("utf-8", errors="strict")
    if protected_regions(old) != protected_regions(new):
        raise Refused("generated or release-controlled README region changed")
    if BANNER not in new:
        raise Refused("README does not reference checked-in image")
    links, anchor_count = check_readme_links(root, head, new)
    return {
        "schema": "prismpm/passive-readme-receipt/1",
        "classifier_sha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        "classification": "PASSIVE_README",
        "base": base,
        "head": head,
        "merge_base": merge_base,
        "paths": [path for _, path in changes],
        "banner_blob": image_id,
        "checked_local_links": links,
        "known_anchors": anchor_count,
        "claim": "presentation change only; no product or release acceptance implied",
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo", default=".")
    parser.add_argument("--base", required=True)
    parser.add_argument("--head", required=True)
    a = parser.parse_args()
    try:
        receipt = qualify(Path(a.repo), a.base, a.head)
    except (Refused, UnicodeError, ValueError) as exc:
        print(json.dumps({"schema": "prismpm/passive-readme-receipt/1", "classifier_sha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(), "classification": "FULL_REQUIRED", "reason": str(exc)}, sort_keys=True))
        return 2
    print(json.dumps(receipt, sort_keys=True))
    return 0


if __name__ == "__main__":
    sys.exit(main())
