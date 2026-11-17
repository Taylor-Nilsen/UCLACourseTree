#!/usr/bin/env node
// Builds data/ucla-grades.js: for every course in data/ucla-courses.js, the share of letter grades that were A+, A or A-,
// overall and for each instructor the Schedule of Classes lists for the next term.
//   node scripts/build-grades.mjs [--term 27W] [--grades <dir with grades-*.csv>] [--cache <dir>]
// Grades: the public-records CSVs behind uclagrades.com (github.com/nathanhleung/uclagrades.com, data/grades-*.csv).
// Instructors: sa.ucla.edu/ro/public/soc, one request per course with a section in the term. See scripts/README.md.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const { COURSES } = createRequire(import.meta.url)(path.join(ROOT, 'data', 'ucla-courses.js'));
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > 0 ? process.argv[i + 1] : d; };
const CACHE = arg('cache', path.join(os.tmpdir(), 'ucla-grades-cache'));
fs.mkdirSync(CACHE, { recursive: true });
const MIN = 10; // fewer letter grades than this is noise (a 6-person seminar): no percentage is stored

// The first Fall/Winter/Spring term that starts after today (instructors are only published for that one; later terms say "Tentative").
function nextTerm(d = new Date()) {
  const y = d.getFullYear() % 100, md = (d.getMonth() + 1) * 100 + d.getDate();
  return md < 105 ? y + 'W' : md < 328 ? y + 'S' : md < 922 ? y + 'F' : (y + 1) + 'W';
}
const TERM = arg('term', nextTerm());

