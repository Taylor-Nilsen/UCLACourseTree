// DARS (UCLA degree audit) parser. Input: lines [{x, line}] from pdf.js (see linesFromItems) or plain text.
// Output: { student, currentTerm, taken:{code:{term,units,grade,title}}, sections:[{title, needSubgroups, groups:[...]}], unitsNeeded }
(function (g) {
  const TERMQ = { FA: 0, WI: 1, SP: 2, SU: 3 };
  // term index: academic year * 4 + quarter (FA26=2026*4, WI27=2026*4+1 ...)
  function termIndex(t) { const m = /^(FA|WI|SP|SU)(\d\d)$/.exec(t); if (!m) return null; const q = TERMQ[m[1]]; let y = 2000 + +m[2]; if (q > 0) y -= 1; return y * 4 + q; }
  function termName(i) { const q = i % 4, y = Math.floor(i / 4) + (q > 0 ? 1 : 0); return ['FA', 'WI', 'SP', 'SU'][q] + String(y).slice(2); }
  function termFromDate(mdy) { const [m, , y] = mdy.split('/').map(Number); const q = m <= 3 ? 'WI' : m <= 6 ? 'SP' : m <= 8 ? 'SU' : 'FA'; return q + String(y).slice(2); }

  // Re-join pdf.js text items into lines; glyph runs are fused when the x-gap is tiny.
  function linesFromItems(items) {
    const rows = [];
    for (const it of items) { if (!it.str) continue; const y = it.transform[5], x = it.transform[4], h = it.height || Math.abs(it.transform[0]) || 8;
      let row = rows.find(r => Math.abs(r.y - y) <= 2); if (!row) { row = { y, items: [] }; rows.push(row); } row.items.push({ x, w: it.width, h, str: it.str }); }
    rows.sort((a, b) => b.y - a.y);
    return rows.map(r => { r.items.sort((a, b) => a.x - b.x); let s = '', end = null;
      for (const it of r.items) { if (end !== null && it.x - end > 0.22 * it.h) s += ' '; s += it.str; end = it.x + it.w; }
      return { x: Math.round(r.items[0].x), line: s.replace(/\s+/g, ' ').trim() }; }).filter(r => r.line);
  }

  const CODE = '(?:CM|M|C|T)?\\d{1,3}[A-Z]{0,3}';
  function splitCode(s) { const m = new RegExp('^([A-Z][A-Z&\' ]*?)\\s*(' + CODE + ')$').exec(s.trim()); return m ? { dept: m[1].trim(), num: m[2] } : null; }
  const COURSE_LINE = new RegExp('^(FA|WI|SP|SU)(\\d\\d)\\s+(.+?)\\s+(\\d+\\.\\d\\d)\\s+(\\S+)\\s*(.*)$');

  // "MECH&AE 102,105A,157 OR 157W ENGR 2(FA24-9999) MAT SCI 100 TO 187" -> options
  function parseOptions(text, currentTerm) {
    text = text.replace(/\(\s*([A-Z]{2}\d{2}|0000)\s*-\s*([A-Z]{2}\d{2}|9999)\s*\)/g, '($1-$2)');
    const re = new RegExp('(' + CODE + ')(?:\\(([^)]*)\\))?', 'g');
    const out = []; let dept = null, last = 0, m, pendingOp = null;
    const cur = termIndex(currentTerm);
    while ((m = re.exec(text))) {
      const between = text.slice(last, m.index).replace(/,/g, ' ').trim();
      last = re.lastIndex;
      let op = null;
      if (between === 'OR' || between === 'TO') op = between;
      else if (between) { if (!/^[A-Z][A-Z&' ]*$/.test(between)) { dept = null; continue; } dept = between; }
      if (!dept) continue;
      let ok = true;
      if (m[2]) { const [a, b] = m[2].split('-'); const end = termIndex(b || a); if (b !== '9999' && end !== null && end < cur) ok = false; }
      const num = m[1];
      if (op === 'TO' && out.length) { out[out.length - 1].to = num; continue; }
      if (op === 'OR' && out.length) { if (ok) out[out.length - 1].alts.push(dept + ' ' + num); continue; }
      if (!ok) continue;
      out.push({ dept, num, alts: [dept + ' ' + num] });
    }
    return out;
  }

  function parse(lines) {
    if (typeof lines === 'string') lines = lines.split('\n').map(l => ({ x: l.length - l.trimStart().length, line: l.trim() }));
    const res = { student: {}, taken: {}, sections: [], unitsNeeded: null, currentTerm: null };
    let section = null, group = null, mode = null, lastHeaderWasTop = false;
    const addTaken = (code, info) => { const prev = res.taken[code]; if (!prev || (prev.grade === 'IP' && info.grade !== 'IP')) res.taken[code] = Object.assign({}, prev, info); };
    for (const { x, line } of lines) {
      let m;
      if ((m = /Audit Prepared On (\d\d\/\d\d\/\d{4})/.exec(line))) { res.student.auditDate = m[1]; res.currentTerm = termFromDate(m[1]); }
      if ((m = /Degree Expected Term (\d{4}) (FALL|WINTER|SPRING|SUMMER)/.exec(line))) res.student.expected = { FALL: 'FA', WINTER: 'WI', SPRING: 'SP', SUMMER: 'SU' }[m[2]] + m[1].slice(2);
      if ((m = /^MAJOR1 .* (EN\d+) (.+)$/.exec(line))) res.student.major = m[2];
      if ((m = COURSE_LINE.exec(line))) {
        const sc = splitCode(m[3]); if (!sc) continue;
        const code = sc.dept + ' ' + sc.num;
        addTaken(code, { term: m[1] + m[2], units: +m[4], grade: m[5], title: m[6] });
        res._lastTaken = code;
        if (group && mode !== 'select') group.taken.push(code);
        continue;
      }
      if ((m = /^ALTERNATE CRS:\s*(.+)$/.exec(line))) { const sc = splitCode(m[1]); if (sc && res._lastTaken) addTaken(sc.dept + ' ' + sc.num, Object.assign({}, res.taken[res._lastTaken], { via: res._lastTaken })); continue; }
      if ((m = /^NEEDS:\s*(.*)$/.exec(line))) {
        const s = m[1]; const sg = /(\d+) SUB-GROUPS?/.exec(s), c = /(\d+) COURSES?/.exec(s), u = /([\d.]+) UNITS/.exec(s);
        if (sg) { if (section) section.needSubgroups = +sg[1]; continue; }
        if (section && /^UNIT CHECK/.test(section.title) && u) { res.unitsNeeded = +u[1]; continue; }
        if (/GPA/.test(s)) continue;
        if (!group) { group = { section: section && section.title, name: section && section.title, taken: [], options: [], notFrom: [] }; if (section) section.groups.push(group); }
        group.needCourses = c ? +c[1] : null; group.needUnits = u ? +u[1] : null;
        if (!group.needCourses && group.needUnits) group.needCourses = Math.ceil(group.needUnits / 4); // GE "4.0 UNITS" = 1 course
        mode = null; continue;
      }
      if ((m = /^(?:-> )?NOT FROM:\s*(.*)$/.exec(line))) { if (group) group._not = m[1]; mode = 'not'; continue; }
      if ((m = /^SELECT FROM:\s*(.*)$/.exec(line))) { if (group) group._sel = m[1]; mode = 'select'; continue; }
      if ((mode === 'select' || mode === 'not') && group && (x >= 150 || /\d/.test(line)) && !/^[A-Z][A-Z &-]+$/.test(line)) { group[mode === 'select' ? '_sel' : '_not'] += ' ' + line; continue; }
      mode = null;
      const isCaps = /^[A-Z0-9][A-Z0-9 &:;,'()\/!-]*$/.test(line) && /[A-Z]{3}/.test(line);
      if (!isCaps) { lastHeaderWasTop = false; continue; }
      if (x < 70) { // top-level section header (may span two lines)
        if (lastHeaderWasTop && section && !section.groups.length) { section.title += ' ' + line; continue; }
        section = { title: line.trim(), groups: [], needSubgroups: null }; res.sections.push(section); group = null; lastHeaderWasTop = true; continue;
      }
      lastHeaderWasTop = false;
      if (x < 100 && section && !/^(IN-PROG|GRADED|EARNED)/.test(line)) { group = { section: section.title, name: line, taken: [], options: [], notFrom: [] }; section.groups.push(group); }
    }
    delete res._lastTaken;
    for (const s of res.sections) for (const gr of s.groups) {
      if (gr._sel) gr.options = parseOptions(gr._sel, res.currentTerm);
      if (gr._not) gr.notFrom = parseOptions(gr._not, res.currentTerm).map(o => o.alts[0]);
      delete gr._sel; delete gr._not;
    }
    // drop groups that have nothing outstanding
    for (const s of res.sections) s.groups = s.groups.filter(gr => gr.needCourses);
    res.sections = res.sections.filter(s => s.groups.length);
    return res;
  }
  g.DARS = { parse, linesFromItems, termIndex, termName, parseOptions, splitCode };
})(typeof module !== 'undefined' ? module.exports : window);
