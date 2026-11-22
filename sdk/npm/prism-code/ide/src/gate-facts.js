// What the page tells Holospace's gate about one call from an extension.
//
// The gate that answers is Holospace's kernel, asked through `h.extensionGate` of the library this page pins by
// label (tools/holospace-pins.json). This file only states the facts of a call in the form that gate takes. It
// decides nothing: where a call points is still found by the scope rules (scope.js, after model/ide-scope), and the
// place those rules give is sent with the facts so the page can refuse when the gate reads the path otherwise.
//
// A path the editor gives under a scheme other than file: is put under a root named for the scheme, so that a path
// of one scheme can never be read as a path of another.

import { pathInside } from './scope.js';

export const RESOURCES = ['show', 'read', 'write', 'network', 'secrets', 'exec'];
export const WORKSPACE = '/workspace';
/** The roots the editor gives extensions to keep their own files in, per scheme. */
const STORAGE = { file: ['/User/globalStorage', '/User/workspaceStorage'], 'vscode-userdata': ['/User/globalStorage', '/User/workspaceStorage'], 'vscode-log': ['/'] };
const rooted = (scheme, path) => (scheme === 'file' ? path : `/@${scheme}${path.startsWith('/') ? '' : '/'}${path}`);

/**
 * Where a call points, as the scope rules read it: `{ place: 'outside' | 'workspace' | 'storage', target, storage }`.
 * `uri` is `{ scheme, path }`, or null for a call that names no file, which counts as the workspace. `other` is true
 * when the path is inside storage that belongs to another extension: that is outside, whoever asks.
 */
export function placeOfCall(uri, { other = false } = {}) {
  if (uri === null) return { place: 'workspace', target: WORKSPACE, storage: [] };
  const { scheme, path } = uri;
  if (typeof scheme !== 'string' || typeof path !== 'string') return { place: 'outside', target: '/@unreadable', storage: [] };
  const roots = (STORAGE[scheme] ?? []).filter((root) => root === '/' || pathInside(path, root));
  if (roots.length > 0 && !other) {
    // The root sent is the one the path is inside, under its scheme. A scheme whose every path is storage (the
    // log) has the scheme's own root.
    return { place: 'storage', target: rooted(scheme, path), storage: roots.map((root) => (root === '/' ? `/@${scheme}` : rooted(scheme, root))) };
  }
  if (scheme === 'file' && roots.length === 0 && pathInside(path, WORKSPACE)) return { place: 'workspace', target: path, storage: [] };
  return { place: 'outside', target: rooted(scheme, path), storage: [] };
}

/**
 * The argument of `h.extensionGate` for one call. `declared` is the set of resources the extension declares;
 * `granted` and `denied` are the user's standing answers for this resource.
 */
export function gateFacts({ resource, uri = null, other = false, declared, granted, denied, trusted }) {
  const where = placeOfCall(uri, { other });
  return {
    place: where.place,
    facts: { resource, declared: [...declared].filter((r) => RESOURCES.includes(r)), denied: denied === true, granted: granted === true, trusted: trusted === true, target: where.target, workspace: WORKSPACE, storage: where.storage, route: 'tab' },
  };
}
