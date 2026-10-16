// DARS (UCLA degree audit, CollegeSource u.achieve) parser. Input: lines [{x, line}] from pdf.js (see linesFromItems) or plain text.
// Output (see INTERFACE.md): { ok, reason?, student, currentTerm, unitsNeeded, taken, sections, unparsed }.
// parse() never throws: anything it cannot read is returned in `unparsed` (inside a requirement section) or makes ok:false.
(function (g) {
  const TERMQ = { FA: 0, WI: 1, SP: 2, SU: 3 };
  // term index: academic year * 4 + quarter (FA26=2026*4, WI27=2026*4+1 ...)
  function termIndex(t) { const m = /^(FA|WI|SP|SU)(\d\d)$/.exec(t); if (!m) return null; const q = TERMQ[m[1]]; let y = 2000 + +m[2]; if (q > 0) y -= 1; return y * 4 + q; }
  function termName(i) { const q = i % 4, y = Math.floor(i / 4) + (q > 0 ? 1 : 0); return ['FA', 'WI', 'SP', 'SU'][q] + String(y).slice(2); }
  function termFromDate(mdy) { const [m, , y] = mdy.split('/').map(Number); const q = m <= 3 ? 'WI' : m <= 6 ? 'SP' : m <= 8 ? 'SU' : 'FA'; return q + String(y).slice(2); }

  // u.achieve status markers printed left of a requirement (OK/NO/IP) or sub-requirement (+ - R IP+ ...).
  const STATUS_ONLY = /^(OK|NO|IP[+-]?|[+-]R?|R[+-]?|\(R\)|<\s*>|\*|OR|NA)$/;
  const STATUS_PREFIX = /^(OK|NO|IP|IP ?[+-]|[+-] ?R|R ?[+-]|[+-]|R|\(R\)|<\s*>|\*)\s+(?=[A-Z0-9(])/;

  // Re-join pdf.js text items into lines; glyph runs are fused when the x-gap is tiny.
  // A lone status marker left of a title (u.achieve's "R", "OK", "+") becomes its own line so the title keeps its own x.
  function linesFromItems(items) {
    const rows = [];
    for (const it of items || []) { if (!it || !it.str || !it.transform) continue; const y = it.transform[5], x = it.transform[4], h = it.height || Math.abs(it.transform[0]) || 8;
      let row = rows.find(r => Math.abs(r.y - y) <= 2); if (!row) { row = { y, items: [] }; rows.push(row); } row.items.push({ x, w: it.width || 0, h, str: it.str }); }
    rows.sort((a, b) => b.y - a.y);
    const out = [];
    for (const r of rows) {
      r.items.sort((a, b) => a.x - b.x);
      let s = '', end = null, x0 = r.items[0].x;
      for (const it of r.items) {
        if (end !== null && it.x - end > 0.22 * it.h) {
          if ((STATUS_ONLY.test(s.trim()) || /^[^\w\s]{1,3}$/.test(s.trim())) && it.x - end > 2 * it.h) { out.push({ x: Math.round(x0), line: s.trim() }); s = ''; x0 = it.x; }
          else s += ' ';
        }
        s += it.str; end = it.x + it.w;
      }
      const line = s.replace(/\s+/g, ' ').trim(); if (line) out.push({ x: Math.round(x0), line });
    }
    return out;
  }

  const CODE = '(?:CM|M|C|T)?\\d{1,3}[A-Z]{0,3}';
  const WILD = '(?:\\d{0,3}[@*]+[A-Z@*]{0,3}|\\d{1,2}XX(?![A-Z0-9])|XXX(?![A-Z0-9]))';
  function splitCode(s) { const m = new RegExp('^([A-Z][A-Z&\' -]*?)\\s*(' + CODE + ')$').exec(String(s).trim()); return m ? { dept: m[1].trim(), num: m[2] } : null; }
  const COURSE_LINE = /^(FA|WI|SP|SU)(\d\d)\s+(.+?)\s+(\d+\.\d+)\s+(\S+)\s*(.*)$/;
  // "SP25 MATH 32B DROP CALC OF SEVRL VAR" (dropped-course notation: no units column)
  const DROP_LINE = /^(FA|WI|SP|SU)(\d\d)\s+(.+?)\s+(DROP|DRP|W|WD)\s+(.*)$/;

  // grade -> 'done' | 'ip' | 'failed' | 'withdrawn' | 'incomplete' | 'unknown'. T/U prefix = transfer grade (UCLA).
  function gradeStatus(grade) {
    const g = String(grade || '').toUpperCase().replace(/>.*$/, '');
    if (/^(IP|IPPF|PL|PLN|PLAN|PLANNED|RG|RGPF|PG|PGPF|REG|\*+)$/.test(g)) return 'ip';
    if (/^(W|WD|WF|WP|WU|WX|WN|DROP)$/.test(g)) return 'withdrawn';
    if (/^(I|IN|INC|IF|NR|DR|DE|X|Z)$/.test(g)) return 'incomplete';
    if (/^(AP|IB|TE|EX|GCE|TR|T|CRE|CL|DS|EXM)$/.test(g)) return 'done'; // exam / test / transfer credit
    if (/^[TU]?(F|NP|NC|NCR|NOCR|E|U|FAIL)$/.test(g)) return 'failed';
    if (/^[TU]?([A-D][+-]?|P|S|CR|PASS)$/.test(g)) return 'done';
    return 'unknown';
  }
  const RANK = { done: 5, ip: 4, incomplete: 3, unknown: 2, withdrawn: 1, failed: 0 };

  // "MECH&AE 102,105A,157 OR 157W ENGR 2(FA24-9999) MAT SCI 100 TO 187 PSYCH 1@@" -> options.
  // info.bad collects fragments that are not course codes; info.attrs collects attribute filters ("F:W2T").
  function parseOptions(text, currentTerm, info) {
    info = info || {}; const bad = info.bad || (info.bad = []), attrs = info.attrs || (info.attrs = []);
    text = String(text || '').replace(/\bF:(\S+)/g, (_, a) => { attrs.push(a.replace(/,$/, '')); return ' '; });
    text = text.replace(/\(\s*([A-Z]{2}\s*\d{2}|0000)\s*-\s*([A-Z]{2}\s*\d{2}|9999)\s*\)/g, (_, a, b) => '(' + a.replace(/\s/g, '') + '-' + b.replace(/\s/g, '') + ')');
    const re = new RegExp('(' + WILD + '|' + CODE + ')(?:\\(([^)]*)\\))?', 'g');
    const out = []; let dept = null, last = 0, m;
    const cur = termIndex(currentTerm);
    const DEPT = /^[A-Z][A-Z&' -]*$/;
    while ((m = re.exec(text))) {
      const between = text.slice(last, m.index).replace(/[,;]/g, ' ').replace(/\s+/g, ' ').trim();
      last = re.lastIndex;
      let op = null, mm;
      if (/^(OR|TO|THRU|THROUGH|-|AND|&)$/.test(between)) op = between;
      else if ((mm = /^(TO|THRU|THROUGH) ([A-Z][A-Z&' -]*)$/.exec(between)) && mm[2] === dept) op = 'TO';
      else if (between) { if (!DEPT.test(between)) { bad.push(between + ' ' + m[0]); dept = null; continue; } dept = between; }
      if (!dept) { bad.push(m[0]); continue; }
      let ok = true;
      if (m[2]) { const [a, b] = m[2].split('-'); const end = termIndex(b || a); if (b !== '9999' && end !== null && cur !== null && end < cur) ok = false; }
      const isWild = new RegExp('^' + WILD + '$').test(m[1]);
      const num = isWild ? m[1].replace(/[*X]/g, '@') : m[1];
      const prev = out[out.length - 1];
      if (/^(TO|THRU|THROUGH|-)$/.test(op) && prev && !prev.wildcard) { prev.to = num; continue; }
      if (op === 'OR' && prev && !isWild && !prev.wildcard && !prev.to) { if (ok) prev.alts.push(dept + ' ' + num); continue; }
      if (!ok) continue;
      out.push(isWild ? { dept, num, wildcard: num, alts: [] } : { dept, num, alts: [dept + ' ' + num] });
    }
    const tail = text.slice(last).replace(/[,;]/g, ' ').trim();
    if (tail) bad.push(tail);
    return out;
  }

  const SUMMARY_WORDS = new Set(['UNIT', 'UNITS', 'COURSE', 'COURSES', 'TAKEN', 'GRADED', 'ATMPTD', 'POINTS', 'GPA', 'SUB-GROUP', 'SUB-GROUPS', 'HOURS', 'CREDITS', 'CREDIT', 'IN-PROG', 'EARNED', 'EARNED:', 'IN-PROGRESS', 'IN-PROGRESS:', 'IN-P', '-->', '--->', 'NEEDS', 'NEEDS:']);
  const isSummary = l => { const t = l.replace(/[()]/g, ' ').split(/\s+/).filter(Boolean); return t.some(w => /^[\d.]+$/.test(w)) && t.every(w => /^[\d.]+$/.test(w) || SUMMARY_WORDS.has(w.toUpperCase())); };
  const isChrome = l => /^\d{1,2}\/\d{1,2}\/\d{2,4},? \d{1,2}:\d\d(:\d\d)?\s*[AP]M\b/.test(l) || /dars\.ucla\.edu|printerFriendly|about:blank|selfservice\/audit/i.test(l) ||
    /My Audit - Audit Results Tab/i.test(l) || /^(Page )?\d+ (of|\/) \d+$/i.test(l) || /^\d+\/\d+$/.test(l);
  const PROGRAM_ROW = /^(?:[*>]\s*)?((?:MAJOR|MINOR|SPEC|SPECIALIZATION|CONC|CONCENTRATION|CERT|PREMAJOR|PRE-MAJOR|OPTION)\s?\d*)\s+(\d{4}\s+(?:FALL|WINTER|SPRING|SUMMER))\s+([A-Z]{0,4}\d{2,6}[A-Z]{0,2})\s+(.+)$/;
  const empty = (reason, unparsed) => ({ ok: false, reason, student: { programs: [] }, taken: {}, sections: [], unitsNeeded: null, currentTerm: null, unparsed: unparsed || [] });

  function parse(input) {
    try { return parseLines(input); }
    catch (e) { return empty('The audit reader hit an internal error (' + (e && e.message) + '). Please send the diagnostic to the maintainer.'); }
  }

  function parseLines(input) {
    let lines;
    if (typeof input === 'string') lines = input.split(/\r?\n/).map(l => ({ x: (l.length - l.trimStart().length) * 6, line: l.trim() }));
    else if (Array.isArray(input)) lines = input.filter(l => l && typeof l === 'object' && (typeof l.line === 'string' || typeof l.line === 'number'))
      .map(l => ({ x: Number.isFinite(+l.x) ? +l.x : 0, line: String(l.line).replace(/\s+/g, ' ').trim() })).filter(l => l.line);
    else return empty('No text was found in this file.');
    if (!lines.length) return empty('No text was found in this file. If it is a scanned image, print the audit to PDF from the DARS site instead.');

    // column positions differ by print margins: derive them from the most common x of NEEDS:/SELECT FROM: lines
    const xs = {}; for (const l of lines) if (/^(NEEDS:|SELECT FROM:)/i.test(l.line)) xs[l.x] = (xs[l.x] || 0) + 1;
    const dataX = +Object.keys(xs).sort((a, b) => xs[b] - xs[a])[0] || 85;
    const res = { ok: true, student: { programs: [] }, taken: {}, sections: [], unitsNeeded: null, currentTerm: null, unparsed: [] };
    let section = null, group = null, mode = null, lastHeaderWasTop = false, afterBreak = false, program = null, lastTaken = null, dars = 0;
    const unparsed = (line, why) => { if (section) res.unparsed.push(Object.assign({ section: section.title, line }, why ? { why } : {})); };
    const addTaken = (code, info) => {
      const prev = res.taken[code];
      if (!prev || RANK[info.status] > RANK[prev.status] || (info.status === prev.status && info.status !== 'done' && (termIndex(info.term) || 0) > (termIndex(prev.term) || 0)))
        res.taken[code] = Object.assign({}, prev, info);
    };
    const newGroup = (name, extra) => { group = Object.assign({ section: section.title, name, taken: [], options: [], notFrom: [] }, extra); section.groups.push(group); return group; };
    const programOf = line => res.student.programs.find(p => line === p.key || line.startsWith(p.key + ' ') || line.startsWith(p.key + ':') || line === p.name ||
      line === p.name + ' ' + p.type.toUpperCase() || line === p.type.toUpperCase() + ' IN ' + p.name || line === p.type.toUpperCase() + ': ' + p.name);

    // the next line that is not print chrome or a lone status marker
    const next = i => { for (let j = i + 1; j < lines.length; j++) if (!isChrome(lines[j].line) && !STATUS_ONLY.test(lines[j].line)) return lines[j].line; return ''; };
    const REQ_LINE = /^(NEEDS:|SELECT FROM:|(FA|WI|SP|SU)\d\d\s)/i;
    for (let i = 0; i < lines.length; i++) {
      let { x, line } = lines[i], m, level = null;
      if (isChrome(line)) { afterBreak = true; continue; }
      if (STATUS_ONLY.test(line)) continue; // marker printed on its own line
      if ((m = /^-+>\s*(?=\S)/.exec(line))) line = line.slice(m[0].length);
      if ((m = STATUS_PREFIX.exec(line)) && !COURSE_LINE.test(line)) { level = /^(OK|NO|IP)$/.test(m[1]) ? 'top' : /^(\*|<\s*>)$/.test(m[1]) ? null : 'group'; line = line.slice(m[0].length); }
      else if (!COURSE_LINE.test(line) && (m = /^([^\w\s(<>"'-][^\w\s]{0,2}|[^\w\s(]{2,3})\s+(?=[A-Z])/.exec(line))) { unparsed(line, 'unknown status marker "' + m[1] + '"'); line = line.slice(m[0].length); }

      if ((m = /Audit Prepared On (\d\d?\/\d\d?\/\d{4})/.exec(line))) { res.student.auditDate = m[1]; res.currentTerm = termFromDate(m[1]); dars++; continue; }
      if ((m = /Degree Expected Term (\d{4}) (FALL|WINTER|SPRING|SUMMER)/.exec(line))) { res.student.expected = { FALL: 'FA', WINTER: 'WI', SPRING: 'SP', SUMMER: 'SU' }[m[2]] + m[1].slice(2); continue; }
      if ((m = PROGRAM_ROW.exec(line))) {
        const key = m[1].replace(/\s+/g, ''), name = m[4].trim();
        if (!res.student.programs.some(p => p.key === key && p.code === m[3]))
          res.student.programs.push({ key, type: /^MAJOR/.test(key) ? 'major' : /^MINOR/.test(key) ? 'minor' : key.replace(/\d+$/, '').toLowerCase(), catalogTerm: m[2], code: m[3], name });
        dars++; continue;
      }
      if ((m = COURSE_LINE.exec(line))) {
        dars++;
        const cm = m, sc = splitCode(cm[3]);
        if (!sc) { if (!/^[A-Z]+$/.test(cm[3])) unparsed(line, 'course code not recognized'); continue; } // NONTRNS / NONCRDT rows have no course
        let grade = cm[5], title = cm[6], flags = [];
        if (grade.includes('>')) { flags.push(grade.slice(grade.indexOf('>'))); grade = grade.slice(0, grade.indexOf('>')); }
        while ((m = /^(>\S*|\(R\)|RP|\*+)\s*/.exec(title)) && m[0]) { flags.push(m[1]); title = title.slice(m[0].length); }
        const code = sc.dept + ' ' + sc.num, status = gradeStatus(grade);
        addTaken(code, Object.assign({ term: cm[1] + cm[2], units: +cm[4], grade, status, title }, flags.length ? { flags } : {}));
        lastTaken = code; lastHeaderWasTop = false;
        if (group && mode !== 'select' && (status === 'done' || status === 'ip') && !group.taken.includes(code)) group.taken.push(code);
        continue;
      }
      if ((m = DROP_LINE.exec(line)) && splitCode(m[3])) { const sc = splitCode(m[3]); addTaken(sc.dept + ' ' + sc.num, { term: m[1] + m[2], units: 0, grade: m[4], status: 'withdrawn', title: m[5] }); continue; }
      if (/^(FA|WI|SP|SU)\d\d\s+SPECIAL NOTE\b/.test(line)) continue; // term notes such as "FA24 SPECIAL NOTE DEANS HONORS LIST"
      if (/^(FA|WI|SP|SU)\d\d\s/.test(line)) { unparsed(line, 'course line not recognized'); continue; }
      if ((m = /^ALTERNATE CRS:\s*(.+)$/.exec(line))) { const sc = splitCode(m[1]); if (sc && lastTaken) addTaken(sc.dept + ' ' + sc.num, Object.assign({}, res.taken[lastTaken], { via: lastTaken })); continue; }
      if ((m = /^NEEDS:\s*(.*)$/i.exec(line))) {
        dars++; lastHeaderWasTop = false;
        const s = m[1].toUpperCase(), sg = /(\d+) SUB-?GROUPS?/.exec(s), c = /(\d+) COURSES?/.exec(s), u = /([\d.]+) (?:UNITS?|HOURS?|CREDITS?)/.exec(s);
        if (sg) { if (section) section.needSubgroups = +sg[1]; continue; }
        if (section && /^UNIT CHECK/.test(section.title) && u) { res.unitsNeeded = +u[1]; continue; }
        if (/GPA/.test(s)) continue;
        if (!c && !u) { unparsed(line, 'NEEDS line not recognized'); continue; }
        if (!section) continue;
        if (!group) newGroup(section.title);
        group.needCourses = c ? +c[1] : null; group.needUnits = u ? +u[1] : null;
        if (!group.needCourses && group.needUnits) group.needCourses = Math.max(1, Math.floor(group.needUnits / 4)); // GE "4.0 UNITS" or "5.0 UNITS" = 1 course
        mode = null; continue;
      }
      if ((m = /^NOT FROM:\s*(.*)$/i.exec(line))) { if (group) group._not = (group._not ? group._not + ' ' : '') + m[1]; mode = 'not'; continue; }
      if ((m = /^SELECT FROM:\s*(.*)$/i.exec(line))) { dars++; if (group) group._sel = (group._sel ? group._sel + ' ' : '') + m[1]; else unparsed(line, 'SELECT FROM outside a requirement'); mode = 'select'; continue; }
      if ((m = /^(OR|AND)\) (.+)$/.exec(line)) && section) { mode = null; lastHeaderWasTop = false; newGroup(m[2], m[1] === 'OR' ? { orPrev: true } : {}); continue; }
      const caps = !/[a-z]/.test(line) && /[A-Z]{3}/.test(line);
      if (!section && /,[^,]*\/\s*\S*\s*$/.test(line)) continue; // "SCHOOL ... - LAST, FIRST / ID" header line
      // a section title the browser repeats at the top of the next page: skip it, keep reading the list it interrupted
      if (section && caps && x < dataX - 10 && (afterBreak || /\(?CONT(INUED|'D)?\)?$/.test(line)) && line.replace(/\s*\(?CONT(INUED|'D)?\)?$/, '') === section.title) { afterBreak = false; continue; }
      afterBreak = false;
      // list continuation: indented past the data column, or a digit-bearing line that is not a group title (a title is followed by NEEDS/courses)
      if ((mode === 'select' || mode === 'not') && group && (x > dataX + 10 || (/\d/.test(line) && x >= dataX - 10 && !(x <= dataX + 6 && (REQ_LINE.test(next(i)) || isSummary(next(i)))))) && !/^[A-Z][A-Z &-]+$/.test(line)) { group[mode === 'select' ? '_sel' : '_not'] += ' ' + line; continue; }
      mode = null;
      if (/^[^A-Za-z0-9\s]{1,3}$/.test(line)) { unparsed(line, 'unknown status marker'); continue; }
      if (isSummary(line) || /^[^A-Za-z0-9]*$/.test(line)) continue;
      if (x > dataX + 150) continue; // right-hand annotation column (AP TEST:, transfer school, grade changes)
      if (!caps) { if (section && !/[a-z]/.test(line) && /[A-Z0-9]/.test(line) && line.length > 2) unparsed(line); lastHeaderWasTop = false; continue; } // prose is fine; caps junk is not
      const top = level ? level === 'top' : x < dataX - 10;
      if (top) { // top-level section header; further caps lines before the first group are notes (or the rest of a two-line title)
        const p = programOf(line); if (p) program = p.key;
        if (lastHeaderWasTop && section && !section.groups.length && !p) {
          if (!section.note && /(\b(OF|AND|OR|FOR|THE|TO|IN|WITH|FROM)|[:,&-])$/.test(section.title)) section.title += ' ' + line;
          else section.note = section.note ? section.note + ' ' + line : line;
          continue;
        }
        section = { title: line, program, groups: [], needSubgroups: null }; res.sections.push(section); group = null; lastHeaderWasTop = !p; continue;
      }
      lastHeaderWasTop = false;
      if ((level === 'group' || x <= dataX + 6) && section && !/^(IN-PROG|GRADED|EARNED)/.test(line)) { const note = /GRADE REQUIRED|\.$/.test(line);
        if (note && group && !group.note && group.needCourses === undefined && !group._sel && !group.taken.length) group.note = line; // note under a group title
        else newGroup(note ? section.title : line, note ? { note: line } : {}); }
    }
    for (const s of res.sections) for (const gr of s.groups) {
      if (/TECHNICAL BREADTH/.test(s.title) && gr.needCourses && !gr._sel && !gr.taken.length) gr.undeclared = true;
      const info = { bad: [], attrs: [] };
      if (gr._sel) gr.options = parseOptions(gr._sel, res.currentTerm, info);
      if (gr._not) { const n = parseOptions(gr._not, res.currentTerm, info), r = n.filter(o => o.to || o.wildcard);
        gr.notFrom = n.filter(o => !r.includes(o)).flatMap(o => o.alts); if (r.length) gr.notFromRanges = r; }
      if (info.attrs.length) gr.attributes = info.attrs;
      for (const b of info.bad) res.unparsed.push({ section: s.title, line: b, why: 'not a course code in the list for ' + gr.name });
      delete gr._sel; delete gr._not;
    }
    // drop groups that have nothing outstanding
    for (const s of res.sections) s.groups = s.groups.filter(gr => gr.needCourses);
    res.sections = res.sections.filter(s => s.groups.length);
    const progs = res.student.programs, major = progs.find(p => p.type === 'major') || progs[0];
    if (major) res.student.major = major.name;
    const complete = lines.some(l => /^(ALL REQUIREMENTS (HAVE BEEN )?(COMPLETE|SATISFIED)|ALL REQUIREMENTS WILL BE)/.test(l.line));
    if (complete) res.student.auditStatus = 'complete';
    if (!dars) return empty('This does not look like a UCLA DARS degree audit: no audit header, requirements or courses were found. Print the "Audit Results" tab to PDF from the DARS site and upload that.', res.unparsed);
    if (!res.sections.length && !complete) { res.ok = false; res.reason = 'No unfinished requirement with a course list was found in this audit. If your audit still has requirements left, please send the diagnostic to the maintainer.'; }
    return res;
  }

  // Privacy-safe copy of the input lines for bug reports: drops the name/ID header line, any 9-digit number,
  // school names (replaced by [redacted]), and replaces letter grades with P / NP (keeps whether a course was passed).
  function redact(lines) {
    const gr = g => { const s = gradeStatus(g); return /^[TU]?[A-DF][+-]?$/.test(g) ? (g.length > 1 && /^[TU]/.test(g) ? g[0] : '') + (s === 'done' ? 'P' : 'NP') : g; };
    return (Array.isArray(lines) ? lines : []).filter(l => l && typeof l.line === 'string')
      .filter(l => !/\d{9}/.test(l.line) && !/,[^,]*\/\s*\S*\s*$/.test(l.line))
      .map(l => {
        let s = l.line.replace(/(High School|Last School Attended)\s.*$/i, '$1 [redacted]').replace(COURSE_LINE, (all, q, y, c, u, gd, t) => `${q}${y} ${c} ${u} ${gr(gd)} ${t}`.trim());
        s = s.replace(/Grade Changed from (\S+) to (\S+)/, (_, a, b) => `Grade Changed from ${gr(a)} to ${gr(b)}`);
        return { x: l.x, line: s };
      });
  }

  g.DARS = { parse, linesFromItems, termIndex, termName, parseOptions, splitCode, gradeStatus, redact };
})(typeof module !== 'undefined' ? module.exports : window);
