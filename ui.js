// DARS Skill Tree UI. Plain browser script: reads window.DARS / COURSES / MODEL (see INTERFACE.md), renders into index.html.
(function () {
  'use strict';
  const $ = s => document.querySelector(s);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const trunc = (s, n) => (s = String(s || '')).length > n ? s.slice(0, n - 1) + '…' : s;
  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode / quota: app still works for this session */ } },
  };
  if (window.pdfjsLib) pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

  const NW = 200, NH = 56, COLW = 340, ROWH = 110, PAD = 40, CW = 240, CHIPW = 108, MAXCHIPS = 8;
  const STATUS = { done: 'Completed', ip: 'In progress', ready: 'Ready now', locked: 'Locked', placeholder: 'GE / elective slot' };
  const QTR = { F: 'Fall', W: 'Winter', S: 'Spring' };
  const PIN_D = 'M10 1l5 5-2 1-3 3 .5 3.5L9 15l-3-3-4 4-1-1 4-4-3-3 1.5-1.5L7 6l3-3z';
  const PIN = '<svg class="pin" viewBox="0 0 16 16" aria-label="pinned"><path d="M10 1l5 5-2 1-3 3 .5 3.5L9 15l-3-3-4 4-1-1 4-4-3-3 1.5-1.5L7 6l3-3z" fill="currentColor"/></svg>';

  const saved = store.get('dars.opts') || {};
  const S = {
    parsed: null, model: null, tab: 'tree', zoom: 1, detail: null,
    opts: { choices: saved.choices || {}, perQuarter: saved.perQuarter || 4, useSummer: !!saved.useSummer },
    altOpen: {}, filters: {},
  };

  // ---------- loading ----------
  function showError(msg) { const e = $('#error'); e.textContent = msg; e.hidden = false; }
  function busy(msg) { $('#busy').textContent = msg || ''; }

  function load(lines, fresh) {
    $('#error').hidden = true;
    let parsed;
    try { parsed = DARS.parse(lines); } catch (e) { console.error(e); return showError('Could not read this audit: ' + e.message); }
    if (!parsed || !parsed.sections || !parsed.sections.length) return showError('No requirement sections were found. Is this a UCLA DARS degree audit PDF?');
    if (fresh) { S.opts.choices = {}; S.detail = null; }
    S.parsed = parsed;
    store.set('dars.lines', lines); saveOpts();
    rebuild();
  }

  function rebuild() {
    if (!window.MODEL) return showError('The planner (model.js) failed to load.');
    try { S.model = MODEL.build(S.parsed, { choices: S.opts.choices, perQuarter: S.opts.perQuarter, useSummer: S.opts.useSummer }); }
    catch (e) { console.error(e); return showError('Could not build a plan from this audit: ' + e.message); }
    render();
  }

  function saveOpts() { store.set('dars.opts', S.opts); }
  function commit() { saveOpts(); rebuild(); }

  async function readPdf(file) {
    if (!window.pdfjsLib) throw new Error('the PDF reader did not load (are you offline?)');
    const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
    let lines = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const tc = await (await pdf.getPage(i)).getTextContent();
      lines = lines.concat(DARS.linesFromItems(tc.items));
    }
    return lines;
  }

  // ---------- lookups ----------
  const nodeMap = () => Object.fromEntries(S.model.nodes.map(n => [n.code, n]));
  const groupByKey = k => S.model.groups.find(g => g.key === k);
  function statusOf(code, nodes) {
    if (nodes[code]) return nodes[code].status;
    const tk = S.parsed.taken, A = window.ALIAS || {};
    const t = tk[code] || Object.keys(tk).filter(k => A[k] === code).map(k => tk[k])[0];
    return t ? (t.grade === 'IP' ? 'ip' : 'done') : 'none';
  }
  const titleOf = (code, nodes) => (nodes[code] && nodes[code].title) || ((window.COURSES || {})[code] || {}).t || '';
  const course = c => (window.COURSES || {})[c];
  const isPinned = (key, code) => (S.opts.choices[key] || []).includes(code);
  const isGE = n => { const g = n.groupKey && groupByKey(n.groupKey); return !!(g && g.placeholder); };
  const offeredText = c => { const o = course(c) ? course(c).off : null; return o == null ? 'unknown' : o ? o.split('').map(q => QTR[q] || q).join(', ') : 'Not currently offered'; };
  const readyNow = c => (course(c) ? course(c).pre : []).every(og => og.some(x => ['done', 'ip'].includes(statusOf(x, {}))));
  // options a choice node / panel lists: pins first, then the model's ready-sorted alternatives
  function choiceOpts(g) {
    const pins = (g.chosen || []).filter(c => !c.auto).map(c => ({ code: c.code, why: c.why, pinned: true, ready: readyNow(c.code) }));
    if (g.choice) return pins.concat(g.alternatives || []);
    return pins.concat((g.chosen || []).filter(c => c.auto && !c.code.startsWith('GE: ')).map(c => ({ code: c.code, why: c.why, ready: readyNow(c.code) })));
  }
  const pickLabel = g => `Pick ${g.need} of ${choiceOpts(g).length}`;
  function preHtml(prereqs, nm) {
    return (prereqs || []).map(og => '<li>' + og.map(c => {
      const s = statusOf(c, nm);
      return `<span class="pre">${nm[c] ? `<a href="#" data-node="${esc(c)}">${esc(c)}</a>` : esc(c)} <i class="badge s-${s}">${esc(STATUS[s] || 'not planned')}</i></span>`;
    }).join(' <span class="muted">or</span> ') + '</li>').join('');
  }

  // ---------- render ----------
  function render() {
    const m = S.model;
    $('#empty').hidden = !!m; $('#app').hidden = !m;
    $('#pq').value = S.opts.perQuarter; $('#summer').checked = S.opts.useSummer;
    if (!m) return;
    renderStats(); renderReqs(); renderTabs(); renderDetail();
  }

  function renderStats() {
    const m = S.model, st = m.stats || {}, stu = S.parsed.student || {};
    const items = [['Major', stu.major || '—'], ['Audit date', stu.auditDate || '—'], ['Current term', m.currentTerm || '—'],
      ['Expected graduation', m.expectedTerm || '—'], ['Units earned / still needed', (st.unitsEarned ?? '—') + ' / ' + (st.unitsNeeded ?? '—')],
      ['Planned units', st.plannedUnits ?? '—'], ['Courses remaining', st.coursesRemaining ?? '—']];
    $('#stats').innerHTML = items.map(([k, v]) => `<div class="stat"><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join('');
    const w = m.warnings || [];
    $('#warnings').hidden = !w.length;
    $('#warnings').innerHTML = w.map(x => `<li>${esc(x)}</li>`).join('');
  }

  function optRow(key, code, why, act, cls, ready) {
    const dot = ready === undefined ? '' : `<i class="dot ${ready ? 'ok' : ''}" title="${ready ? 'prereqs met' : 'prereqs missing'}"></i>`;
    return `<button class="opt ${cls || ''}" data-act="${act}" data-key="${esc(key)}" data-code="${esc(code)}" title="${act === 'unpin' ? 'Click to unpin' : 'Click to pin'}">` +
      `${act === 'unpin' ? PIN : dot}<b>${esc(code)}</b>${why ? ` <small title="${esc(why)}">${esc(why)}</small>` : ''}</button>`;
  }

  function optionList(g) {
    const q = (S.filters[g.key] || '').trim().toUpperCase(), pinned = S.opts.choices[g.key] || [];
    const hits = (g.options || []).filter(c => !q || c.includes(q));
    return hits.slice(0, 150).map(c => optRow(g.key, c, '', pinned.includes(c) ? 'unpin' : 'pin', pinned.includes(c) ? 'on' : '')).join('') +
      (hits.length > 150 ? `<p class="muted small">Showing 150 of ${hits.length}. Type to narrow.</p>` : hits.length ? '' : '<p class="muted small">No matches.</p>');
  }

  function cardBody(g) {
    let h = (g.taken || []).map(c => `<div class="tk">✓ ${esc(c)}</div>`).join('');
    if (g.placeholder) {
      h += (g.chosen || []).map(c => optRow(g.key, c.code, c.why, c.auto ? 'pin' : 'unpin', 'chosen')).join('');
      return h + `<p class="muted small">pick ${esc(g.need)} of ${esc(g.optionCount)} options</p>
        <input type="search" class="filter" data-filter="${esc(g.key)}" placeholder="Filter options" value="${esc(S.filters[g.key] || '')}">
        <div class="optlist" data-list="${esc(g.key)}">${optionList(g)}</div>`;
    }
    if (!g.choice) return h + (g.chosen || []).map(c => optRow(g.key, c.code, c.why, c.auto ? 'pin' : 'unpin', 'chosen')).join('');
    // choice group: the owner picks; show every viable option, ready ones first
    const pins = g.chosen.filter(c => !c.auto), alts = g.alternatives || [], M = pins.length + alts.length;
    h += pins.length ? `<p class="small">your pick: ${pins.map(c => esc(c.code)).join(', ')}</p>` + pins.map(c => optRow(g.key, c.code, c.why, 'unpin', 'chosen')).join('')
      : '<p class="small muted">no pick yet</p>';
    const rows = alts.map(a => optRow(g.key, a.code, a.why, 'pin', '', a.ready)).join('');
    const open = S.altOpen[g.key] ?? M - g.need <= 6;
    h += `<details class="alts" data-key="${esc(g.key)}"${open ? ' open' : ''}><summary>show ${M} options</summary>${rows}</details>`;
    return h + `<button class="btn sm" data-group="${esc(g.key)}">compare prereqs</button>`;
  }

  function renderReqs() {
    let h = '', sec = null;
    for (const g of S.model.groups) {
      if (g.section !== sec) { sec = g.section; h += `<h3 class="sec">${esc(sec)}</h3>`; }
      const head = `<div class="card-h"><b>${esc(g.name)}</b><span class="need">${g.choice ? esc(pickLabel(g)) : 'need ' + esc(g.need)}</span></div>`;
      const others = (g.altGroupKeys || []).map(k => (groupByKey(k) || {}).name || k).join(', ');
      if (g.selected === false && g.undecided) {
        h += `<div class="card pick">${head}<p class="small">alternative to ${esc(others)}: pin an option to use this group</p>${cardBody(g)}</div>`;
      } else if (g.selected === false) {
        h += `<div class="card muted">${head}<p class="small">alternative to ${esc(others)} (pin an option here to switch)</p>
          <details class="alts"><summary>show options</summary>${cardBody(g)}</details></div>`;
      } else h += `<div class="card${g.undecided ? ' pick' : ''}">${head}${cardBody(g)}</div>`;
    }
    $('#reqs').innerHTML = h;
  }

  function renderTabs() {
    document.querySelectorAll('[data-tab]').forEach(b => b.setAttribute('aria-selected', b.dataset.tab === S.tab));
    $('#tree-view').hidden = S.tab !== 'tree'; $('#plan-view').hidden = S.tab !== 'plan';
    renderTree(); renderPlan();
  }

  // Layer = longest path from a source; rows ordered by barycenter of predecessors (one pass).
  // Choice nodes go under the column of their most advanced option; GE slots get their own lane at the bottom.
  function layout(nodes, edges, cgroups, lane) {
    const preds = {}; nodes.forEach(n => { preds[n.code] = []; });
    edges.forEach(e => { if (preds[e.to] && preds[e.from]) preds[e.to].push(e.from); });
    const layer = {}, visiting = new Set();
    const L = c => {
      if (c in layer) return layer[c];
      if (visiting.has(c)) return 0; // cycle guard: bad data shouldn't hang the page
      visiting.add(c); const v = preds[c].length ? 1 + Math.max(...preds[c].map(L)) : 0; visiting.delete(c);
      return (layer[c] = v);
    };
    nodes.forEach(n => L(n.code));
    const cols = [];
    nodes.forEach(n => (cols[layer[n.code]] = cols[layer[n.code]] || []).push(n));
    const row = {}, pos = {}, colY = [];
    for (let li = 0; li < cols.length; li++) {
      const col = cols[li] || [];
      const key = n => { if (!li) return 0; const p = preds[n.code].filter(c => c in row); return p.length ? p.reduce((s, c) => s + row[c], 0) / p.length : 1e9; };
      const k = new Map(col.map(n => [n, key(n)]));
      col.sort((a, b) => k.get(a) - k.get(b));
      col.forEach((n, i) => { row[n.code] = i; pos[n.code] = { x: PAD + li * COLW, y: PAD + i * ROWH }; });
      colY[li] = PAD + col.length * ROWH;
    }
    const memo = {}, optL = (c, seen) => {
      if (c in layer) return layer[c];
      if (c in memo) return memo[c];
      if (seen.has(c)) return 0; seen.add(c);
      const ps = (course(c) ? course(c).pre : []).flat();
      return (memo[c] = ps.length ? 1 + Math.max(...ps.map(p => optL(p, seen))) : 0);
    };
    const cpos = {};
    let maxX = PAD + Math.max(0, cols.length - 1) * COLW + NW;
    for (const g of cgroups) {
      const li = Math.max(0, ...choiceOpts(g).map(o => optL(o.code, new Set())));
      const y = colY[li] || PAD, x = PAD + li * COLW;
      cpos[g.key] = { x, y, h: choiceHeight(g) };
      colY[li] = y + cpos[g.key].h + 30;
      maxX = Math.max(maxX, x + CW);
    }
    let h = Math.max(PAD + NH, ...Object.values(pos).map(p => p.y + NH), ...Object.values(cpos).map(p => p.y + p.h)) + PAD;
    let laneY = null;
    if (lane.length) {
      laneY = h + 20;
      const perRow = Math.max(3, Math.floor((maxX - PAD + 24) / (NW + 24)));
      lane.forEach((n, i) => { pos[n.code] = { x: PAD + (i % perRow) * (NW + 24), y: laneY + 20 + Math.floor(i / perRow) * (NH + 20) }; });
      maxX = Math.max(maxX, PAD + Math.min(lane.length, perRow) * (NW + 24) - 24);
      h = laneY + 20 + Math.ceil(lane.length / perRow) * (NH + 20) + PAD;
    }
    return { pos, cpos, laneY, w: maxX + PAD, h };
  }

  const choiceRows = g => Math.ceil(Math.min(choiceOpts(g).length, MAXCHIPS + 1) / 2);
  const choiceHeight = g => (g.selected ? 32 : 46) + choiceRows(g) * 24 + 6;
  function choiceSvg(g, p) {
    const opts = choiceOpts(g), shown = opts.length > MAXCHIPS + 1 ? opts.slice(0, MAXCHIPS) : opts, more = opts.length - shown.length;
    const top = g.selected ? 32 : 46;
    const chip = (i, inner, attrs) => { const x = 8 + (i % 2) * (CHIPW + 8), y = top + Math.floor(i / 2) * 24;
      return `<g class="cchip" ${attrs} transform="translate(${x},${y})" tabindex="0" role="button"><rect width="${CHIPW}" height="20" rx="10"/>${inner}</g>`; };
    const chips = shown.map((o, i) => chip(i, `<circle class="dot${o.ready ? ' ok' : ''}" cx="11" cy="10" r="4"/><text x="20" y="14">${esc(trunc(o.code, 15))}</text>${o.pinned ? `<path class="pinp" transform="translate(${CHIPW - 16},4) scale(.75)" d="${PIN_D}"/>` : ''}`,
      `data-act="${o.pinned ? 'unpin' : 'pin'}" data-key="${esc(g.key)}" data-code="${esc(o.code)}" aria-label="${esc((o.pinned ? 'Unpin ' : 'Pin ') + o.code + (o.ready ? ', prereqs met' : ', prereqs missing'))}"`)).join('') +
      (more ? chip(shown.length, `<text class="more" x="${CHIPW / 2}" y="14" text-anchor="middle">+${more} more</text>`, `data-group="${esc(g.key)}" aria-label="All ${opts.length} options"`) : '');
    return `<g class="cnode${S.detail === 'g:' + g.key ? ' sel' : ''}" data-group="${esc(g.key)}" transform="translate(${p.x},${p.y})" tabindex="0" role="button" aria-label="${esc(pickLabel(g) + ', ' + g.name)}">
      <title>${esc(pickLabel(g) + ' · ' + g.name)}</title><rect class="box" width="${CW}" height="${p.h}" rx="10"/>
      <text class="ch" x="10" y="20">${esc(trunc(pickLabel(g) + ' · ' + g.name, 34))}</text>
      ${g.selected ? '' : `<text class="csub" x="10" y="36">or another group: pin to use this one</text>`}${chips}</g>`;
  }

  function renderTree() {
    const { nodes: all, edges } = S.model, nm = nodeMap();
    if (!all.length) { $('#tree').innerHTML = '<p class="muted pad">Nothing to show yet.</p>'; return; }
    // CHOOSE: slots of major requirements are drawn as choice nodes; GE slots and courses go to the lane
    const lane = all.filter(n => isGE(n)), nodes = all.filter(n => !isGE(n) && !n.code.startsWith('CHOOSE: '));
    const cgroups = S.model.groups.filter(g => g.undecided && !g.placeholder);
    const { pos, cpos, laneY, w, h } = layout(nodes, edges, cgroups, lane);
    const blocked = e => nm[e.to].status === 'locked' && !['done', 'ip'].includes(nm[e.from].status);
    const es = edges.filter(e => pos[e.from] && pos[e.to] && nm[e.from] && !isGE(nm[e.from]) && !isGE(nm[e.to])).sort((a, b) => blocked(a) - blocked(b)).map(e => {
      const a = pos[e.from], b = pos[e.to], x1 = a.x + NW, y1 = a.y + NH / 2, x2 = b.x, y2 = b.y + NH / 2, dx = Math.max(40, (x2 - x1) / 2);
      return `<path class="edge${blocked(e) ? ' block' : ''}" d="M${x1} ${y1} C${x1 + dx} ${y1} ${x2 - dx} ${y2} ${x2} ${y2}"/>`;
    }).join('');
    const ns = nodes.concat(lane).map(n => {
      const p = pos[n.code], chip = n.planned || n.term || '', ready = n.status === 'ready', pinned = n.groupKey && isPinned(n.groupKey, n.code);
      const cw = chip ? chip.length * 6.2 + 12 : 0, label = n.code.startsWith('CHOOSE: ') ? 'choose: ' + n.title : n.code;
      return `<g class="node s-${esc(n.status)}${S.detail === n.code ? ' sel' : ''}" data-node="${esc(n.code)}" transform="translate(${p.x},${p.y})" tabindex="0" role="button" aria-label="${esc(n.code + ', ' + (STATUS[n.status] || n.status) + (pinned ? ', pinned' : ''))}">
        <title>${esc(n.code + ' — ' + n.title)}</title><rect class="box" width="${NW}" height="${NH}" rx="8"/>
        ${pinned ? `<path class="pinp" transform="translate(8,10) scale(.8)" d="${PIN_D}"/>` : ''}
        <text class="code" x="${pinned ? 24 : 10}" y="22">${esc(trunc(label, Math.floor((NW - cw - (pinned ? 32 : 18)) / 7.8)))}</text>
        <text class="ttl" x="10" y="42">${esc(trunc(n.title, ready ? 20 : n.status === "placeholder" ? 27 : 31))}</text>${ready ? `<text class="rdy" x="${NW - 10}" y="42" text-anchor="end">ready now</text>` : ''}
        ${chip ? `<rect class="chip" x="${NW - cw - 8}" y="9" width="${cw}" height="17" rx="8.5"/><text class="chipt" x="${NW - 8 - cw / 2}" y="21" text-anchor="middle">${esc(chip)}</text>` : ''}
      </g>`;
    }).join('');
    const cs = cgroups.map(g => choiceSvg(g, cpos[g.key])).join('');
    const ln = laneY == null ? '' : `<line class="lane" x1="${PAD / 2}" x2="${w - PAD / 2}" y1="${laneY - 14}" y2="${laneY - 14}"/><text class="lanet" x="${PAD}" y="${laneY + 6}">General Education</text>`;
    $('#tree').innerHTML = `<svg id="tree-svg" data-w="${w}" data-h="${h}" xmlns="http://www.w3.org/2000/svg"><g id="zoomg">${es}${ns}${cs}${ln}</g></svg>`;
    applyZoom();
  }

  function applyZoom() {
    const svg = $('#tree-svg'); $('#zoomv').textContent = Math.round(S.zoom * 100) + '%';
    if (!svg) return;
    const w = svg.dataset.w * S.zoom, h = svg.dataset.h * S.zoom;
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`); svg.setAttribute('width', w); svg.setAttribute('height', h);
    $('#zoomg').setAttribute('transform', `scale(${S.zoom})`);
  }

  function renderPlan() {
    const nm = nodeMap();
    const chipFor = c => {
      const n = nm[c] || {};
      if (c.startsWith('CHOOSE: ')) return `<button class="pchip choose" ${isGE(n) ? `data-node="${esc(c)}"` : `data-group="${esc(n.groupKey)}"`} title="Decision pending: open the options"><b>choose: ${esc(n.title)}</b><small>${esc(n.units ?? '')} u</small></button>`;
      return `<button class="pchip s-${esc(n.status || '')}" data-node="${esc(c)}"><b>${esc(c)}</b><span>${esc(titleOf(c, nm))}</span><small>${esc(n.units ?? '')} u</small></button>`;
    };
    $('#plan').innerHTML = (S.model.plan || []).map(t => `<div class="term${t.beyondExpected ? ' late' : ''}">
      <div class="term-h"><b>${esc(t.term)}</b><span>${esc(t.units)} units</span></div>
      ${t.beyondExpected ? '<span class="tag-late">past expected graduation</span>' : ''}
      ${t.courses.map(chipFor).join('') || '<p class="muted small">No courses</p>'}
    </div>`).join('') || '<p class="muted pad">Nothing left to plan.</p>';
  }

  function groupDetail(g, nm) {
    const others = (g.altGroupKeys || []).map(k => (groupByKey(k) || {}).name || k).join(', ');
    const rows = choiceOpts(g).map(o => {
      const c = course(o.code) || {}, pre = preHtml(c.pre, nm);
      return `<div class="optd${o.pinned ? ' on' : ''}"><div class="optd-h">${o.pinned ? PIN : `<i class="dot${o.ready ? ' ok' : ''}" title="${o.ready ? 'prereqs met' : 'prereqs missing'}"></i>`}
        <b>${nm[o.code] ? `<a href="#" data-node="${esc(o.code)}">${esc(o.code)}</a>` : esc(o.code)}</b><span class="muted small">${esc(c.u ?? '?')} u</span>
        <button class="btn sm" data-act="${o.pinned ? 'unpin' : 'pin'}" data-key="${esc(g.key)}" data-code="${esc(o.code)}">${o.pinned ? 'Unpin' : 'Pin'}</button></div>
        <div class="small">${esc(c.t || 'Not in the course database')}</div>
        <div class="small muted">Offered: ${esc(offeredText(o.code))}</div>
        ${pre ? `<ul class="prelist small">${pre}</ul>` : `<div class="small muted">${c.t ? 'No prerequisites' : 'Prerequisites unknown'}</div>`}
        ${o.why ? `<div class="small muted">${esc(o.why)}</div>` : ''}</div>`;
    }).join('');
    return `<button class="close" data-close aria-label="Close">×</button>
      <h2>${esc(pickLabel(g))}</h2><p>${esc(g.name)}<br><small class="muted">${esc(g.section)}</small></p>
      ${g.selected ? '' : `<p class="small">Alternative to ${esc(others)}. Pinning an option here uses this group instead.</p>`}
      <p class="small muted">Green dot: prerequisites done, in progress or pinned. Grey: something is still missing.</p>${rows}`;
  }

  function renderDetail() {
    const d = $('#detail'), nm = S.model ? nodeMap() : {}, id = S.detail || '';
    const grp = id.startsWith('g:') && S.model && groupByKey(id.slice(2)), n = nm[id];
    if (!grp && !n) { d.hidden = true; S.detail = null; return; }
    if (grp) { d.innerHTML = groupDetail(grp, nm); d.hidden = false; return; }
    const g = n.groupKey && groupByKey(n.groupKey), pinned = g && isPinned(g.key, n.code);
    const off = n.offered ? n.offered.split('').map(q => QTR[q] || q).join(', ') : 'Not currently offered';
    const pre = preHtml(n.prereqs, nm);
    d.innerHTML = `<button class="close" data-close aria-label="Close">×</button>
      <h2>${pinned ? PIN + ' ' : ''}${esc(n.code)}</h2><p>${esc(n.title)}</p>
      ${pinned ? `<p><button class="btn sm" data-act="unpin" data-key="${esc(g.key)}" data-code="${esc(n.code)}">Unpin</button></p>` : ''}
      <dl><dt>Status</dt><dd><i class="badge s-${esc(n.status)}">${esc(STATUS[n.status] || n.status)}</i></dd>
      <dt>Units</dt><dd>${esc(n.units)}</dd>
      ${n.term ? `<dt>Taken</dt><dd>${esc(n.term)}</dd>` : ''}${n.planned ? `<dt>Planned</dt><dd>${esc(n.planned)}</dd>` : ''}
      <dt>Offered</dt><dd>${esc(off)}</dd>
      ${g ? `<dt>Satisfies</dt><dd>${esc(g.name)}<br><small class="muted">${esc(g.section)}</small></dd>` : ''}</dl>
      ${g && !g.placeholder && (g.choice || (g.altGroupKeys || []).length) ? `<p><a href="#" data-group="${esc(g.key)}">All options for this requirement</a></p>` : ''}
      <h3>Prerequisites</h3>${pre ? `<ul class="prelist">${pre}</ul>` : '<p class="muted">None</p>'}
      ${n.status === 'placeholder' ? '<p class="muted small">Pick a specific course for this slot in the requirements panel.</p>' : ''}
      ${n.note ? `<h3>Note</h3><p>${esc(n.note)}</p>` : ''}${n.req ? `<h3>Catalog requisites</h3><p>${esc(n.req)}</p>` : ''}`;
    d.hidden = false;
  }

  function openDetail(id) {
    S.detail = id; renderDetail();
    document.querySelectorAll('.node.sel,.cnode.sel').forEach(e => e.classList.remove('sel'));
    document.querySelectorAll(id.startsWith('g:') ? '.cnode' : '.node').forEach(e => { if ((id.startsWith('g:') ? 'g:' + e.dataset.group : e.dataset.node) === id) e.classList.add('sel'); });
  }

  // ---------- choices ----------
  function pin(key, code) {
    const g = groupByKey(key); if (!g) return;
    const a = (S.opts.choices[key] || []).filter(c => c !== code); a.push(code);
    while (a.length > Math.max(1, g.need || 1)) a.shift();
    S.opts.choices[key] = a;
    // pinning inside a losing subgroup (the set is already decided) means "this one wins": drop the rivals' pins
    if (g.selected === false && !g.undecided) (g.altGroupKeys || []).forEach(k => delete S.opts.choices[k]);
    commit();
  }
  function unpin(key, code) {
    const a = (S.opts.choices[key] || []).filter(c => c !== code);
    if (a.length) S.opts.choices[key] = a; else delete S.opts.choices[key];
    commit();
  }

  // ---------- events ----------
  document.addEventListener('click', e => {
    const t = e.target.closest('[data-act],[data-node],[data-group],[data-tab],[data-zoom],[data-sample],[data-close]');
    if (!t) return;
    if (t.dataset.sample !== undefined) {
      if (!Array.isArray(window.SAMPLE_LINES)) return showError('Sample audit (sample/dars-lines.js) did not load.');
      return load(window.SAMPLE_LINES, true);
    }
    if (t.dataset.close !== undefined) { S.detail = null; document.querySelectorAll('.node.sel').forEach(x => x.classList.remove('sel')); return renderDetail(); }
    if (t.dataset.tab) { S.tab = t.dataset.tab; return renderTabs(); }
    if (t.dataset.zoom) { S.zoom = Math.min(2, Math.max(0.4, Math.round((S.zoom + 0.2 * t.dataset.zoom) * 10) / 10)); return applyZoom(); }
    if (t.dataset.node) { e.preventDefault(); return openDetail(t.dataset.node); }
    const { act, key, code } = t.dataset;
    if (act === 'pin') pin(key, code);
    else if (act === 'unpin') unpin(key, code);
    else if (t.dataset.group) { e.preventDefault(); openDetail('g:' + t.dataset.group); }
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && S.detail) { S.detail = null; renderDetail(); }
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches && e.target.matches('.node,.cnode,.cchip')) { e.preventDefault(); e.target.dispatchEvent(new MouseEvent('click', { bubbles: true })); }
  });
  document.addEventListener('toggle', e => {
    const k = e.target.matches && e.target.matches('details.alts[data-key]') && e.target.dataset.key;
    if (k) S.altOpen[k] = e.target.open;
  }, true);
  document.addEventListener('input', e => {
    const k = e.target.dataset && e.target.dataset.filter; if (k === undefined) return;
    S.filters[k] = e.target.value;
    const g = groupByKey(k), list = [...document.querySelectorAll('[data-list]')].find(x => x.dataset.list === k);
    if (g && list) list.innerHTML = optionList(g);
  });
  document.addEventListener('change', async e => {
    const t = e.target;
    if (t.id === 'pq') { S.opts.perQuarter = Math.min(6, Math.max(3, parseInt(t.value, 10) || 4)); t.value = S.opts.perQuarter; if (S.parsed) commit(); else saveOpts(); return; }
    if (t.id === 'summer') { S.opts.useSummer = t.checked; if (S.parsed) commit(); else saveOpts(); return; }
    if (t.matches('input[type=file]') && t.files[0]) {
      const f = t.files[0]; t.value = '';
      busy('Reading ' + f.name + '…');
      try { load(await readPdf(f), true); } catch (err) { console.error(err); showError('Could not read that PDF: ' + (err.message || err)); }
      busy();
    }
  });

  // ---------- init ----------
  if (matchMedia('(max-width: 800px)').matches) $('#reqs-wrap').open = false;
  const lines = store.get('dars.lines');
  if (Array.isArray(lines) && lines.length) load(lines, false);
  render();
})();
