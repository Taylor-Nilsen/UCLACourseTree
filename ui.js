// DARS Skill Tree UI. Plain browser script: reads window.DARS / COURSES / MODEL (see INTERFACE.md), renders into index.html.

// Tree layering (pure, also loaded by the Node tests). An undecided path choice is one card (node `PATH: <key>`); nodes of
// its paths (a path already taken while more picks are pending) fold into it. Layer = longest prereq chain; a card sits
// where the last course of its slowest path would sit. Once decided there is no card: the taken paths' courses are
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
        : Math.max(0, ...pc.paths.map(p => {
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
  const STATUS = { done: 'Completed', ip: 'In progress', ready: 'Ready now', locked: 'Locked', placeholder: 'GE / elective slot', path: 'Pick one' };
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
  const pickHead = pc => `Pick ${pc.pick} of ${pc.paths.length}`;
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
  const pickLabel = g => g.undeclared ? `Declare an area · ${g.need} course${g.need === 1 ? '' : 's'}` : `Pick ${g.need} of ${choiceOpts(g).length}`;
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

  // one card per path choice (same wording as the tree card): each path is a whole alternative group, taken as a bundle
  function pathCard(pc) {
    const nm = nodeMap(), done = pathDecided(pc);
    const rows = pc.paths.map(p => {
      const on = pc.chosenPaths.includes(p.groupKey), g = groupByKey(p.groupKey);
      const cs = p.courses.map(c => `<div class="pc">${nm[c] ? `<a href="#" data-node="${esc(c)}">${esc(c)}</a>` : `<b>${esc(c)}</b>`} <span>${esc(titleOf(c, nm))}</span> <small>${esc((nm[c] || {}).planned || '')}</small></div>`).join('');
      const body = p.choice ? (on ? cardBody(g) : done ? '' : `<details class="alts"><summary>show options</summary>${cardBody(g)}</details>`) : on ? cs : '';
      const act = on ? `<a href="#" class="small" data-change="${esc(pc.key)}">change</a>` : `<button class="btn sm" data-take="${esc(p.groupKey)}" data-pc="${esc(pc.key)}">${done ? 'switch' : 'Pick'}</button>`;
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
    $('#tree-view').hidden = S.tab !== 'tree'; $('#plan-view').hidden = S.tab !== 'plan';
    renderTree(); renderPlan();
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
      const li = Math.max(0, ...choiceOpts(g).map(o => optL(o.code, new Set())));
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
  // "pick · GROUP  ⇄" on a course picked in a pick-N-of-M group; ⇄ opens that group's options (it does not unpin)
  const pickTag = (g, w, y) => tagRow('pick · ' + g.name, `data-group="${esc(g.key)}"`, 'Change pick for ' + g.name, w, y);
  function choiceSvg(g, p) {
    const opts = choiceOpts(g), shown = opts.length > MAXCHIPS + 1 ? opts.slice(0, MAXCHIPS) : opts, more = opts.length - shown.length;
    const top = 32;
    const chip = (i, inner, attrs) => { const x = 8 + (i % 2) * (CHIPW + 8), y = top + Math.floor(i / 2) * 24;
      return `<g class="cchip" ${attrs} transform="translate(${x},${y})" tabindex="0" role="button"><rect width="${CHIPW}" height="20" rx="10"/>${inner}</g>`; };
    const chips = shown.map((o, i) => chip(i, `<circle class="dot${o.ready ? ' ok' : ''}" cx="11" cy="10" r="4"/><text x="20" y="14">${esc(trunc(o.code, 15))}</text>${o.pinned ? `<path class="pinp" transform="translate(${CHIPW - 16},4) scale(.75)" d="${PIN_D}"/>` : ''}`,
      `data-act="${o.pinned ? 'unpin' : 'pin'}" data-key="${esc(g.key)}" data-code="${esc(o.code)}" aria-label="${esc((o.pinned ? 'Unpin ' : 'Pin ') + o.code + (o.ready ? ', prereqs met' : ', prereqs missing'))}"`)).join('') +
      (more ? chip(shown.length, `<text class="more" x="${CHIPW / 2}" y="14" text-anchor="middle">+${more} more</text>`, `data-group="${esc(g.key)}" aria-label="All ${opts.length} options"`) : '');
    return `<g class="cnode${S.detail === 'g:' + g.key ? ' sel' : ''}" data-group="${esc(g.key)}" transform="translate(${p.x},${p.y})" tabindex="0" role="button" aria-label="${esc(pickLabel(g) + ', ' + g.name)}">
      <title>${esc(pickLabel(g) + ' · ' + g.name)}</title><rect class="box" width="${CW}" height="${p.h}" rx="10"/>
      <text class="ch" x="10" y="20">${esc(trunc(pickLabel(g) + ' · ' + g.name, 34))}</text>
      ${chips}${takenPathOf(g.key) ? pathTag(takenPathOf(g.key).pc, CW, p.h) : ''}</g>`;
  }

  // path card (only while undecided): header "Pick 1 of 2 · TITLE", one row per path with a Pick button. With pick k > 1, a
  // path already taken lists its courses with their planned quarters and "change".
  const pathHeight = pc => 32 + pc.paths.length * PROW;
  function pathSvg(pc, pos, nm) {
    const btn = (y, attrs, label, w) => `<g class="pbtn" ${attrs} transform="translate(${PW - w - 12},${y})" tabindex="0" role="button"><rect width="${w}" height="18" rx="9"/><text x="${w / 2}" y="13" text-anchor="middle">${esc(label)}</text></g>`;
    const take = (p, y, label) => btn(y, `data-take="${esc(p.groupKey)}" data-pc="${esc(pc.key)}" aria-label="${esc(label + ': ' + pathLine(p))}"`, label, label.length * 6.5 + 18);
    const line = p => `${pathLine(p)} · ${p.units} u`;
    // chosen row, second line: "177A FA27 → 177B WI28"; a list path not pinned yet: its slot's quarter and a link to the list
    const quarters = p => {
      const q = c => `<tspan class="q">${esc((nm[c] || {}).planned || (nm[c] || {}).term || '')}</tspan>`;
      if ((p.chain || []).length) return `<text class="qs" x="30" y="Y">${chainText(p, c => esc(dept(c) ? c.slice(dept(c).length + 1) : c) + ' ' + q(c))}</text>`;
      const slot = S.model.nodes.find(n => n.groupKey === p.groupKey && !n.code.startsWith('PATH: '));
      const t = `<text class="qs${p.placeholder ? '' : ' plink'}" x="30" y="Y">${p.placeholder ? 'any course from the list' : 'pick the course ›'}${slot ? ' ' + q(slot.code) : ''}</text>`;
      return p.placeholder ? t : `<g class="qlink" data-group="${esc(p.groupKey)}" role="button" tabindex="0" aria-label="Pick the course">${t}</g>`;
    };
    let y = 32;
    const rows = pc.paths.map(p => {
      const on = pc.chosenPaths.includes(p.groupKey), y0 = y;
      y += PROW;
      const head = `<rect class="prow${on ? ' on' : ''}" x="8" y="${y0}" width="${PW - 16}" height="${PROW - 6}" rx="6"/>
        <circle class="dot${p.ready ? ' ok' : ''}" cx="20" cy="${y0 + 14}" r="4"><title>${esc(pathNeeds(p))}</title></circle>
        <text class="pt" x="30" y="${y0 + 18}">${esc(trunc(line(p), on ? 34 : 33))}</text>`;
      return head + (on ? quarters(p).replace('y="Y"', `y="${y0 + 34}"`) + btn(y0 + 4, `data-change="${esc(pc.key)}" aria-label="Change your pick"`, 'change', 56)
        : `<text class="csub" x="30" y="${y0 + 34}">${esc(pathNeeds(p))}</text>` + take(p, y0 + 11, 'Pick'));
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
      return `<g class="node s-${esc(n.status)}${S.detail === n.code ? ' sel' : ''}" data-node="${esc(n.code)}" transform="translate(${p.x},${p.y})" tabindex="0" role="button" aria-label="${esc(n.code + ', ' + (STATUS[n.status] || n.status) + (pinned ? ', pinned' : ''))}">
        <title>${esc(n.code + ' — ' + n.title)}</title><rect class="box" width="${NW}" height="${p.h}" rx="8"/>
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

  function renderPlan() {
    const nm = nodeMap();
    const chipFor = c => {
      const n = nm[c] || {};
      if (c.startsWith('CHOOSE: ')) return `<button class="pchip choose" ${n.pathChoiceKey ? `data-path="${esc(n.pathChoiceKey)}"` : isGE(n) ? `data-node="${esc(c)}"` : `data-group="${esc(n.groupKey)}"`} title="Decision pending: open the options"><b>choose: ${esc(n.title)}</b><small>${esc(n.units ?? '')} u</small></button>`;
      return `<button class="pchip s-${esc(n.status || '')}" data-node="${esc(c)}"><b>${esc(c)}</b><span>${esc(titleOf(c, nm))}</span><small>${esc(n.units ?? '')} u</small></button>`;
    };
    $('#plan').innerHTML = (S.model.plan || []).map(t => `<div class="term${t.beyondExpected ? ' late' : ''}">
      <div class="term-h"><b>${esc(t.term)}</b><span>${esc(t.units)} units</span></div>
      ${t.beyondExpected ? '<span class="tag-late">past expected graduation</span>' : ''}
      ${t.courses.map(chipFor).join('') || '<p class="muted small">No courses</p>'}
    </div>`).join('') || '<p class="muted pad">Nothing left to plan.</p>';
  }

  function groupDetail(g, nm) {
    const rows = choiceOpts(g).map(o => {
      const c = course(o.code) || {}, pre = preHtml(c.pre, nm);
      return `<div class="optd${o.pinned ? ' on' : ''}"><div class="optd-h">${o.pinned ? PIN : `<i class="dot${o.ready ? ' ok' : ''}" title="${o.ready ? 'prereqs met' : 'prereqs missing'}"></i>`}
        <b>${nm[o.code] ? `<a href="#" data-node="${esc(o.code)}">${esc(o.code)}</a>` : esc(o.code)}</b><span class="muted small">${esc(c.u ?? '?')} u</span>
        <button class="btn sm" data-act="${o.pinned ? 'unpin' : 'pin'}" data-key="${esc(g.key)}" data-code="${esc(o.code)}">${o.pinned ? 'Unpin' : 'Pick'}</button></div>
        <div class="small">${esc(c.t || 'Not in the course database')}</div>
        <div class="small muted">Offered: ${esc(offeredText(o.code))}</div>
        ${pre ? `<ul class="prelist small">${pre}</ul>` : `<div class="small muted">${c.t ? 'No prerequisites' : 'Prerequisites unknown'}</div>`}
        ${c.req ? `<div class="small muted">Catalog: ${esc(c.req)}</div>` : ''}
        ${o.why ? `<div class="small muted">${esc(o.why)}</div>` : ''}</div>`;
    }).join('');
    // open slots, or which pin a new pick replaces (pin() drops the oldest)
    const mine = S.opts.choices[g.key] || [], left = g.need - g.chosen.filter(c => !c.auto).length;
    const slots = !g.choice || g.undeclared ? '' : left > 0 ? `<p class="small"><b>${esc(left)} more to pick</b></p>`
      : `<p class="small"><b>${g.need === 1 ? 'Picked.' : `All ${esc(g.need)} picked.`}</b> Picking another option replaces ${esc(mine[0] || 'your oldest pick')}, your oldest pick.</p>`;
    return `<button class="close" data-close aria-label="Close">×</button>
      <h2>${esc(pickLabel(g))}</h2><p>${esc(g.name)}<br><small class="muted">${esc(g.section)}</small></p>${slots}
      ${takenPathOf(g.key) ? partOf(takenPathOf(g.key)) : ''}
      ${g.selected === false && pcOfGroup(g.key) ? `<p class="small">One path of ${esc(pcOfGroup(g.key).title)}. Pinning an option here takes this path. <a href="#" data-path="${esc(pcOfGroup(g.key).key)}">Compare paths</a></p>` : ''}
      <p class="small muted">Green dot: prerequisites done, in progress or pinned. Grey: something is still missing.</p>${rows}`;
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
      const list = p.choice ? `<p class="small">${p.placeholder ? 'Pick the course in the Requirements panel once you pick this path.' : `<a href="#" data-group="${esc(p.groupKey)}">See every option</a>`}</p>` : '';
      return `<div class="optd${on ? ' on' : ''}"><div class="optd-h"><i class="dot${p.ready ? ' ok' : ''}" title="${esc(pathNeeds(p))}"></i><b>${esc(pathLine(p))}</b><span class="muted small">${esc(p.units)} u</span>
        ${on ? `<button class="btn sm" data-change="${esc(pc.key)}">change</button>` : `<button class="btn sm" data-take="${esc(p.groupKey)}" data-pc="${esc(pc.key)}">${done ? 'switch' : 'Pick'}</button>`}</div>
        <div class="small muted">${esc(p.name)} · ${esc(pathNeeds(p))}</div>${list}${cs}</div>`;
    }).join('');
    return `<button class="close" data-close aria-label="Close">×</button>
      <h2>${esc(pickHead(pc))}</h2><p>${esc(pc.title)}<br><small class="muted">${esc(pc.section)}</small></p>
      <p class="small muted">Each option is taken as a whole: the plan schedules every course in the one you pick and none from the others. Green dot: prerequisites done, in progress or pinned.</p>${rows}`;
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
      ${n.pickedFor && groupByKey(n.pickedFor) ? `<p class="small">Picked for: ${esc(groupByKey(n.pickedFor).name)} <button class="btn sm" data-group="${esc(n.pickedFor)}">Change pick</button></p>` : ''}
      ${pinned ? `<p><button class="btn sm" data-act="unpin" data-key="${esc(g.key)}" data-code="${esc(n.code)}">Unpin</button></p>` : ''}
      <dl><dt>Status</dt><dd><i class="badge s-${esc(n.status)}">${esc(STATUS[n.status] || n.status)}</i></dd>
      <dt>Units</dt><dd>${esc(n.units)}</dd>
      ${n.term ? `<dt>Taken</dt><dd>${esc(n.term)}</dd>` : ''}${n.planned ? `<dt>Planned</dt><dd>${esc(n.planned)}</dd>` : ''}
      <dt>Offered</dt><dd>${esc(off)}</dd>
      ${g ? `<dt>Satisfies</dt><dd>${esc(g.name)}<br><small class="muted">${esc(g.section)}</small></dd>` : ''}</dl>
      ${g && !g.placeholder && (g.choice || (g.altGroupKeys || []).length) ? `<p><a href="#" data-group="${esc(g.key)}">All options for this requirement</a></p>` : ''}
      <h3>Prerequisites</h3>${pre ? `<ul class="prelist">${pre}</ul>` : '<p class="muted">None</p>'}
      ${n.pathPrereq ? '<p class="muted small">Only an option you have not picked yet needs this, so it is not in the plan.</p>' : ''}
      ${n.status === 'placeholder' ? '<p class="muted small">Pick a specific course for this slot in the requirements panel.</p>' : ''}
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
    const g = groupByKey(key); if (!g) return;
    const a = (S.opts.choices[key] || []).filter(c => c !== code); a.push(code);
    while (a.length > Math.max(1, g.need || 1)) a.shift();
    // a course counts for one pick only: drop it from every other group's pins
    for (const k of Object.keys(S.opts.choices)) if (k !== key && !k.startsWith('path:')) {
      const r = S.opts.choices[k].filter(c => c !== code);
      if (r.length) S.opts.choices[k] = r; else delete S.opts.choices[k];
    }
    S.opts.choices[key] = a;
    // pinning inside a path that is not taken takes that path
    const pc = g.selected === false && pcOfGroup(key);
    if (pc) return takePath(pc.key, key);
    commit();
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
    const t = e.target.closest('[data-act],[data-node],[data-group],[data-path],[data-take],[data-change],[data-tab],[data-zoom],[data-sample],[data-close],[data-diag]');
    if (!t) return;
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
    if (act === 'pin') pin(key, code);
    else if (act === 'unpin') unpin(key, code);
    else if (t.dataset.group) { e.preventDefault(); openDetail('g:' + t.dataset.group); }
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && S.detail) { S.detail = null; renderDetail(); }
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches && e.target.matches('.node,.cnode,.cchip,.pnode,.pbtn,.qlink')) { e.preventDefault(); e.target.dispatchEvent(new MouseEvent('click', { bubbles: true })); }
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
