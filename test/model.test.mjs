import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const { DARS } = require('../parser.js');
const { COURSES } = require('../courses.js');
const { MODEL } = require('../model.js');
const { TREE_LAYOUT } = require('../ui.js');
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
const inPlan = (mm, c) => mm.plan.some(p => p.courses.includes(c));
t('core: needs 10, shows 10 -> all auto-chosen; 157W resolved because 157 is never offered', () => {
  const g = grp(m, 'TWELVE'), c = chosen(g);
  assert.equal(c.length, 10); assert.ok(g.chosen.every(x => x.auto && /^required: 10 of 10/.test(x.why)));
  assert.ok(c.includes('MECH&AE 157W')); assert.ok(!c.includes('MECH&AE 157')); assert.equal(g.choice, false);
});
t('aero track: needs 4, shows 4 -> all chosen', () => {
  const g = grp(m, 'FOUR COURSES FROM THE AERO');
  assert.equal(g.chosen.length, 4); assert.ok(g.chosen.every(x => x.auto)); assert.equal(g.choice, false); assert.equal(g.selected, true);
});
t('space track: needs 1, shows 4 -> choice, nothing auto-picked, ready first, CHOOSE slot', () => {
  const g = grp(m, 'ONE COURSE FROM THE SPACE');
  assert.equal(g.choice, true); assert.equal(g.undecided, true); assert.deepEqual(g.chosen, []);
  assert.equal(g.alternatives.length, 4);
  const a = g.alternatives; assert.ok(a[0].ready);
  for (let i = 1; i < a.length; i++) assert.ok(a[i - 1].ready > a[i].ready || (a[i - 1].ready === a[i].ready && a[i - 1].unmet <= a[i].unmet), a[i].code);
  for (const x of a) assert.equal(typeof x.why, 'string');
  assert.ok(!a.some(x => /recommend/i.test(x.why)));
  assert.ok(inPlan(m, 'CHOOSE: ONE COURSE FROM THE SPACE TRACK'));
  assert.equal(node('CHOOSE: ONE COURSE FROM THE SPACE TRACK').status, 'placeholder');
});
t('pin C150R in space track -> chosen, slot gone', () => {
  const key = grp(m, 'ONE COURSE FROM THE SPACE').key;
  const mm = MODEL.build(parsed, { choices: { [key]: ['MECH&AE C150R'] } }), g = grp(mm, 'ONE COURSE FROM THE SPACE');
  assert.deepEqual(g.chosen.map(c => [c.code, c.auto]), [['MECH&AE C150R', false]]);
  assert.equal(g.undecided, false); assert.ok(inPlan(mm, 'MECH&AE C150R'));
  assert.ok(!mm.nodes.some(n => n.code.startsWith('CHOOSE: ONE COURSE')));
});
t('TBA: used/excluded courses are not options; 3 open slots', () => {
  const g = grp(m, 'MATERIALS SCIENCE'), all = chosen(g).concat(g.alternatives.map(a => a.code));
  for (const c of ['MAT SCI 104', 'CHEM 20B', 'MAT SCI 188']) assert.ok(!all.includes(c), c);
  assert.equal(g.choice, true); assert.equal(m.nodes.filter(n => n.code.startsWith('CHOOSE: MATERIALS')).length, 3);
});
t('ethics: both same-named groups shown, neither selected; pinning ENGR 2 selects its group', () => {
  const eth = m.groups.filter(g => g.name === 'ENGINEERING ETHICS');
  assert.equal(eth.length, 2); assert.ok(eth.every(g => !g.selected && g.undecided && g.altGroupKeys.length === 1));
  assert.ok(m.nodes.some(n => n.code.startsWith('CHOOSE: ENGINEERING ETHICS')));
  assert.ok(!inPlan(m, 'ENGR 2'));
  const k = eth.find(g => g.options.includes('ENGR 2')).key;
  const mm = MODEL.build(parsed, { choices: { [k]: ['ENGR 2'] } }), e2 = mm.groups.filter(g => g.name === 'ENGINEERING ETHICS');
  assert.deepEqual(e2.map(g => g.selected), eth.map(g => g.key === k));
  assert.ok(e2.every(g => !g.undecided)); assert.ok(inPlan(mm, 'ENGR 2'));
  assert.ok(!mm.nodes.some(n => n.code.startsWith('CHOOSE: ENGINEERING ETHICS')));
});
t('writing: a required course on the list (157W) satisfies it, no extra slot', () => {
  const g = grp(m, 'ENGINEERING WRITING');
  assert.equal(g.choice, false); assert.deepEqual(g.chosen.map(c => c.code), ['MECH&AE 157W']);
  assert.ok(!m.nodes.some(n => n.code.startsWith('CHOOSE: ENGINEERING WRITING')));
});
t('undeclared TBA holds slots in the plan (sample 2)', () => {
  const m2 = MODEL.build(DARS.parse(JSON.parse(readFileSync(new URL('../sample/dars-lines-2.json', import.meta.url), 'utf8'))), { perQuarter: 4 });
  const g = m2.groups.find(x => x.undeclared);
  assert.ok(g && g.choice && g.need === 3);
  assert.equal(m2.plan.flatMap(p => p.courses).filter(c => c.startsWith('CHOOSE: ' + g.name)).length, 3);
  assert.ok(m2.warnings.some(w => /no technical breadth area is declared/.test(w)));
});
t('GE groups still placeholders', () => {
  for (const n of ['HISTORICAL', 'SOCIAL']) { const g = grp(m, n); assert.ok(g.placeholder); assert.ok(g.options.length > 50); assert.ok(inPlan(m, 'GE: ' + g.name)); }
});
t('synthetic: OR-slot with both offered is its own choice; orPrev groups are alternatives; short list warns', () => {
  const o = (...alts) => ({ dept: 'X', num: '1', alts });
  const p = { student: { expected: 'SP29' }, currentTerm: 'FA26', unitsNeeded: 0, taken: {}, sections: [
    { title: 'S1', needSubgroups: null, groups: [{ name: 'A', needCourses: 2, taken: [], notFrom: [], options: [o('MECH&AE 161B'), o('MECH&AE 161A', 'ENGR 184')] }] },
    { title: 'S2', needSubgroups: null, groups: [{ name: 'B', needCourses: 1, taken: [], notFrom: [], options: [o('ENGR 186')] },
      { name: 'C', needCourses: 1, taken: [], notFrom: [], options: [o('ENGR 2')], orPrev: true }] },
    { title: 'S3', needSubgroups: null, groups: [{ name: 'D', needCourses: 3, taken: [], notFrom: [], options: [o('MECH&AE 161C')] }] }] };
  const mm = MODEL.build(p, {});
  const a = mm.groups.find(g => g.name === 'A'), sub = mm.groups.find(g => g.name === 'MECH&AE 161A OR ENGR 184');
  assert.deepEqual(chosen(a), ['MECH&AE 161B']); assert.ok(sub.choice && sub.undecided && sub.selected);
  const b = mm.groups.find(g => g.name === 'B'), c = mm.groups.find(g => g.name === 'C');
  assert.ok(!b.selected && !c.selected && b.altGroupKeys[0] === c.key);
  assert.ok(inPlan(mm, 'CHOOSE: S2: ENGR 186 or ENGR 2'));
  assert.ok(mm.warnings.some(w => /fewer options than it needs/.test(w)));
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
t('pin a GE placeholder option becomes a real node', () => {
  const g = grp(m, 'HISTORICAL'), code = g.options[0];
  const mm = MODEL.build(parsed, { choices: { [g.key]: [code] } });
  const nd = mm.nodes.find(x => x.code === code);
  assert.equal(nd.units, COURSES[code] ? COURSES[code].u : 4); assert.ok(nd.planned); // catalog data when the course is known
  assert.ok(!mm.nodes.some(x => x.code === 'GE: HISTORICAL ANALYSIS'));
});
t('stats', () => {
  assert.equal(m.stats.unitsNeeded, 69);
  assert.equal(m.stats.coursesRemaining, m.plan.reduce((s, p) => s + p.courses.length, 0));
  assert.equal(m.stats.plannedUnits, m.plan.reduce((s, p) => s + p.units, 0));
});

// ---- grade status and wildcard / range expansion (synthetic fixtures in test/fixtures)
const fx = name => DARS.parse(JSON.parse(readFileSync(new URL('./fixtures/' + name + '.json', import.meta.url), 'utf8')));
t('only passing grades count as done; failed / withdrawn / incomplete courses are still to take', () => {
  const mm = MODEL.build(fx('failed-withdrawn-repeats'), {}), nd = c => mm.nodes.find(x => x.code === c);
  assert.equal(nd('MATH 32A').status, 'done'); assert.equal(nd('MATH 32B').status, 'ip');
  for (const c of ['MATH 33A', 'MATH 115A', 'PHYSICS 1A']) { assert.notEqual(nd(c).status, 'done', c); assert.ok(nd(c).planned, c + ' planned'); }
  assert.ok(!mm.nodes.some(x => x.code === 'MATH 95' && x.status === 'done'));
  assert.equal(mm.stats.unitsEarned, 4 + 4 + 4 + 4 + 8); // 31A, 31B, 32A (B+ retake), 33B, ENGCOMP 3 (AP)
});
t('wildcards expand against COURSES and NOT FROM (codes and ranges) is honored', () => {
  const cs = MODEL.build(fx('eng-computer-science'), {}).groups.find(g => g.name === 'FIVE COMPUTER SCIENCE ELECTIVES');
  assert.ok(cs.options.length > 20 && cs.options.every(c => /^COM SCI (CM|M|C)?1\d\d[A-Z]*$/.test(c)), cs.options.join());
  const alts = cs.alternatives.map(a => a.code).concat(cs.chosen.map(c => c.code));
  assert.ok(!alts.includes('COM SCI 188') && !alts.includes('COM SCI 199'));
  const h = MODEL.build(fx('hostile-psychology'), {}).groups.find(g => g.name === 'FOUR UPPER DIVISION ELECTIVES');
  assert.ok(h.options.includes('PSYCH 110') && h.options.some(c => /^LING /.test(c)));
  assert.ok(!h.options.some(c => /^PSYCH 19[2-9]/.test(c)), 'PSYCH 192-199 excluded');
  assert.ok(!cs.options.includes('COM SCI 188'));
});
// ---- paths: an alternative set is one decision made of whole-group paths
const p2 = DARS.parse(JSON.parse(readFileSync(new URL('../sample/dars-lines-2.json', import.meta.url), 'utf8')));
const m2 = MODEL.build(p2, { perQuarter: 4 });
const cap = m2.pathChoices.find(pc => pc.title === 'BIOENGINEERING CAPSTONE');
const planned = mm => mm.plan.flatMap(p => p.courses);
t('sample 2: capstone is one path choice: [177A, 177B] (need 2) or [177C] (need 1)', () => {
  assert.ok(cap); assert.equal(cap.pick, 1); assert.deepEqual(cap.chosenPaths, []);
  assert.deepEqual(cap.paths.map(p => [p.courses, p.need, p.choice]), [[['BIOENGR 177A', 'BIOENGR 177B'], 2, false], [['BIOENGR 177C'], 1, false]]);
  assert.equal(cap.paths[1].ready, true); assert.equal(cap.paths[0].ready, false); assert.ok(cap.paths[0].unmet > 0);
});
const SEVEN = ['BIOENGR 110', 'BIOENGR 120', 'BIOENGR 122', 'BIOENGR 167L', 'BIOENGR 175', 'BIOENGR 176', 'BIOENGR 180'];
t('sample 2: the 7 required upper-division courses are planned whatever the capstone path', () => {
  const g = m2.groups.find(x => /^EIGHT BIOENGINEERING/.test(x.name)), req = g.chosen.map(c => c.code);
  assert.ok(g.selected && !g.choice && req.length === 7);
  for (const gk of [null, ...cap.paths.map(p => p.groupKey)]) {
    const mm = gk ? MODEL.build(p2, { choices: { ['path:' + cap.key]: [gk] } }) : m2;
    for (const c of req) assert.ok(planned(mm).includes(c) || p2.taken[c], c);
  }
  assert.ok(req.every(c => SEVEN.includes(c) || p2.taken[c]), req.join());
});
const capNode = mm => mm.nodes.filter(n => n.status === 'path' && n.pathChoiceKey === cap.key);
t('sample 2 undecided: one CHOOSE slot naming both paths; one path node; no option nodes; 177A/B/C not nodes or planned', () => {
  const slots = planned(m2).filter(c => c.startsWith('CHOOSE: BIOENGINEERING CAPSTONE'));
  assert.equal(slots.length, 1); assert.ok(slots[0].includes('177A + 177B') && slots[0].includes('177C'), slots[0]);
  const sl = m2.nodes.find(n => n.code === slots[0]); assert.equal(sl.pathChoiceKey, cap.key); assert.equal(sl.units, 8);
  assert.ok(!m2.nodes.some(n => n.status === 'option'));
  assert.deepEqual(capNode(m2).map(n => n.code), ['PATH: ' + cap.key]);
  for (const c of ['BIOENGR 177A', 'BIOENGR 177B', 'BIOENGR 177C']) { assert.ok(!m2.nodes.some(n => n.code === c), c); assert.ok(!planned(m2).includes(c)); }
  assert.ok(!planned(m2).some(c => c.startsWith('PATH: ')));
  assert.equal(m2.stats.coursesRemaining, planned(m2).length);
});
t('sample 2 undecided: each path exposes its per-course prereq chain; prereqs of every path have edges into the card', () => {
  assert.deepEqual(cap.paths.map(p => p.chain), [
    [{ code: 'BIOENGR 177A', pre: ['BIOENGR 167L', 'BIOENGR 176'], after: [] }, { code: 'BIOENGR 177B', pre: [], after: ['BIOENGR 177A'] }],
    [{ code: 'BIOENGR 177C', pre: [], after: [] }]]);
  const into = m2.edges.filter(e => e.to === 'PATH: ' + cap.key).map(e => e.from).sort();
  assert.deepEqual(into, ['BIOENGR 167L', 'BIOENGR 176']);
});
const pick = i => MODEL.build(p2, { choices: { ['path:' + cap.key]: [cap.paths[i].groupKey] } });
t('choosing path 2 plans 177C (not a standalone tree node: it folds into the card); 177A/B are neither planned nor nodes', () => {
  const b = pick(1), nd = b.nodes.find(n => n.code === 'BIOENGR 177C');
  assert.ok(planned(b).includes('BIOENGR 177C')); assert.ok(!b.nodes.some(n => /BIOENGR 177[AB]/.test(n.code)));
  assert.equal(TREE_LAYOUT.cardOf(nd, b.pathChoices), 'PATH: ' + cap.key);
  const { nodes } = TREE_LAYOUT.layers(b.nodes, b.edges, b.pathChoices);
  assert.ok(!nodes.some(n => n.code === 'BIOENGR 177C')); assert.equal(capNode(b).length, 1);
  assert.ok(!planned(b).some(c => c.startsWith('CHOOSE: BIOENGINEERING CAPSTONE')));
});
t('choosing path 1 plans 177A before 177B and drops 177C and the slot', () => {
  const a = pick(0);
  const term = (mm, c) => { const p = mm.plan.find(q => q.courses.includes(c)); return p && DARS.termIndex(p.term); };
  assert.ok(term(a, 'BIOENGR 177A') < term(a, 'BIOENGR 177B'));
  assert.ok(COURSES['BIOENGR 177B'].pre.some(og => og.includes('BIOENGR 177A')));
  assert.ok(!a.nodes.some(n => n.code === 'BIOENGR 177C'));
  assert.ok(!planned(a).some(c => c.startsWith('CHOOSE: BIOENGINEERING CAPSTONE')));
  assert.deepEqual(a.pathChoices.find(pc => pc.key === cap.key).chosenPaths, [cap.paths[0].groupKey]);
});
t('tree layout: the capstone card sits late while undecided, at column 0 for 177C, late again for 177A + 177B', () => {
  const L = mm => TREE_LAYOUT.layers(mm.nodes, mm.edges, mm.pathChoices).layer;
  const k = 'PATH: ' + cap.key, u = L(m2), c = L(pick(1)), ab = L(pick(0));
  assert.ok(u[k] > 0); assert.equal(u[k], Math.max(u['BIOENGR 167L'], u['BIOENGR 176']) + 2); // one right of where 177A would sit
  assert.equal(c[k], 0);
  assert.ok(ab[k] > 0); assert.equal(ab[k], u[k]);
  assert.ok(!TREE_LAYOUT.layers(pick(0).nodes, pick(0).edges, pick(0).pathChoices).edges.some(e => /177/.test(e.from)), 'internal 177A -> 177B is not an edge');
});
t('a prereq only an undecided path needs is added as a node but not planned', () => {
  const o = c => ({ dept: c.split(' ')[0], num: c.split(' ')[1], alts: [c] });
  const p = { student: { expected: 'SP29' }, currentTerm: 'FA26', unitsNeeded: 0, taken: {}, sections: [
    { title: 'S', needSubgroups: null, groups: [{ name: 'CAP', needCourses: 2, taken: [], notFrom: [], options: [o('BIOENGR 177A'), o('BIOENGR 177B')] },
      { name: 'CAP', needCourses: 1, taken: [], notFrom: [], options: [o('BIOENGR 177C')] }] }] };
  const mm = MODEL.build(p, {}), n176 = mm.nodes.find(n => n.code === 'BIOENGR 176');
  assert.ok(n176 && n176.pathPrereq); assert.equal(n176.planned, undefined); assert.ok(!planned(mm).includes('BIOENGR 176'));
  assert.ok(mm.edges.some(e => e.from === 'BIOENGR 176' && e.to.startsWith('PATH: ')));
});
t('sample 1: the two ENGINEERING ETHICS groups are one path choice: an 11-option list or ENGR 2', () => {
  const pc = m.pathChoices.find(x => x.title === 'ENGINEERING ETHICS');
  assert.equal(pc.paths.length, 2);
  const list = pc.paths.find(p => p.choice), e2 = pc.paths.find(p => !p.choice);
  assert.ok(list && e2); assert.deepEqual(e2.courses, ['ENGR 2']); assert.deepEqual(list.courses, []);
  assert.equal(list.summary, 'pick 1 of 11 from ETHICS list');
  assert.ok(!m.nodes.some(n => n.code === 'ENGR 2'));
  assert.ok(m.nodes.some(n => n.code === 'PATH: ' + pc.key && n.status === 'path'));
  assert.ok(planned(m).some(c => c.startsWith('CHOOSE: ENGINEERING ETHICS:') && c.includes('pick 1 of 11') && c.includes('ENGR 2')));
  // picking the list path selects that group and leaves its own pick-1 slot
  const mm = MODEL.build(parsed, { choices: { ['path:' + pc.key]: [list.groupKey] } });
  assert.ok(mm.groups.find(g => g.key === list.groupKey).selected);
  assert.ok(!mm.nodes.some(n => n.code === 'ENGR 2'));
  assert.ok(planned(mm).includes('CHOOSE: ENGINEERING ETHICS'));
});
console.log(n + ' passed');
