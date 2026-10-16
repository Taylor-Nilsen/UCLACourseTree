// Builds data/ucla-courses.js from the UCLA General Catalog (catalog.registrar.ucla.edu, a CourseLoop site)
// and the UCLA Schedule of Classes (sa.ucla.edu/ro/public/soc) for the quarters each course was actually offered.
// Usage: node scripts/build-course-db.mjs [--year 2026] [--cache DIR] [--soc-cache DIR]
// No npm deps. Raw responses are cached so reruns don't refetch (delete the dirs to refresh).
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = arg('--cache', path.join(os.tmpdir(), 'ucla-catalog-cache'));
const SOC_CACHE = arg('--soc-cache', path.join(os.tmpdir(), 'ucla-soc-cache'));
const SITE = 'https://catalog.registrar.ucla.edu';
const SOC = 'https://sa.ucla.edu/ro/Public/SOC';
fs.mkdirSync(CACHE, { recursive: true }); fs.mkdirSync(SOC_CACHE, { recursive: true });

async function cached(name, url, opts, dir = CACHE) {
  const f = path.join(dir, name);
  if (fs.existsSync(f)) return fs.readFileSync(f, 'utf8');
  for (let i = 0; ; i++) {
    try {
      const r = await fetch(url, opts);
      if (!r.ok) throw new Error(`${r.status} ${(await r.text()).slice(0, 200)}`);
      const t = await r.text(); fs.writeFileSync(f, t); return t;
    } catch (e) {
      if (i >= 4) throw e;
      console.error(`retry ${url}: ${e.message}`); await new Promise(r => setTimeout(r, 2000 * (i + 1)));
    }
  }
}

// ---------- fetch ----------
const site = JSON.parse(await cached('site-config.json', `${SITE}/api/config/annualised-site-configuration?siteId=ucla-prod-pres`));
const YEAR = arg('--year', site.data.currentYear);
async function catalogYear(year) { // every course in one catalog year, all levels
  const out = [];
  for (let off = 0; ; off += 100) { // sequential pages (100 is the API's max page size); ~150 requests per year
    const body = { siteId: 'ucla-prod-pres', contentType: 'subject', queryParams: [{ queryField: 'availableInYears', queryValue: String(year) }], offset: off, limit: 100 };
    const page = JSON.parse(await cached(`browse-${year}-${off}.json`, `${SITE}/api/search/browsepage-academic-items`,
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).data.data;
    for (const r of page) out.push(JSON.parse(r.data));
    if (page.length < 100) return out;
  }
}
const items = await catalogYear(YEAR);
// Older catalog years: backfill discontinued courses (DARS still lists them) and requisite targets.
const OLD_YEARS = site.data.years.map(y => +y.value).filter(y => y < +YEAR).sort((a, b) => b - a);
const oldItems = [];
for (const y of OLD_YEARS) for (const j of await catalogYear(y)) oldItems.push({ ...j, year: y });
const regHtml = await cached('registrar-subject-codes.html', 'https://registrar.ucla.edu/faculty-staff/courses-and-programs/department-and-subject-area-codes');

// ---------- subject names -> DARS abbreviations ----------
const dec = s => s.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&rsquo;/g, "'")
  .replace(/&ndash;|–|—/g, '-').replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ').trim();
