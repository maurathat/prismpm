"""Planted defects for the passive README classifier; run without SDK/Docker."""
import importlib.util
import sys
import json
import hashlib
import subprocess
import tempfile
import unittest
from pathlib import Path

FILE = Path(__file__).with_name("passive_readme_scope.py")
SPEC = importlib.util.spec_from_file_location("passive_readme_scope", FILE)
scope = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(scope)

BASE = "# Project\n\n## Section\n\nAn existing section.\n"
VALID = (
    "![Provisional art](assets/readme-banner-PLACEHOLDER.png)\n\n"
    "# Project\n\n[Section](#section) · [Details](details.md)\n\n"
    "## Section\n\nAn edited presentation.\n"
)
IMAGE = b"\x89PNG\r\n\x1a\nsynthetic test image, never production artwork"


class PassiveReadmeTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.git("init", "-q", "-b", "main")
        self.git("config", "user.email", "fixture@example.invalid")
        self.git("config", "user.name", "Fixture")
        (self.root / "README.md").write_text(BASE)
        (self.root / "details.md").write_text("# Details\n")
        (self.root / "src").mkdir()
        (self.root / "src" / "model.rs").write_text("pub fn proof() {}\n")
        self.git("add", ".")
        self.git("commit", "-qm", "base")
        self.base = self.git("rev-parse", "HEAD").strip()
        self.expected = None

    def git(self, *args):
        p = subprocess.run(["git", "-C", str(self.root), *args], check=True,
                           text=True, capture_output=True)
        return p.stdout

    def build(self, text=VALID, image=IMAGE, extra=None, executable=False):
        if text is not None:
            (self.root / "README.md").write_text(text)
        if image is not None:
            (self.root / "assets").mkdir(exist_ok=True)
            (self.root / scope.BANNER).write_bytes(image)
        if extra:
            extra()
        self.git("add", "-A")
        if executable:
            self.git("update-index", "--chmod=+x", "README.md")
        self.git("commit", "-qm", "change")
        self.head = self.git("rev-parse", "HEAD").strip()
        self.expected = self.git("rev-parse", f"HEAD:{scope.BANNER}").strip() if image else "0" * 40

    def check(self, expected=None):
        return scope.qualify(self.root, self.base, self.head,
                             self.expected if expected is None else expected)

    def refuse(self, reason=None, expected=None):
        with self.assertRaises(scope.Refused) as error:
            self.check(expected)
        if reason:
            self.assertIn(reason, str(error.exception))

    def test_cli_refuses_synthetic_image_not_on_approved_allowlist(self):
        self.build()
        # Tests may inject a synthetic image blob into qualify(), but production
        # CLI must refuse it because --expected-banner-blob is never exposed.
        self.assertEqual(self.check()["classification"], "PASSIVE_README")
        result = subprocess.run(
            [sys.executable, str(FILE), "--repo", str(self.root),
             "--base", self.base, "--head", self.head],
            text=True, capture_output=True, check=False,
        )
        self.assertEqual(result.returncode, 2, result.stderr)
        receipt = json.loads(result.stdout)
        self.assertEqual(set(receipt), {
            "schema", "classifier_sha256", "classification", "reason",
        })
        self.assertEqual(receipt["schema"], "prismpm/passive-readme-receipt/1")
        self.assertEqual(receipt["classification"], "FULL_REQUIRED")
        self.assertIn("unapproved placeholder image bytes", receipt["reason"])
        self.assertEqual(receipt["classifier_sha256"], hashlib.sha256(FILE.read_bytes()).hexdigest())

    def test_cli_emits_closed_refusal_receipt_and_digest(self):
        self.build()
        result = subprocess.run(
            [sys.executable, str(FILE), "--repo", str(self.root),
             "--base", "1" * 40, "--head", self.head],
            text=True, capture_output=True, check=False,
        )
        self.assertEqual(result.returncode, 2, result.stderr)
        receipt = json.loads(result.stdout)
        self.assertEqual(set(receipt), {
            "schema", "classifier_sha256", "classification", "reason",
        })
        self.assertEqual(receipt["schema"], "prismpm/passive-readme-receipt/1")
        self.assertEqual(receipt["classification"], "FULL_REQUIRED")
        self.assertEqual(receipt["classifier_sha256"], hashlib.sha256(FILE.read_bytes()).hexdigest())
        self.assertNotIn("paths", receipt)

    def test_passes_two_regular_presentation_paths(self):
        self.build()
        receipt = self.check()
        self.assertEqual(receipt["classification"], "PASSIVE_README")
        self.assertEqual(receipt["schema"], "prismpm/passive-readme-receipt/1")
        self.assertRegex(receipt["classifier_sha256"], r"^[0-9a-f]{64}$")
        self.assertEqual(set(receipt["paths"]), {"README.md", scope.BANNER})
        self.assertEqual(receipt["checked_local_links"], 3)

    def test_rejects_unapproved_png(self):
        self.build()
        self.refuse("unapproved placeholder", "0" * 40)

    def test_rejects_mixed_source_change(self):
        self.build(extra=lambda: (self.root / "src" / "model.rs").write_text("pub fn changed() {}\n"))
        self.refuse("not passive")

    def test_rejects_workflow_change(self):
        def workflow():
            p = self.root / ".github" / "workflows"
            p.mkdir(parents=True)
            (p / "bootstrap.yml").write_text("name: bypass\n")
        self.build(extra=workflow)
        self.refuse("not passive")

    def test_rejects_unknown_doc(self):
        self.build(extra=lambda: (self.root / "docs.md").write_text("extra"))
        self.refuse("not passive")

    def test_rejects_executable_readme(self):
        self.build(executable=True)
        self.refuse("non-regular or executable")

    def test_rejects_symlink_readme(self):
        def symlink():
            (self.root / "README.md").unlink()
            (self.root / "README.md").symlink_to("details.md")
        self.build(extra=symlink)
        self.refuse("not passive: T README.md")

    def test_rejects_broken_anchor(self):
        self.build(VALID.replace("#section", "#missing-anchor"))
        self.refuse("unresolved README anchor")

    def test_rejects_broken_local_target(self):
        self.build(VALID.replace("details.md", "no-such-file.md"))
        self.refuse("missing or non-regular link target")

    def test_rejects_reference_style_missing_file(self):
        self.build(VALID + "\n[missing][target]\n\n[target]: no-such-file.md\n")
        self.refuse("unsupported reference-style")

    def test_rejects_reference_style_broken_anchor(self):
        self.build(VALID + "\n[missing][target]\n\n[target]: #not-a-heading\n")
        self.refuse("unsupported reference-style")

    def test_rejects_reference_definition_without_usage(self):
        self.build(VALID + "\n[target]: details.md\n")
        self.refuse("unsupported reference-style")

    def test_rejects_empty_label_broken_link(self):
        self.build(VALID + "\n[](no-such-file.md)\n")
        self.refuse("missing or non-regular link target")

    def test_rejects_empty_alt_broken_image(self):
        self.build(VALID + "\n![](no-such-image.png)\n")
        self.refuse("missing or non-regular link target")

    def test_rejects_fenced_heading_as_fake_anchor(self):
        self.build(VALID + "\n[Broken](#fake-heading)\n\n\x60\x60\x60text\n## Fake heading\n\x60\x60\x60\n")
        self.refuse("unresolved README anchor")

    def test_rejects_unterminated_fence(self):
        self.build(VALID + "\n\x60\x60\x60text\n## Fake heading\n")
        self.refuse("unterminated Markdown fence")

    def test_rejects_unparseable_markdown_nested_title(self):
        self.build(VALID + "\n[Broken](missing.md (a title))\n")
        self.refuse("unsupported Markdown link syntax")

    def test_rejects_unquoted_html_link_attribute(self):
        self.build(VALID + "\n<a href=missing.md>Broken</a>\n")
        self.refuse("unsupported HTML link attribute")

    def test_rejects_hidden_html_comment_heading(self):
        self.build(VALID + "\n[Ghost](#ghost)\n<!-- unrendered\n## Ghost\n-->\n")
        self.refuse("unresolved README anchor")

    def test_rejects_missing_cross_document_anchor(self):
        self.build(VALID + "\n[Broken](details.md#missing)\n")
        self.refuse("unsupported cross-document fragment")

    def test_rejects_gitlinks_hidden_by_repo_configuration(self):
        self.build()
        self.git("config", "diff.ignoreSubmodules", "all")
        self.git("update-index", "--add", "--cacheinfo", f"160000,{self.base},vendor")
        self.git("commit", "-qm", "hidden source gitlink")
        self.head = self.git("rev-parse", "HEAD").strip()
        self.refuse("not passive")

    def test_rejects_replacement_object_spoof(self):
        self.build(extra=lambda: (self.root / "src" / "model.rs").write_text("fn changed() {}\n"))
        malicious = self.head
        self.git("checkout", "--detach", self.base)
        self.build()
        benign = self.head
        self.git("replace", malicious, benign)
        self.git("checkout", "--detach", malicious)
        self.head = malicious
        self.refuse("not passive")

    def test_rejects_encoded_fragment_delimiter_as_filename(self):
        self.build(VALID + "\n[Missing](README.md%23section)\n")
        self.refuse("missing or non-regular link target")

    def test_rejects_encoded_query_delimiter_as_filename(self):
        self.build(VALID + "\n[Missing](details.md%3Fquery)\n")
        self.refuse("missing or non-regular link target")

    def test_rejects_unreviewed_raw_query(self):
        self.build(VALID + "\n[Missing](details.md?query)\n")
        self.refuse("unsafe or unsupported link")

    def test_rejects_comment_like_html_attribute(self):
        self.build(VALID + '\n<a title="<!--" href="missing.md">Broken</a><!-- -->\n')
        self.refuse("HTML comment marker in tag attribute")

    def test_rejects_backtick_inside_fence_info(self):
        self.build(VALID + "\n\x60\x60\x60lang\x60invalid\n[Broken](missing.md)\n\x60\x60\x60\n")
        self.refuse("backtick in Markdown fence info")

    def test_rejects_traversal(self):
        self.build(VALID.replace("details.md", "../secret.md"))
        self.refuse("escapes repository")

    def test_rejects_generated_source_header(self):
        self.build("<!-- @generated from canonical model -->\n" + VALID)
        self.refuse("source-owned generated")

    def test_rejects_modified_generated_region(self):
        old = BASE + "\n<!-- BEGIN release-targets -->\nverified: false\n<!-- END release-targets -->\n"
        (self.root / "README.md").write_text(old)
        self.git("add", "README.md")
        self.git("commit", "-qm", "model baseline")
        self.base = self.git("rev-parse", "HEAD").strip()
        self.build(VALID + "\n<!-- BEGIN release-targets -->\nverified: true\n<!-- END release-targets -->\n")
        self.refuse("generated or release-controlled")

    def test_rejects_removed_protected_region(self):
        old = BASE + "\n<!-- BEGIN release-targets -->\nverified: false\n<!-- END release-targets -->\n"
        (self.root / "README.md").write_text(old)
        self.git("add", "README.md")
        self.git("commit", "-qm", "model baseline")
        self.base = self.git("rev-parse", "HEAD").strip()
        self.build(VALID)
        self.refuse("generated or release-controlled")

    def test_rejects_uorust_release_target_change(self):
        marked = (
            "<!-- release-targets:begin (scripts/self-model/release.py) -->\n"
            "| Target | Status |\n| --- | --- |\n| linux | open |\n"
            "<!-- release-targets:end -->\n"
        )
        (self.root / "README.md").write_text(BASE + marked)
        self.git("add", "README.md")
        self.git("commit", "-qm", "generated release baseline")
        self.base = self.git("rev-parse", "HEAD").strip()
        changed = marked.replace("| linux | open |", "| linux | passing |")
        self.build(VALID + changed)
        self.refuse("generated or release-controlled")

    def test_rejects_removed_uorust_release_target_markers(self):
        marked = (
            "<!-- release-targets:begin (scripts/self-model/release.py) -->\n"
            "signed data\n<!-- release-targets:end -->\n"
        )
        (self.root / "README.md").write_text(BASE + marked)
        self.git("add", "README.md")
        self.git("commit", "-qm", "generated release baseline")
        self.base = self.git("rev-parse", "HEAD").strip()
        self.build(VALID)
        self.refuse("generated or release-controlled")

    def test_rejects_unknown_generated_marker(self):
        self.build(VALID + "\n<!-- generated:custom-source-v2 -->\nchanged\n")
        self.refuse("unknown generated-region marker")

    def test_rejects_missing_base(self):
        self.build()
        with self.assertRaises(scope.Refused):
            scope.qualify(self.root, "1" * 40, self.head, self.expected)

    def test_rejects_mismatched_head(self):
        self.build()
        self.git("checkout", "--detach", self.base)
        self.refuse("working tree HEAD does not equal trusted pull-request head")

    def test_rejects_outdated_base_before_declaring_passive(self):
        self.build()
        self.git("switch", "-c", "base-update")
        (self.root / "unrelated.md").write_text("new base has moved\\n")
        self.git("add", "unrelated.md")
        self.git("commit", "-qm", "base advanced after PR head")
        self.base = self.git("rev-parse", "HEAD").strip()
        self.git("checkout", "--detach", self.head)
        self.refuse("head must descend from one exact trusted base")

    def test_rejects_no_readme_change(self):
        self.build(text=None)
        self.refuse("no README change")

    def test_rejects_renamed_readme(self):
        def rename():
            (self.root / "README.md").rename(self.root / "OLD-README.md")
        self.build(text=None, extra=rename)
        self.refuse("not passive")

    def test_rejects_asset_alone_or_delete(self):
        self.build(text=None, image=IMAGE)
        self.refuse("no README change")

    def test_rejects_newly_injected_policy_marker(self):
        self.build(VALID + "\n<!-- BEGIN release-targets -->\nfalse\n<!-- END release-targets -->\n")
        self.refuse("generated or release-controlled")


if __name__ == "__main__":
    unittest.main()
