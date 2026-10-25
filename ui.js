// DARS Skill Tree UI. Plain browser script: reads window.DARS / COURSES / MODEL (see INTERFACE.md), renders into index.html.

// Tree layering (pure, also loaded by the Node tests). An undecided path choice is one card (node `PATH: <key>`); nodes of
// its paths (a path already taken while more picks are pending) fold into it. Layer = longest prereq chain; a card sits
// at the earliest column any of its paths allows (where the last course of its fastest path would sit). Once decided there is no card: the taken paths' courses are
// ordinary nodes, layered like any other.
(function (g) {
  const cardOf = (n, pcs) => {
    if (!n.groupKey || n.status === 'path') return null;
    const pc = pcs.find(pc => pc.chosenPaths.length < pc.pick && pc.paths.some(p => n.groupKey === p.groupKey || n.groupKey.startsWith(p.groupKey + '|')));
    return pc ? 'PATH: ' + pc.key : null;
  };
  function layers(nodes, edges, pcs) {
    const have = new Set(nodes.map(n => n.code)), fold = {};
    for (const n of nodes) { const c = cardOf(n, pcs); if (c && have.has(c)) fold[n.code] = c; }
    const f = c => fold[c] || c, shown = nodes.filter(n => !fold[n.code]), preds = {}, out = [];
    shown.forEach(n => { preds[n.code] = []; });
    for (const e of edges) { // prereqs inside a path (177A -> 177B) fold into the card and are not drawn
      const a = f(e.from), b = f(e.to);
      if (a !== b && preds[a] && preds[b] && !preds[b].includes(a)) { preds[b].push(a); out.push({ from: a, to: b }); }
    }
    const card = Object.fromEntries(pcs.map(pc => ['PATH: ' + pc.key, pc])), layer = {}, visiting = new Set();
    const L = c => {
      if (c in layer) return layer[c];
      if (visiting.has(c)) return 0; // cycle guard: bad data shouldn't hang the page
      visiting.add(c);
      const pc = card[c];
      const v = !pc ? (preds[c].length ? 1 + Math.max(...preds[c].map(L)) : 0)
        : Math.min(...pc.paths.map(p => {
          const cl = {};
          for (const x of p.chain || []) cl[x.code] = Math.max(0, ...x.pre.map(f).filter(q => q in preds && q !== c).map(q => L(q) + 1), ...x.after.map(q => (cl[q] || 0) + 1));
          return Math.max(0, ...Object.values(cl));
        }));
      visiting.delete(c);
      return (layer[c] = v);
    };
    shown.forEach(n => L(n.code));
    return { layer, nodes: shown, edges: out, preds };
  }
  g.TREE_LAYOUT = { layers, cardOf };
})(typeof module !== 'undefined' ? module.exports : window);