const NAME = new Map(); // lower-case full name -> code
for (const m of regHtml.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
  const c = [...m[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(x => dec(x[1]));
  if (c.length >= 2 && c[1]) NAME.set(c[0].toLowerCase(), c[1]);
}
const subjOf = code => code.replace(/\s+\S+$/, '');
for (const j of items) { // catalog's own "CODE Full Name" (covers anything the Registrar list lacks)
  const s = subjOf(j.code), v = j.educational_area?.value || '';
  if (v.startsWith(s + ' ')) { const n = v.slice(s.length + 1).toLowerCase(); if (!NAME.has(n)) NAME.set(n, s); }
}
// Short / older names used in requisite prose.
const ALIASES = {
  'chemistry': 'CHEM', 'electrical engineering': 'EC ENGR', 'electrical and computer engineering': 'EC ENGR',
  'computer science and engineering': 'COM SCI', 'neuroscience': 'NEUROSC', 'bioinformatics': 'BIOINFR',
  'world arts and cultures/dance': 'WL ARTS', 'english as a second language': 'ESL', 'statistics and data science': 'STATS',
  'atmospheric sciences': 'A&O SCI', 'earth and space sciences': 'EPS SCI', 'study of religion': 'RELIGN',
  'design | media arts': 'DESMA', 'design/media arts': 'DESMA', 'film, television, and digital media': 'FILM TV',
  'chicana and chicano studies': 'CCAS', 'chicana/o studies': 'CCAS', 'chicana/o and central american studies': 'CCAS',
  'molecular, cell, and developmental biology': 'MCD BIO', 'microbiology, immunology, and molecular genetics': 'MIMG',
  'integrative biology and physiology': 'MC&IP', 'physiological science': 'PHYSCI', 'women\'s studies': 'GENDER',
  'near eastern languages and cultures': 'NR EAST', 'asian languages and cultures': 'ASIAN', 'computing': 'COMPTNG',
  'pic': 'COMPTNG', 'civil engineering': 'C&EE', 'materials science': 'MAT SCI', 'materials engineering': 'MAT SCI',
  'chemical engineering': 'CH ENGR', 'religion': 'RELIGN',
  'ge clusters': 'CLUSTER', 'semitics': 'SEMITIC', 'programming in computing': 'COMPTNG', 'life science': 'LIFESCI', 'english comp': 'ENGCOMP', 'math': 'MATH',
};
for (const [k, v] of Object.entries(ALIASES)) if (!NAME.has(k)) NAME.set(k, v);
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const NAME_RE = new RegExp(`\\b(${[...NAME.keys()].sort((a, b) => b.length - a.length).map(esc).join('|')})(?=\\s+[A-Z]{0,2}\\d)`, 'gi');

// ---------- requisite parsing ----------
const NUM = /^(?:[A-Z]{1,2})?\d{1,3}[A-Z]{0,4}$/;
const IGNORABLE = /equivalent|consent|instructor|permission/i;

// Sentences of the description that talk about requisites (kept verbatim in `req`).
function reqSentences(desc) {
  return desc.split(/(?<=\.)\s+(?=[A-Z(])/).filter(s => /requisite|recommended|preparation:/i.test(s));
}

// "Requisites: courses 101, Mathematics 33A, Physics 1A." -> [["X 101"],["MATH 33A"],["PHYSICS 1A"]]
function parseClause(text, self) {
  let t = ' ' + text + ' ';
  // "(14C may be taken concurrently)" / "(may be taken concurrently)" -> mark; "(or X)" -> one more alternative; drop other parentheticals.
  t = t.replace(/\(([^()]*)\)/g, (m, inner) => /concurrent/i.test(inner) ? ` §CONC:${(inner.match(/\b[A-Z]{0,2}\d{1,3}[A-Z]{0,4}\b/g) || ['PREV']).join(':')}§ `
    : /^or\b[^,]*$/i.test(inner) && !/\band\b/.test(inner) ? ` ${inner} ` : ' ');
  t = t.replace(/,?\s*(?:all )?with (?:a )?(?:minimum )?grades? of [A-D][+-]?(?: or better)?/gi, ' ');
  t = t.replace(NAME_RE, (m) => `§${NAME.get(m.toLowerCase())}§`);
  t = t.replace(/\bcourses?\b/gi, `§${self}§`);
  // Resolve each number to a full code in text order (subjects are sticky: "Mathematics 31A, 31B").
  let subj = self, last = null; const conc = new Set();
  t = t.replace(/§([^§]+)§|(?<![\d.])\b([A-Z]{0,2}\d{1,3}[A-Z]{0,4})\b(?!\.\d)/g, (m, sj, num) => {
    if (sj?.startsWith('CONC:')) { for (const n of sj.split(':').slice(1)) conc.add(n === 'PREV' ? last : n); return ' '; }
    if (sj) { subj = sj; return ' '; }
    last = `${subj} ${num}`; conc.has(num) && conc.add(last); return `{${last}}`;
  });
  const isConc = c => conc.has(c) || conc.has(c.split(' ').pop());
  const groups = []; // AND-list of OR-strings
  const ONE = /\b(?:one|any)\b[\s\w-]{0,25}?\bfrom\b|\bone of\b|\beither\b/i;
  for (const semi of t.split(';')) {
    const parts = semi.split(/,|\band\b/);
    const i = parts.findIndex(p => ONE.test(p));
    if (i >= 0) { groups.push(...parts.slice(0, i), parts.slice(i).join(' or ')); continue; } // "..., one course from A, B, or C"
    if (!/,\s*or\b/.test(semi)) { groups.push(...parts); continue; }
    // "A, B, and C, or D and E": a DNF of AND-lists. A flat "A, B, C, or D" (no "and", single last item) is just an OR-list.
    const branches = semi.split(/,\s*or\b/).map(b => b.split(/,|\band\b/).filter(x => /\S/.test(x)));
    if (!/\band\b/.test(semi) && branches.at(-1).length === 1) { groups.push(branches.flat().join(' or ')); continue; }
    if (branches.flat().some(x => !/\{/.test(x) && !IGNORABLE.test(x))) continue; // "or background in ...", "3.0 GPA": unparseable
    const real = branches.filter(b => b.some(x => /\{/.test(x)));
    if (real.every(b => b.length === real[0].length)) real[0].forEach((_, k) => groups.push(real.map(b => b[k]).join(' or '))); // pair by position
    else { // distribute (exact CNF) when small
      let cnf = [[]]; for (const b of real) cnf = cnf.flatMap(g => b.map(x => [...g, x]));
      if (cnf.length > 1 && real.reduce((n, b) => n * b.length, 1) <= 16) groups.push(...real[0].flatMap(x => real.slice(1).reduce((acc, b) => acc.flatMap(a => b.map(y => a + ' or ' + y)), [x])));
    }
  }
  const pre = [];
  for (const g of groups) {
    const alts = g.split(/\bor\b/), codes = [];
    let bad = false;
    for (const alt of alts) {
      const cs = alt.match(/\{[^}]+\}/g)?.map(c => c.slice(1, -1)) || [];
      // A code buried in prose ("one term of experience in the lab where 196A research is done") isn't a requisite list.
      if (cs.length && alt.replace(/\{[^}]+\}|\b(?:one|either|any|of|from|the|following|courses?|equivalent|upper|lower|division)\b/gi, '').split(/\W+/).filter(Boolean).length > 3) bad = true;
      if (cs.length) codes.push(...cs);
      else if (/\w/.test(alt.replace(/\b(?:one|either|any|of|from|the|following|list)\b/gi, '')) && !IGNORABLE.test(alt)) bad = true;
    }
    if (bad || !codes.length || codes.some(isConc)) continue; // non-course alternative or concurrent-ok: leave to `req` text
    pre.push([...new Set(codes)]);
  }
  return pre;
}

function parsePre(sentences, self) {
  const pre = [];
  for (const s of sentences) {
    const m = s.match(/^(?:enforced\s+)?(?:pre)?requisites?\s*:\s*(.*)$/i); // "Requisite or corequisite", "Recommended ..." excluded
    if (m) pre.push(...parseClause(m[1].replace(/\.$/, ''), self));
  }
  return pre;
}

// ---------- build ----------
const norm = c => c.replace(/\s+/g, ' ').trim();
function entry(j) {
  const code = norm(j.code), desc = dec(j.description || '');
  const units = (j.credit_points_header || '').match(/\d+(?:\.\d+)?/g);
  const sents = reqSentences(desc);
  const e = { t: dec(j.title), u: units ? Math.max(...units.map(Number)) : 0, pre: parsePre(sents, subjOf(code)), off: '?' };
  if (sents.length) e.req = sents.join(' ');
  if (/^(\([^)]*\)\s*)?Tutorial\b/.test(desc)) TUTORIAL.add(code); // arranged one-on-one; many departments never list these in the Schedule of Classes
  if (/Writing II/i.test(desc) && /satisf/i.test(desc)) e.w2 = true;
  if (j.year) e.last = j.year; // discontinued: last catalog year (e.g. 2023 = 2023-24) that listed it
  return e;
}
const TUTORIAL = new Set();
const isUG = j => /^Undergraduate/.test(j.course_level);
const DB = {};
for (const j of items.filter(isUG)) DB[norm(j.code)] = entry(j);
const OLD = {}; // newest older-catalog version of every course code (any level: requisites name a few grad courses)
for (const j of oldItems) if (!OLD[norm(j.code)]) OLD[norm(j.code)] = j;
const CUR_ANY = Object.fromEntries(items.map(j => [norm(j.code), j]));
// Undergraduate courses dropped since the oldest catalog year: DARS still lists them (taken courses, GE options).
let dropped = 0;
for (const [k, j] of Object.entries(OLD)) if (!CUR_ANY[k] && isUG(j)) { DB[k] = entry(j); dropped++; }
console.log(`added ${dropped} undergraduate courses listed in ${OLD_YEARS.at(-1)}-${YEAR - 1} catalogs but not in ${YEAR} (marked with last)`);

// A requisite naming a code that isn't in the DB: the multi-list prefix (C/M/CM) often changed, or the
// sticky subject in prose ("courses 100B or Mathematics 170S, 101A") really meant the course's own subject.
const variants = (subj, num) => { const b = num.replace(/^(CM|C|M)(?=\d)/, ''); return [num, b, 'C' + b, 'M' + b, 'CM' + b].map(n => `${subj} ${n}`); };
function resolve(code, self) {
  const [subj, num] = [subjOf(code), code.slice(subjOf(code).length + 1)];
  const cands = [...variants(subj, num), ...(subj !== self ? variants(self, num) : [])];
  for (const has of [c => DB[c], c => CUR_ANY[c] && isUG(CUR_ANY[c]), c => OLD[c] || CUR_ANY[c]]) {
    const hit = cands.find(has); if (hit) return hit;
  }
  return code;
}
for (let pass = 0, added = 1; added; pass++) { // repeat: backfilled courses can name further missing courses
  added = 0;
  for (const [k, e] of Object.entries(DB)) e.pre = e.pre.map(g => [...new Set(g.map(c => DB[c] ? c : resolve(c, subjOf(k))))]);
  for (const e of Object.values(DB)) for (const g of e.pre) for (const c of g)
    if (!DB[c] && (OLD[c] || CUR_ANY[c])) { DB[c] = entry(CUR_ANY[c] || OLD[c]); added++; }
  if (pass === 0) console.log(`backfilled ${added} more courses (graduate or older) named in requisites`);
}
// Alternatives naming courses absent from every catalog since ${OLD_YEARS.at(-1)} (e.g. LIFESCI 1-4, ENGCOMP 3H) are stale
// catalog prose: drop them from an OR-group that still has a real alternative (the raw text stays in `req`).
const pruned = {};
for (const e of Object.values(DB)) e.pre = e.pre.map(g => {
  if (!g.some(c => DB[c])) return g;
  for (const c of g) if (!DB[c]) pruned[c] = (pruned[c] || 0) + 1;
  return g.filter(c => DB[c]);
});
const np = Object.values(pruned).reduce((a, b) => a + b, 0);
console.log(`pruned ${np} stale OR-alternatives: ${Object.entries(pruned).sort((a, b) => b[1] - a[1]).slice(0, 20).map(([k, v]) => `${k} x${v}`).join(', ')}`);

// ---------- offerings from the Schedule of Classes ----------
// For every subject and term, list the courses with at least one section that is not cancelled. A course's `off` is the
// set of quarters (F/W/S) it ran in during WINDOW; `offTerms` lists those terms. Summer sessions are out of scope.
const Q = { F: 'Fall', W: 'Winter', S: 'Spring' };
const tIdx = t => (+t.slice(0, 2) - (t[2] === 'F' ? 0 : 1)) * 3 + 'FWS'.indexOf(t[2]); // academic-year order
const tName = i => { const y = Math.floor(i / 3), q = 'FWS'[i % 3]; return String(q === 'F' ? y : y + 1).padStart(2, '0') + q; };
const label = t => `${Q[t[2]]} 20${t.slice(0, 2)}`;
const home = await cached('soc-home.html', SOC, undefined, SOC_CACHE);
const cur = tIdx(home.match(/value="(\d\d[FWS])"[^>]*selected="selected"/)[1]); // the term the site opens on
const first = cur - cur % 3 - 6; // Fall two academic years back
const WINDOW = Array.from({ length: cur + 2 - first }, (_, i) => tName(first + i)); // ... through the next term
const LOOKBACK = Array.from({ length: 9 }, (_, i) => tName(first - 9 + i)); // older terms, only to date `offNote`
const FLAGS = JSON.stringify({ enrollment_status: 'O,W,C,T,S', advanced: 'y', meet_days: null, start_time: null, end_time: null, // every status but cancelled
  meet_locations: null, meet_units: null, instructor: null, class_career: null, impacted: null, enrollment_restrictions: null,
  enforced_requisites: null, individual_studies: null, summer_session: null });
async function socTerm(subj, term) { // course numbers with a live section, from the paged "course titles" view (25 per page)
  const nums = new Set();
  for (let page = 1; ; page++) {
    const model = JSON.stringify({ subj_area_cd: subj, search_by: 'subject', term_cd: term, ActiveEnrollmentFlag: 'n', HasData: 'True' });
    const qs = new URLSearchParams({ search_by: 'subject', model, pageNumber: page, filterFlags: FLAGS });
    const html = await cached(`${term}-${subj.replace(/\W/g, '_')}-${page}.html`, `${SOC}/Results/CourseTitlesView?${qs}`,
      { headers: { 'x-requested-with': 'XMLHttpRequest', 'user-agent': 'Mozilla/5.0' } }, SOC_CACHE);
    const titles = [...html.matchAll(/<button class="linkLikeButton" id="[^"]+-title"[^>]*>([^<]+)</g)].map(m => m[1].trim().split(' - ')[0]);
    if (!titles.length && html.length > 5000) throw new Error(`unexpected page: ${term} ${subj} ${page}`);
    titles.forEach(n => nums.add(n));
    if (titles.length < 25) return nums;
  }
}
async function pool(jobs, n, fn) { // polite: at most n requests in flight
  let i = 0, done = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < jobs.length) { await fn(jobs[i++]); if (++done % 200 === 0) console.log(`schedule of classes: ${done}/${jobs.length}`); } }));
}
const SEEN = {}; // code -> terms with a live section
const subjAreas = [...new Set(Object.keys(DB).map(subjOf))];
await pool(subjAreas.flatMap(s => [...LOOKBACK, ...WINDOW].map(t => [s, t])), 4, async ([s, t]) => {
  for (const n of await socTerm(s, t)) (SEEN[`${s} ${n}`] ||= []).push(t);
});
for (const [k, e] of Object.entries(DB)) {
  const seen = (SEEN[k] || []).sort((a, b) => tIdx(a) - tIdx(b)), offTerms = seen.filter(t => WINDOW.includes(t));
  e.off = 'FWS'.split('').filter(q => offTerms.some(t => t[2] === q)).join('');
  if (offTerms.length) e.offTerms = offTerms;
  else if (TUTORIAL.has(k)) Object.assign(e, { off: '?', offNote: 'tutorial arranged with a faculty mentor; not listed in the Schedule of Classes' });
  else e.offNote = `not offered since ${seen.length ? label(seen.at(-1)) : 'before ' + label(LOOKBACK[0])}`;
}
const sorted = Object.fromEntries(Object.entries(DB).sort(([a], [b]) => a.localeCompare(b, 'en', { numeric: true })));

