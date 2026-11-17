#!/usr/bin/env node
// Builds data/ucla-instructors.js: the instructors the Schedule of Classes lists for the next term and whether their sections are full,
// per course in data/ucla-courses.js. Seats change by the hour during enrollment: delete the cache and rerun for a fresh snapshot.
//   node scripts/build-instructors.mjs [--term 27W] [--cache <dir>]
// Source: sa.ucla.edu/ro/public/soc, one request per course with a section in the term. It sends no CORS headers, so the browser
// cannot ask it directly; grades need no build step (the browser reads them from uclagrades.com). See scripts/README.md.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const { COURSES } = createRequire(import.meta.url)(path.join(ROOT, 'data', 'ucla-courses.js'));
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > 0 ? process.argv[i + 1] : d; };
const CACHE = arg('cache', path.join(os.tmpdir(), 'ucla-instructors-cache'));
fs.mkdirSync(CACHE, { recursive: true });

// The first Fall/Winter/Spring term that starts after today (instructors are only published for that one; later terms say "Tentative").
function nextTerm(d = new Date()) {
  const y = d.getFullYear() % 100, md = (d.getMonth() + 1) * 100 + d.getDate();
  return md < 105 ? y + 'W' : md < 328 ? y + 'S' : md < 922 ? y + 'F' : (y + 1) + 'W';
}
const TERM = arg('term', nextTerm());

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
// Seats, per section: "Open ...", "Waitlist ...", "Closed / Class Full (210)". Anything else ("Closed by Dept", cancelled) says nothing
// about seats and is ignored. A course or instructor is 'wait' or 'full' only when none of its sections is open.
const seatOf = t => /^Open/i.test(t) ? 'open' : /^Waitlist/i.test(t) ? 'wait' : /^Closed/i.test(t) && /Class Full/i.test(t) ? 'full' : null;
const worst = list => list.includes('open') || !list.length ? undefined : list.includes('wait') ? 'wait' : 'full';
const info = {}; // code -> { seats: [state per section], profs: { name as printed ("Keranen, J.P."): [state per section] } }
await pool(entries, 4, async ([code, model]) => {
  const html = await cached(`${TERM}-sum-${safe(JSON.parse(model).Path)}.html`, `${SOC}/Results/GetCourseSummary?${new URLSearchParams({ model, FilterFlags: FLAGS })}`);
  const seat = Object.fromEntries([...html.matchAll(/id="([^"]+)-status_data"><p>(.*?)<\/p>/gs)].map(m => [m[1], seatOf(m[2].replace(/<[^>]*>/g, ' ').trim())]));
  const e = info[code] ||= { seats: [], profs: {} };
  e.seats.push(...Object.values(seat).filter(Boolean));
  for (const m of html.matchAll(/id="([^"]+)-instructor_data"><p>(.*?)<\/p>/gs)) for (const p of m[2].split(/<br\s*\/?>/)) {
    const name = p.trim().replace(/&#39;/g, "'").replace(/&amp;/g, '&');
    if (name && !NOBODY.test(name)) (e.profs[name] ||= []).push(...(seat[m[1]] ? [seat[m[1]]] : []));
  }
});

// ---------- write ----------
const out = Object.entries(info).sort(([a], [b]) => a.localeCompare(b, 'en', { numeric: true })).map(([k, e]) => {
  const p = Object.keys(e.profs).sort().map(name => ({ name, ...(worst(e.profs[name]) && { st: worst(e.profs[name]) }) }));
  return [k, { ...(worst(e.seats) && { st: worst(e.seats) }), ...(p.length && { p }) }];
}).filter(([, v]) => v.st || v.p);
const file = path.join(ROOT, 'data', 'ucla-instructors.js');
fs.writeFileSync(file, `// Instructors the UCLA Schedule of Classes (sa.ucla.edu/ro/public/soc) lists for term ${TERM}, generated by scripts/build-instructors.mjs. Do not edit by hand.
// Built ${new Date().toISOString().slice(0, 10)}. Shape: { term, asOf, c: { [code]: { st?, p?: [{ name, st? }] } } }. st = 'full' (every section with a seat
// count is closed, class full) or 'wait' (none open, at least one taking a waitlist), as of asOf. The browser adds the grade figures
// (a, n) to these entries at run time from uclagrades.com; see MODEL.setGrades in model.js.
(function (g) {
g.GRADES = {"term":${JSON.stringify(TERM)},"asOf":${JSON.stringify(new Date().toISOString().slice(0, 10))},"c":{
${out.map(([k, v]) => `${JSON.stringify(k)}:${JSON.stringify(v)}`).join(',\n')}
}};
})(typeof module !== 'undefined' ? module.exports : window);
`);
console.log(`${TERM}: ${entries.length} listings, ${out.filter(([, v]) => v.p).length} courses with a named instructor, ${out.reduce((n, [, v]) => n + (v.p || []).length, 0)} course-instructor pairs; ${out.filter(([, v]) => v.st === 'full').length} courses full, ${out.filter(([, v]) => v.st === 'wait').length} waitlist only`);
console.log(`wrote ${file} (${(fs.statSync(file).size / 1e6).toFixed(2)} MB)`);
