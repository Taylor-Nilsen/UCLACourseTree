// TEST ONLY: crude stand-in for model.js that follows INTERFACE.md so ui.js can be exercised. Never loaded by index.html.
(function (g) {
  function build(parsed, opts) {
    const C = g.COURSES, A = g.ALIAS || {}, D = g.DARS, choices = opts.choices || {}, pq = opts.perQuarter || 4;
    const taken = {}; for (const [c, t] of Object.entries(parsed.taken)) { taken[c] = t; if (A[c]) taken[A[c]] = t; }
    const has = c => taken[c] && taken[c].grade !== 'IP' ? 'done' : taken[c] ? 'ip' : null;
    const warnings = [], groups = [], used = new Set();
    parsed.sections.forEach(s => {
      const sec = [];
      s.groups.forEach((gr, i) => {
        const key = s.title + '|' + gr.name + '|' + i;
        if (!gr.options.length) { warnings.push(gr.name + ': still needs ' + gr.needCourses + ' course(s) (count check)'); return; }
        const options = [];
        for (const o of gr.options) {
          if (o.to) { const lo = parseInt(o.num), hi = parseInt(o.to); for (const c of Object.keys(C)) if (c.startsWith(o.dept + ' ') && parseInt(c.slice(o.dept.length + 1).replace(/^\D+/, '')) >= lo && parseInt(c.slice(o.dept.length + 1).replace(/^\D+/, '')) <= hi) options.push(c); }
          else options.push(o.alts.find(a => C[a] && C[a].off) || o.alts[0]);
        }
        const placeholder = !options.some(c => C[c]), need = gr.needCourses;
        const pins = (choices[key] || []).filter(c => options.includes(c));
        const avail = options.filter(c => !has(c) && !pins.includes(c) && !used.has(c) && (placeholder || C[c]))
          .sort((a, b) => ((C[b] || {}).rec || 0) - ((C[a] || {}).rec || 0));
        const chosen = pins.map(code => ({ code, auto: false, why: 'pinned by you' }));
        if (!placeholder) while (chosen.length < need && avail.length) { const code = avail.shift(); chosen.push({ code, auto: true, why: (C[code].rec ? 'aero relevance ' + C[code].rec : 'required / earliest available') }); }
        chosen.forEach(c => used.add(c.code));
        const grp = { key, section: s.title, name: gr.name, need, taken: gr.taken, chosen, alternatives: avail.map(code => ({ code, why: C[code] ? 'offered ' + (C[code].off || 'not offered') : 'GE option' })),
          placeholder, optionCount: options.length, options, selected: true, altGroupKeys: [] };
        sec.push(grp); groups.push(grp);
      });
      // pick-k-of-subgroups and same-name alternatives
      const sets = s.needSubgroups ? [sec] : Object.values(sec.reduce((m, x) => ((m[x.name] = m[x.name] || []).push(x), m), {})).filter(a => a.length > 1);
      for (const set of sets) {
        const k = s.needSubgroups || 1; const order = set.slice().sort((a, b) => ((choices[b.key] || []).length > 0) - ((choices[a.key] || []).length > 0));
        order.forEach((x, j) => { x.selected = j < k; x.altGroupKeys = set.filter(y => y !== x).map(y => y.key); });
      }
    });
    const nodes = {}, add = (code, extra) => { if (nodes[code]) return nodes[code]; const c = C[code] || {}; return nodes[code] = Object.assign({ code, title: c.t || (taken[code] || {}).title || code, units: c.u || (taken[code] || {}).units || 4, offered: c.off || '', note: c.note, prereqs: c.pre || [] }, extra); };
    for (const grp of groups) if (grp.selected) {
      if (grp.placeholder) add('GE: ' + grp.name, { status: 'placeholder', groupKey: grp.key, title: grp.name, units: 4, offered: 'FWS', prereqs: [] });
      else for (const c of grp.chosen) add(c.code, { groupKey: grp.key });
    }
    // pull in prereqs transitively (taken ones become done/ip nodes)
    for (let changed = true; changed;) { changed = false; for (const n of Object.values(nodes)) for (const og of n.prereqs) for (const p of og) if (!nodes[p] && C[p] && (has(p) || og.length === 1)) { add(p, {}); changed = true; } }
    for (const n of Object.values(nodes)) { const h = has(n.code); if (h) { n.status = h; n.term = taken[n.code].term; } }
    const st = c => nodes[c] && nodes[c].status, ok = c => ['done', 'ip'].includes(st(c)) || ['done', 'ip'].includes(has(c));
    for (const n of Object.values(nodes)) if (!n.status) n.status = n.prereqs.every(og => og.some(ok)) ? 'ready' : 'locked';
    const edges = []; for (const n of Object.values(nodes)) for (const og of n.prereqs) for (const p of og) if (nodes[p]) edges.push({ from: p, to: n.code });
    // greedy plan
    const todo = Object.values(nodes).filter(n => !['done', 'ip'].includes(n.status)), plan = [], doneSet = new Set(Object.values(nodes).filter(n => n.term).map(n => n.code));
    Object.keys(taken).forEach(c => doneSet.add(c));
    let t = D.termIndex(parsed.currentTerm); const exp = D.termIndex(parsed.student.expected);
    while (todo.length && plan.length < 20) {
      t++; if (t % 4 === 3 && !opts.useSummer) continue;
      const term = D.termName(t), q = 'FWS'[t % 4], pick = [];
      for (const n of todo.slice()) { if (pick.length >= pq) break; if ((n.offered && !n.offered.includes(q)) || (!n.offered && n.status !== 'placeholder')) continue; if (!n.prereqs.every(og => og.some(p => doneSet.has(p)))) continue; pick.push(n); todo.splice(todo.indexOf(n), 1); n.planned = term; }
      pick.forEach(n => doneSet.add(n.code));
      plan.push({ term, courses: pick.map(n => n.code), units: pick.reduce((s, n) => s + n.units, 0), beyondExpected: t > exp });
    }
    todo.forEach(n => warnings.push(n.code + ' could not be scheduled (not offered)'));
    const plannedUnits = plan.reduce((s, p) => s + p.units, 0), unitsEarned = Object.values(parsed.taken).filter(x => x.grade !== 'IP').reduce((s, x) => s + x.units, 0);
    return { currentTerm: parsed.currentTerm, expectedTerm: parsed.student.expected, warnings, groups, nodes: Object.values(nodes), edges, plan,
      stats: { unitsEarned, unitsNeeded: parsed.unitsNeeded, plannedUnits, coursesRemaining: plan.reduce((s, p) => s + p.courses.length, 0) } };
  }
  g.MODEL = { build };
})(window);