const out = path.join(ROOT, 'data', 'ucla-courses.js');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, `// UCLA undergraduate course database, generated by scripts/build-course-db.mjs. Do not edit by hand.
// Source: UCLA General Catalog ${YEAR}-${String(+YEAR + 1).slice(2)} (catalog.registrar.ucla.edu); subject codes per Registrar's
// "Department and Subject Area Codes"; off/offTerms from the UCLA Schedule of Classes (sa.ucla.edu/ro/public/soc),
// terms ${WINDOW[0]}-${WINDOW.at(-1)} (Fall/Winter/Spring; ${WINDOW.at(-1)} as published so far), counting sections that were not cancelled.
// Built ${new Date().toISOString().slice(0, 10)}. Shape: { t, u, pre: AND-of-OR groups, off: quarters offered ("" = none in those terms),
// offTerms?: terms it ran, offNote?: "not offered since <term>" when off is "" (off "?": an unlisted tutorial), req?, w2?, last? (discontinued; last catalog year listing it) }
(function (g) {
g.COURSES = {
${Object.entries(sorted).map(([k, v]) => `${JSON.stringify(k)}:${JSON.stringify(v)}`).join(',\n')}
};
})(typeof module !== 'undefined' ? module.exports : window);
`);

// ---------- report ----------
const keys = Object.keys(DB), subjects = new Set(keys.map(subjOf));
let refs = 0; const dangling = {};
for (const e of Object.values(DB)) for (const g of e.pre) for (const c of g) { refs++; if (!DB[c]) dangling[c] = (dangling[c] || 0) + 1; }
const nd = Object.values(dangling).reduce((a, b) => a + b, 0);
console.log(`catalog year ${YEAR}: ${items.length} catalog courses (all levels); wrote ${keys.length} entries (${keys.filter(k => !DB[k].last && isUG(CUR_ANY[k] || {})).length} current undergraduate), ${subjects.size} subjects`);
console.log(`with pre: ${Object.values(DB).filter(e => e.pre.length).length}, with req text: ${Object.values(DB).filter(e => e.req).length}, offered ${WINDOW[0]}-${WINDOW.at(-1)}: ${Object.values(DB).filter(e => e.off && e.off !== '?').length}, not offered: ${Object.values(DB).filter(e => !e.off).length}, unlisted tutorials: ${Object.values(DB).filter(e => e.off === '?').length}, w2: ${Object.values(DB).filter(e => e.w2).length}`);
console.log(`pre references: ${refs}, dangling: ${nd} (${(100 * nd / refs).toFixed(2)}%)`);
console.log('top dangling:', Object.entries(dangling).sort((a, b) => b[1] - a[1]).slice(0, 20).map(([k, v]) => `${k} x${v}`).join(', '));
console.log(`wrote ${out} (${(fs.statSync(out).size / 1e6).toFixed(2)} MB)`);
