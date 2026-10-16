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

// ---- synthetic fixtures (test/fixtures, see README there): exact sections, groups, needs, option counts, programs, grade classes
const FIX = {
  'arts-design-media-arts': {"programs":["MAJOR1 DESIGN | MEDIA ARTS"],"expected":"SP29","unitsNeeded":158,"sections":[["ARTS AND ARCHITECTURE GENERAL EDUCATION",null,2,[["HISTORY AND SOCIETY",1,5,7],["SCIENCE AND TECHNOLOGY",1,5,4]]],["DESIGN MEDIA ARTS PREPARATION",null,null,[["DESMA 10, 21, 22, 24, 25, 28",2,null,2]]],["DESIGN MEDIA ARTS UPPER DIVISION",null,null,[["DESMA 101 AND 104",2,null,2],["SIX UPPER DIVISION DESMA STUDIOS",6,24,3]]]],"done":["ART HIS 20","DESMA 10","DESMA 21","DESMA 22","ENGCOMP 3"],"ip":["DESMA 24"]},
  'double-major-econ-polisci': {"programs":["MAJOR1 ECONOMICS","MAJOR2 POLITICAL SCIENCE"],"expected":"SP28","unitsNeeded":141,"sections":[["WRITING II",null,null,[["WRITING II",1,null,6]]],["FOREIGN LANGUAGE",null,null,[["LEVEL THREE PROFICIENCY IN ONE LANGUAGE",1,null,9]]],["DIVERSITY REQUIREMENT",null,null,[["ONE DIVERSITY COURSE",1,null,12]]],["PREPARATION FOR THE ECONOMICS MAJOR","MAJOR1",null,[["ECON 1, 2, 11",1,null,1]]],["ECONOMICS MAJOR REQUIREMENTS","MAJOR1",null,[["ECON 101, 102",2,null,2],["FIVE UPPER DIVISION ECONOMICS ELECTIVES",5,null,1]]],["PREPARATION FOR THE POLITICAL SCIENCE MAJOR","MAJOR2",null,[["THREE OF POL SCI 10, 20, 30, 40, 50",2,null,4]]],["POLITICAL SCIENCE FIELDS","MAJOR2",2,[["INTERNATIONAL RELATIONS FIELD",2,null,1],["AMERICAN POLITICS FIELD",2,null,1],["COMPARATIVE POLITICS FIELD",2,null,1]]]],"done":["ECON 1","ECON 2","ENGCOMP 3","POL SCI 20"],"ip":[]},
  'education-est': {"programs":["MAJOR1 EDUCATION AND SOCIAL TRANSFORMATION"],"expected":"SP29","unitsNeeded":172,"sections":[["EDUCATION PREPARATION",null,null,[["EDUC 10, 11, 35",1,null,1]]],["EDUCATION CORE",null,null,[["EDUCATION CORE",3,null,3]]],["EDUCATION ELECTIVES",null,null,[["THREE UPPER DIVISION ELECTIVES",3,null,3]]]],"done":["EDUC 10","EDUC 11","ENGCOMP 3"],"ip":[]},
  'eng-computer-science': {"programs":["MAJOR1 COMPUTER SCIENCE"],"expected":"SP28","unitsNeeded":111,"sections":[["LOWER DIVISION COMPUTER SCIENCE",null,null,[["COMPUTER SCIENCE 1, 31, 32, 33, 35L, M51A",1,null,2]]],["LOWER DIVISION MATHEMATICS",null,null,[["MATHEMATICS 31A, 31B, 32A, 32B, 33A, 33B, 61",2,null,2]]],["LOWER DIVISION PHYSICS",null,null,[["PHYSICS 1A, 1B, 1C, 4AL, 4BL",1,null,1]]],["COMPUTER SCIENCE UPPER DIVISION REQUIRED COURSES",null,null,[["NINE REQUIRED COURSES",9,null,9]]],["COMPUTER SCIENCE ELECTIVES",null,null,[["FIVE COMPUTER SCIENCE ELECTIVES",5,20,1],["SCI-TECH ELECTIVES",3,12,8]]],["CS TECHNICAL BREADTH REQUIREMENT",null,null,[["CS TECHNICAL BREADTH REQUIREMENT",3,12,0,"TBA"]]],["ENGINEERING ETHICS REQUIREMENT",null,null,[["ENGINEERING ETHICS",1,null,5]]],["FOUNDATIONS OF THE ARTS AND HUMANITIES",null,1,[["LITERARY & CULTURAL ANALYSIS",1,4,7],["VISUAL & PERFORMANCE ARTS ANALYSIS",1,4,7]]]],"done":["CHEM 20A","COM SCI 1","COM SCI 31","COM SCI 32","COM SCI 33","ENGCOMP 3","MATH 31A","MATH 31B","MATH 32A","MATH 32B","MATH 33A","PHYSICS 1A","PHYSICS 1B","PHYSICS 4AL"],"ip":["COM SCI 35L","PHYSICS 1C"]},
  'failed-withdrawn-repeats': {"programs":["MAJOR1 MATHEMATICS"],"expected":"SP28","unitsNeeded":149,"sections":[["PREPARATION FOR THE MATHEMATICS MAJOR",null,null,[["MATH 31A, 31B, 32A, 32B, 33A, 33B",1,null,1],["PHYSICS 1A",1,null,1]]],["MATHEMATICS MAJOR REQUIREMENTS",null,null,[["MATH 115A, 131A, 131B",3,null,3],["FIVE UPPER DIVISION MATHEMATICS ELECTIVES",5,20,14]]]],"done":["ENGCOMP 3","MATH 31A","MATH 31B","MATH 32A","MATH 33B"],"ip":["MATH 32B"],"failed":["MATH 19","MATH 33A"],"withdrawn":["MATH 106"],"incomplete":["MATH 115A","MATH 131A","PHYSICS 1A"],"unknown":["MATH 95"]},
  'hostile-psychology': {"programs":["MAJOR1 PSYCHOLOGY"],"expected":"SP28","unitsNeeded":148,"sections":[["WRITING II",null,null,[["WRITING II",1,null,4]]],["FOREIGN LANGUAGE",null,null,[["LEVEL THREE PROFICIENCY IN ONE LANGUAGE",1,null,3]]],["PREPARATION FOR THE PSYCHOLOGY MAJOR",null,null,[["ONE STATISTICS COURSE",1,null,3]]],["PSYCHOLOGY MAJOR REQUIREMENTS",null,null,[["FIVE CORE COURSES FROM AT LEAST FOUR AREAS",5,null,18]]],["UPPER DIVISION ELECTIVES FOR STUDENTS ADMITTED FALL 2024 AND LATER",null,null,[["FOUR UPPER DIVISION ELECTIVES",4,16,3],["ONE LAB COURSE",1,4,3]]]],"done":["PSYCH 10","PSYCH 100A","PSYCH 100B"],"ip":["PSYCH 85"],"unparsed":["~ FOREIGN LANGUAGE","??","NEEDS: SEE YOUR COUNSELOR","SP26 PSYCH 1 IP","40W","SEE COUNSELOR"]},
  'ls-psychology': {"programs":["MAJOR1 PSYCHOLOGY"],"expected":"SP28","unitsNeeded":135,"sections":[["WRITING II",null,null,[["WRITING II",1,null,6]]],["FOREIGN LANGUAGE",null,null,[["LEVEL THREE PROFICIENCY IN ONE LANGUAGE",1,null,9]]],["DIVERSITY REQUIREMENT",null,null,[["ONE DIVERSITY COURSE",1,null,12]]],["FOUNDATIONS OF SCIENTIFIC INQUIRY",null,1,[["PHYSICAL SCIENCES",1,5,12]]],["PREPARATION FOR THE PSYCHOLOGY MAJOR",null,null,[["ONE STATISTICS COURSE",1,null,4],["LIFE SCIENCES 7A, 7B, 7C",2,null,2]]],["PSYCHOLOGY MAJOR REQUIREMENTS",null,null,[["PSYCH 100B",1,null,1],["FIVE CORE COURSES FROM AT LEAST FOUR AREAS",5,null,11],["FOUR UPPER DIVISION ELECTIVES",4,16,1]]]],"done":["ENGCOMP 3","HIST 13A","LIFESCI 7A","PHILOS 7","PSYCH 10","SOCIOL 1"],"ip":["MUSCLG 7","PSYCH 100A","PSYCH 85"]},
  'luskin-public-affairs': {"programs":["MAJOR1 PUBLIC AFFAIRS"],"expected":"SP28","unitsNeeded":124,"sections":[["WRITING II",null,null,[["WRITING II",1,null,6]]],["FOREIGN LANGUAGE",null,null,[["LEVEL THREE PROFICIENCY IN ONE LANGUAGE",1,null,9]]],["DIVERSITY REQUIREMENT",null,null,[["ONE DIVERSITY COURSE",1,null,12]]],["PUBLIC AFFAIRS CORE",null,null,[["PUB AFF 10, 20, 30, 40, 50",1,null,1]]],["PUBLIC AFFAIRS CAPSTONE",null,null,[["APPLIED EXPERIENTIAL SEQUENCE",3,null,3]]],["PUBLIC AFFAIRS ELECTIVES",null,null,[["FOUR UPPER DIVISION ELECTIVES",4,16,5]]]],"done":["ENGCOMP 3","PUB AFF 10","PUB AFF 20","PUB AFF 30"],"ip":["PUB AFF 40"]},
  'minor-stats-ftvdm': {"programs":["MAJOR1 STATISTICS AND DATA SCIENCE","MINOR1 FILM, TELEVISION, AND DIGITAL MEDIA"],"expected":"SP28","unitsNeeded":152,"sections":[["PREPARATION FOR THE STATISTICS MAJOR","MAJOR1",null,[["MATH 31A, 31B, 32A, 33A, STATS 20",2,null,2]]],["STATISTICS MAJOR REQUIREMENTS","MAJOR1",null,[["SEVEN REQUIRED COURSES",7,null,7],["TWO STATISTICS ELECTIVES",2,null,1]]],["FILM, TELEVISION, AND DIGITAL MEDIA MINOR","MINOR1",null,[["LOWER DIVISION MINOR COURSES",2,null,3],["UPPER DIVISION MINOR COURSES",5,20,1]]]],"done":["ENGCOMP 3","MATH 31A","MATH 31B","MATH 32A"],"ip":[]},
  'music-performance': {"programs":["MAJOR1 MUSIC PERFORMANCE"],"expected":"SP28","unitsNeeded":161,"sections":[["MUSIC THEORY AND MUSICIANSHIP",null,null,[["MUSC 20A, 20B, 20C",1,null,1]]],["APPLIED STUDY",null,null,[["SIX QUARTERS OF PRIVATE INSTRUCTION",1,6,1]]],["ENSEMBLES",null,null,[["LARGE ENSEMBLES",5,null,5]]],["MUSIC HISTORY",null,null,[["MUSCLG 70, 71, 72",2,null,2],["ONE ETHNOMUSICOLOGY COURSE",1,null,5]]]],"done":["ENGCOMP 3","MUSC 20A","MUSC 20B","MUSC 65","MUSC 91A"],"ip":[]},
  'nursing-bs': {"programs":["MAJOR1 NURSING"],"expected":"SP29","unitsNeeded":161,"sections":[["NURSING PREPARATION",null,null,[["CHEM 14A, 14B, LIFESCI 7A, 7B, 7C",2,null,2],["ONE STATISTICS COURSE",1,null,3]]],["NURSING LOWER DIVISION",null,null,[["NURSING 3, 10, 12, 13",3,null,3]]],["CLINICAL SEQUENCE",null,null,[["CLINICAL PRACTICUM",2,8,2],["CLINICAL SEMINAR",1,null,2]]]],"done":["CHEM 14A","CHEM 14B","ENGCOMP 3","LIFESCI 7A","NURSING 3"],"ip":[]},
  'tft-film-television': {"programs":["MAJOR1 FILM AND TELEVISION"],"expected":"SP29","unitsNeeded":167,"sections":[["FILM AND TELEVISION PREPARATION",null,null,[["FILM TV 4, 6A, 6B, 33",2,null,2]]],["FILM AND TELEVISION UPPER DIVISION CORE",null,null,[["FILM TV 106A, 106B, 106C",3,null,3],["ONE PRODUCTION COURSE",1,null,1],["ONE SCREENWRITING COURSE",1,null,3,"OR"]]],["FILM AND TELEVISION ELECTIVES",null,null,[["FOUR UPPER DIVISION ELECTIVES",4,16,3]]]],"done":["ENGCOMP 3","FILM TV 4","FILM TV 6A"],"ip":[],"failed":["FILM TV 33"]},
  'transfer-igetc-economics': {"programs":["MAJOR1 ECONOMICS"],"expected":"SP28","unitsNeeded":78,"sections":[["WRITING II",null,null,[["WRITING II",1,null,3]]],["ECONOMICS MAJOR REQUIREMENTS",null,null,[["ECON 101, 102, 103",2,null,2],["FIVE UPPER DIVISION ECONOMICS ELECTIVES",5,null,1]]]],"done":["ECON 1","ECON 2","ECON T01","ENGCOMP 3","MATH 31A","MATH 31B","MATH 32A","STATS 10"],"ip":["ECON 101","ECON 11"]}
};
const fixture = name => JSON.parse(readFileSync(new URL('./fixtures/' + name + '.json', import.meta.url), 'utf8'));
function project(r) {
  const by = s => Object.entries(r.taken).filter(([, t]) => t.status === s).map(([c]) => c).sort();
  const o = { programs: r.student.programs.map(p => p.key + ' ' + p.name), expected: r.student.expected, unitsNeeded: r.unitsNeeded,
    sections: r.sections.map(s => [s.title, s.program, s.needSubgroups, s.groups.map(g => [g.name, g.needCourses, g.needUnits, g.options.length].concat(g.orPrev ? ['OR'] : g.undeclared ? ['TBA'] : []))]),
    done: by('done'), ip: by('ip'), failed: by('failed'), withdrawn: by('withdrawn'), incomplete: by('incomplete'), unknown: by('unknown'), unparsed: r.unparsed.map(u => u.line) };
  for (const k of ['failed', 'withdrawn', 'incomplete', 'unknown', 'unparsed']) if (!o[k].length) delete o[k];
  return o;
}
for (const [name, want] of Object.entries(FIX)) t('fixture ' + name, () => {
  const r = DARS.parse(fixture(name));
  assert.equal(r.ok, true, r.reason); assert.equal(r.currentTerm, 'FA26');
  assert.deepEqual(project(r), want);
  assert.equal(r.student.major, want.programs[0].replace(/^\S+ /, ''));
  for (const s of r.sections) for (const g of s.groups) { // no status markers or condition codes leak into names or codes
    assert.ok(!/^(OK|NO|IP|[+-]|R|~|\?\?|\(R\)) /.test(g.name) && !/^(OK|NO|IP) /.test(s.title), g.name);
    for (const o of g.options) for (const c of o.alts) assert.match(c, /^[A-Z][A-Z&' -]* (CM|M|C|T)?\d{1,3}[A-Z]{0,3}$/, c);
  }
  for (const c of Object.keys(r.taken)) assert.match(c, /^[A-Z][A-Z&' -]* (CM|M|C|T)?\d{1,3}[A-Z]{0,3}$/, c);
});
t('fixture details: best attempt, flags, wildcards, NOT FROM range, AND)/OR), notes', () => {
  const f = DARS.parse(fixture('failed-withdrawn-repeats'));
  assert.deepEqual([f.taken['MATH 32A'].grade, f.taken['MATH 32A'].term, f.taken['MATH 32A'].flags], ['B+', 'FA25', ['>R']]); // F >D attempt replaced
  assert.deepEqual([f.taken['MATH 32B'].status, f.taken['MATH 32B'].term], ['ip', 'FA26']); // W then IP retake
  assert.equal(f.taken['MATH 33B'].title, 'DIFFERENTIAL EQ'); assert.deepEqual(f.taken['MATH 33B'].flags, ['RP']);
  const h = DARS.parse(fixture('hostile-psychology')), sec = n => h.sections.find(s => s.title.startsWith(n));
  assert.deepEqual(sec('FOREIGN LANGUAGE').groups[0].options.map(o => o.wildcard ? o.dept + ' ' + o.wildcard : o.alts.join('|')), ['SPAN @', 'FRNCH 3|FRNCH 3S', 'GERMAN 3']);
  const el = sec('UPPER DIVISION ELECTIVES').groups[0];
  assert.deepEqual(el.options, [{ dept: 'PSYCH', num: '1@@', wildcard: '1@@', alts: [] }, { dept: 'COMM', num: '1@@', wildcard: '1@@', alts: [] }, { dept: 'LING', num: '1@@', wildcard: '1@@', alts: [] }]);
  assert.deepEqual(el.notFromRanges, [{ dept: 'PSYCH', num: '192', alts: ['PSYCH 192'], to: '199' }]);
  assert.ok(sec('PSYCHOLOGY MAJOR REQUIREMENTS').groups[0].options.some(o => o.alts.includes('PSYCH 127W'))); // window split across a page break
  assert.deepEqual([h.taken['PSYCH 100A'].grade, h.taken['PSYCH 100A'].flags], ['C-', ['>R']]);
  assert.ok(h.unparsed.every(u => u.section), 'every unparsed line carries its section');
  const n = DARS.parse(fixture('nursing-bs')).sections.find(s => s.title === 'CLINICAL SEQUENCE').groups;
  assert.deepEqual(n.map(g => !!g.orPrev), [false, false]);
  const stat = DARS.parse(fixture('nursing-bs')).sections[0].groups[1];
  assert.deepEqual([stat.name, stat.note], ['ONE STATISTICS COURSE', "MINIMUM 'C' GRADE REQUIRED"]);
  const cs = DARS.parse(fixture('eng-computer-science')).sections.find(s => s.title === 'COMPUTER SCIENCE ELECTIVES').groups[0];
  assert.deepEqual(cs.notFrom, ['COM SCI 188', 'COM SCI 194', 'COM SCI 195', 'COM SCI 199']);
});

// ---- never throws; non-DARS input is reported, not rendered blank
t('garbage in, ok:false out', () => {
  for (const x of [undefined, null, 0, 42, {}, [], '', 'hello world', [null, 1, 'x', {}], [{ x: 'a', line: null }], { length: 3 },
    'Lorem ipsum dolor sit amet\nCONSECTETUR ADIPISCING\n  ELIT SED DO', [{ x: 10, line: 'INVOICE 2026' }, { x: 40, line: 'TOTAL DUE 4.00' }]]) {
    const r = DARS.parse(x);
    assert.equal(r.ok, false, JSON.stringify(x)); assert.equal(typeof r.reason, 'string'); assert.ok(Array.isArray(r.sections) && Array.isArray(r.unparsed));
  }
  const r = DARS.parse(lines.slice(0, 40)); // audit header and in-progress courses only
  assert.equal(r.ok, false); assert.match(r.reason, /No unfinished requirement/);
  assert.equal(r.taken['MECH&AE 103'].status, 'ip');
});
t('gradeStatus', () => {
  const want = { done: ['A+', 'A', 'B-', 'C', 'D-', 'P', 'S', 'CR', 'AP', 'IB', 'TE', 'EX', 'TA', 'TB+', 'UA', 'TP', 'A>R'], ip: ['IP', 'PL', 'PLANNED', 'RG', '***'],
    failed: ['F', 'NP', 'NC', 'U', 'NOCR', 'TF'], withdrawn: ['W', 'WF', 'DROP'], incomplete: ['I', 'NR', 'DR'], unknown: ['Q', '', 'ZZ', 'B++'] };
  for (const [s, gs] of Object.entries(want)) for (const g of gs) assert.equal(DARS.gradeStatus(g), s, g);
});
t('linesFromItems splits a lone status marker off the title it precedes', () => {
  const it = (x, y, str, w) => ({ str, transform: [8, 0, 0, 8, x, y], width: w, height: 8 });
  assert.deepEqual(DARS.linesFromItems([it(60, 100, 'R', 5), it(110, 100, 'SIX ELECTIVES', 60), it(110, 90, 'NEEDS:', 30), it(150, 90, '1 COURSE', 40), null, {}]),
    [{ x: 60, line: 'R' }, { x: 110, line: 'SIX ELECTIVES' }, { x: 110, line: 'NEEDS: 1 COURSE' }]);
});
t('redact drops name/ID, school names and letter grades but still parses the same', () => {
  const raw = lines.map(l => ({ x: l.x, line: l.line.replace('STUDENT, SAMPLE / 000000000', 'DOE, JANE Q / 123456789').replace(/(MATH 32B 4\.00) P/, '$1 C+').replace(/(MATH 33A 4\.00) P/, '$1 F') }));
  const red = DARS.redact(raw), txt = JSON.stringify(red);
  assert.ok(!/DOE|JANE|123456789|TEMECULA/.test(txt)); assert.ok(!/ C\+ | F /.test(txt.replace(/"line":"[^"]*Grade Changed[^"]*"/g, '')));
  assert.ok(red.some(l => /MATH 33A 4\.00 NP /.test(l.line)));
  assert.deepEqual(project(DARS.parse(red)).sections, project(r).sections);
});

// ---- fuzz: 500 seeded mutations of both real samples. Every mutation must parse without throwing.
// Mild ones (whole-document x shift within +-20 with +-2 per-line jitter, injected print chrome, duplicated page headers)
// must still yield the same requirement groups. Per-line x shuffles of +-20 are only checked for not throwing: they erase
// the section/group column difference (25 points) that the layout itself uses.
t('fuzz: 500 mutations never throw; mild ones keep every requirement group', () => {
  let seed = 12345; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648), ri = n => Math.floor(rnd() * n);
  const samples = [lines, JSON.parse(readFileSync(new URL('../sample/dars-lines-2.json', import.meta.url), 'utf8'))];
  const shape = r => r.sections.map(s => s.title + '|' + s.needSubgroups + '|' + s.groups.map(g => [g.name, g.needCourses, g.needUnits, g.options.length, !!g.orPrev].join(':')).join(';'));
  const base = samples.map(x => shape(DARS.parse(x)));
  const CHROME = ['10/16/26, 1:05 PM My Audit - Audit Results Tab', 'https://dars.ucla.edu/selfservice/audit/read.html?printerFriendly=true&id=X 3/9', 'Page 2 of 9', 'about:blank', '4/9'];
  const GARBAGE = ['NEEDS:', 'SELECT FROM:', 'OR)', 'FA26', 'NEEDS: 99 SUB-GROUPS', '-> NOT FROM:', 'SELECT FROM: ((((', '\u0000ÿ', '@@@ @@@', 'R', '', '9'.repeat(400)];
  let mild = 0;
  for (let i = 0; i < 500; i++) {
    const k = i % 2, src = samples[k], kind = i % 5;
    let m = src.map(l => ({ x: l.x, line: l.line }));
    if (kind === 0) { const d = ri(41) - 20; m = m.map(l => ({ x: l.x + d + ri(5) - 2, line: l.line })); }                      // mild: margins
    if (kind === 1) for (let j = 0; j < 12; j++) m.splice(ri(m.length), 0, { x: 24, line: CHROME[ri(CHROME.length)] });      // mild: chrome
    if (kind === 2) for (const l of m.filter(l => /My Audit|printerFriendly/.test(l.line))) m.splice(m.indexOf(l), 0, Object.assign({}, l)); // mild: dup headers
    if (kind === 2 && k === 0) for (let j = 0; j < 6; j++) { const at = ri(m.length); m.splice(at, 0, { x: 24, line: CHROME[0] }, { x: 24, line: CHROME[0] }); }
    if (kind === 3) { m = m.filter(() => rnd() > 0.15); if (rnd() < 0.5) m = m.slice(0, ri(m.length)); }                       // harsh: drop / truncate
    if (kind === 4) { m = m.map(l => ({ x: l.x + ri(41) - 20, line: rnd() < 0.05 ? l.line.slice(0, ri(l.line.length)) : l.line }));  // harsh: x shuffle, cut lines, garbage
      for (let j = 0; j < 8; j++) m.splice(ri(m.length), 0, { x: ri(400), line: GARBAGE[ri(GARBAGE.length)] }); }
    let r; assert.doesNotThrow(() => { r = DARS.parse(m); }, 'mutation ' + i);
    assert.equal(typeof r.ok, 'boolean'); assert.ok(Array.isArray(r.sections) && Array.isArray(r.unparsed));
    if (kind <= 2) { assert.deepEqual(shape(r), base[k], 'mild mutation ' + i + ' kind ' + kind); mild++; }
  }
  assert.equal(mild, 300);
});
console.log(n + ' passed');
