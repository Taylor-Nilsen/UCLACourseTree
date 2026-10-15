import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const { DARS } = require("../parser.js");
const lines = JSON.parse(readFileSync(new URL('../sample/dars-lines.json', import.meta.url), 'utf8'));
const r = DARS.parse(lines);
const sec = t => r.sections.find(s => s.title.startsWith(t));
const grp = (s, n) => sec(s).groups.find(g => g.name.startsWith(n));
const codes = g => g.options.flatMap(o => o.alts);
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok  ' + name); };

t('header', () => {
  assert.equal(r.currentTerm, 'FA26'); assert.equal(r.student.expected, 'SP29'); assert.equal(r.unitsNeeded, 69);
});
t('taken courses and aliases', () => {
  assert.equal(r.taken['MAT SCI 104'].grade, 'IP');
  assert.equal(r.taken['MECH&AE 101'].grade, 'P'); // sample has letter grades scrubbed
  assert.equal(r.taken['CHEM 20A'].via, 'CHEM T01');
  assert.ok(r.taken['MATH 31B']);
  assert.deepEqual(Object.keys(r.taken).filter(k => /MAT S CI|MECH& AE/.test(k)), []);
});
t('lower division chemistry', () => {
  const g = grp('LOWER DIVISION CHEMISTRY', 'CHEM'); assert.equal(g.needCourses, 1);
  assert.deepEqual(g.options.map(o => o.alts), [['CHEM 20L']]);
});
t('upper division core', () => {
  const g = sec('UPPER DIVISION CORE').groups[0]; assert.equal(g.needCourses, 10); assert.equal(g.options.length, 10);
  assert.ok(g.options.some(o => o.alts.join() === 'MECH&AE 157,MECH&AE 157W'));
});
t('required track', () => {
  const s = sec('AEROSPACE ENGINEERING REQUIRED TRACK'); assert.equal(s.needSubgroups, 2);
  assert.deepEqual(s.groups.map(g => g.needCourses), [4, 1]);
});
t('TBA group', () => {
  const g = grp('AEROSPACE MAJOR FIELD', 'MATERIALS SCIENCE'); assert.equal(g.needCourses, 3);
  assert.ok(g.options.some(o => o.dept === 'MAT SCI' && o.num === '100' && o.to === '187'));
  assert.ok(g.notFrom.includes('MAT SCI 188'));
});
t('ethics: two same-named groups, expired window excluded, open included', () => {
  const s = sec('ENGINEERING ETHICS'); assert.equal(s.groups.length, 2);
  assert.ok(s.groups.every(g => g.name === 'ENGINEERING ETHICS'));
  const all = s.groups.flatMap(codes);
  assert.ok(!all.includes('C&EE 109EW')); assert.ok(all.includes('ENGR 2'));
});
t('engineering writing', () => {
  const g = sec('ENGINEERING WRITING').groups[0]; assert.ok(g.options.length > 100); assert.ok(codes(g).includes('MECH&AE 157W'));
});
t('arts and humanities subgroups', () => {
  assert.equal(sec('FOUNDATIONS OF THE ARTS AND HUMANITIES').needSubgroups, 1);
});
t('parseOptions shape', () => {
  const o = DARS.parseOptions('MECH&AE 102,105A,157 OR 157W ENGR 2(FA24-9999) MAT SCI 100 TO 187 CHEM 20B', 'FA26');
  // 6 option slots (157 OR 157W is one slot with two alts) = 7 course codes
  assert.equal(o.length, 6); assert.equal(o.flatMap(x => x.alts).length, 7);
  assert.deepEqual(o[2], { dept: 'MECH&AE', num: '157', alts: ['MECH&AE 157', 'MECH&AE 157W'] });
  assert.deepEqual(o[4], { dept: 'MAT SCI', num: '100', alts: ['MAT SCI 100'], to: '187' });
  assert.deepEqual(o[3].alts, ['ENGR 2']); assert.deepEqual(o[5].alts, ['CHEM 20B']);
  assert.deepEqual(DARS.parseOptions('ENGR 3(FA20-SU25)', 'FA26'), []);
});
t('termIndex', () => assert.equal(DARS.termIndex('WI27'), DARS.termIndex('FA26') + 1));
console.log(n + ' passed');