// ---------- grades ----------
let dir = arg('grades');
if (!dir) {
  const repo = path.join(CACHE, 'uclagrades.com');
  if (!fs.existsSync(repo)) execFileSync('git', ['clone', '--depth', '1', 'https://github.com/nathanhleung/uclagrades.com.git', repo], { stdio: 'inherit' });
  dir = path.join(repo, 'data');
}
const csvLine = l => [...l.matchAll(/("(?:[^"]|"")*"|[^,]*)(?:,|$)/g)].map(m => m[1].replace(/^"|"$/g, '').replace(/""/g, '"').trim());
const LETTER = new Set(['A+', 'A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-', 'D+', 'D', 'D-', 'F']); // P/NP, S/U, I, DR... are left out
const profKey = name => { const [last, rest = ''] = name.toUpperCase().split(','); return last.trim() + ',' + rest.trim()[0]; }; // "KERANEN,J"
// A co-taught section repeats its rows once per instructor, so counts are keyed by term+section+grade and summed afterwards.
const byCourse = {}, byProf = {}, files = fs.readdirSync(dir).filter(f => /^grades-.*\.csv$/.test(f)).sort();
for (const f of files) for (const line of fs.readFileSync(path.join(dir, f), 'utf8').split(/\r?\n/)) {
  const r = csvLine(line);
  if (!/^\d+$/.test(r[5] || '') || !LETTER.has(r[4])) continue;
  // two layouts (data/header-old.csv, header-new.csv): the subject code is column 1 in the old one, column 10 in the new one
  const code = `${/^\d+$/.test(r[10]) ? r[1] : r[10]} ${r[2]}`, cell = `${r[0]}|${r[3]}|${r[4]}`;
  if (!COURSES[code]) continue;
  (byCourse[code] ||= {})[cell] = [r[4], +r[5]];
  if (r[7]) ((byProf[code] ||= {})[profKey(r[7])] ||= {})[cell] = [r[4], +r[5]];
}
const stat = cells => {
  let a = 0, n = 0;
  for (const [grd, k] of Object.values(cells || {})) { n += k; if (grd[0] === 'A') a += k; }
  return n >= MIN ? { a: Math.round(100 * a / n), n } : null;
};

// ---------- next term's instructors ----------
const SOC = 'https://sa.ucla.edu/ro/public/soc';
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function cached(name, url) {
  const f = path.join(CACHE, name);
  if (fs.existsSync(f)) return fs.readFileSync(f, 'utf8');
  for (let i = 0; ; i++) {
    try {
      const res = await fetch(url, { headers: { 'x-requested-with': 'XMLHttpRequest', 'user-agent': 'Mozilla/5.0' } });
      if (!res.ok) throw new Error(`${res.status} ${url}`);
      const t = await res.text(); fs.writeFileSync(f, t); return t;
    } catch (e) { if (i >= 4) throw e; await sleep(1000 * 2 ** i); }
  }
}
const FLAGS = JSON.stringify({ enrollment_status: 'O,W,C,T,S', advanced: 'y', meet_days: null, start_time: null, end_time: null,
  meet_locations: null, meet_units: null, instructor: null, class_career: null, impacted: null, enrollment_restrictions: null,
  enforced_requisites: null, individual_studies: null, summer_session: null });
const safe = s => s.replace(/\W/g, '_');
async function pool(jobs, n, fn) { // polite: at most n requests in flight
  let i = 0, done = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < jobs.length) { await fn(jobs[i++]); if (++done % 200 === 0) console.log(`schedule of classes: ${done}/${jobs.length}`); } }));
}
const subjOf = k => k.slice(0, k.lastIndexOf(' '));
const entries = []; // [code, model JSON] for every course (or seminar topic) with a live section in TERM
await pool([...new Set(Object.keys(COURSES).map(subjOf))], 4, async subj => {
  for (let page = 1; ; page++) {
    const model = JSON.stringify({ subj_area_cd: subj, search_by: 'subject', term_cd: TERM, ActiveEnrollmentFlag: 'n', HasData: 'True' });
    const html = await cached(`${TERM}-${safe(subj)}-${page}.html`, `${SOC}/Results/CourseTitlesView?${new URLSearchParams({ search_by: 'subject', model, pageNumber: page, filterFlags: FLAGS })}`);
    const titles = [...html.matchAll(/<button class="linkLikeButton" id="[^"]+-title"[^>]*>([^<]+)</g)].map(m => m[1].trim().split(' - ')[0]);
    const models = [...html.matchAll(/AddToCourseData\("[^"]+",(\{[^}]+\})\)/g)].map(m => m[1]);
    if (titles.length !== models.length) throw new Error(`unexpected page: ${TERM} ${subj} ${page}`);
    titles.forEach((n, i) => { if (COURSES[`${subj} ${n}`]) entries.push([`${subj} ${n}`, models[i]]); });
    if (titles.length < 25) return;
  }
});
const NOBODY = /^(tentative|the staff|staff|ta|tba|no instructors?)$/i;
const profs = {}; // code -> Set of names as the Schedule of Classes prints them ("Keranen, J.P.")
await pool(entries, 4, async ([code, model]) => {
  const html = await cached(`${TERM}-sum-${safe(JSON.parse(model).Path)}.html`, `${SOC}/Results/GetCourseSummary?${new URLSearchParams({ model, FilterFlags: FLAGS })}`);
  for (const m of html.matchAll(/-instructor_data"><p>(.*?)<\/p>/g)) for (const p of m[1].split(/<br\s*\/?>/))
    if (p.trim() && !NOBODY.test(p.trim())) (profs[code] ||= new Set()).add(p.trim().replace(/&#39;/g, "'").replace(/&amp;/g, '&'));
});

// ---------- write ----------
const out = {};
for (const code of Object.keys(COURSES)) {
  const s = stat(byCourse[code]), ps = [...(profs[code] || [])].sort();
  if (!s && !ps.length) continue;
  out[code] = { ...s, ...(ps.length && { p: ps.map(name => ({ name, ...stat((byProf[code] || {})[profKey(name)]) })) }) };
}
const file = path.join(ROOT, 'data', 'ucla-grades.js');
fs.writeFileSync(file, `// A percentages per UCLA course, generated by scripts/build-grades.mjs. Do not edit by hand.
// Grades: UCLA public-records data published by uclagrades.com (${files[0].slice(7, 10)} to ${files.at(-1).slice(11, 14)}); instructors: UCLA Schedule of Classes, term ${TERM}.
// Built ${new Date().toISOString().slice(0, 10)}. Shape: { term, c: { [code]: { a?, n?, p? } } }. a = % of letter grades (A+ to F) that were A+, A or A-,
// n = letter grades counted (a and n are left out under ${MIN}); p = instructors listed for \`term\`, each { name, a?, n? } from that instructor's own past sections of the course.
(function (g) {
g.GRADES = {"term":${JSON.stringify(TERM)},"c":{
${Object.entries(out).map(([k, v]) => `${JSON.stringify(k)}:${JSON.stringify(v)}`).join(',\n')}
}};
})(typeof module !== 'undefined' ? module.exports : window);
`);
const v = Object.values(out), pl = v.flatMap(e => e.p || []);
console.log(`grades: ${files.length} files; ${v.filter(e => e.n).length} of ${Object.keys(COURSES).length} courses have an A percentage`);
console.log(`${TERM}: ${entries.length} listings, ${v.filter(e => e.p).length} courses with a named instructor, ${pl.length} course-instructor pairs, ${pl.filter(p => p.n).length} with past grades in that course`);
console.log(`wrote ${file} (${(fs.statSync(file).size / 1e6).toFixed(2)} MB)`);
