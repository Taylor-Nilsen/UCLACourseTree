import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const { DARS } = require('../parser.js');
const { COURSES } = require('../data/ucla-courses.js');
const { MODEL } = require('../model.js');
const { TREE_LAYOUT } = require('../ui.js');
// synthetic courses (subject ZZ) so the offering rules are tested independently of the generated data
Object.assign(COURSES, Object.fromEntries([
  ['ZZ 10', 'FWS'], ['ZZ 11', 'FWS'], ['ZZ 12', 'FWS'], ['ZZ 13', 'FWS'], ['ZZ 14', 'FWS'], ['ZZ 15', 'FWS'],
  ['ZZ 21', 'F'], ['ZZ 22', 'W', [['ZZ 21']]], ['ZZ 30', ''], ['ZZ 30W', 'FWS'], ['ZZ 31', ''], ['ZZ 32', 'S'], ['ZZ 33', 'W'],
].map(([k, off, pre = []]) => [k, { t: k, u: 4, pre, off, ...(off ? {} : { offNote: 'not offered since Spring 2023' }) }])));
const zz = c => ({ dept: 'ZZ', num: c.split(' ')[1], alts: [c] }), zzOr = (...alts) => ({ dept: 'ZZ', num: alts[0].split(' ')[1], alts });
const synth = groups => ({ student: { expected: 'SP29' }, currentTerm: 'FA26', unitsNeeded: 0, taken: {},
  sections: [{ title: 'S', needSubgroups: null, groups: groups.map(([name, needCourses, options]) => ({ name, needCourses, taken: [], notFrom: [], options })) }] });
