// Degree-plan model: parsed DARS -> requirement choices, prerequisite graph and a quarter-by-quarter plan.
// Contract: INTERFACE.md. Depends on COURSES/ALIAS (courses.js) and DARS (parser.js).
(function (g) {
  const env = typeof module !== 'undefined' ? Object.assign({}, require('./courses.js'), require('./parser.js')) : g;
  const { COURSES, ALIAS, DARS } = env;
  const EW = /ETHICS|WRITING/;
  const numOf = n => parseInt(String(n).replace(/^\D+/, ''), 10);
  const plural = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');

  function build(parsed, opts = {}) {
    const per = opts.perQuarter || 4, choices = opts.choices || {}, warnings = [];
    // done/ip, with aliases (MATH T03 -> MATH 31B)
    const taken = Object.assign({}, parsed.taken);
    for (const [c, t] of Object.entries(parsed.taken)) if (ALIAS[c] && !taken[ALIAS[c]]) taken[ALIAS[c]] = Object.assign({}, t, { via: c });
    const chosenBy = new Map(); // code -> groupKey that plans it
    const met = c => !!taken[c] || chosenBy.has(c);

    // count checks: compare against the itemized groups of the section right before
    parsed.sections.forEach((s, i) => s.groups.forEach(gr => {
      if (gr.options.length || !i) return;
      const m = parsed.sections[i - 1].groups.reduce((n, x) => n + (x.options.length ? x.needCourses : 0), 0);
      if (gr.needCourses > m) warnings.push(`The audit's course-count check "${gr.name}" wants ${gr.needCourses} more courses, but the itemized requirements only add up to ${m}. Ask your counselor which extra course counts.`);
    }));

    // groups in document order, options expanded up front
    const groups = [], bySection = [];
    for (const s of parsed.sections) {
      const sec = [];
      s.groups.forEach((gr, i) => {
        if (!gr.options.length) return;
        const slots = [], unknown = [], all = [];
        for (const o of gr.options) {
          const codes = o.to ? Object.keys(COURSES).filter(k => { const sc = DARS.splitCode(k); return sc.dept === o.dept && numOf(sc.num) >= numOf(o.num) && numOf(sc.num) <= numOf(o.to); }) : o.alts;
          all.push(...codes);
          unknown.push(...codes.filter(c => !COURSES[c]));
          const known = codes.filter(c => COURSES[c]);
          if (o.to) known.forEach(c => slots.push([c])); else if (known.length) slots.push(known);
        }
        const options = [...new Set(all)];
        const out = { key: s.title + '|' + gr.name + '|' + i, section: s.title, name: gr.name, need: gr.needCourses, taken: gr.taken,
          chosen: [], alternatives: [], placeholder: !slots.length, optionCount: options.length, options, selected: true, altGroupKeys: [],
          _slots: slots, _unknown: [...new Set(unknown)], _notFrom: gr.notFrom, _ew: EW.test(s.title), _writing: /WRITING/.test(s.title),
          _slotUnits: gr.needUnits && gr.needCourses ? gr.needUnits / gr.needCourses : 4 };
        sec.push(out); groups.push(out);
      });
      if (sec.length) bySection.push({ s, sec });
    }
    const writingGroups = groups.filter(x => x._writing);
    const writingOpen = () => writingGroups.some(w => !w.options.some(c => chosenBy.has(c)));

    // unmet transitive prereqs; OR-groups take the cheapest alternative
    function unmet(code) {
      const out = new Set(), c = COURSES[code];
      if (!c) return out;
      for (const grp of c.pre) {
        if (grp.some(met)) continue;
        let best = null;
        for (const a of grp) { const s = unmet(a); s.add(a); s.cost = s.size + (COURSES[a] && COURSES[a].off === '' ? 0.5 : 0); if (!best || s.cost < best.cost) best = s; }
        best.forEach(x => out.add(x));
      }
      return out;
    }
    const nameOf = key => groups.find(x => x.key === key).name.toLowerCase();
    function score(code, gr) {
      const c = COURSES[code], why = [], u = [...unmet(code)];
      let s = 0;
      if (u.length) { s += u.length; why.push(`needs ${plural(u.length, 'prereq')} not yet planned (${u.join(', ')})`); }
      else why.push(c.pre.length ? 'all prereqs done or planned' : c.note ? c.note.replace(/\.$/, '') : 'no prereqs');
      if (c.off === '') { s += 100; why.push('not offered 2025-27'); }
      if (gr._ew && chosenBy.has(code)) { s -= 50; why.push(`already in the plan for ${nameOf(chosenBy.get(code))}, so it counts twice`); }
      if (gr._ew && c.w2 && writingOpen()) { s -= 3; why.push('also satisfies Engineering Writing'); }
      if (c.rec) { s -= 0.1 * c.rec; why.push('strong aerospace relevance'); }
      s += 0.01 * c.u;
      const w = why.join('; ');
      return { code, s, why: w[0].toUpperCase() + w.slice(1) + '.' };
    }

    function choose(gr) {
      const pins = (choices[gr.key] || []).filter(c => gr.options.includes(c));
      const chosen = pins.map(c => { const sc = COURSES[c] && !gr.placeholder ? score(c, gr) : { s: 0, why: '' }; return { code: c, auto: false, why: ('Pinned by you. ' + sc.why).trim(), s: sc.s }; });
      let alts = [];
      if (gr.placeholder) {
        const n = Math.max(0, gr.need - pins.length);
        for (let i = 1; i <= n; i++) chosen.push({ code: 'GE: ' + gr.name + (n > 1 ? ' #' + i : ''), auto: true, why: 'Pick any approved course from this list; the plan holds a slot for it.', s: 0 });
      } else {
        const ok = c => !gr._notFrom.includes(c) && !taken[c] && (gr._ew || !chosenBy.has(c));
        const slots = gr._slots.filter(sl => !sl.some(c => pins.includes(c))).map(sl => sl.filter(ok).map(c => score(c, gr)).sort((a, b) => a.s - b.s)).filter(sl => sl.length).sort((a, b) => a[0].s - b[0].s);
        const k = Math.max(0, gr.need - pins.length);
        slots.slice(0, k).forEach(sl => chosen.push({ code: sl[0].code, auto: true, why: sl[0].why, s: sl[0].s }));
        alts = slots.slice(0, k).flatMap(sl => sl.slice(1)).concat(slots.slice(k).flat()).sort((a, b) => a.s - b.s)
          .concat(gr._unknown.filter(c => !pins.includes(c)).map(c => ({ code: c, why: 'not in course database' })));
      }
      gr.chosen = chosen.map(({ code, auto, why }) => ({ code, auto, why }));
      gr.alternatives = alts.map(({ code, why }) => ({ code, why }));
      // pinned groups win subgroup picks
      gr._total = chosen.reduce((t, c) => t + c.s, 0) - 1000 * pins.length;
      for (const c of gr.chosen) if (!chosenBy.has(c.code)) chosenBy.set(c.code, gr.key);
    }
    function pick(set, k) {
      if (k >= set.length) return;
      const keep = [...set].sort((a, b) => a._total - b._total).slice(0, k);
      for (const x of set) {
        x.selected = keep.includes(x);
        x.altGroupKeys = set.filter(y => y !== x).map(y => y.key);
        if (!x.selected) for (const [c, key] of chosenBy) if (key === x.key) chosenBy.delete(c);
      }
    }
    // ethics/writing last so the writing course chosen elsewhere (157W) is known
    for (const { s, sec } of bySection.filter(b => !EW.test(b.s.title)).concat(bySection.filter(b => EW.test(b.s.title)))) {
      sec.forEach(choose);
      if (s.needSubgroups) pick(sec, s.needSubgroups);
      else for (const name of new Set(sec.map(x => x.name))) { const same = sec.filter(x => x.name === name); if (same.length > 1) pick(same, 1); }
    }

    // nodes: taken + chosen + transitive prereqs
    const nodes = new Map();
    const add = (code, extra) => {
      if (nodes.has(code)) return;
      const c = COURSES[code], t = taken[code];
      nodes.set(code, Object.assign({ code, title: c ? c.t : t ? t.title : code, units: c ? c.u : t ? t.units : 4, offered: c ? c.off : '?', prereqs: c ? c.pre : [] }, c && c.note ? { note: c.note } : {}, extra));
    };
    for (const [code, t] of Object.entries(taken)) if (!ALIAS[code]) add(code, { status: t.grade === 'IP' ? 'ip' : 'done', term: t.term });
    for (const gr of groups) if (gr.selected) for (const c of gr.chosen) {
      if (c.code.startsWith('GE: ')) add(c.code, { title: gr.name, units: gr._slotUnits, offered: 'FWS', status: 'placeholder', groupKey: gr.key });
      else add(c.code, { groupKey: chosenBy.get(c.code) || gr.key });
    }
    const stack = [...nodes.keys()].filter(c => !taken[c]);
    while (stack.length) for (const grp of nodes.get(stack.pop()).prereqs) {
      const m = grp.find(x => nodes.has(x)) || grp[0];
      if (!nodes.has(m)) { add(m, {}); stack.push(m); }
    }
    for (const n of nodes.values()) if (!n.status) n.status = n.prereqs.every(grp => grp.some(x => taken[x])) ? 'ready' : 'locked';
    const edges = [];
    for (const n of nodes.values()) for (const grp of n.prereqs) for (const p of grp) if (nodes.has(p)) edges.push({ from: p, to: n.code });

    // plan
    const todo = [...nodes.values()].filter(n => !taken[n.code]);
    let real = todo.filter(n => n.status !== 'placeholder');
    const slots = todo.filter(n => n.status === 'placeholder');
    for (const n of real) if (n.offered === '') warnings.push(`${n.code} is not offered in 2025-27, so the plan can't schedule it.`);
    for (let changed = true; changed;) { // drop courses that can never be scheduled, and whatever depends on them
      changed = false;
      const keep = real.filter(n => n.offered !== '' && n.prereqs.every(grp => grp.some(x => taken[x] || real.some(r => r.code === x))));
      if (keep.length < real.length) { real.filter(n => !keep.includes(n) && n.offered !== '').forEach(n => warnings.push(`${n.code} can't be scheduled because a prerequisite is never offered.`)); real = keep; changed = true; }
    }
    const deps = c => real.filter(n => n.prereqs.some(grp => grp.includes(c)));
    const hMemo = new Map(), height = c => hMemo.get(c) ?? (hMemo.set(c, 1 + Math.max(0, ...deps(c).map(d => height(d.code)))), hMemo.get(c));
    const prio = (a, b) => height(b.code) - height(a.code) || deps(b.code).length - deps(a.code).length || b.units - a.units;
    const have = new Set(Object.keys(taken)), plan = [], exp = DARS.termIndex(parsed.student.expected);
    let t = DARS.termIndex(parsed.currentTerm), quarters = 0;
    while ((real.length || slots.length) && quarters < 16) {
      const term = DARS.termName(++t);
      if (term.startsWith('SU') && !opts.useSummer) continue;
      quarters++;
      const q = { FA: 'F', WI: 'W', SP: 'S', SU: 'U' }[term.slice(0, 2)];
      const picks = real.filter(n => (n.offered === '?' || n.offered.includes(q)) && n.prereqs.every(grp => grp.some(x => have.has(x)))).sort(prio).slice(0, per);
      picks.push(...slots.splice(0, per - picks.length));
      if (!picks.length) continue;
      real = real.filter(n => !picks.includes(n));
      picks.forEach(n => { n.planned = term; have.add(n.code); });
      plan.push({ term, courses: picks.map(n => n.code), units: picks.reduce((u, n) => u + n.units, 0), beyondExpected: t > exp });
    }
    if (real.length || slots.length) warnings.push(`Stopped planning after 16 quarters; still unscheduled: ${real.concat(slots).map(n => n.code).join(', ')}.`);

    for (const gr of groups) for (const k of Object.keys(gr)) if (k[0] === '_') delete gr[k];
    const plannedUnits = plan.reduce((u, p) => u + p.units, 0);
    return {
      currentTerm: parsed.currentTerm, expectedTerm: parsed.student.expected, warnings, groups,
      nodes: [...nodes.values()], edges, plan,
      stats: { unitsEarned: Object.values(parsed.taken).filter(x => x.grade !== 'IP' && !x.via).reduce((u, x) => u + x.units, 0),
        unitsNeeded: parsed.unitsNeeded, plannedUnits, coursesRemaining: plan.reduce((n, p) => n + p.courses.length, 0) },
    };
  }
  g.MODEL = { build };
})(typeof module !== 'undefined' ? module.exports : window);
