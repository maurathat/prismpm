// The kernel-proof predicate (ADR-018): Lean's kernel's verdict on every theorem, as a build judged it.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { spec } from './spec.mjs';
import { validate } from './json-schema.mjs';
import { here, readJson, schema } from './reference.mjs';

const { KERNEL_PROOF_PREDICATE_TYPE } = spec;
const SCHEMA = 'predicates/kernel-proof-v1.schema.json';
const fixture = readJson('fixtures/predicates/kernel-proof-v1/loan.json');
const copy = (value) => JSON.parse(JSON.stringify(value));
const errors = (value) => validate(schema(SCHEMA), value);

test('the type constant, the schema $id and the registry row agree', () => {
  assert.equal(KERNEL_PROOF_PREDICATE_TYPE, 'https://uor.foundation/prism/kernel-proof/v1');
  assert.equal(schema(SCHEMA).$id, `${KERNEL_PROOF_PREDICATE_TYPE}/schema.json`);
  const row = readJson('../predicates/registry.json').predicates.find((p) => p.predicateType === KERNEL_PROOF_PREDICATE_TYPE);
  assert.equal(row.schema, SCHEMA);
});

test('the fixture validates, and a predicate a verifier could mistake is refused', () => {
  assert.deepEqual(errors(fixture), []);
  const rejects = (value, why) => assert.notDeepEqual(errors(value), [], why);
  rejects({ ...fixture, signed: true }, 'an unknown member');
  rejects({ ...fixture, kernel: fixture.kernel.replace('blake3:', 'sha256:') }, 'a kernel not named by its blake3 label');
  rejects({ ...fixture, semantic_id: fixture.semantic_id.toUpperCase() }, 'uppercase hex, a second spelling of one id');
  const theorems = copy(fixture);
  theorems.theorems[0].status = 'assumed';
  rejects(theorems, 'a status no kernel reports');
  const axioms = copy(fixture);
  axioms.theorems[1].axioms = ['propext', 'propext'];
  rejects(axioms, 'an axiom listed twice');
  const { theorems: _, ...noTheorems } = fixture;
  rejects(noTheorems, 'no theorems at all');
});

/** The members a schema object declares, walking every $ref. */
function schemaMembers(root) {
  const members = new Set();
  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    if (node.$ref) return walk(root.$defs[node.$ref.split('/').pop()]);
    for (const [name, value] of Object.entries(node.properties ?? {})) {
      members.add((node.required ?? []).includes(name) ? name : `${name}?`);
      walk(value);
    }
    walk(node.items);
  };
  walk(root);
  return members;
}

test('the KernelProofPredicateV1 type and the schema declare the same members', () => {
  const source = readFileSync(here('../predicates/kernel-proof-v1.d.ts'), 'utf8').replace(/\/\*\*[\s\S]*?\*\//g, '');
  const declared = new Set([...source.matchAll(/^\s+([A-Za-z_]+\??):/gm)].map((m) => m[1]));
  assert.deepEqual(declared, schemaMembers(schema(SCHEMA)));
});