const offered = c => COURSES[c] && COURSES[c].off !== '';
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
t('sample 1 core: needs 10, shows 10 -> all auto-chosen; an OR slot keeps only its offered course', () => {
  const g = grp(m, 'TWELVE'), c = chosen(g);
  assert.equal(c.length, 10); assert.ok(g.chosen.every(x => x.auto && /^required: 10 of 10/.test(x.why)));
  assert.ok(c.every(offered), c.join()); assert.equal(g.choice, false);
});
t('sample 1 track group: needs 4, shows 4 -> all chosen', () => {
  const g = grp(m, 'FOUR COURSES FROM THE AERO');
  assert.equal(g.chosen.length, 4); assert.ok(g.chosen.every(x => x.auto)); assert.equal(g.choice, false); assert.equal(g.selected, true);
});
t('sample 1 pick-1 group: every offered option is an alternative, nothing auto-picked, ready first, CHOOSE slot', () => {
  const g = grp(m, 'ONE COURSE FROM THE SPACE');
  assert.equal(g.choice, true); assert.equal(g.undecided, true); assert.deepEqual(g.chosen, []);
  assert.deepEqual(g.alternatives.map(a => a.code).sort(), g.options.filter(c => offered(c) && !parsed.taken[c]).sort());
  const a = g.alternatives; assert.ok(a[0].ready);
  for (let i = 1; i < a.length; i++) assert.ok(a[i - 1].ready > a[i].ready || (a[i - 1].ready === a[i].ready && a[i - 1].unmet <= a[i].unmet), a[i].code);
  for (const x of a) assert.equal(typeof x.why, 'string');
  assert.ok(!a.some(x => /recommend/i.test(x.why)));
  assert.ok(inPlan(m, 'CHOOSE: ONE COURSE FROM THE SPACE TRACK'));
  assert.equal(node('CHOOSE: ONE COURSE FROM THE SPACE TRACK').status, 'placeholder');
});
t('pinning an option in a pick-1 group -> chosen, slot gone', () => {
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
t('writing: a required course that is also on the writing list satisfies it, no extra slot', () => {
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
  const p = { student: { expected: 'SP29' }, currentTerm: 'FA26', unitsNeeded: 0, taken: {}, sections: [
    { title: 'S1', needSubgroups: null, groups: [{ name: 'A', needCourses: 2, taken: [], notFrom: [], options: [zz('ZZ 10'), zzOr('ZZ 11', 'ZZ 12')] }] },
    { title: 'S2', needSubgroups: null, groups: [{ name: 'B', needCourses: 1, taken: [], notFrom: [], options: [zz('ZZ 13')] },
      { name: 'C', needCourses: 1, taken: [], notFrom: [], options: [zz('ZZ 14')], orPrev: true }] },
    { title: 'S3', needSubgroups: null, groups: [{ name: 'D', needCourses: 3, taken: [], notFrom: [], options: [zz('ZZ 15')] }] }] };
  const mm = MODEL.build(p, {});
  const a = mm.groups.find(g => g.name === 'A'), sub = mm.groups.find(g => g.name === 'ZZ 11 OR ZZ 12');
  assert.deepEqual(chosen(a), ['ZZ 10']); assert.ok(sub.choice && sub.undecided && sub.selected);
  const b = mm.groups.find(g => g.name === 'B'), c = mm.groups.find(g => g.name === 'C');
  assert.ok(!b.selected && !c.selected && b.altGroupKeys[0] === c.key);
  assert.ok(inPlan(mm, 'CHOOSE: S2: ZZ 13 or ZZ 14'));
  assert.ok(mm.warnings.some(w => /fewer options than it needs/.test(w)));
});
const QTR = { FA: 'F', WI: 'W', SP: 'S' };
t('a course is only planned in quarters it is offered (both samples, 2-4 per quarter)', () => {
  for (const f of ['dars-lines.json', 'dars-lines-2.json']) for (const pq of [2, 3, 4]) {
    const mm = MODEL.build(DARS.parse(JSON.parse(readFileSync(new URL('../sample/' + f, import.meta.url), 'utf8'))), { perQuarter: pq });
    let n = 0;
    for (const q of mm.plan) for (const c of q.courses) if (COURSES[c] && COURSES[c].off !== '?') {
      n++; assert.ok(COURSES[c].off.includes(QTR[q.term.slice(0, 2)]), `${f}: ${c} planned ${q.term}, offered ${JSON.stringify(COURSES[c].off)}`);
    }
    assert.ok(n > 5, f);
  }
});
t('a course offered in one quarter is planned only in that quarter, after its prereqs', () => {
  const mm = MODEL.build(synth([['R', 2, [zz('ZZ 21'), zz('ZZ 22')]]]), {});
  const at = c => mm.plan.find(q => q.courses.includes(c)).term;
  assert.equal(at('ZZ 21'), 'FA27'); assert.equal(at('ZZ 22'), 'WI28'); // FA26 is the current term
});
t('a course with off "" is never auto-chosen or planned when an offered alternative is in the same slot', () => {
  const mm = MODEL.build(synth([['R', 2, [zzOr('ZZ 30', 'ZZ 30W'), zz('ZZ 32')]], ['P', 1, [zz('ZZ 31'), zz('ZZ 33')]]]), {});
  const r = mm.groups.find(g => g.name === 'R');
  assert.deepEqual(chosen(r), ['ZZ 30W', 'ZZ 32']); assert.ok(r.chosen.every(x => x.auto)); assert.match(r.chosen[0].why, /ZZ 30 not offered recently/);
  assert.ok(!mm.groups.some(g => g.name === 'ZZ 30 OR ZZ 30W'), 'no pick between an offered and a never-offered course');
  const p = mm.groups.find(g => g.name === 'P'); // one viable option left: required, not a choice
  assert.equal(p.choice, false); assert.deepEqual(chosen(p), ['ZZ 33']);
  for (const c of ['ZZ 30', 'ZZ 31']) { assert.ok(!inPlan(mm, c), c); assert.ok(!mm.nodes.some(n => n.code === c), c); }
});
t('nothing planned before its prereqs', () => {
  const idx = c => parsed.taken[c] ? -Infinity : termOf(c) ? DARS.termIndex(termOf(c)) : Infinity;
  for (const p of m.plan) for (const c of p.courses) for (const og of (COURSES[c] || { pre: [] }).pre)
    assert.ok(og.some(x => idx(x) < DARS.termIndex(p.term)), c + ' before ' + og);
});
t('perQuarter respected', () => { for (const p of m.plan) assert.ok(p.courses.length <= 4, p.term); });
t('count-check warning', () => { assert.ok(m.warnings.some(w => /wants 5 .* add up to 4/.test(w))); });
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
const L = mm => TREE_LAYOUT.layers(mm.nodes, mm.edges, mm.pathChoices);
const real = (mm, c) => mm.nodes.find(n => n.code === c && ['ready', 'locked'].includes(n.status));
const hasEdge = (mm, from, to) => mm.edges.some(e => e.from === from && e.to === to);
t('choosing path 2: no capstone card; 177C is a normal node tagged fromPath; 177A/B absent', () => {
  const b = pick(1), nd = real(b, 'BIOENGR 177C');
  assert.ok(planned(b).includes('BIOENGR 177C')); assert.ok(nd && nd.planned); assert.equal(nd.fromPath, cap.key);
  assert.ok(!b.nodes.some(n => /BIOENGR 177[AB]/.test(n.code))); assert.equal(capNode(b).length, 0);
  assert.equal(TREE_LAYOUT.cardOf(nd, b.pathChoices), null);
  assert.ok(L(b).nodes.some(n => n.code === 'BIOENGR 177C'));
  assert.ok(!planned(b).some(c => c.startsWith('CHOOSE: BIOENGINEERING CAPSTONE')));
});
t('choosing path 1: no capstone card; 177A/177B are normal nodes with real prereq edges, layered in order', () => {
  const a = pick(0);
  assert.equal(capNode(a).length, 0); assert.ok(!a.nodes.some(n => n.status === 'path' && n.pathChoiceKey === cap.key));
  for (const c of ['BIOENGR 177A', 'BIOENGR 177B']) { assert.ok(real(a, c), c); assert.equal(real(a, c).fromPath, cap.key); assert.ok(!real(a, c).pathPrereq); }
  for (const [f, to] of [['BIOENGR 177A', 'BIOENGR 177B'], ['BIOENGR 167L', 'BIOENGR 177A'], ['BIOENGR 176', 'BIOENGR 177A']]) assert.ok(hasEdge(a, f, to), f + ' -> ' + to);
  const { layer, nodes, edges } = L(a);
  assert.ok(layer['BIOENGR 177A'] > layer['BIOENGR 167L'] && layer['BIOENGR 177A'] > layer['BIOENGR 176']);
  assert.ok(layer['BIOENGR 177B'] > layer['BIOENGR 177A']);
  assert.equal(layer['BIOENGR 177A'], Math.max(layer['BIOENGR 167L'], layer['BIOENGR 176']) + 1);
  assert.ok(nodes.some(n => n.code === 'BIOENGR 177A') && nodes.some(n => n.code === 'BIOENGR 177B'));
  assert.ok(edges.some(e => e.from === 'BIOENGR 177A' && e.to === 'BIOENGR 177B'), 'internal 177A -> 177B is drawn');
});
t('clearing the capstone choice brings back exactly one path node, at the earliest column a path allows', () => {
  const u = MODEL.build(p2, { perQuarter: 4, choices: {} });
  assert.equal(capNode(u).length, 1);
  assert.ok(!u.nodes.some(n => n.fromPath));
  const lay = L(u).layer;
  assert.equal(lay['PATH: ' + cap.key], 0); // 177C has no prereqs, so the card can sit in the first column
  assert.ok(lay['PATH: ' + cap.key] < Math.max(lay['BIOENGR 167L'], lay['BIOENGR 176']) + 1, 'earlier than where the 177A path would put it');
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
t('a prereq only an undecided path needs is added as a node but not planned', () => {
  const o = c => ({ dept: c.split(' ')[0], num: c.split(' ')[1], alts: [c] });
  const p = { student: { expected: 'SP29' }, currentTerm: 'FA26', unitsNeeded: 0, taken: {}, sections: [
    { title: 'S', needSubgroups: null, groups: [{ name: 'CAP', needCourses: 2, taken: [], notFrom: [], options: [o('BIOENGR 177A'), o('BIOENGR 177B')] },
      { name: 'CAP', needCourses: 1, taken: [], notFrom: [], options: [o('BIOENGR 177C')] }] }] };
  const mm = MODEL.build(p, {}), n176 = mm.nodes.find(n => n.code === 'BIOENGR 176');
  assert.ok(n176 && n176.pathPrereq); assert.equal(n176.planned, undefined); assert.ok(!planned(mm).includes('BIOENGR 176'));
  assert.ok(mm.edges.some(e => e.from === 'BIOENGR 176' && e.to.startsWith('PATH: ')));
});
t('sample 1: the two ENGINEERING ETHICS groups are one path choice: a list of its offered options or ENGR 2', () => {
  const pc = m.pathChoices.find(x => x.title === 'ENGINEERING ETHICS');
  assert.equal(pc.paths.length, 2);
  const list = pc.paths.find(p => p.choice), e2 = pc.paths.find(p => !p.choice);
  assert.ok(list && e2); assert.deepEqual(e2.courses, ['ENGR 2']); assert.deepEqual(list.courses, []);
  const nList = m.groups.find(g => g.key === list.groupKey).options.filter(c => offered(c) && !parsed.taken[c]).length;
  assert.ok(nList > 5); assert.equal(list.summary, `select 1 of ${nList} from ETHICS list`);
  assert.ok(!m.nodes.some(n => n.code === 'ENGR 2'));
  assert.ok(m.nodes.some(n => n.code === 'PATH: ' + pc.key && n.status === 'path'));
  assert.ok(planned(m).some(c => c.startsWith('CHOOSE: ENGINEERING ETHICS:') && c.includes(`select 1 of ${nList}`) && c.includes('ENGR 2')));
  // picking the list path selects that group and leaves its own pick-1 slot
  const mm = MODEL.build(parsed, { choices: { ['path:' + pc.key]: [list.groupKey] } });
  assert.ok(mm.groups.find(g => g.key === list.groupKey).selected);
  assert.ok(!mm.nodes.some(n => n.code === 'ENGR 2'));
  assert.ok(planned(mm).includes('CHOOSE: ENGINEERING ETHICS'));
  assert.ok(!mm.nodes.some(n => n.code === 'PATH: ' + pc.key));
  assert.equal(mm.nodes.find(n => n.code === 'CHOOSE: ENGINEERING ETHICS').fromPath, pc.key);
});
// ---- exclusive picks: a course pinned for one requirement is no option anywhere else
const codesOf = g => g.options.concat(g.alternatives.map(a => a.code), g.chosen.filter(c => !c.auto).map(c => c.code)); // chips = pins + alternatives
t('a MAT SCI course pinned in the TBA group is offered nowhere else; its node carries pickedFor', () => {
  const tba = grp(m, 'MATERIALS SCIENCE'), c = tba.alternatives[0].code;
  assert.match(c, /^MAT SCI /);
  const mm = MODEL.build(parsed, { choices: { [tba.key]: [c] } });
  assert.deepEqual(mm.groups.find(g => g.key === tba.key).chosen.map(x => [x.code, x.auto]), [[c, false]]);
  for (const g of mm.groups) if (g.key !== tba.key) assert.ok(!codesOf(g).includes(c), g.name);
  assert.equal(mm.nodes.find(x => x.code === c).pickedFor, tba.key);
  const sp = grp(m, 'ONE COURSE FROM THE SPACE'), s1 = sp.alternatives[0].code;
  assert.equal(MODEL.build(parsed, { choices: { [sp.key]: [s1] } }).nodes.find(x => x.code === s1).pickedFor, sp.key);
  assert.ok(!m.nodes.some(x => x.pickedFor), 'no pins, no pickedFor');
});
const shared = synth([['A', 1, [zz('ZZ 10'), zz('ZZ 11'), zz('ZZ 12')]], ['B', 1, [zz('ZZ 12'), zz('ZZ 13'), zz('ZZ 14')]]]);
const sk = MODEL.build(shared, {}), kA = sk.groups[0].key, kB = sk.groups[1].key;
t('a pin in a later group removes the course from an earlier group; unpinning restores it', () => {
  assert.ok(codesOf(sk.groups[0]).includes('ZZ 12') && sk.groups[0].alternatives.some(a => a.code === 'ZZ 12'));
  const mm = MODEL.build(shared, { choices: { [kB]: ['ZZ 12'] } }), [a, b] = mm.groups;
  assert.ok(!codesOf(a).includes('ZZ 12'), codesOf(a).join()); assert.deepEqual(a.alternatives.map(x => x.code), ['ZZ 10', 'ZZ 11']);
  assert.deepEqual(chosen(b), ['ZZ 12']); assert.equal(mm.nodes.find(x => x.code === 'ZZ 12').pickedFor, kB);
  const back = MODEL.build(shared, { choices: {} }).groups[0]; // unpinned: it is an option of A again
  assert.ok(back.options.includes('ZZ 12') && back.alternatives.some(x => x.code === 'ZZ 12'));
  // swapping B's pick to ZZ 13 returns ZZ 12 to A
  const sw = MODEL.build(shared, { choices: { [kB]: ['ZZ 13'] } });
  assert.ok(sw.groups[0].alternatives.some(x => x.code === 'ZZ 12'));
});
t('the same course pinned in two groups: the first group in document order keeps it, with a warning naming both', () => {
  const mm = MODEL.build(shared, { choices: { [kB]: ['ZZ 12'], [kA]: ['ZZ 12'] } }), [a, b] = mm.groups;
  assert.deepEqual(chosen(a), ['ZZ 12']); assert.deepEqual(chosen(b), []); assert.ok(b.undecided);
  assert.ok(!codesOf(b).includes('ZZ 12'));
  assert.ok(mm.warnings.some(w => w.includes('ZZ 12') && w.includes(' A ') && w.includes(' B;')), mm.warnings.join('\n'));
});
t('ethics/writing: an EW course pinned for ethics satisfies writing automatically and is not offered there', () => {
  const eth = m.groups.find(g => g.name === 'ENGINEERING ETHICS' && g.choice), wr = grp(m, 'ENGINEERING WRITING');
  const ew = eth.alternatives.map(a => a.code).find(c => /EW$/.test(c) && wr.options.includes(c));
  assert.ok(ew);
  const mm = MODEL.build(parsed, { choices: { [eth.key]: [ew] } }), w = mm.groups.find(g => g.key === wr.key);
  assert.deepEqual(w.chosen, [{ code: ew, auto: true, why: 'selected for engineering ethics; it is on this list, so it counts here too' }]);
  assert.ok(!w.options.includes(ew) && !w.alternatives.some(a => a.code === ew));
  assert.ok(!mm.nodes.some(n => n.code.startsWith('CHOOSE: ENGINEERING WRITING') || n.code.startsWith('GE: ENGINEERING WRITING')));
  const nd = mm.nodes.find(n => n.code === ew);
  assert.equal(nd.pickedFor, eth.key); assert.equal(nd.fromPath, eth.key); // picked inside a taken list path
  assert.equal(planned(mm).filter(c => c === ew).length, 1);
  // the other way round: picked for writing, on the ethics list -> ethics (a path choice) is taken and satisfied by it
  const m3 = MODEL.build(parsed, { choices: { [wr.key]: [ew] } }), e3 = m3.groups.find(g => g.key === eth.key);
  assert.ok(e3.selected && !e3.undecided); assert.match(e3.chosen[0].why, /^selected for engineering writing/);
  assert.ok(!m3.nodes.some(n => n.code.startsWith('CHOOSE: ENGINEERING ETHICS') || (n.status === 'path' && n.title === 'ENGINEERING ETHICS')));
});

// ---- scheduling constraints: defers, conflicts, critical courses, previewChange
Object.assign(COURSES, { 'ZZ 50': { t: 'ZZ 50', u: 4, pre: [], off: 'FWS' }, 'ZZ 51': { t: 'ZZ 51', u: 4, pre: [['ZZ 50']], off: 'FWS' },
  'ZZ 52': { t: 'ZZ 52', u: 4, pre: [['ZZ 51']], off: 'FWS' } });
const chain = synth([['R', 4, [zz('ZZ 50'), zz('ZZ 51'), zz('ZZ 52'), zz('ZZ 10')]]]); // ZZ 50 -> 51 -> 52, and a leaf ZZ 10
const termIn = (mm, c) => (mm.plan.find(q => q.courses.includes(c)) || {}).term;
t('defer: the course moves to its next offered quarter, never before its prereqs', () => {
  const p = synth([['R', 2, [zz('ZZ 21'), zz('ZZ 22')]]]); // ZZ 21 Fall only -> ZZ 22 Winter only
  const r = MODEL.previewChange(p, {}, { type: 'defer', code: 'ZZ 21' });
  assert.deepEqual(r.opts.defers, { 'ZZ 21': 'FA28' });
  assert.equal(termIn(r.after, 'ZZ 21'), 'FA28'); assert.equal(termIn(r.after, 'ZZ 22'), 'WI29'); // dependent follows
  assert.equal(termIn(MODEL.build(p, { defers: { 'ZZ 22': 'SP28' } }), 'ZZ 22'), 'WI29'); // not before SP28, Winter only
  assert.equal(termIn(MODEL.build(p, { defers: { 'ZZ 22': 'WI27' } }), 'ZZ 22'), 'WI28'); // still after ZZ 21 (FA27)
  const d = MODEL.previewChange(chain, {}, { type: 'defer', code: 'ZZ 10' });
  assert.equal(termIn(d.before, 'ZZ 10'), 'WI27'); assert.equal(termIn(d.after, 'ZZ 10'), 'SP27');
  const u = MODEL.previewChange(chain, d.opts, { type: 'undefer', code: 'ZZ 10' });
  assert.deepEqual(u.opts.defers, {}); assert.equal(termIn(u.after, 'ZZ 10'), 'WI27');
});
t('conflict: the bottleneck stays and the leaf moves; why says so', () => {
  for (const [a, b] of [['ZZ 50', 'ZZ 10'], ['ZZ 10', 'ZZ 50']]) {
    const mm = MODEL.build(chain, { conflicts: [{ a, b, term: 'WI27' }] }), r = mm.conflictResolutions[0];
    assert.equal(r.kept, 'ZZ 50'); assert.equal(r.moved, 'ZZ 10'); assert.equal(r.movedTo, 'SP27');
    assert.equal(termIn(mm, 'ZZ 50'), 'WI27'); assert.equal(termIn(mm, 'ZZ 10'), 'SP27'); assert.equal(termIn(mm, 'ZZ 52'), 'FA27');
    assert.equal(r.why, 'Kept ZZ 50: it unlocks 2 later courses; moving ZZ 10 instead changes nothing else.');
  }
});
const three = synth([['R', 3, [zz('ZZ 10'), zz('ZZ 11'), zz('ZZ 12')]]]);
t('conflict: on a tie the first-named course stays; the freed slot is filled by the next eligible course', () => {
  const base = MODEL.build(three, { perQuarter: 2 });
  assert.deepEqual(base.plan.map(q => q.courses), [['ZZ 10', 'ZZ 11'], ['ZZ 12']]);
  for (const [a, b] of [['ZZ 10', 'ZZ 11'], ['ZZ 11', 'ZZ 10']]) {
    const mm = MODEL.build(three, { perQuarter: 2, conflicts: [{ a, b, term: 'WI27' }] }), r = mm.conflictResolutions[0];
    assert.deepEqual([r.kept, r.moved, r.movedTo, r.filledBy], [a, b, 'SP27', 'ZZ 12']);
    assert.deepEqual(mm.plan.map(q => q.courses.slice().sort()), [[a, 'ZZ 12'].sort(), [b]]);
    assert.match(r.why, /so the first-named one stays/);
  }
  // no clash once the pair is no longer in that quarter
  const nc = MODEL.build(three, { perQuarter: 2, conflicts: [{ a: 'ZZ 10', b: 'ZZ 12', term: 'WI27' }] });
  assert.equal(nc.conflictResolutions[0].kept, null); assert.match(nc.conflictResolutions[0].why, /^No clash now/);
});
t('critical / slack: with graduation right at the plan end, a free leaf is not critical; every course on the longest chain is', () => {
  const tight = Object.assign({}, chain, { student: Object.assign({}, chain.student, { expected: 'FA27' }) });
  const mm = MODEL.build(tight, {}), nd = c => mm.nodes.find(x => x.code === c);
  assert.equal(mm.plan[mm.plan.length - 1].term, 'FA27');
  assert.equal(nd('ZZ 10').critical, false); assert.equal(nd('ZZ 10').slack, 2); // SP27, FA27 fine; WI28 would end later
  for (const c of ['ZZ 50', 'ZZ 51', 'ZZ 52']) { assert.equal(nd(c).critical, true, c); assert.equal(nd(c).slack, 0); assert.equal(nd(c).criticalWhy, 'your last quarter to WI28, past expected graduation'); }
  // room before graduation: finishing a quarter later is not a cascade, so nothing on the chain is starred
  const roomy = MODEL.build(Object.assign({}, chain, { student: Object.assign({}, chain.student, { expected: 'SP29' }) }), {});
  assert.ok(roomy.nodes.filter(x => x.planned).every(x => !x.critical));
  // past expected graduation already: a slip that pushes another course late is still critical, and nothing throws
  const late = Object.assign({}, chain, { student: { expected: 'FA26' } }), ml = MODEL.build(late, {});
  assert.ok(ml.nodes.find(x => x.code === 'ZZ 50').critical);
  const never = synth([['R', 2, [zz('ZZ 31'), zz('ZZ 10')]]]), mn = MODEL.build(never, { defers: { 'ZZ 31': 'WI27' } });
  assert.ok(mn.warnings.some(w => /Ignored your deferral of ZZ 31/.test(w)));
});
t('previewChange severity: none, minor, major', () => {
  assert.equal(MODEL.previewChange(chain, {}, { type: 'defer', code: 'ZZ 10' }).diff.severity, 'none');
  const minor = MODEL.previewChange(three, { perQuarter: 2 }, { type: 'defer', code: 'ZZ 10' }).diff;
  assert.equal(minor.severity, 'minor'); assert.deepEqual(minor.moved, [{ code: 'ZZ 10', from: 'WI27', to: 'SP27' }, { code: 'ZZ 12', from: 'SP27', to: 'WI27' }]);
  const major = MODEL.previewChange(chain, {}, { type: 'defer', code: 'ZZ 50' }).diff;
  assert.equal(major.severity, 'major'); assert.deepEqual([major.finalTermBefore, major.finalTermAfter], ['FA27', 'WI28']);
  assert.deepEqual(major.moved.map(x => x.code), ['ZZ 50', 'ZZ 51', 'ZZ 52']);
  const lateDiff = MODEL.previewChange(Object.assign({}, chain, { student: { expected: 'FA27' } }), {}, { type: 'defer', code: 'ZZ 52' }).diff;
  assert.equal(lateDiff.severity, 'major'); assert.deepEqual(lateDiff.pastExpected, ['ZZ 52']);
  const c = MODEL.previewChange(chain, {}, { type: 'conflict', a: 'ZZ 50', b: 'ZZ 10', term: 'WI27' });
  assert.equal(c.diff.severity, 'none'); assert.deepEqual(c.opts.conflicts, [{ a: 'ZZ 50', b: 'ZZ 10', term: 'WI27' }]);
  assert.deepEqual(MODEL.previewChange(chain, c.opts, { type: 'unconflict', a: 'ZZ 10', b: 'ZZ 50', term: 'WI27' }).opts.conflicts, []);
  assert.equal(MODEL.previewChange(chain, {}, { type: 'defer', code: 'NOPE 1' }).diff.severity, 'none'); // not planned: no-op
});
t('defers / conflicts naming courses outside the plan are ignored with a warning', () => {
  const base = MODEL.build(chain, {});
  const mm = MODEL.build(chain, { defers: { 'NOPE 1': 'WI28', 'ZZ 10': 'later' }, conflicts: [{ a: 'NOPE 1', b: 'ZZ 10', term: 'WI27' }, null, { a: 'ZZ 10', b: 'ZZ 10', term: 'WI27' }, { a: 'ZZ 10', b: 'ZZ 50' }] });
  assert.deepEqual(mm.plan, base.plan); assert.deepEqual(mm.conflictResolutions, []);
  assert.equal(mm.warnings.filter(w => /^Ignored your/.test(w)).length, 6, mm.warnings.join('\n'));
});
t('samples: a full build with criticality stays fast; critical courses carry a reason', () => {
  for (const f of ['dars-lines.json', 'dars-lines-2.json']) {
    const p = DARS.parse(JSON.parse(readFileSync(new URL('../sample/' + f, import.meta.url), 'utf8')));
    MODEL.build(p, { perQuarter: 4 }); // warm up
    const t0 = performance.now(), mm = MODEL.build(p, { perQuarter: 4 }), ms = performance.now() - t0;
    const pl = mm.nodes.filter(x => x.planned && !/^(GE|CHOOSE): /.test(x.code));
    console.log(`    ${f}: build ${ms.toFixed(1)} ms, ${pl.filter(x => x.critical).length} of ${pl.length} planned courses critical`);
    assert.ok(ms < 300, ms);
    for (const x of pl) { assert.ok(x.slack >= 0 && x.slack <= 4); if (x.critical) assert.ok(x.criticalWhy, x.code); }
  }
});
t('nextQuarter: default term, importance order, alternates that can really be taken that quarter', () => {
  for (const f of ['dars-lines.json', 'dars-lines-2.json']) {
    const p = DARS.parse(JSON.parse(readFileSync(new URL('../sample/' + f, import.meta.url), 'utf8'))), mm = MODEL.build(p, { perQuarter: 4 });
    const nd = new Map(mm.nodes.map(x => [x.code, x]));
    assert.equal(MODEL.nextQuarter(mm).term, mm.plan[0].term); assert.equal(MODEL.nextQuarter(mm, 'nope').term, mm.plan[0].term);
    for (const pl of mm.plan) {
      const r = MODEL.nextQuarter(mm, pl.term), T = DARS.termIndex(pl.term), q = 'FWSU'[T % 4];
      assert.equal(r.term, pl.term); assert.deepEqual(r.picks.map(x => x.code).sort(), pl.courses.slice().sort());
      const real = r.picks.filter(x => !x.slot).map(x => nd.get(x.code));
      assert.ok(r.picks.findIndex(x => x.slot) === -1 || r.picks.slice(r.picks.findIndex(x => x.slot)).every(x => x.slot), 'slots last');
      for (let i = 1; i < real.length; i++) assert.ok(!!real[i - 1].critical > !!real[i].critical || (!!real[i - 1].critical === !!real[i].critical && real[i - 1].slack <= real[i].slack), pl.term + ' ' + real[i].code);
      const have = c => ['done', 'ip'].includes((nd.get(c) || {}).status) || (nd.get(c) && nd.get(c).planned && DARS.termIndex(nd.get(c).planned) < T);
      for (const x of r.picks) {
        assert.ok(x.alts.length <= 3); assert.equal(new Set(x.alts.map(a => a.code)).size, x.alts.length);
        for (const a of x.alts) {
          assert.ok(!pl.courses.includes(a.code), a.code); assert.ok(a.why);
          if (a.code.startsWith('GE: ')) continue;
          const k = COURSES[a.code]; assert.ok(k.off === '?' || k.off.includes(q), `${a.code} offered ${k.off}, ${pl.term}`);
          for (const og of k.pre) assert.ok(og.some(have), `${a.code} in ${pl.term}: ${og}`);
        }
      }
    }
  }
});
t('nextQuarter: a selected course lists its unselected siblings first', () => {
  const p = synth([['PICK', 1, [zz('ZZ 10'), zz('ZZ 11'), zz('ZZ 12')]], ['REQ', 2, [zz('ZZ 13'), zz('ZZ 14')]]]);
  const key = MODEL.build(p, {}).groups[0].key, mm = MODEL.build(p, { perQuarter: 3, choices: { [key]: ['ZZ 10'] } });
  const x = MODEL.nextQuarter(mm, 'WI27').picks.find(x => x.code === 'ZZ 10');
  assert.deepEqual(x.alts.map(a => [a.code, a.groupKey, a.same]), [['ZZ 11', key, true], ['ZZ 12', key, true]]);
  const open = MODEL.build(p, { perQuarter: 3 }), slot = MODEL.nextQuarter(open).picks.find(x => x.slot);
  assert.deepEqual(slot.alts.map(a => [a.code, a.groupKey]), [['ZZ 10', key], ['ZZ 11', key], ['ZZ 12', key]]);
  const deferred = MODEL.build(p, { perQuarter: 3, choices: { [key]: ['ZZ 10'] }, defers: { 'ZZ 14': 'SP27' } });
  assert.ok(!MODEL.nextQuarter(deferred, 'WI27', { defers: { 'ZZ 14': 'SP27' } }).picks.some(x => x.alts.some(a => a.code === 'ZZ 14')));
});
t('pins: move a course to a quarter, swap one in, refuse quarters it is not offered in or before its prereqs', () => {
  const at = (mm, c) => (mm.nodes.find(x => x.code === c) || {}).planned;
  assert.equal(at(MODEL.build(chain, { pins: { 'ZZ 10': 'FA27' } }), 'ZZ 10'), 'FA27');
  const early = MODEL.build(chain, { pins: { 'ZZ 51': 'WI27' } });
  assert.equal(at(early, 'ZZ 51'), 'SP27'); assert.ok(early.warnings.some(w => /^Couldn't move ZZ 51 to WI27: its prerequisites/.test(w)), early.warnings.join('\n'));
  const fw = synth([['R', 2, [zz('ZZ 21'), zz('ZZ 22')]]]), off = MODEL.build(fw, { pins: { 'ZZ 21': 'WI27' } });
  assert.equal(at(off, 'ZZ 21'), 'FA27'); assert.ok(off.warnings.some(w => /move of ZZ 21 to WI27: it is not offered in Winter/.test(w)));
  const sw = MODEL.previewChange(three, { perQuarter: 2 }, { type: 'swapIn', code: 'ZZ 12', out: 'ZZ 10', term: 'WI27' });
  assert.deepEqual(sw.opts.pins, { 'ZZ 12': 'WI27' }); assert.deepEqual(sw.opts.defers, { 'ZZ 10': 'SP27' });
  assert.deepEqual(sw.after.plan.map(p => [p.term, p.courses.slice().sort()]), [['WI27', ['ZZ 11', 'ZZ 12']], ['SP27', ['ZZ 10']]]);
  const mv = MODEL.previewChange(three, { perQuarter: 2, defers: { 'ZZ 12': 'FA27' } }, { type: 'move', code: 'ZZ 12', term: 'WI27' });
  assert.deepEqual(mv.opts.defers, {}); assert.equal(at(mv.after, 'ZZ 12'), 'WI27'); assert.equal(mv.after.plan[0].courses.length, 2);
  assert.deepEqual(MODEL.previewChange(three, mv.opts, { type: 'unmove', code: 'ZZ 12' }).opts.pins, {});
  assert.deepEqual(MODEL.previewChange(three, mv.opts, { type: 'defer', code: 'ZZ 12' }).opts.pins, {}); // a defer replaces the move
});
console.log(n + ' passed');
