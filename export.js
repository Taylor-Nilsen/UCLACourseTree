// Printable degree plan: quarter table + monochrome prerequisite tree, printed with the browser's own print-to-PDF.
// EXPORT.buildDocument(model, parsed) -> self-contained HTML string (also used by test/export.test.mjs).
(function (g) {
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const trunc = (s, n) => (s = String(s || '')).length > n ? s.slice(0, n - 1).trimEnd() + '…' : s;
  const SEASON = { FA: 'Fall', WI: 'Winter', SP: 'Spring', SU: 'Summer' };
  const termLabel = t => { const m = /^(FA|WI|SP|SU)(\d\d)$/.exec(t || ''); return m ? SEASON[m[1]] + ' 20' + m[2] : String(t || ''); };
  const SMALL = new Set(['a', 'an', 'and', 'as', 'at', 'by', 'for', 'from', 'in', 'of', 'on', 'or', 'the', 'to', 'with']);
  const ACRONYM = new Set(['TBA', 'GE', 'UC', 'US', 'BA', 'BS', 'AP', 'IB', 'IGETC', 'STEM', 'ROTC', 'II', 'III', 'IV']);
  // "BIOENGINEERING SIX MAJOR FIELD ELECTIVES (TBA)" -> "Bioengineering Six Major Field Electives (TBA)"
  const titleCase = s => String(s || '').replace(/[A-Za-z][A-Za-z']*/g, (w, i, all) => {
    const l = w.toLowerCase();
    if (ACRONYM.has(w) || all[i - 1] === '(') return w;
    return i && SMALL.has(l) ? l : l[0].toUpperCase() + l.slice(1);
  });
  const longDate = s => { const m = /^(\d\d?)\/(\d\d?)\/(\d{4})$/.exec(s || ''); const d = m ? new Date(+m[3], m[1] - 1, +m[2]) : s instanceof Date ? s : null; return d ? d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : esc(s || '—'); };
  const isSlot = c => /^(GE|CHOOSE): /.test(c);
  // "pick 1 of 11 from ETHICS list" -> "pick 1 of 11 from Ethics list"
  const summary = p => String(p.summary || '').replace(/from (.+) list$/, (m, x) => 'from ' + titleCase(x) + ' list');

  // GE / CHOOSE plan slots -> { kind, name, detail }
  function slotInfo(code, model) {
    if (code.startsWith('GE: ')) return { kind: 'GE', name: titleCase(code.slice(4)), detail: 'General education' };
    const n = model.nodes.find(x => x.code === code) || {};
    const pc = n.pathChoiceKey && model.pathChoices.find(p => p.key === n.pathChoiceKey);
    if (pc) {
      const num = / #\d+(?=:)/.exec(code);
      return { kind: 'Choose', name: titleCase(pc.title) + (num ? num[0] : ''), detail: pc.paths.filter(p => !pc.chosenPaths.includes(p.groupKey)).map(summary).join(', or ') };
    }
    const gr = model.groups.find(x => x.key === n.groupKey), k = gr ? gr.alternatives.length : 0;
    return { kind: 'Choose', name: titleCase(code.slice(8)), detail: k ? `one of ${k} options` : 'see Pending decisions' };
  }

  // ---------- prerequisite tree ----------
  const BW = 128, BH = 34, GAP = 10, DH = 8, TOP = 34, MARGIN = 8, LANE = 4.5, GUT = 26, TERMS_PER_PAGE = 6;

  // returns one SVG string per page: terms split into balanced groups of <= TERMS_PER_PAGE columns
  function treePages(model) {
    const N = new Map(model.nodes.map(n => [n.code, n])), terms = model.plan.map(q => q.term);
    const col = new Map(); // code -> term column (1-based); completed prereqs -> 0
    model.plan.forEach((q, i) => q.courses.forEach(c => col.set(c, i + 1)));
    const done = c => N.has(c) && ['done', 'ip'].includes(N.get(c).status);
    // ponytail: prereqs that are neither done nor planned are skipped (the model plans every needed prereq)
    const edges = model.edges.filter(e => col.has(e.to) && !isSlot(e.to) && (done(e.from) || (col.get(e.from) || 0) > 0 && col.get(e.from) < col.get(e.to)));
    edges.forEach(e => { if (!col.has(e.from)) col.set(e.from, 0); });
    const pages = Math.max(1, Math.ceil(terms.length / TERMS_PER_PAGE)), per = Math.ceil(terms.length / pages) || 1, out = [];
    for (let p = 0; p < pages; p++) out.push(treeSvg(model, N, col, edges, terms, p * per + 1, Math.min(terms.length, (p + 1) * per), p));
    return out;
  }

  function treeSvg(model, N, col, edges, terms, a, b, page) {
    // local columns: 0 = context (completed, plus earlier-page courses on continued pages), 1.. = terms a..b
    const pageEdges = edges.filter(e => col.get(e.to) >= a && col.get(e.to) <= b);
    const lc = c => col.get(c) < a ? 0 : col.get(c) - a + 1;
    const ncol = b - a + 2, cols = Array.from({ length: ncol }, () => []), item = new Map();
    const add = (id, c, o) => { if (!item.has(id)) { const it = Object.assign({ id, c, preds: [], succs: [] }, o); item.set(id, it); cols[c].push(it); } return item.get(id); };
    const link = (x, y) => { if (!x.succs.includes(y)) { x.succs.push(y); y.preds.push(x); } };
    // context column: sources from earlier columns, completed first, then by code
    [...new Set(pageEdges.filter(e => col.get(e.from) < a).map(e => e.from))]
      .sort((x, y) => col.get(x) - col.get(y) || x.localeCompare(y)).forEach(c => add(c, 0, { kind: 'box', code: c }));
    const slots = [];
    for (let t = a; t <= b; t++) model.plan[t - 1].courses.forEach(c => isSlot(c) ? slots.push({ c: t - a + 1, code: c }) : add(c, t - a + 1, { kind: 'box', code: c }));
    // long edges pass through one shared dummy per (source, column), so a source's track runs between boxes, never through them
    for (const e of pageEdges) {
      let prev = item.get(e.from);
      for (let c = lc(e.from) + 1; c < lc(e.to); c++) { const d = add(e.from + '@' + c, c, { kind: 'dummy', src: e.from }); link(prev, d); prev = d; }
      link(prev, item.get(e.to));
    }
    // order within columns by barycenter of neighbours: down, up, down
    const sweep = (c, nb) => {
      const idx = it => cols[it.c].indexOf(it);
      const key = new Map(cols[c].map((it, i) => [it, it[nb].length ? it[nb].reduce((s, x) => s + idx(x), 0) / it[nb].length : i]));
      cols[c].sort((x, y) => key.get(x) - key.get(y));
    };
    for (let c = 1; c < ncol; c++) sweep(c, 'preds');
    for (let c = ncol - 2; c >= 0; c--) sweep(c, 'succs');
    for (let c = 1; c < ncol; c++) sweep(c, 'preds');
    slots.forEach(s => cols[s.c].push({ kind: 'slot', code: s.code, c: s.c, preds: [], succs: [] }));

    // y: stack each column in order, each item pulled down level with its predecessors when there is room; dummies take a thin slot
    for (const list of cols) {
      let y = TOP;
      for (const it of list) {
        const h = it.kind === 'dummy' ? DH : BH, want = it.preds.length ? it.preds.reduce((s, p) => s + p.cy, 0) / it.preds.length - h / 2 : y;
        it.y = Math.max(y, Math.round(want)); it.h = h; it.cy = it.y + h / 2; y = it.y + h + GAP;
      }
    }
    // gutters: one vertical lane per source crossing that gutter, ordered by the source's y in the column before it
    const lanes = Array.from({ length: ncol }, () => []);
    const trackY = (src, c) => { const it = item.get(c === lc(src) ? src : src + '@' + c); return it.cy; };
    for (const e of pageEdges) for (let c = lc(e.from); c < lc(e.to); c++) if (!lanes[c].includes(e.from)) lanes[c].push(e.from);
    lanes.forEach((l, c) => l.sort((x, y) => trackY(x, c) - trackY(y, c)));
    const x = [MARGIN];
    for (let c = 1; c < ncol; c++) x[c] = x[c - 1] + BW + Math.max(GUT, 16 + lanes[c - 1].length * LANE);
    const laneX = (c, src) => { const w = x[c + 1] - x[c] - BW, k = lanes[c].length, i = lanes[c].indexOf(src); return x[c] + BW + w / 2 + (i - (k - 1) / 2) * LANE; };
    // target ports spread down the left side, in the order the tracks arrive
    const port = new Map();
    for (const list of cols) for (const it of list) if (it.kind === 'box') {
      const inc = pageEdges.filter(e => e.to === it.code).sort((p, q) => trackY(p.from, lc(p.to) - 1) - trackY(q.from, lc(q.to) - 1));
      inc.forEach((e, i) => port.set(e.from + '>' + e.to, it.y + BH * (i + 1) / (inc.length + 1)));
    }
    const r = v => Math.round(v * 10) / 10;
    const paths = pageEdges.map(e => {
      let c = lc(e.from), y = item.get(e.from).cy, d = `M${r(x[c] + BW)} ${r(y)}`;
      for (; c < lc(e.to); c++) {
        const last = c + 1 === lc(e.to), ny = last ? port.get(e.from + '>' + e.to) : trackY(e.from, c + 1), lx = laneX(c, e.from);
        d += ` H${r(lx)} V${r(ny)} H${r(last ? x[c + 1] - 1.5 : x[c + 1] + BW)}`;
        y = ny;
      }
      return `<path class="edge" data-from="${esc(e.from)}" data-to="${esc(e.to)}" d="${d}"/>`;
    });

    const box = it => {
      const n = N.get(it.code) || {}, X = x[it.c], Y = it.y;
      if (it.kind === 'slot') {
        const s = slotInfo(it.code, model);
        return `<g class="slot"><rect x="${X}" y="${Y}" width="${BW}" height="${BH}"/><text x="${X + 6}" y="${Y + 14}" class="code">${esc(s.kind === 'GE' ? 'GE' : 'Choose' + ((/ #\d+/.exec(it.code) || [''])[0]))}</text><text x="${X + 6}" y="${Y + 27}" class="t">${esc(trunc(s.name.replace(/ #\d+$/, ''), 30))}</text></g>`;
      }
      const comp = ['done', 'ip'].includes(n.status), sub = it.c === 0 && !comp ? 'planned ' + termLabel(n.planned) : n.status === 'ip' ? 'in progress' : n.title;
      return `<g class="box${comp ? ' done' : ''}" data-code="${esc(it.code)}" data-col="${it.c}"><rect x="${X}" y="${Y}" width="${BW}" height="${BH}"/><text x="${X + 6}" y="${Y + 14}" class="code">${esc(it.code)}</text><text x="${X + 6}" y="${Y + 27}" class="t">${esc(trunc(sub, 29))}</text></g>`;
    };
    const heads = cols.map((list, c) => c === 0 ? (list.length ? (page ? 'Completed / earlier' : 'Completed') : '') : termLabel(terms[a + c - 2]))
      .map((h, c) => h ? `<text x="${x[c] + BW / 2}" y="14" class="head">${esc(h)}</text>` : '').join('');
    const W = x[ncol - 1] + BW + MARGIN, H = Math.max(TOP + BH, ...cols.flat().map(it => it.y + it.h)) + MARGIN;
    return `<svg class="tree" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Prerequisite tree">
<defs><marker id="arr${page}" viewBox="0 0 6 6" refX="5.5" refY="3" markerWidth="6" markerHeight="6" markerUnits="userSpaceOnUse" orient="auto"><path d="M0 0L6 3L0 6z" fill="#000"/></marker></defs>
${heads}<line x1="${MARGIN}" x2="${W - MARGIN}" y1="22" y2="22" class="rule"/>
<g class="edges" marker-end="url(#arr${page})">${paths.join('')}</g>
${cols.flat().filter(it => it.kind !== 'dummy').map(box).join('')}
</svg>`;
  }

  // ---------- document ----------
  const CSS = `
@page { size: letter landscape; margin: 0.6in;
  @bottom-left { content: "Generated from a UCLA DARS audit. Plans are estimates; confirm with your counselor."; font: 7.5pt Georgia, 'Times New Roman', serif; color: #000; }
  @bottom-right { content: "Page " counter(page) " of " counter(pages); font: 7.5pt Georgia, 'Times New Roman', serif; color: #000; } }
html { background: #fff; color: #000; }
body { font: 10pt/1.35 Georgia, 'Times New Roman', serif; margin: 0.6in auto; max-width: 9.8in; padding: 0 16px; background: #fff; color: #000; }
h1 { font-size: 22pt; font-weight: normal; margin: 0 0 2pt; letter-spacing: .01em; }
h2 { font-size: 13pt; font-weight: normal; margin: 18pt 0 6pt; padding-bottom: 3pt; border-bottom: 1pt solid #000; }
h2, h3 { break-after: avoid; page-break-after: avoid; }
h3 { font-size: 10.5pt; margin: 12pt 0 4pt; }
.programs { font-size: 12pt; margin: 0 0 10pt; }
.facts { display: flex; flex-wrap: wrap; gap: 6pt 28pt; margin: 0; padding: 8pt 0; border-top: 0.5pt solid #000; border-bottom: 0.5pt solid #000; }
.facts div { min-width: 0; }
.facts dt { font-size: 7.5pt; text-transform: uppercase; letter-spacing: .08em; }
.facts dd { margin: 1pt 0 0; font-variant-numeric: tabular-nums; }
table.plan { width: 100%; border-collapse: collapse; table-layout: fixed; border-bottom: 1pt solid #000; }
table.plan th { text-align: left; font-size: 8pt; text-transform: uppercase; letter-spacing: .06em; font-weight: normal; padding: 5pt 6pt; border-bottom: 0.75pt solid #000; }
table.plan td { padding: 5pt 6pt; vertical-align: top; border-top: 0.5pt solid #000; }
table.plan thead { display: table-header-group; }
table.plan tr { break-inside: avoid; page-break-inside: avoid; }
table.plan .u { text-align: right; font-variant-numeric: tabular-nums; width: 0.6in; }
table.plan .term { width: 1.25in; } table.plan td.term { font-weight: bold; }
td b, td i, td span.ge { display: block; }
td small { display: block; font-size: 8pt; line-height: 1.25; margin-top: 1pt; }
td.term small { font-weight: normal; font-style: italic; }
.totals { margin: 6pt 0 0; font-variant-numeric: tabular-nums; }
ol, ul { margin: 2pt 0; padding-left: 18pt; } li { margin: 2pt 0; break-inside: avoid; }
.tree-page { break-before: page; page-break-before: always; }
.tree-page p.lead { margin: 0 0 6pt; font-size: 9pt; }
.legend { display: flex; flex-wrap: wrap; gap: 4pt 18pt; font-size: 8.5pt; margin: 0 0 8pt; align-items: center; }
.legend svg { vertical-align: middle; margin-right: 4pt; }
svg.tree { display: block; width: 100%; height: auto; max-height: 6.2in; }
svg text { font-family: Georgia, 'Times New Roman', serif; fill: #000; }
svg .head { font-size: 11px; text-anchor: middle; font-weight: bold; }
svg .code { font-size: 10.5px; font-weight: bold; }
svg .t { font-size: 8.5px; }
svg rect { fill: #fff; stroke: #000; stroke-width: 1; }
svg .done rect { stroke-width: 0.8; stroke-dasharray: 3 2; }
svg .slot rect { stroke-width: 0.6; }
svg .slot text { font-style: italic; }
svg .slot .code { font-weight: normal; }
svg .edges path { fill: none; stroke: #000; stroke-width: 0.8; }
svg .rule { stroke: #000; stroke-width: 0.5; }
footer { margin-top: 18pt; font-size: 7.5pt; }
.bar { margin: 0 0 12pt; }
.bar button { font: inherit; padding: 4pt 10pt; border: 0.75pt solid #000; background: #fff; color: #000; cursor: pointer; }
@media print { body { margin: 0; max-width: none; padding: 0; } .bar, footer { display: none; } }
`;

  function buildDocument(model, parsed) {
    const st = (parsed && parsed.student) || {}, stats = model.stats || {};
    const N = new Map(model.nodes.map(n => [n.code, n]));
    const progs = (st.programs && st.programs.length ? st.programs : st.major ? [{ type: 'major', name: st.major }] : [])
      .map(p => esc(titleCase(p.name)) + (p.type && p.type !== 'major' ? ` <small>(${esc(p.type)})</small>` : '')).join(' &middot; ');
    const facts = [['Audit date', longDate(st.auditDate)], ['Current term', esc(termLabel(model.currentTerm || parsed.currentTerm))],
      ['Expected graduation', esc(termLabel(model.expectedTerm || st.expected))], ['Units earned', esc(stats.unitsEarned ?? '—')],
      ['Units still needed', esc(stats.unitsNeeded ?? parsed.unitsNeeded ?? '—')], ['Generated', longDate(new Date())]]
      .map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('');

    const ncol = Math.max(1, ...model.plan.map(q => q.courses.length));
    const cell = c => {
      if (!c) return '<td></td>';
      if (isSlot(c)) { const s = slotInfo(c, model); return s.kind === 'GE' ? `<td><span class="ge">GE: ${esc(s.name)}</span></td>` : `<td><i>Choose: ${esc(s.name)}</i><small>${esc(s.detail)}</small></td>`; }
      return `<td><b>${esc(c)}</b><small>${esc((N.get(c) || {}).title || '')}</small></td>`;
    };
    const rows = model.plan.map(q => `<tr><td class="term">${esc(termLabel(q.term))}${q.beyondExpected ? '<small>after expected graduation</small>' : ''}</td>${Array.from({ length: ncol }, (_, i) => cell(q.courses[i])).join('')}<td class="u">${esc(q.units)}</td></tr>`).join('\n');
    const head = `<tr><th class="term">Quarter</th>${Array.from({ length: ncol }, (_, i) => `<th>Course ${i + 1}</th>`).join('')}<th class="u">Units</th></tr>`;

    const pending = [];
    for (const pc of model.pathChoices || []) if (pc.chosenPaths.length < pc.pick)
      pending.push(`${titleCase(pc.title)}${pc.pick > 1 ? ` (pick ${pc.pick})` : ''}: ${pc.paths.filter(p => !pc.chosenPaths.includes(p.groupKey)).map(summary).join(', or ')}`);
    for (const gr of model.groups) if (gr.selected && gr.undecided && !gr.placeholder) {
      const open = model.nodes.filter(n => n.groupKey === gr.key && !n.pathChoiceKey && n.code.startsWith('CHOOSE: ')).length || gr.need;
      const alts = gr.alternatives.map(a => a.code);
      pending.push(`${titleCase(gr.name)} (choose ${open}): ${alts.length ? alts.join(', ') : 'no options listed in the audit; see Notes'}`);
    }
    const list = (tag, items) => `<${tag}>${items.map(x => `<li>${esc(x)}</li>`).join('')}</${tag}>`;

    const svgs = treePages(model);
    const legend = `<div class="legend">
<span><svg width="26" height="12"><rect x="0.5" y="0.5" width="25" height="11" fill="#fff" stroke="#000" stroke-width="1"/></svg>Planned course</span>
<span><svg width="26" height="12"><rect x="0.5" y="0.5" width="25" height="11" fill="#fff" stroke="#000" stroke-width="0.8" stroke-dasharray="3 2"/></svg>Completed or in progress</span>
<span><svg width="26" height="12"><rect x="0.5" y="0.5" width="25" height="11" fill="#fff" stroke="#000" stroke-width="0.6"/></svg><i>Open choice or GE slot</i></span>
<span><svg width="34" height="12"><path d="M1 6H27" stroke="#000" stroke-width="0.8"/><path d="M27 3L33 6L27 9z" fill="#000"/></svg>is required before</span></div>`;
    const trees = svgs.map((s, i) => `<section class="tree-page"><h2>Prerequisite Tree${svgs.length > 1 ? ` <small>(${i ? 'continued, ' : ''}part ${i + 1} of ${svgs.length})</small>` : ''}</h2>
<p class="lead">Remaining courses, each in the quarter it is planned. Read left to right; arrows run from a prerequisite to the course that needs it.</p>
${legend}${s}</section>`).join('\n');

    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Degree Plan</title><style>${CSS}</style></head><body>
<div class="bar"><button type="button" onclick="print()">Print or save as PDF</button></div>
<header><h1>Degree Plan</h1><p class="programs">${progs}</p><dl class="facts">${facts}</dl></header>
<h2>Quarter Plan</h2>
<table class="plan"><thead>${head}</thead><tbody>
${rows}
</tbody></table>
<p class="totals">Planned: ${esc(stats.plannedUnits ?? 0)} units in ${esc(stats.coursesRemaining ?? 0)} remaining courses.</p>
${model.warnings && model.warnings.length ? `<h3>Notes</h3>${list('ol', model.warnings).replace(/ (\d+)\b/g, '&nbsp;$1')}` : ''}
${pending.length ? `<h3>Pending decisions</h3>${list('ul', pending)}` : ''}
${trees}
<footer>Generated from a UCLA DARS audit. Plans are estimates; confirm with your counselor.</footer>
</body></html>`;
  }

  g.EXPORT = { buildDocument, termLabel };

  if (typeof document === 'undefined') return;
  function exportPlan() {
    let lines = null, opts = {};
    try { lines = JSON.parse(localStorage.getItem('dars.lines')); opts = JSON.parse(localStorage.getItem('dars.opts')) || {}; } catch (e) { /* storage blocked */ }
    const parsed = Array.isArray(lines) && lines.length && window.DARS ? DARS.parse(lines) : null;
    if (!parsed || !parsed.ok) return alert('Load an audit first.');
    let html;
    try { html = buildDocument(MODEL.build(parsed, { choices: opts.choices || {}, perQuarter: opts.perQuarter || 4, useSummer: !!opts.useSummer }), parsed); }
    catch (e) { console.error(e); return alert('Could not build the export: ' + e.message); }
    const w = window.open('', '_blank');
    if (!w) return alert('Allow pop-ups for this page to export.');
    w.document.write(html); w.document.close(); // inline CSS/SVG only: nothing to wait for
    w.focus(); w.print();
  }
  document.addEventListener('DOMContentLoaded', () => {
    const bar = document.querySelector('[data-sample]') && document.querySelector('[data-sample]').closest('header');
    if (!bar || document.getElementById('export-btn')) return;
    const b = document.createElement('button');
    b.type = 'button'; b.id = 'export-btn'; b.className = 'btn'; b.textContent = 'Export';
    b.title = 'Open a printable quarter plan and prerequisite tree (save as PDF from the print dialog)';
    b.addEventListener('click', exportPlan);
    bar.querySelector('#busy') ? bar.insertBefore(b, bar.querySelector('#busy')) : bar.appendChild(b);
  });
})(typeof module !== 'undefined' ? module.exports : window);
