#!/usr/bin/env node
/**
 * prism-doctor — the first-party CLI plugin (#293, experimental).
 *
 *   prism-code doctor        check what prism-code needs here: Node.js, and the
 *                            optional sigstore packages
 *
 * It ships in the prism-code package as a second binary, so installing
 * prism-code puts `prism-doctor` on the PATH and `prism-code doctor` finds it.
 * prism-code needs nothing else: check, build and verify run in this process.
 *
 * Exit codes: 0 nothing failed, 1 a check failed.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { HOOK_COMMAND, METADATA_COMMAND, PLUGIN_SCHEMA_VERSION } from '../src/plugins.mjs';

const require = createRequire(import.meta.url);
const { version } = require('../package.json');

const METADATA = {
  schemaVersion: PLUGIN_SCHEMA_VERSION,
  vendor: 'UOR Foundation',
  version,
  shortDescription: 'Check Node.js and the sigstore packages',
  errorHooks: [],
};

function node() {
  const major = Number(process.versions.node.split('.')[0]);
  return major >= 22 ? ['ok', `node ${process.versions.node}`] : ['fail', `node ${process.versions.node}; prism-code needs 22 or later`];
}

function sigstore() {
  try {
    require.resolve('@sigstore/sign');
    require.resolve('@sigstore/verify');
    return ['ok', 'sigstore packages installed'];
  } catch {
    return ['warn', 'the optional sigstore packages are not installed; attest and verify-attestation need them'];
  }
}

function doctor() {
  const results = [node(), sigstore()];
  for (const [status, message] of results) process.stdout.write(`${status.padEnd(6)}${message}\n`);
  return results.some(([status]) => status === 'fail') ? 1 : 0;
}

const [command] = process.argv.slice(2);
if (command === METADATA_COMMAND) {
  process.stdout.write(`${JSON.stringify(METADATA)}\n`);
} else if (command === HOOK_COMMAND) {
  readFileSync(0, 'utf8');
  process.stdout.write(`${JSON.stringify({ messages: [] })}\n`);
} else if (command === '--help' || command === '-h') {
  process.stdout.write('Usage: prism-code doctor\n\nCheck Node.js and the optional sigstore packages. Exits 1 when a check fails.\n');
} else if (command === undefined) {
  process.exitCode = doctor();
} else {
  process.stderr.write(`prism-code doctor takes no arguments; got ${command}\n`);
  process.exitCode = 64;
}
