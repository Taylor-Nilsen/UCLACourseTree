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

// ---- sample 2: different print margins (headers x~88/112, data x~113), browser print chrome, OR) groups
const r2 = DARS.parse(JSON.parse(readFileSync(new URL('../sample/dars-lines-2.json', import.meta.url), 'utf8')));
const sec2 = s => r2.sections.find(x => x.title.startsWith(s));
const grp2 = (s, g) => sec2(s).groups.find(x => x.name.startsWith(g));
t('sample2 header and units check', () => {
  assert.equal(r2.currentTerm, 'FA26'); assert.equal(r2.student.expected, 'SP28'); assert.equal(r2.unitsNeeded, 9);
});
t('sample2 lower division math', () => {
  const g = sec2('LOWER DIVISION MATHEMATICS').groups[0]; assert.equal(g.needCourses, 1);
  assert.deepEqual(g.options.map(o => o.alts), [['MATH 33B']]);
});
t('sample2 required courses, OR) capstone, no needSubgroups', () => {
  const s = sec2('BIOENGINEERING REQUIRED COURSES'); assert.equal(s.needSubgroups, null);
  assert.deepEqual(s.groups.map(g => [g.name, g.needCourses, g.options.length, !!g.orPrev]), [
    ['EIGHT BIOENGINEERING UPPER DIVISION REQUIRED COURSES', 7, 7, false],
    ['BIOENGINEERING CAPSTONE', 2, 2, false],
    ['BIOENGINEERING CAPSTONE OPTION 2', 1, 1, true]]);
});
t('sample2 TBA: separate section, undeclared group', () => {
  assert.ok(!r2.sections.some(s => /MAJOR FIELD ELECTIVES & TECHNICAL/.test(s.title)));
  const s = sec2('SELECT THREE COURSES FROM ONE TECHNICAL BREADTH');
  const g = s.groups[0]; assert.equal(g.needCourses, 3); assert.equal(g.needUnits, 12);
  assert.equal(g.undeclared, true); assert.deepEqual(g.options, []);
  const e = grp2('SELECT THREE COURSES', 'BIOENGINEERING SIX MAJOR FIELD ELECTIVES');
  assert.equal(e.needCourses, 6); assert.equal(e.options.length, 29); assert.ok(!e.undeclared);
  assert.ok(codes(e).includes('BIOENGR CM187') && codes(e).includes('BIOENGR C101')); // first and last continuation lines
});
t('sample2 ethics and residence', () => {
  assert.equal(sec2('ENGINEERING ETHICS REQUIREMENT').groups[0].needCourses, 1);
  assert.ok(codes(sec2('ENGINEERING ETHICS REQUIREMENT').groups[0]).includes('ENGR 188EW'));
  assert.ok(sec2('HSSEAS'));
});
t('sample2 print chrome ignored', () => {
  assert.ok(!r2.sections.some(s => /dars|printerFriendly|My Audit/i.test(s.title + (s.note || ''))));
});
t('sample2 taken courses', () => {
  const k = Object.keys(r2.taken);
  assert.ok(k.length >= 40 && k.length <= 50);
  for (const c of ['BIOENGR 10', 'BIOENGR 100', 'PHYSICS 4AL', 'CHEM 30AL', 'CHEM 20A', 'MATH 32B']) assert.ok(r2.taken[c], c);
  assert.equal(r2.taken['BIOENGR 100'].grade, 'IP'); assert.equal(r2.taken['PHYSICS 4AL'].grade, 'IP');
  assert.equal(r2.taken['MATH 31A'].via, 'MATH T01');
  assert.ok(!k.some(c => /BIOENGR10|PHYSICS4AL/.test(c)));
});
t('top-level caps lines go to note, not title', () => {
  const x = DARS.parse([{ x: 10, line: 'FIRST HEADER LINE' }, { x: 10, line: 'SECOND HEADER LINE' }, { x: 30, line: 'GROUP ONE' }, { x: 30, line: 'NEEDS: 1 COURSE' }, { x: 30, line: 'SELECT FROM: MATH 31A' }]);
  assert.equal(x.sections[0].title, 'FIRST HEADER LINE'); assert.equal(x.sections[0].note, 'SECOND HEADER LINE');
});
console.log(n + ' passed');
