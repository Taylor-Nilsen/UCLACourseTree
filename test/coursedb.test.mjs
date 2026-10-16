import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { statSync } from 'node:fs';
const require = createRequire(import.meta.url);
const { COURSES: D } = require('../data/ucla-courses.js');
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok  ' + name); };

t('database loads with > 5000 courses and stays under 6 MB', () => {
  assert.ok(Object.keys(D).length > 5000, `only ${Object.keys(D).length} courses`);
  assert.ok(statSync(new URL('../data/ucla-courses.js', import.meta.url)).size < 6e6);
});
t('spot-check courses exist with titles, numeric units, well-formed fields', () => {
  for (const k of ['COM SCI 111', 'HIST 13A', 'FILM TV 4', 'NURSING 160', 'MUSC 15', 'ECON 101', 'BIOENGR 177A', 'BIOENGR 100', 'CHEM 30A', 'LIFESCI 7B', 'COM SCI 32',
    'MATH 33B', 'ECON 11', 'PSYCH 100A', 'ENGCOMP 3', 'PHYSICS 1B']) {
    const e = D[k];
    assert.ok(e, `${k} missing`); assert.ok(e.t, `${k} has no title`); assert.ok(Number.isFinite(e.u) && e.u > 0, `${k} units`);
    assert.ok(Array.isArray(e.pre) && e.pre.every(g => Array.isArray(g) && g.length));
    assert.match(e.off, /^(\?|F?W?S?)$/);
  }
});
t('offerings: off is the set of quarters in offTerms; off "" carries an offNote', () => {
  let known = 0;
  for (const [k, e] of Object.entries(D)) {
    assert.match(e.off, /^(\?|F?W?S?)$/, k);
    if (e.offTerms) { known++; assert.equal(e.off, 'FWS'.split('').filter(q => e.offTerms.some(t => t[2] === q)).join(''), k); assert.ok(e.offTerms.every(t => /^\d\d[FWS]$/.test(t)), k); }
    else if (e.off === '') { known++; assert.match(e.offNote, /^not offered since /, k); }
    else assert.ok(e.off === '?' && /tutorial/.test(e.offNote), k + ' has neither offTerms nor offNote');
  }
  assert.ok(known / Object.keys(D).length > 0.85, `offerings known for ${known}`);
  assert.ok(Object.values(D).filter(e => e.offTerms).length > 4000);
  for (const k of ['COM SCI 32', 'MATH 33B', 'PSYCH 100A', 'ECON 101']) assert.equal(D[k].off, 'FWS', k); // large courses run every quarter
});
t('requisite parsing on known entries', () => {
  assert.deepEqual(D['COM SCI 111'].pre, [['COM SCI 32'], ['COM SCI 33'], ['COM SCI 35L']]);
  assert.deepEqual(D['STATS 100B'].pre, [['STATS 100A', 'MATH 170A', 'MATH 170E']]); // OR across subjects
  assert.deepEqual(D['BIOENGR 110'].pre, [['BIOENGR 100'], ['MATH 33B']]);
  assert.deepEqual(D['CHEM 30A'].pre, [['CHEM 20B']]); // grade minimum ignored
  assert.deepEqual(D['PHYSICS 1B'].pre, [['PHYSICS 1A'], ['MATH 31B'], ['MATH 32A']]); // corequisite 32B excluded
});
t('dangling prerequisite references < 3%', () => {
  let refs = 0, bad = 0;
  for (const e of Object.values(D)) for (const g of e.pre) for (const c of g) { refs++; if (!D[c]) bad++; }
  assert.ok(refs > 3000); assert.ok(bad / refs < 0.03, `${bad}/${refs} dangling`);
});
console.log(`${n} coursedb tests passed`);
