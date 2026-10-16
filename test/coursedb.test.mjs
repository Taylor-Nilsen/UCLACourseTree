import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { statSync } from 'node:fs';
const require = createRequire(import.meta.url);
const { UCLA_COURSES: D } = require('../data/ucla-courses.js');
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok  ' + name); };

t('database loads with > 5000 courses and stays under 6 MB', () => {
  assert.ok(Object.keys(D).length > 5000, `only ${Object.keys(D).length} courses`);
  assert.ok(statSync(new URL('../data/ucla-courses.js', import.meta.url)).size < 6e6);
});
t('spot-check courses exist with titles, numeric units, well-formed fields', () => {
  for (const k of ['MECH&AE 102', 'MECH&AE 157D', 'BIOENGR 177A', 'BIOENGR 100', 'CHEM 30A', 'LIFESCI 7B', 'COM SCI 32',
    'MATH 33B', 'ECON 11', 'PSYCH 100A', 'ENGCOMP 3', 'PHYSICS 1B']) {
    const e = D[k];
    assert.ok(e, `${k} missing`); assert.ok(e.t, `${k} has no title`); assert.ok(Number.isFinite(e.u) && e.u > 0, `${k} units`);
    assert.ok(Array.isArray(e.pre) && e.pre.every(g => Array.isArray(g) && g.length));
    assert.match(e.off, /^(\?|F?W?S?)$/);
  }
});
t('requisite parsing on known entries', () => {
  assert.deepEqual(D['MECH&AE 102'].pre, [['MECH&AE 101'], ['MATH 33A'], ['PHYSICS 1A']]);
  assert.deepEqual(D['MECH&AE 157D'].pre, [['MECH&AE 105A'], ['MECH&AE 150A'], ['MECH&AE 157', 'MECH&AE 157W'], ['MECH&AE 171A']]);
  assert.deepEqual(D['CHEM 30A'].pre, [['CHEM 20B']]); // grade minimum ignored
  assert.deepEqual(D['PHYSICS 1B'].pre, [['PHYSICS 1A'], ['MATH 31B'], ['MATH 32A']]); // corequisite 32B excluded
});
t('dangling prerequisite references < 3%', () => {
  let refs = 0, bad = 0;
  for (const e of Object.values(D)) for (const g of e.pre) for (const c of g) { refs++; if (!D[c]) bad++; }
  assert.ok(refs > 3000); assert.ok(bad / refs < 0.03, `${bad}/${refs} dangling`);
});
console.log(`${n} coursedb tests passed`);