(function () {
  'use strict';
  if (typeof document === 'undefined') return; // Node: only TREE_LAYOUT above
  const $ = s => document.querySelector(s);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const trunc = (s, n) => (s = String(s || '')).length > n ? s.slice(0, n - 1) + '…' : s;
  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode / quota: app still works for this session */ } },
  };
  if (window.pdfjsLib) pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

  const NW = 200, NH = 56, COLW = 340, ROWH = 110, PAD = 40, CW = 240, CHIPW = 108, MAXCHIPS = 8, PW = 300, PROW = 46, TAGH = 22;
  const STATUS = { done: 'Completed', ip: 'In progress', ready: 'Ready now', locked: 'Locked', placeholder: 'GE / elective slot', path: 'Select one' };
  const QTR = { F: 'Fall', W: 'Winter', S: 'Spring' };
  const PIN_D = 'M10 1l5 5-2 1-3 3 .5 3.5L9 15l-3-3-4 4-1-1 4-4-3-3 1.5-1.5L7 6l3-3z';
  const PIN = '<svg class="selicon" viewBox="0 0 16 16" aria-label="selected"><path d="M10 1l5 5-2 1-3 3 .5 3.5L9 15l-3-3-4 4-1-1 4-4-3-3 1.5-1.5L7 6l3-3z" fill="currentColor"/></svg>';

  const saved = store.get('dars.opts') || {};
  const S = {
    parsed: null, model: null, tab: 'tree', zoom: 1, detail: null,
    opts: { choices: saved.choices || {}, defers: saved.defers || {}, pins: saved.pins || {}, conflicts: saved.conflicts || [], perQuarter: saved.perQuarter || 4, useSummer: !!saved.useSummer },
    altOpen: {}, filters: {}, conflictFrom: null /* { code, term } while the user selects the other class */, modal: null,
  };

  // ---------- loading ----------
  function showError(msg) { const e = $('#error'); e.textContent = msg; e.hidden = false; }
  function busy(msg) { $('#busy').textContent = msg || ''; }

  // "Copy diagnostic": redacted lines + what the parser could not read, for a bug report (DARS.redact strips name, ID, grades)
  const DIAG = '<button type="button" class="diag" data-diag>Copy diagnostic</button>';
  async function copyDiag(btn) {
    const { parsed: p, lines } = S.diag || {};
    const unparsed = ((p && p.unparsed) || []).map(u => Object.assign({}, u, { line: (DARS.redact([{ x: 0, line: u.line }])[0] || {}).line || '[redacted]' }));
    const txt = JSON.stringify({ app: 'dars-skill-tree', ok: p && p.ok, reason: p && p.reason, unparsed, lines: DARS.redact(lines || []) });
    try { await navigator.clipboard.writeText(txt); btn.textContent = 'Copied'; }
    catch (e) { const ta = document.createElement('textarea'); ta.value = txt; ta.readOnly = true; ta.rows = 4; ta.style.width = '100%'; btn.after(ta); ta.select(); btn.textContent = 'Copy the text below'; }
  }

  function load(lines, fresh) {
    $('#error').hidden = true;
    const parsed = DARS.parse(lines); // never throws; ok:false carries a reason
    S.diag = { parsed, lines };
    if (!parsed.ok) { showError(parsed.reason); $('#error').insertAdjacentHTML('beforeend', ' ' + DIAG); return; }
    if (fresh) { S.opts.choices = {}; S.opts.defers = {}; S.opts.pins = {}; S.opts.conflicts = []; S.detail = null; S.conflictFrom = null; S.nextTerm = null; }
    S.parsed = parsed;
    store.set('dars.lines', lines); saveOpts();
    rebuild();
  }

  function rebuild() {
    if (!window.MODEL) return showError('The planner (model.js) failed to load.');
    try { S.model = MODEL.build(S.parsed, buildOpts()); }
    catch (e) { console.error(e); return showError('Could not build a plan from this audit: ' + e.message); }
    render();
  }

  const buildOpts = () => ({ choices: S.opts.choices, defers: S.opts.defers, pins: S.opts.pins, conflicts: S.opts.conflicts, perQuarter: S.opts.perQuarter, useSummer: S.opts.useSummer });
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
    const t = S.parsed.taken[code]; // AP/transfer placeholders are already mapped to real courses by the parser (via)
    const st = t && (t.status || (t.grade === 'IP' ? 'ip' : 'done'));
    return st === 'done' || st === 'ip' ? st : 'none'; // failed / withdrawn / incomplete attempts do not count
  }
  const titleOf = (code, nodes) => (nodes[code] && nodes[code].title) || ((window.COURSES || {})[code] || {}).t || '';
  const course = c => (window.COURSES || {})[c];
  const pcs = () => S.model.pathChoices || [];
  const pcByKey = k => pcs().find(pc => pc.key === k);
  const pcOfGroup = gk => pcs().find(pc => pc.paths.some(p => p.groupKey === gk));
  const pathDecided = pc => pc.chosenPaths.length >= pc.pick;
  const inPath = (gk, k) => gk === k || gk.startsWith(k + '|');
  // decided path choice whose taken path holds this group, and that path (its courses are ordinary tree nodes)
  const takenPathOf = gk => { const pc = gk && pcs().find(pc => pathDecided(pc) && pc.chosenPaths.some(k => inPath(gk, k)));
    return pc ? { pc, p: pc.paths.find(p => pc.chosenPaths.includes(p.groupKey) && inPath(gk, p.groupKey)) } : null; };
  const partOf = tp => `<p class="small">Part of your chosen path: ${esc(tp.pc.title)} (${esc(pathLine(tp.p))}) <button class="btn sm" data-change="${esc(tp.pc.key)}">Change path</button></p>`;
  // a path's courses in prereq order: "BIOENGR 177A → 177B" (→ when it follows the previous one, else +); a list path: its summary
  const dept = c => (DARS.splitCode(c) || {}).dept;
  const chainText = (p, label) => (p.chain || []).map((x, i, a) => (i ? (x.after.length ? ' → ' : ' + ') : '') + label(x.code, i ? a[i - 1].code : null)).join('');
  const pathLine = p => p.choice ? p.summary : chainText(p, (c, prev) => prev && dept(c) === dept(prev) ? c.slice(dept(c).length + 1) : c);
  const pickHead = pc => `Select ${pc.pick} of ${pc.paths.length}`;
  const isGEpc = pc => pc.paths.every(p => p.placeholder);
  const pathNeeds = p => p.ready ? 'prereqs met' : `needs ${p.unmet} prereq${p.unmet === 1 ? '' : 's'}`;
  const isPinned = (key, code) => (S.opts.choices[key] || []).includes(code);
  const isGE = n => { const g = n.groupKey && groupByKey(n.groupKey); return !!(g && g.placeholder); };
  // "Fall, Spring (24F, 25S, 25F)" from the Schedule of Classes; "Not offered since ..." when it had no sections
  const qtrs = o => o.split('').map(q => QTR[q] || q).join(', ');
  const offeredText = c => { const k = course(c); return !k ? 'unknown' : k.offTerms ? `${qtrs(k.off)} (${k.offTerms.join(', ')})` : k.offNote ? k.offNote[0].toUpperCase() + k.offNote.slice(1) : k.off === '?' ? 'unknown' : k.off ? qtrs(k.off) : 'Not currently offered'; };
  const readyNow = c => (course(c) ? course(c).pre : []).every(og => og.some(x => ['done', 'ip'].includes(statusOf(x, {}))));
  // options a choice node / panel lists: pins first, then the model's ready-sorted alternatives
  function choiceOpts(g) {
    const pins = (g.chosen || []).filter(c => !c.auto).map(c => ({ code: c.code, why: c.why, pinned: true, ready: readyNow(c.code) }));
    if (g.choice) return pins.concat(g.alternatives || []);
    return pins.concat((g.chosen || []).filter(c => c.auto && !c.code.startsWith('GE: ')).map(c => ({ code: c.code, why: c.why, ready: readyNow(c.code) })));
  }
  const pickLabel = g => g.undeclared ? `Declare an area · ${g.need} course${g.need === 1 ? '' : 's'}` : `Select ${g.need} of ${choiceOpts(g).length}`;
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
    const w = m.warnings || [], wKey = 'w:' + w.join('\n');
    $('#warnings').hidden = !w.length || isDismissed(wKey);
    $('#warnings').innerHTML = w.map(x => `<li>${esc(x)}</li>`).join('') + closeBtn(wKey);
    const u = S.parsed.unparsed || [];
    let box = $('#unparsed');
    if (!box) { box = document.createElement('details'); box.id = 'unparsed'; box.className = 'warnings'; $('#warnings').after(box); }
    const uKey = 'u:' + u.map(x => x.line).join('\n');
    box.hidden = !u.length || isDismissed(uKey);
    box.innerHTML = closeBtn(uKey) + `<summary>${u.length} audit line${u.length === 1 ? ' was' : 's were'} not understood</summary><ul>` +
      u.map(x => `<li>${x.section ? `<b>${esc(x.section)}</b>: ` : ''}${esc(x.line)}${x.why ? ` <small>(${esc(x.why)})</small>` : ''}</li>`).join('') +
      `</ul><p>The plan may be missing something from these lines. Use ${DIAG} and send the result to the maintainer; your name, student ID and grades are removed.</p>`;
  }

  // dismissible banners: remembered per exact text, so a new warning still shows
  const DKEY = 'dars.dismissed';
  const dismissed = () => { try { return JSON.parse(localStorage.getItem(DKEY) || '[]'); } catch { return []; } };
  const isDismissed = k => dismissed().includes(k);
  const closeBtn = k => `<button type="button" class="dismiss" aria-label="Dismiss" title="Dismiss" data-dismiss="${esc(k)}">×</button>`;
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-dismiss]'); if (!b) return;
    e.preventDefault();
    try { localStorage.setItem(DKEY, JSON.stringify(dismissed().concat(b.dataset.dismiss).slice(-50))); } catch {}
    b.parentElement.hidden = true;
  });

  function optRow(key, code, why, act, cls, ready) {
    const dot = ready === undefined ? '' : `<i class="dot ${ready ? 'ok' : ''}" title="${ready ? 'prereqs met' : 'prereqs missing'}"></i>`;
    return `<button class="opt ${cls || ''}" data-act="${act}" data-key="${esc(key)}" data-code="${esc(code)}" title="${act === 'unselect' ? 'Click to unselect' : 'Click to select'}">` +
      `${act === 'unselect' ? PIN : dot}<b>${esc(code)}</b>${why ? ` <small title="${esc(why)}">${esc(why)}</small>` : ''}</button>`;
  }

  function optionList(g) {
    const q = (S.filters[g.key] || '').trim().toUpperCase(), pinned = S.opts.choices[g.key] || [];
    const hits = (g.options || []).filter(c => !q || c.includes(q));
    return hits.slice(0, 150).map(c => optRow(g.key, c, '', pinned.includes(c) ? 'unselect' : 'select', pinned.includes(c) ? 'on' : '')).join('') +
      (hits.length > 150 ? `<p class="muted small">Showing 150 of ${hits.length}. Type to narrow.</p>` : hits.length ? '' : '<p class="muted small">No matches.</p>');
  }

  function cardBody(g) {
    let h = (g.taken || []).map(c => `<div class="tk">✓ ${esc(c)}</div>`).join('');
    if (g.placeholder) {
      h += (g.chosen || []).map(c => optRow(g.key, c.code, c.why, c.auto ? 'select' : 'unselect', 'chosen')).join('');
      return h + `<p class="muted small">select ${esc(g.need)} of ${esc(g.optionCount)} options</p>
        <input type="search" class="filter" data-filter="${esc(g.key)}" placeholder="Filter options" value="${esc(S.filters[g.key] || '')}">
        <div class="optlist" data-list="${esc(g.key)}">${optionList(g)}</div>`;
    }
    if (!g.choice) return h + (g.chosen || []).map(c => optRow(g.key, c.code, c.why, c.auto ? 'select' : 'unselect', 'chosen')).join('');
    // choice group: the owner selects; show every viable option, ready ones first
    const pins = g.chosen.filter(c => !c.auto), alts = g.alternatives || [], M = pins.length + alts.length;
    h += pins.length ? `<p class="small">your selection: ${pins.map(c => esc(c.code)).join(', ')}</p>` + pins.map(c => optRow(g.key, c.code, c.why, 'unselect', 'chosen')).join('')
      : '<p class="small muted">nothing selected yet</p>';
    const rows = alts.map(a => optRow(g.key, a.code, a.why, 'select', '', a.ready)).join('');
    const open = S.altOpen[g.key] ?? M - g.need <= 6;
    h += `<details class="alts" data-key="${esc(g.key)}"${open ? ' open' : ''}><summary>show ${M} options</summary>${rows}</details>`;
    return h + `<button class="btn sm" data-group="${esc(g.key)}">compare prereqs</button>`;
  }

  // one card per path choice (same wording as the tree card): each path is a whole alternative group, taken as a bundle
  function pathCard(pc) {
    const nm = nodeMap(), done = pathDecided(pc);
    const rows = pc.paths.map(p => {
      const on = pc.chosenPaths.includes(p.groupKey), g = groupByKey(p.groupKey);
      const cs = p.courses.map(c => `<div class="pc">${nm[c] ? `<a href="#" data-node="${esc(c)}">${esc(c)}</a>` : `<b>${esc(c)}</b>`} <span>${esc(titleOf(c, nm))}</span> <small>${esc((nm[c] || {}).planned || '')}</small></div>`).join('');
      const body = p.choice ? (on ? cardBody(g) : done ? '' : `<details class="alts"><summary>show options</summary>${cardBody(g)}</details>`) : on ? cs : '';
      const act = on ? `<a href="#" class="small" data-change="${esc(pc.key)}">change</a>` : `<button class="btn sm" data-take="${esc(p.groupKey)}" data-pc="${esc(pc.key)}" aria-label="${esc((done ? 'Switch to this path: ' : 'Select this path: ') + pathLine(p))}">${done ? 'switch' : 'Select'}</button>`;
      return `<div class="path${on ? ' on' : done ? ' off' : ''}"><div class="path-h"><i class="dot${p.ready ? ' ok' : ''}" title="${esc(pathNeeds(p))}"></i>
        <span>${esc(pathLine(p))} · ${esc(p.units)} u</span>${act}</div>${done ? '' : `<div class="small muted">${esc(pathNeeds(p))}</div>`}${body}</div>`;
    }).join('');
    return `<div class="card${done ? '' : ' pick'}"><div class="card-h"><b>${esc(pc.title)}</b><span class="need">${esc(pickHead(pc))}</span></div>${rows}</div>`;
  }

  function renderReqs() {
    let h = '', sec = null;
    for (const g of S.model.groups) {
      const pc = pcOfGroup(g.key);
      if (pc ? pc.paths[0].groupKey !== g.key : g.selected === false) continue; // drawn inside its path card
      if (g.section !== sec) { sec = g.section; h += `<h3 class="sec">${esc(sec)}</h3>`; }
      if (pc) { h += pathCard(pc); continue; }
      const head = `<div class="card-h"><b>${esc(g.name)}</b><span class="need">${g.choice ? esc(pickLabel(g)) : 'need ' + esc(g.need)}</span></div>`;
      h += `<div class="card${g.undecided ? ' pick' : ''}">${head}${cardBody(g)}</div>`;
    }
    $('#reqs').innerHTML = h;
  }

  function renderTabs() {
    document.querySelectorAll('[data-tab]').forEach(b => b.setAttribute('aria-selected', b.dataset.tab === S.tab));
    $('#tree-view').hidden = S.tab !== 'tree'; $('#plan-view').hidden = S.tab !== 'plan'; $('#next-view').hidden = S.tab !== 'next';
    renderTree(); renderPlan(); renderNext();
  }

  // Layers come from TREE_LAYOUT (path cards fold in their paths' courses); rows ordered by barycenter of predecessors
  // (one pass), stacked by box height so a tall path card pushes the rest of its column down.
  // Choice nodes go under the column of their most advanced option; GE slots and GE path cards get a lane at the bottom.
  function layout(all, edges, cgroups, lane, pchoices, gecards) {
    const { layer, nodes, edges: te, preds } = TREE_LAYOUT.layers(all, edges, pchoices);
    const boxW = n => n.status === 'path' ? PW : NW, boxH = n => n.status === 'path' ? pathHeight(pcByKey(n.pathChoiceKey)) : NH + TAGH * (!!n.fromPath + !!n.pickedFor);
    const cols = [];
    nodes.forEach(n => (cols[layer[n.code]] = cols[layer[n.code]] || []).push(n));
    const row = {}, pos = {}, colY = [];
    for (let li = 0; li < cols.length; li++) {
      const col = cols[li] || [];
      const key = n => { if (!li) return 0; const p = preds[n.code].filter(c => c in row); return p.length ? p.reduce((s, c) => s + row[c], 0) / p.length : 1e9; };
      const k = new Map(col.map(n => [n, key(n)]));
      col.sort((a, b) => k.get(a) - k.get(b));
      let y = PAD;
      col.forEach((n, i) => { row[n.code] = i; pos[n.code] = { x: PAD + li * COLW, y, w: boxW(n), h: boxH(n) }; y += boxH(n) + ROWH - NH; });
      colY[li] = y;
    }
    const memo = {}, optL = (c, seen) => {
      if (c in layer) return layer[c];
      if (c in memo) return memo[c];
      if (seen.has(c)) return 0; seen.add(c);
      const ps = (course(c) ? course(c).pre : []).flat();
      return (memo[c] = ps.length ? 1 + Math.max(...ps.map(p => optL(p, seen))) : 0);
    };
    const cpos = {};
    let maxX = Math.max(PAD + NW, ...Object.values(pos).map(p => p.x + p.w));
    for (const g of cgroups) {
      const ls = choiceOpts(g).map(o => optL(o.code, new Set())), li = ls.length ? Math.min(...ls) : 0; // earliest option's column
      const y = colY[li] || PAD, x = PAD + li * COLW;
      cpos[g.key] = { x, y, h: choiceHeight(g) };
      colY[li] = y + cpos[g.key].h + 30;
      maxX = Math.max(maxX, x + CW);
    }
    let h = Math.max(PAD + NH, ...Object.values(pos).map(p => p.y + p.h), ...Object.values(cpos).map(p => p.y + p.h)) + PAD;
    let laneY = null;
    if (lane.length || gecards.length) {
      laneY = h + 20;
      const perRow = Math.max(3, Math.floor((maxX - PAD + 24) / (NW + 24))), LH = Math.max(NH, ...lane.map(boxH));
      lane.forEach((n, i) => { pos[n.code] = { x: PAD + (i % perRow) * (NW + 24), y: laneY + 20 + Math.floor(i / perRow) * (LH + 20), w: NW, h: boxH(n) }; });
      maxX = Math.max(maxX, PAD + Math.min(lane.length, perRow) * (NW + 24) - 24);
      h = laneY + 20 + Math.ceil(lane.length / perRow) * (LH + 20);
      // GE path cards: a row under the GE slots, wrapping at the tree width
      let x = PAD, rh = 0;
      for (const pc of gecards) {
        if (x > PAD && x + PW > maxX) { x = PAD; h += rh + 20; rh = 0; }
        const ch = pathHeight(pc); pos['PATH: ' + pc.key] = { x, y: h, w: PW, h: ch };
        x += PW + 24; rh = Math.max(rh, ch); maxX = Math.max(maxX, x - 24);
      }
      h += rh + PAD;
    }
    return { pos, cpos, laneY, w: maxX + PAD, h, nodes, edges: te };
  }

  const choiceRows = g => Math.ceil(Math.min(choiceOpts(g).length, MAXCHIPS + 1) / 2);
  const choiceHeight = g => 32 + choiceRows(g) * 24 + 6 + (takenPathOf(g.key) ? TAGH : 0);
  // tag row "label  ⇄" at y inside a box
  const tagRow = (label, attrs, aria, w, y) => `<rect class="ptag" x="8" y="${y}" width="${w - 16}" height="18" rx="9"/><text class="ptagt" x="16" y="${y + 13}">${esc(trunc(label, Math.floor((w - 70) / 6)))}</text>
    <g class="pbtn" ${attrs} transform="translate(${w - 38},${y})" tabindex="0" role="button" aria-label="${esc(aria)}"><title>${esc(aria)}</title><rect width="30" height="18" rx="9"/><text x="15" y="13" text-anchor="middle">⇄</text></g>`;
  // "path · TITLE  ⇄" inside a box that came from a taken path; ⇄ clears the path choice (the card comes back)
  const pathTag = (pc, w, h) => tagRow('path · ' + pc.title, `data-change="${esc(pc.key)}"`, 'Change path for ' + pc.title, w, h - 24);
  // "selected · GROUP  ⇄" on a course selected in a select-N-of-M group; ⇄ opens that group's options (it does not unselect)
  const pickTag = (g, w, y) => tagRow('selected · ' + g.name, `data-group="${esc(g.key)}"`, 'Change selection for ' + g.name, w, y);
  function choiceSvg(g, p) {
    const opts = choiceOpts(g), shown = opts.length > MAXCHIPS + 1 ? opts.slice(0, MAXCHIPS) : opts, more = opts.length - shown.length;
    const top = 32;
    const chip = (i, inner, attrs) => { const x = 8 + (i % 2) * (CHIPW + 8), y = top + Math.floor(i / 2) * 24;
      return `<g class="cchip" ${attrs} transform="translate(${x},${y})" tabindex="0" role="button"><rect width="${CHIPW}" height="20" rx="10"/>${inner}</g>`; };
    const chips = shown.map((o, i) => chip(i, `<circle class="dot${o.ready ? ' ok' : ''}" cx="11" cy="10" r="4"/><text x="20" y="14">${esc(trunc(o.code, 15))}</text>${o.pinned ? `<path class="pinp" transform="translate(${CHIPW - 16},4) scale(.75)" d="${PIN_D}"/>` : ''}`,
      `data-act="${o.pinned ? 'unselect' : 'select'}" data-key="${esc(g.key)}" data-code="${esc(o.code)}" aria-label="${esc((o.pinned ? 'Unselect ' : 'Select ') + o.code + (o.ready ? ', prereqs met' : ', prereqs missing'))}"`)).join('') +
      (more ? chip(shown.length, `<text class="more" x="${CHIPW / 2}" y="14" text-anchor="middle">+${more} more</text>`, `data-group="${esc(g.key)}" aria-label="All ${opts.length} options"`) : '');
    return `<g class="cnode${S.detail === 'g:' + g.key ? ' sel' : ''}" data-group="${esc(g.key)}" transform="translate(${p.x},${p.y})" tabindex="0" role="button" aria-label="${esc(pickLabel(g) + ', ' + g.name)}">
      <title>${esc(pickLabel(g) + ' · ' + g.name)}</title><rect class="box" width="${CW}" height="${p.h}" rx="10"/>
      <text class="ch" x="10" y="20">${esc(trunc(pickLabel(g) + ' · ' + g.name, 34))}</text>
      ${chips}${takenPathOf(g.key) ? pathTag(takenPathOf(g.key).pc, CW, p.h) : ''}</g>`;
  }

  // path card (only while undecided): header "Select 1 of 2 · TITLE", one row per path with a Select button. With pick k > 1, a
  // path already taken lists its courses with their planned quarters and "change".
  const pathHeight = pc => 32 + pc.paths.length * PROW;
  function pathSvg(pc, pos, nm) {
    const btn = (y, attrs, label, w) => `<g class="pbtn" ${attrs} transform="translate(${PW - w - 12},${y})" tabindex="0" role="button"><rect width="${w}" height="18" rx="9"/><text x="${w / 2}" y="13" text-anchor="middle">${esc(label)}</text></g>`;
    const take = (p, y, label) => btn(y, `data-take="${esc(p.groupKey)}" data-pc="${esc(pc.key)}" aria-label="${esc('Select this path: ' + pathLine(p))}"`, label, label.length * 6.5 + 18);
    const line = p => `${pathLine(p)} · ${p.units} u`;
    // chosen row, second line: "177A FA27 → 177B WI28"; a list path not pinned yet: its slot's quarter and a link to the list
    const quarters = p => {
      const q = c => `<tspan class="q">${esc((nm[c] || {}).planned || (nm[c] || {}).term || '')}</tspan>`;
      if ((p.chain || []).length) return `<text class="qs" x="30" y="Y">${chainText(p, c => esc(dept(c) ? c.slice(dept(c).length + 1) : c) + ' ' + q(c))}</text>`;
      const slot = S.model.nodes.find(n => n.groupKey === p.groupKey && !n.code.startsWith('PATH: '));
      const t = `<text class="qs${p.placeholder ? '' : ' plink'}" x="30" y="Y">${p.placeholder ? 'any course from the list' : 'select the course ›'}${slot ? ' ' + q(slot.code) : ''}</text>`;
      return p.placeholder ? t : `<g class="qlink" data-group="${esc(p.groupKey)}" role="button" tabindex="0" aria-label="Select the course">${t}</g>`;
    };
    let y = 32;
    const rows = pc.paths.map(p => {
      const on = pc.chosenPaths.includes(p.groupKey), y0 = y;
      y += PROW;
      const head = `<rect class="prow${on ? ' on' : ''}" x="8" y="${y0}" width="${PW - 16}" height="${PROW - 6}" rx="6"/>
        <circle class="dot${p.ready ? ' ok' : ''}" cx="20" cy="${y0 + 14}" r="4"><title>${esc(pathNeeds(p))}</title></circle>
        <text class="pt" x="30" y="${y0 + 18}">${esc(trunc(line(p), on ? 34 : 33))}</text>`;
      return head + (on ? quarters(p).replace('y="Y"', `y="${y0 + 34}"`) + btn(y0 + 4, `data-change="${esc(pc.key)}" aria-label="Change your selection"`, 'change', 56)
        : `<text class="csub" x="30" y="${y0 + 34}">${esc(pathNeeds(p))}</text>` + take(p, y0 + 11, 'Select'));
    }).join('');
    const head = `${pickHead(pc)} · ${pc.title}`;
    return `<g class="pnode${S.detail === 'p:' + pc.key ? ' sel' : ''}" data-path="${esc(pc.key)}" transform="translate(${pos.x},${pos.y})" tabindex="0" role="button" aria-label="${esc(head)}">
      <title>${esc(head + '\n' + pc.paths.map(p => line(p)).join('\n'))}</title>
      <rect class="box" width="${PW}" height="${pos.h}" rx="10"/><text class="ch" x="10" y="20">${esc(trunc(head, 44))}</text>${rows}</g>`;
  }

  function renderTree() {
    const { nodes: all, edges } = S.model, nm = nodeMap();
    if (!all.length) { $('#tree').innerHTML = '<p class="muted pad">Nothing to show yet.</p>'; return; }
    // path cards stand for their paths' courses and slots; CHOOSE: slots of major requirements are drawn as choice nodes;
    // GE slots and GE path cards go to the lane
    const folded = n => !!TREE_LAYOUT.cardOf(n, pcs()), pcOf = n => n.status === 'path' && pcByKey(n.pathChoiceKey);
    const gecards = pcs().filter(pc => isGEpc(pc) && !pathDecided(pc)), pchoices = pcs().filter(pc => !isGEpc(pc));
    const lane = all.filter(n => isGE(n) && !folded(n));
    const tree = all.filter(n => !isGE(n) && !n.code.startsWith('CHOOSE: ') && !(pcOf(n) && isGEpc(pcOf(n))));
    const cgroups = S.model.groups.filter(g => g.undecided && !g.placeholder && g.selected !== false && !folded({ groupKey: g.key }));
    const { pos, cpos, laneY, w, h, nodes, edges: te } = layout(tree, edges, cgroups, lane, pchoices, gecards);
    const blocked = e => nm[e.to].status === 'locked' && !['done', 'ip'].includes(nm[e.from].status);
    const yAt = p => p.y + (p.w === PW ? 16 : NH / 2); // cards connect at their header
    const es = te.filter(e => !isGE(nm[e.from]) && !isGE(nm[e.to])).sort((a, b) => blocked(a) - blocked(b)).map(e => {
      const a = pos[e.from], b = pos[e.to], x1 = a.x + a.w, y1 = yAt(a), x2 = b.x, y2 = yAt(b), dx = Math.max(40, (x2 - x1) / 2);
      return `<path class="edge${blocked(e) ? ' block' : ''}" d="M${x1} ${y1} C${x1 + dx} ${y1} ${x2 - dx} ${y2} ${x2} ${y2}"/>`;
    }).join('');
    const ns = nodes.filter(n => n.status !== 'path').concat(lane).map(n => {
      const p = pos[n.code], chip = n.planned || n.term || '', ready = n.status === 'ready', pinned = n.groupKey && isPinned(n.groupKey, n.code);
      const cw = chip ? chip.length * 6.2 + 12 : 0, label = n.code.startsWith('CHOOSE: ') ? 'choose: ' + n.title : n.code, fp = n.fromPath && pcByKey(n.fromPath), pf = n.pickedFor && groupByKey(n.pickedFor);
      return `<g class="node s-${esc(n.status)}${S.detail === n.code ? ' sel' : ''}" data-node="${esc(n.code)}" transform="translate(${p.x},${p.y})" tabindex="0" role="button" aria-label="${esc(n.code + ', ' + (STATUS[n.status] || n.status) + (pinned ? ', selected' : '') + (n.critical ? '. ' + critText(n) : ''))}">
        <title>${esc(n.code + ' — ' + n.title + (n.critical ? '\n* ' + critText(n) : ''))}</title><rect class="box" width="${NW}" height="${p.h}" rx="8"/>${n.critical ? '<text class="crit" x="-7" y="13" aria-hidden="true">*</text>' : ''}
        ${pinned ? `<path class="pinp" transform="translate(8,10) scale(.8)" d="${PIN_D}"/>` : ''}
        <text class="code" x="${pinned ? 24 : 10}" y="22">${esc(trunc(label, Math.floor((NW - cw - (pinned ? 32 : 18)) / 7.8)))}</text>
        <text class="ttl" x="10" y="42">${esc(trunc(n.title, ready ? 20 : n.status === "placeholder" ? 27 : 31))}</text>${ready ? `<text class="rdy" x="${NW - 10}" y="42" text-anchor="end">ready now</text>` : ''}
        ${chip ? `<rect class="chip" x="${NW - cw - 8}" y="9" width="${cw}" height="17" rx="8.5"/><text class="chipt" x="${NW - 8 - cw / 2}" y="21" text-anchor="middle">${esc(chip)}</text>` : ''}
        ${pf ? pickTag(pf, NW, p.h - 24 - (fp ? TAGH : 0)) : ''}${fp ? pathTag(fp, NW, p.h) : ''}
      </g>`;
    }).join('');
    const cs = cgroups.map(g => choiceSvg(g, cpos[g.key])).join('') + pcs().filter(pc => pos['PATH: ' + pc.key]).map(pc => pathSvg(pc, pos['PATH: ' + pc.key], nm)).join('');
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

  const isSlotCode = c => /^(GE|CHOOSE): /.test(c);
  const critText = n => 'Must be taken this quarter: delaying it pushes back ' + n.criticalWhy;
  function renderPlan() {
    const nm = nodeMap(), cf = S.conflictFrom;
    const chipFor = (c, term) => {
      const n = nm[c] || {};
      if (c.startsWith('CHOOSE: ')) return `<button class="pchip choose" ${n.pathChoiceKey ? `data-path="${esc(n.pathChoiceKey)}"` : isGE(n) ? `data-node="${esc(c)}"` : `data-group="${esc(n.groupKey)}"`} title="Decision pending: open the options"><b>choose: ${esc(n.title)}</b><small>${esc(n.units ?? '')} u</small></button>`;
      return courseChip(c, term, nm, `data-drag="${esc(c)}" data-from="${esc(term)}"`);
    };
    renderCfStatus();
    renderConstraints();
    $('#plan').innerHTML = (S.model.plan || []).map(t => `<div class="term${t.beyondExpected ? ' late' : ''}" data-drop="plan" data-term="${esc(t.term)}">
      <div class="term-h"><b>${esc(t.term)}</b><span>${esc(t.units)} units</span></div>
      ${t.beyondExpected ? '<span class="tag-late">past expected graduation</span>' : ''}
      ${t.courses.map(c => chipFor(c, t.term)).join('') || '<p class="muted small">No courses</p>'}
    </div>`).join('') || '<p class="muted pad">Nothing left to plan.</p>';
  }

  // a planned class (or GE slot) chip with » defer and ≠ conflict; while picking a conflict, the other classes that term are targets
  function courseChip(c, term, nm, attrs) {
    const n = nm[c] || {}, cf = S.conflictFrom, real = !isSlotCode(c), target = real && cf && cf.term === term && cf.code !== c;
    const crit = n.critical ? `<span class="crit" role="img" aria-label="${esc(critText(n))}" title="${esc(critText(n))}">*</span>` : '';
    const acts = real ? `<span class="pacts"><button type="button" class="pact" data-defer="${esc(c)}" aria-label="Defer ${esc(c)} to the next quarter it is offered" title="Defer to the next quarter it is offered">»</button><button type="button" class="pact" data-conflict="${esc(c)}" data-term="${esc(term)}" aria-label="Conflict: mark a class that clashes with ${esc(c)} in ${esc(term)}" title="Conflict…">≠</button></span>` : '';
    return `<div class="pwrap${target ? ' target' : ''}${cf && cf.code === c && cf.term === term ? ' source' : ''}"${attrs ? ' draggable="true" ' + attrs : ''}>${crit}<button class="pchip s-${esc(n.status || '')}" data-node="${esc(c)}"${target ? ` data-cpick="${esc(c)}" aria-label="${esc(c + ' conflicts with ' + cf.code)}"` : ''}><b>${esc(c)}</b><span>${esc(titleOf(c, nm))}</span><small>${esc(n.units ?? '')} u</small></button>${acts}</div>`;
  }
  function renderCfStatus() {
    const cf = S.conflictFrom;
    document.querySelectorAll('.cfstatus').forEach(st => {
      st.hidden = !cf;
      st.innerHTML = cf ? `Select the class that conflicts with <b>${esc(cf.code)}</b> in ${esc(cf.term)} <span class="muted">(Esc to cancel)</span> <button type="button" class="btn sm" data-cfcancel>Cancel</button>` : '';
    });
  }

  // "What to take next": one column per class of the chosen quarter (most important left), alternates under it (best on top).
  // » defers a class, ≠ marks a conflict; an alternate opens its course or its options panel, or is dragged onto a class to take it instead.
  function renderNext() {
    const r = MODEL.nextQuarter(S.model, S.nextTerm, { defers: S.opts.defers }), nm = nodeMap();
    renderCfStatus();
    $('#nextterm').innerHTML = r.terms.map(t => `<option value="${esc(t)}"${t === r.term ? ' selected' : ''}>${esc(t)}${t === r.terms[0] ? ' (next)' : ''}</option>`).join('');
    const alt = a => {
      const open = nm[a.code] ? `data-node="${esc(a.code)}"` : a.groupKey ? `data-group="${esc(a.groupKey)}"` : '';
      return `<a href="#" class="nalt" draggable="true" data-drag="${esc(a.code)}"${a.groupKey && !nm[a.code] ? ` data-gk="${esc(a.groupKey)}"` : ''} ${open}><b>${esc(a.code)}</b><span>${esc(a.title)}</span><small>${esc(a.why)}</small></a>`;
    };
    $('#next').innerHTML = r.picks.map((x, i) => {
      const n = nm[x.code] || {};
      const top = x.code.startsWith('CHOOSE: ')
        ? `<button class="pchip choose" ${n.pathChoiceKey ? `data-path="${esc(n.pathChoiceKey)}"` : `data-group="${esc(n.groupKey)}"`}><b>choose: ${esc(n.title)}</b><small>${esc(x.units)} u</small></button>`
        : courseChip(x.code, r.term, nm, '');
      return `<div class="ncol"><div class="nrank">#${i + 1}${i || x.slot ? '' : ' most important'}</div><div class="ntop" data-drop="next" data-out="${esc(x.code)}" data-term="${esc(r.term)}">${top}</div><span class="nwhy">${esc(x.why)}</span>
        ${x.alts.length ? `<div class="nalt-h">If you can't take it:</div>${x.alts.map(alt).join('')}` : x.slot ? '' : '<div class="nalt-h">Nothing else can be taken this quarter in its place.</div>'}</div>`;
    }).join('') || '<p class="muted pad">Nothing left to plan.</p>';
  }

  // "Your scheduling constraints": each defer and conflict (with the model's reason) and a × that removes it
  function renderConstraints() {
    const d = Object.entries(S.opts.defers || {}), p = Object.entries(S.opts.pins || {}), cs = S.opts.conflicts || [], res = S.model.conflictResolutions || [], box = $('#constraints');
    box.hidden = !d.length && !p.length && !cs.length;
    const x = (attrs, label) => `<button type="button" class="cx" ${attrs} aria-label="${esc(label)}" title="${esc(label)}">×</button>`;
    box.innerHTML = box.hidden ? '' : '<h3>Your scheduling constraints</h3><ul>' +
      p.map(([c, t]) => { const w = (S.model.warnings || []).find(w => w.includes(` ${c} to ${t}:`));
        return `<li><span>Move <b>${esc(c)}</b> to ${esc(t)}${w ? `<br><small class="muted">${esc(w)}</small>` : ''}</span>${x(`data-unmove="${esc(c)}"`, 'Remove move of ' + c)}</li>`; }).join('') +
      d.map(([c, t]) => `<li><span>Defer <b>${esc(c)}</b> to ${esc(t)} or later</span>${x(`data-undefer="${esc(c)}"`, 'Remove deferral of ' + c)}</li>`).join('') +
      cs.map((c, i) => { const r = res.find(r => r.term === c.term && r.a === c.a && r.b === c.b);
        return `<li><span>Conflict in ${esc(c.term)}: <b>${esc(c.a)}</b> and <b>${esc(c.b)}</b><br><small class="muted">${esc(r ? r.why : 'Ignored: one of these is no longer in the plan.')}</small></span>${x(`data-unconflict="${i}"`, `Remove conflict between ${c.a} and ${c.b}`)}</li>`; }).join('') + '</ul>';
  }

  // ---------- scheduling changes: preview, then apply; major ones ask (modal), the rest offer Undo (toast) ----------
  const shortCode = c => trunc(c, 44);
  function tryChange(change, prev = { opts: JSON.parse(JSON.stringify(S.opts)), model: S.model }) {
    let r;
    try { r = MODEL.previewChange(S.parsed, buildOpts(), change); } catch (e) { console.error(e); return showError('Could not apply that change: ' + e.message); }
    S.opts.defers = r.opts.defers; S.opts.pins = r.opts.pins; S.opts.conflicts = r.opts.conflicts; S.conflictFrom = null;
    saveOpts(); S.model = r.after; render();
    if (r.diff.severity === 'major') return showModal(r.diff, prev);
    if (!/^un/.test(change.type)) showToast(changeText(change, r), prev);
  }
  function changeText(ch, r) {
    const mv = r.diff.moved, own = mv.find(x => x.code === ch.code);
    const others = mv.filter(x => ![ch.code, ch.a, ch.b].includes(x.code));
    const say = list => list.slice(0, 3).map(x => `${shortCode(x.code)} moved to ${x.to}${own && x.to === own.from ? ' to fill the slot' : ''}.`).join(' ') + (list.length > 3 ? ` ${list.length - 3} more moved.` : '');
    if (ch.type === 'move' || ch.type === 'swapIn') {
      const fail = r.after.warnings.find(w => w.startsWith(`Couldn't move ${ch.code} `) || w.startsWith(`Ignored your move of ${ch.code} `));
      if (fail) return fail;
      const out = ch.type === 'swapIn' && mv.find(x => x.code === ch.out);
      return `Moved ${ch.code} to ${ch.term}.` + (out ? ` ${shortCode(out.code)} moved to ${out.to}.` : '') + (others.length ? ' ' + say(others.filter(x => x.code !== ch.out)) : '');
    }
    if (ch.type === 'defer') return own ? `Deferred ${ch.code} to ${own.to}. ${say(others)}`.trim() : `${ch.code} could not be deferred.`;
    const res = (r.after.conflictResolutions || []).find(x => x.term === ch.term && x.a === ch.a && x.b === ch.b);
    if (!res || !res.kept) return res ? res.why : 'Conflict saved.';
    return `Kept ${res.kept} in ${ch.term}; ${res.moved} moved to ${res.movedTo || 'nowhere'}.` + (res.filledBy ? ` ${shortCode(res.filledBy)} moved to ${ch.term} to fill the slot.` : '');
  }
  function undo(prev) { S.opts = prev.opts; saveOpts(); S.model = prev.model; render(); }
  let toastTimer = null;
  function showToast(text, prev) {
    const t = $('#toast');
    clearTimeout(toastTimer);
    t.innerHTML = `<span>${esc(text)}</span><button type="button" class="btn sm" data-toastundo>Undo</button>`;
    t.hidden = false; S.toastPrev = prev;
    toastTimer = setTimeout(() => { t.hidden = true; S.toastPrev = null; }, 8000);
  }
  function showModal(diff, prev) {
    const li = xs => '<ul>' + xs.map(x => `<li>${x}</li>`).join('') + '</ul>';
    $('#toast').hidden = true;
    $('#modal-b').innerHTML = `<p><b>Graduation</b> (last planned quarter): ${esc(diff.finalTermBefore || '—')} → ${esc(diff.finalTermAfter || '—')}</p>` +
      (diff.pastExpected.length ? `<p><b>Now past expected graduation (${esc(S.model.expectedTerm)}):</b></p>${li(diff.pastExpected.map(esc))}` : '') +
      (diff.unschedulable.length ? `<p><b>Can no longer be scheduled:</b></p>${li(diff.unschedulable.map(esc))}` : '') +
      (diff.moved.length ? `<p><b>Courses that move:</b></p>${li(diff.moved.map(x => `${esc(shortCode(x.code))}: ${esc(x.from)} → ${esc(x.to)}`))}` : '');
    openModal('This change causes scheduling problems', '<button type="button" class="btn primary" data-modal="undo">Undo</button><button type="button" class="btn" data-modal="continue">Continue anyway</button>', prev);
  }
  function openModal(title, buttons, prev) {
    $('#modal-t').textContent = title; $('#modal-btns').innerHTML = buttons;
    S.modal = { prev, focus: document.activeElement };
    ['header.bar', '#app', '#detail'].forEach(q => { $(q).inert = true; });
    $('#modal').hidden = false;
    $('#modal-btns button').focus();
  }
  // dropped in a quarter it isn't offered in: offer the nearest offered quarters, one before and one after
  function offerNearest(code, term) {
    const n = nodeMap()[code], ti = DARS.termIndex(term), t0 = DARS.termIndex(S.model.currentTerm);
    const okAt = u => (S.opts.useSummer || u % 4 !== 3) && (n.offered === '?' || n.offered.includes('FWSU'[u % 4]));
    let before = null, after = null;
    for (let u = ti - 1; u > t0 && before == null; u--) if (okAt(u)) before = u;
    for (let u = ti + 1; u <= ti + 8 && after == null; u++) if (okAt(u)) after = u;
    const QN = { F: 'Fall', W: 'Winter', S: 'Spring', U: 'Summer' }, b = (u, w) => u == null ? '' : `<button type="button" class="btn${w === 'after' ? '' : ' primary'}" data-moveto="${esc(DARS.termName(u))}" data-code="${esc(code)}">${esc(DARS.termName(u))} (${w})</button>`;
    $('#toast').hidden = true;
    $('#modal-b').innerHTML = `<p>${esc(code)} is offered ${esc(offeredText(code))}, so it can't go in ${esc(term)}.</p>` +
      (before == null && after == null ? '<p>No nearby quarter offers it.</p>' : '<p>Move it to the nearest quarter it is offered instead?</p>');
    openModal(`${code} isn't offered in ${QN['FWSU'[ti % 4]]}`, b(before, 'before') + b(after, 'after') + '<button type="button" class="btn" data-modal="cancel">Cancel</button>', null);
  }
  function closeModal(doUndo) {
    const m = S.modal; if (!m) return;
    S.modal = null; $('#modal').hidden = true;
    ['header.bar', '#app', '#detail'].forEach(q => { $(q).inert = false; });
    if (doUndo && m.prev) undo(m.prev);
    const back = m.focus && document.contains(m.focus) ? m.focus : $('[data-tab="plan"]');
    if (back) back.focus();
  }

  function groupDetail(g, nm) {
    const rows = choiceOpts(g).map(o => {
      const c = course(o.code) || {}, pre = preHtml(c.pre, nm);
      return `<div class="optd${o.pinned ? ' on' : ''}"><div class="optd-h">${o.pinned ? PIN : `<i class="dot${o.ready ? ' ok' : ''}" title="${o.ready ? 'prereqs met' : 'prereqs missing'}"></i>`}
        <b>${nm[o.code] ? `<a href="#" data-node="${esc(o.code)}">${esc(o.code)}</a>` : esc(o.code)}</b><span class="muted small">${esc(c.u ?? '?')} u</span>
        <button class="btn sm" data-act="${o.pinned ? 'unselect' : 'select'}" data-key="${esc(g.key)}" data-code="${esc(o.code)}">${o.pinned ? 'Unselect' : 'Select'}</button></div>
        <div class="small">${esc(c.t || 'Not in the course database')}</div>
        <div class="small muted">Offered: ${esc(offeredText(o.code))}</div>
        ${pre ? `<ul class="prelist small">${pre}</ul>` : `<div class="small muted">${c.t ? 'No prerequisites' : 'Prerequisites unknown'}</div>`}
        ${c.req ? `<div class="small muted">Catalog: ${esc(c.req)}</div>` : ''}
        ${o.why ? `<div class="small muted">${esc(o.why)}</div>` : ''}</div>`;
    }).join('');
    // open slots, or which selection a new one replaces (pin() drops the oldest)
    const mine = S.opts.choices[g.key] || [], left = g.need - g.chosen.filter(c => !c.auto).length;
    const slots = !g.choice || g.undeclared ? '' : left > 0 ? `<p class="small"><b>${esc(left)} more to select</b></p>`
      : `<p class="small"><b>${g.need === 1 ? 'Selected.' : `All ${esc(g.need)} selected.`}</b> Selecting another option replaces ${esc(mine[0] || 'your oldest selection')}, your oldest selection.</p>`;
    return `<button class="close" data-close aria-label="Close">×</button>
      <h2>${esc(pickLabel(g))}</h2><p>${esc(g.name)}<br><small class="muted">${esc(g.section)}</small></p>${slots}
      ${takenPathOf(g.key) ? partOf(takenPathOf(g.key)) : ''}
      ${g.selected === false && pcOfGroup(g.key) ? `<p class="small">One path of ${esc(pcOfGroup(g.key).title)}. Selecting an option here selects this path. <a href="#" data-path="${esc(pcOfGroup(g.key).key)}">Compare paths</a></p>` : ''}
      <p class="small muted">Green dot: prerequisites done, in progress or selected. Grey: something is still missing.</p>${rows}`;
  }

  function pathDetail(pc, nm) {
    const done = pathDecided(pc);
    const rows = pc.paths.map(p => {
      const on = pc.chosenPaths.includes(p.groupKey);
      const cs = (p.chain || []).map(({ code: c }) => { const k = course(c) || {}, pre = preHtml(k.pre, nm), n = nm[c] || {};
        return `<div class="pcourse"><b>${nm[c] ? `<a href="#" data-node="${esc(c)}">${esc(c)}</a>` : esc(c)}</b> <span class="muted small">${esc(k.u ?? '?')} u${n.planned ? ' · planned ' + esc(n.planned) : ''}</span>
          <div class="small">${esc(k.t || 'Not in the course database')}</div><div class="small muted">Offered: ${esc(offeredText(c))}</div>
          ${pre ? `<ul class="prelist small">${pre}</ul>` : `<div class="small muted">${k.t ? 'No prerequisites' : 'Prerequisites unknown'}</div>`}
          ${k.req ? `<div class="small muted">Catalog: ${esc(k.req)}</div>` : ''}</div>`; }).join('');
      const list = p.choice ? `<p class="small">${p.placeholder ? 'Select the course in the Requirements panel once you select this path.' : `<a href="#" data-group="${esc(p.groupKey)}">See every option</a>`}</p>` : '';
      return `<div class="optd${on ? ' on' : ''}"><div class="optd-h"><i class="dot${p.ready ? ' ok' : ''}" title="${esc(pathNeeds(p))}"></i><b>${esc(pathLine(p))}</b><span class="muted small">${esc(p.units)} u</span>
        ${on ? `<button class="btn sm" data-change="${esc(pc.key)}">change</button>` : `<button class="btn sm" data-take="${esc(p.groupKey)}" data-pc="${esc(pc.key)}">${done ? 'Switch to this path' : 'Select this path'}</button>`}</div>
        <div class="small muted">${esc(p.name)} · ${esc(pathNeeds(p))}</div>${list}${cs}</div>`;
    }).join('');
    return `<button class="close" data-close aria-label="Close">×</button>
      <h2>${esc(pickHead(pc))}</h2><p>${esc(pc.title)}<br><small class="muted">${esc(pc.section)}</small></p>
      <p class="small muted">Each option is taken as a whole: the plan schedules every course in the one you select and none from the others. Green dot: prerequisites done, in progress or selected.</p>${rows}`;
  }

  function renderDetail() {
    const d = $('#detail'), nm = S.model ? nodeMap() : {}, id = S.detail || '';
    const grp = id.startsWith('g:') && S.model && groupByKey(id.slice(2)), n = nm[id], pc = id.startsWith('p:') && S.model && pcByKey(id.slice(2));
    if (pc) { d.innerHTML = pathDetail(pc, nm); d.hidden = false; return; }
    if (!grp && !n) { d.hidden = true; S.detail = null; return; }
    if (grp) { d.innerHTML = groupDetail(grp, nm); d.hidden = false; return; }
    const g = n.groupKey && groupByKey(n.groupKey), pinned = g && isPinned(g.key, n.code);
    const off = course(n.code) ? offeredText(n.code) : n.offered ? qtrs(n.offered) : 'Not currently offered';
    const pre = preHtml(n.prereqs, nm);
    d.innerHTML = `<button class="close" data-close aria-label="Close">×</button>
      <h2>${pinned ? PIN + ' ' : ''}${esc(n.code)}</h2><p>${esc(n.title)}</p>
      ${n.fromPath && takenPathOf(n.groupKey) ? partOf(takenPathOf(n.groupKey)) : ''}
      ${n.pickedFor && groupByKey(n.pickedFor) ? `<p class="small">Selected for: ${esc(groupByKey(n.pickedFor).name)} <button class="btn sm" data-group="${esc(n.pickedFor)}">Change selection</button></p>` : ''}
      ${pinned ? `<p><button class="btn sm" data-act="unselect" data-key="${esc(g.key)}" data-code="${esc(n.code)}">Unselect</button></p>` : ''}
      <dl><dt>Status</dt><dd><i class="badge s-${esc(n.status)}">${esc(STATUS[n.status] || n.status)}</i></dd>
      <dt>Units</dt><dd>${esc(n.units)}</dd>
      ${n.term ? `<dt>Taken</dt><dd>${esc(n.term)}</dd>` : ''}${n.planned ? `<dt>Planned</dt><dd>${esc(n.planned)}${n.critical ? ` <span class="crit-t">* ${esc(critText(n))}</span>` : n.slack ? ` <small class="muted">(can slip ${esc(n.slack)}${n.slack >= 4 ? '+' : ''} offered quarter${n.slack === 1 ? '' : 's'})</small>` : ''}</dd>` : ''}
      <dt>Offered</dt><dd>${esc(off)}</dd>
      ${g ? `<dt>Satisfies</dt><dd>${esc(g.name)}<br><small class="muted">${esc(g.section)}</small></dd>` : ''}</dl>
      ${g && !g.placeholder && (g.choice || (g.altGroupKeys || []).length) ? `<p><a href="#" data-group="${esc(g.key)}">All options for this requirement</a></p>` : ''}
      <h3>Prerequisites</h3>${pre ? `<ul class="prelist">${pre}</ul>` : '<p class="muted">None</p>'}
      ${n.pathPrereq ? '<p class="muted small">Only an option you have not selected yet needs this, so it is not in the plan.</p>' : ''}
      ${n.status === 'placeholder' ? '<p class="muted small">Select a specific course for this slot in the requirements panel.</p>' : ''}
      ${n.req ? `<h3>Catalog requisites</h3><p>${esc(n.req)}</p>` : ''}`;
    d.hidden = false;
  }

  function openDetail(id) {
    S.detail = id; renderDetail();
    document.querySelectorAll('.node.sel,.cnode.sel,.pnode.sel').forEach(e => e.classList.remove('sel'));
    document.querySelectorAll('.node,.cnode,.pnode').forEach(e => { if ((e.dataset.path ? 'p:' + e.dataset.path : e.dataset.group ? 'g:' + e.dataset.group : e.dataset.node) === id) e.classList.add('sel'); });
  }

  // ---------- choices ----------
  function pin(key, code) {
    const g = select(key, code); if (!g) return;
    // pinning inside a path that is not taken takes that path
    const pc = g.selected === false && pcOfGroup(key);
    if (pc) return takePath(pc.key, key);
    commit();
  }
  // record a selection without rebuilding
  function select(key, code) {
    const g = groupByKey(key); if (!g) return null;
    const a = (S.opts.choices[key] || []).filter(c => c !== code); a.push(code);
    while (a.length > Math.max(1, g.need || 1)) a.shift();
    // a course counts for one pick only: drop it from every other group's pins
    for (const k of Object.keys(S.opts.choices)) if (k !== key && !k.startsWith('path:')) {
      const r = S.opts.choices[k].filter(c => c !== code);
      if (r.length) S.opts.choices[k] = r; else delete S.opts.choices[k];
    }
    S.opts.choices[key] = a;
    return g;
  }
  // take a path: it joins the picks (oldest dropped beyond pick k); pins in paths no longer taken are dropped
  function takePath(pcKey, gk) {
    const pc = pcByKey(pcKey); if (!pc) return;
    const keep = pc.chosenPaths.filter(k => k !== gk).concat(gk).slice(-pc.pick);
    S.opts.choices['path:' + pcKey] = keep;
    pc.paths.forEach(p => { if (!keep.includes(p.groupKey)) delete S.opts.choices[p.groupKey]; });
    commit();
  }
  function clearPath(pcKey) {
    const pc = pcByKey(pcKey); if (!pc) return;
    delete S.opts.choices['path:' + pcKey];
    pc.paths.forEach(p => delete S.opts.choices[p.groupKey]);
    commit();
  }
  function unpin(key, code) {
    const a = (S.opts.choices[key] || []).filter(c => c !== code);
    if (a.length) S.opts.choices[key] = a; else delete S.opts.choices[key];
    commit();
  }

  // ---------- events ----------
  document.addEventListener('click', e => {
    const t = e.target.closest('[data-act],[data-node],[data-group],[data-path],[data-take],[data-change],[data-tab],[data-zoom],[data-sample],[data-close],[data-diag],[data-defer],[data-conflict],[data-cfcancel],[data-undefer],[data-unconflict],[data-toastundo],[data-modal],[data-moveto],[data-unmove]');
    if (!t) return;
    if (t.dataset.modal) return closeModal(t.dataset.modal === 'undo');
    if (t.dataset.moveto) { closeModal(false); return tryChange({ type: 'move', code: t.dataset.code, term: t.dataset.moveto }); }
    if (t.dataset.unmove) return tryChange({ type: 'unmove', code: t.dataset.unmove });
    if (t.dataset.toastundo !== undefined) { const p = S.toastPrev; $('#toast').hidden = true; S.toastPrev = null; return p && undo(p); }
    if (t.dataset.cfcancel !== undefined) { S.conflictFrom = null; return renderTabs(); }
    if (t.dataset.cpick && S.conflictFrom) { const { code, term } = S.conflictFrom; return tryChange({ type: 'conflict', a: code, b: t.dataset.cpick, term }); }
    if (t.dataset.defer) return tryChange({ type: 'defer', code: t.dataset.defer });
    if (t.dataset.conflict) {
      const same = S.conflictFrom && S.conflictFrom.code === t.dataset.conflict;
      S.conflictFrom = same ? null : { code: t.dataset.conflict, term: t.dataset.term };
      renderTabs();
      const first = document.querySelector((S.tab === 'next' ? '#next' : '#plan') + ' .pwrap.target .pchip');
      if (first) first.focus();
      return;
    }
    if (t.dataset.undefer) return tryChange({ type: 'undefer', code: t.dataset.undefer });
    if (t.dataset.unconflict) { const c = S.opts.conflicts[+t.dataset.unconflict]; return c && tryChange({ type: 'unconflict', a: c.a, b: c.b, term: c.term }); }
    if (t.dataset.diag !== undefined) return copyDiag(t);
    if (t.dataset.sample !== undefined) {
      if (!Array.isArray(window.SAMPLE_LINES)) return showError('Sample audit (sample/dars-lines.js) did not load.');
      return load(window.SAMPLE_LINES, true);
    }
    if (t.dataset.close !== undefined) { S.detail = null; document.querySelectorAll('.sel').forEach(x => x.classList.remove('sel')); return renderDetail(); }
    if (t.dataset.tab) { S.tab = t.dataset.tab; return renderTabs(); }
    if (t.dataset.zoom) { S.zoom = Math.min(2, Math.max(0.4, Math.round((S.zoom + 0.2 * t.dataset.zoom) * 10) / 10)); return applyZoom(); }
    if (t.dataset.take) { e.preventDefault(); return takePath(t.dataset.pc, t.dataset.take); }
    if (t.dataset.change) { e.preventDefault(); return clearPath(t.dataset.change); }
    if (t.dataset.path) { e.preventDefault(); return openDetail('p:' + t.dataset.path); }
    if (t.dataset.node) { e.preventDefault(); return openDetail(t.dataset.node); }
    const { act, key, code } = t.dataset;
    if (act === 'select') pin(key, code);
    else if (act === 'unselect') unpin(key, code);
    else if (t.dataset.group) { e.preventDefault(); openDetail('g:' + t.dataset.group); }
  });
  document.addEventListener('keydown', e => {
    if (S.modal) { // focus stays in the dialog; Esc = Undo
      if (e.key === 'Escape') { e.preventDefault(); return closeModal(true); }
      if (e.key === 'Tab') {
        const f = [...document.querySelectorAll('#modal button')], i = f.indexOf(document.activeElement);
        e.preventDefault(); f[(i + (e.shiftKey ? -1 : 1) + f.length) % f.length].focus();
      }
      return;
    }
    if (e.key === 'Escape' && S.conflictFrom) { S.conflictFrom = null; return renderTabs(); }
    if (e.key === 'Escape' && S.detail) { S.detail = null; renderDetail(); }
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches && e.target.matches('.node,.cnode,.cchip,.pnode,.pbtn,.qlink')) { e.preventDefault(); e.target.dispatchEvent(new MouseEvent('click', { bubbles: true })); }
  });
  // drag: a plan chip to another quarter (move), or a "What to take next" alternate onto a class at the top (take it instead)
  const dropZone = e => S.drag && e.target.closest && e.target.closest('[data-drop]');
  const clearOver = () => document.querySelectorAll('.over').forEach(x => x.classList.remove('over'));
  document.addEventListener('dragstart', e => {
    const el = e.target.closest && e.target.closest('[data-drag]'); if (!el) return;
    S.drag = { code: el.dataset.drag, from: el.dataset.from, gk: el.dataset.gk };
    e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', el.dataset.drag);
  });
  document.addEventListener('dragover', e => { const z = dropZone(e); if (!z) return; e.preventDefault(); if (!z.classList.contains('over')) { clearOver(); z.classList.add('over'); } });
  document.addEventListener('dragend', () => { S.drag = null; clearOver(); });
  document.addEventListener('drop', e => {
    const z = dropZone(e); if (!z) return;
    e.preventDefault(); clearOver();
    const d = S.drag, term = z.dataset.term; S.drag = null;
    if (z.dataset.drop === 'plan') {
      if (d.from === undefined || d.from === term) return;
      const n = nodeMap()[d.code], q = 'FWSU'[DARS.termIndex(term) % 4];
      return n.offered === '?' || n.offered.includes(q) ? tryChange({ type: 'move', code: d.code, term }) : offerNearest(d.code, term);
    }
    if (d.from !== undefined || d.code === z.dataset.out) return; // "next" zones take alternates only
    const prev = { opts: JSON.parse(JSON.stringify(S.opts)), model: S.model };
    if (d.gk) { // an option not selected yet: select it first, in place of the class it replaces when that is a selection of the same requirement
      const cs = S.opts.choices[d.gk] || [];
      if (cs.includes(z.dataset.out)) S.opts.choices[d.gk] = cs.filter(c => c !== z.dataset.out);
      select(d.gk, d.code);
    }
    tryChange({ type: 'swapIn', code: d.code, out: z.dataset.out, term }, prev);
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
    if (t.id === 'nextterm') { S.nextTerm = t.value; return renderNext(); }
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
