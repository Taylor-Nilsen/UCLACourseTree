import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const { DARS } = require('../parser.js');
const { COURSES } = require('../courses.js');
const { MODEL } = require('../model.js');
const parsed = DARS.parse(JSON.parse(readFileSync(new URL('../sample/dars-lines.json', import.meta.url), 'utf8')));
const m = MODEL.build(parsed, { perQuarter: 4 });
const grp = (mm, n) => mm.groups.find(g => g.name.startsWith(n) && g.selected !== false) || mm.groups.find(g => g.name.startsWith(n));
const chosen = g => g.chosen.map(c => c.code);
const node = c => m.nodes.find(n => n.code === c);
const termOf = c => (m.plan.find(p => p.courses.includes(c)) || {}).term;
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok  ' + name); };

t('CHEM 20L chosen and planned', () => {
  assert.deepEqual(chosen(grp(m, 'CHEMISTRY 20A')), ['CHEM 20L']);
  assert.ok(termOf('CHEM 20L')); assert.equal(node('CHEM 20L').planned, termOf('CHEM 20L'));
});
t('core picks 157W not 157', () => {
  const c = chosen(grp(m, 'TWELVE')); assert.ok(c.includes('MECH&AE 157W')); assert.ok(!c.includes('MECH&AE 157'));
  assert.equal(c.length, 10);
});
t('TBA excludes courses used elsewhere, picks rec-weighted MAT SCI', () => {
  const g = grp(m, 'MATERIALS SCIENCE'), all = chosen(g).concat(g.alternatives.map(a => a.code));
  for (const c of ['MAT SCI 104', 'CHEM 20B']) assert.ok(!all.includes(c), c);
  assert.deepEqual(chosen(g).slice(0, 2), ['MAT SCI 143A', 'MAT SCI 151']);
  assert.equal(chosen(g).length, 3);
});
t('ethics picks ENGR 2, writing reuses 157W', () => {
  const eth = m.groups.filter(g => g.name === 'ENGINEERING ETHICS');
  assert.equal(eth.filter(g => g.selected).length, 1);
  assert.deepEqual(chosen(eth.find(g => g.selected)), ['ENGR 2']);
  assert.ok(eth.every(g => g.altGroupKeys.length === 1));
  const w = grp(m, 'ENGINEERING WRITING').chosen[0];
  assert.equal(w.code, 'MECH&AE 157W'); assert.equal(w.auto, true); assert.match(w.why, /already in the plan/);
});
t('157D in WI, 157E the following SP', () => {
  const d = termOf('MECH&AE 157D'), e = termOf('MECH&AE 157E');
  assert.match(d, /^WI/); assert.equal(e, 'SP' + d.slice(2));
});
t('nothing planned before its prereqs', () => {
  const idx = c => parsed.taken[c] || (c === 'CHEM 20A' || c === 'MATH 31B') ? -Infinity : termOf(c) ? DARS.termIndex(termOf(c)) : Infinity;
  for (const p of m.plan) for (const c of p.courses) for (const og of (COURSES[c] || { pre: [] }).pre)
    assert.ok(og.some(x => idx(x) < DARS.termIndex(p.term)), c + ' before ' + og);
});
t('perQuarter respected', () => { for (const p of m.plan) assert.ok(p.courses.length <= 4, p.term); });
t('count-check warning', () => { assert.ok(m.warnings.some(w => /wants 5 .* add up to 4/.test(w))); });
t('166A only in fall', () => {
  for (const pq of [2, 3, 4]) { const mm = MODEL.build(parsed, { perQuarter: pq }); const p = mm.plan.find(p => p.courses.includes('MECH&AE 166A')); assert.match(p.term, /^FA/); }
});
t('pin C150R in space track', () => {
  const key = grp(m, 'ONE COURSE FROM THE SPACE').key;
  const mm = MODEL.build(parsed, { choices: { [key]: ['MECH&AE C150R'] } });
  assert.deepEqual(grp(mm, 'ONE COURSE FROM THE SPACE').chosen.map(c => [c.code, c.auto]), [['MECH&AE C150R', false]]);
});
t('pin a GE placeholder option becomes a real node', () => {
  const g = grp(m, 'HISTORICAL'), code = g.options[0];
  const mm = MODEL.build(parsed, { choices: { [g.key]: [code] } });
  const nd = mm.nodes.find(x => x.code === code);
  assert.equal(nd.units, 4); assert.deepEqual(nd.prereqs, []); assert.ok(nd.planned);
  assert.ok(!mm.nodes.some(x => x.code === 'GE: HISTORICAL ANALYSIS'));
});
t('stats', () => {
  assert.equal(m.stats.unitsNeeded, 69);
  assert.equal(m.stats.coursesRemaining, m.plan.reduce((s, p) => s + p.courses.length, 0));
  assert.equal(m.stats.plannedUnits, m.plan.reduce((s, p) => s + p.units, 0));
});
console.log(n + ' passed');
