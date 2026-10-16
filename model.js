// Degree-plan model: parsed DARS -> requirement choices, prerequisite graph and a quarter-by-quarter plan.
// Contract: INTERFACE.md. Depends on COURSES/ALIAS (courses.js) and DARS (parser.js).
(function (g) {
  const env = typeof module !== 'undefined' ? Object.assign({}, require('./courses.js'), require('./parser.js')) : g;
  const { COURSES, ALIAS, DARS } = env;
  const EW = /ETHICS|WRITING/;
  // GE-style lists (hundreds of options) stay as searchable slots in their own area instead of choice nodes
  const BIGLIST = /FOUNDATIONS OF|GENERAL EDUCATION|\bGE\b|DIVERSITY|WRITING II|ENGINEERING WRITING|QUANTITATIVE REASONING|FOREIGN LANGUAGE|LANGUAGE REQUIREMENT/;
  const numOf = n => parseInt(String(n).replace(/^\D+/, ''), 10);
  const plural = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');

  // ranges and wildcards ("PSYCH 110 TO 199", "PSYCH 1@@" = 100-199, "SPAN @" = any) expand against COURSES
  let table = null;
  function expand(o) {
    table = table || Object.keys(COURSES).map(k => [k, DARS.splitCode(k)]).filter(x => x[1]);
    const w = o.wildcard && o.wildcard.replace(/[^@\d]/g, ''), re = w && (/^@*$/.test(w) ? /./ : new RegExp('^' + w.replace(/@/g, '\\d') + '$'));
    return table.filter(([, sc]) => sc.dept === o.dept && (re ? re.test(String(numOf(sc.num))) : numOf(sc.num) >= numOf(o.num) && numOf(sc.num) <= numOf(o.to))).map(x => x[0]);
  }

  function build(parsed, opts = {}) {
    const per = opts.perQuarter || 4, choices = opts.choices || {}, warnings = [];
    // done/ip only (failed, withdrawn, incomplete attempts do not count), with aliases (MATH T03 -> MATH 31B)
    const st = t => t.status || (t.grade === 'IP' ? 'ip' : 'done');
    const taken = {};
    for (const [c, t] of Object.entries(parsed.taken)) if (['done', 'ip'].includes(st(t))) taken[c] = t;
    for (const [c, t] of Object.entries(taken)) if (ALIAS[c] && !taken[ALIAS[c]]) taken[ALIAS[c]] = Object.assign({}, t, { via: c });
    const chosenBy = new Map(); // code -> groupKey that plans it

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
        if (!gr.options.length && !gr.undeclared) return;
        const slots = [], all = [];
        for (const o of gr.options) {
          const codes = o.to || o.wildcard ? expand(o) : o.alts;
          all.push(...codes);
          if (o.to || o.wildcard) codes.forEach(c => slots.push([c])); else if (codes.length) slots.push(codes);
        }
        const notFrom = new Set(gr.notFrom.concat(...(gr.notFromRanges || []).map(expand)));
        const options = [...new Set(all)].filter(c => !notFrom.has(c)); // NOT FROM courses are never offered
        const out = { key: s.title + '|' + gr.name + '|' + i, section: s.title, name: gr.name, need: gr.needCourses, taken: gr.taken,
          chosen: [], alternatives: [], placeholder: !gr.undeclared && (BIGLIST.test(s.title) || options.length > 60 || !all.some(c => COURSES[c])), choice: false, undeclared: !!gr.undeclared, undecided: false, optionCount: options.length, options, selected: true, altGroupKeys: [],
          _slots: slots, _notFrom: [...notFrom], _orPrev: !!gr.orPrev, _ew: EW.test(s.title), _writing: /WRITING/.test(s.title),
          _slotUnits: gr.needUnits && gr.needCourses ? gr.needUnits / gr.needCourses : 4 };
        sec.push(out); groups.push(out);
      });
      if (sec.length) bySection.push({ s, sec });
    }
    const writingGroups = groups.filter(x => x._writing);
    const writingOpen = () => writingGroups.some(w => !w.chosen.length && !(choices[w.key] || []).length);
    // "ready" = every prereq is done, in progress or pinned (not merely planned)
    const pinned = new Set(Object.values(choices).flat());
    const met = c => !!taken[c] || pinned.has(c);

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
    const cmpCode = (a, b) => { const x = DARS.splitCode(a) || { dept: a, num: '' }, y = DARS.splitCode(b) || { dept: b, num: '' }; return x.dept.localeCompare(y.dept) || (numOf(x.num) || 0) - (numOf(y.num) || 0) || a.localeCompare(b); };
    // overlap info only (ethics/writing double counting); never used to choose
    function extras(code, gr) {
      const c = COURSES[code], by = chosenBy.get(code), w = [];
      if (gr._ew && by && by !== gr.key) w.push(`already planned for ${nameOf(by)}, counts for both`);
      else if (c && c.w2 && !gr._writing) w.push(gr._ew && !gr._writing && writingOpen() ? 'also satisfies Engineering Writing' : 'writing credit');
      return w;
    }
    function facts(code, gr) {
      const c = COURSES[code];
      if (!c) return { code, ready: false, unmet: 0, why: ['not in course database'].concat(extras(code, gr)).join('; '), _k: 1 };
      const u = [...unmet(code)];
      return { code, ready: !u.length, unmet: u.length, _k: 0,
        why: [u.length ? `needs ${plural(u.length, 'prereq')}: ${u.join(', ')}` : c.pre.length ? 'prereqs met' : 'no prereqs'].concat(extras(code, gr)).join('; ') };
    }
    const byReadiness = (a, b) => b.ready - a.ready || a._k - b._k || a.unmet - b.unmet || cmpCode(a.code, b.code);

    function choose(gr) {
      const pins = (choices[gr.key] || []).filter(c => gr.options.includes(c));
      gr.chosen = pins.map(c => ({ code: c, auto: false, why: gr.placeholder ? 'pinned by you' : 'pinned by you; ' + facts(c, gr).why }));
      const k = Math.max(0, gr.need - pins.length);
      if (gr.undeclared) { // TBA not declared yet: nothing to list, but the plan must still hold the courses
        gr.choice = true; gr._open = k;
        warnings.push(`${gr.section}: no technical breadth area is declared, so the plan holds ${plural(k, 'open slot')}. Declare one at my.engineering.ucla.edu and re-export the audit.`);
        return;
      }
      // ethics/writing: a course already required elsewhere that is on this list satisfies it outright (e.g. 157W for Writing II)
      const already = gr._ew ? gr.options.filter(c => chosenBy.has(c) && chosenBy.get(c) !== gr.key && !pins.includes(c)).slice(0, k) : [];
      if (already.length && already.length >= k) {
        for (const c of already) gr.chosen.push({ code: c, auto: true, why: `already required for ${nameOf(chosenBy.get(c))}; it is on this list, so it counts here too` });
        gr.placeholder = false;
      } else if (gr.placeholder) {
        for (let i = 1; i <= k; i++) gr.chosen.push({ code: 'GE: ' + gr.name + (k > 1 ? ' #' + i : ''), auto: true, why: 'Pick any approved course from this list; the plan holds a slot for it.' });
      } else {
        // viable = not excluded, not already used (ethics/writing may double count), not known to be never offered
        const ok = c => !gr._notFrom.includes(c) && !taken[c] && (gr._ew || !chosenBy.has(c));
        const never = c => COURSES[c] && COURSES[c].off === '';
        const slots = gr._slots.filter(sl => !sl.some(c => pins.includes(c)))
          .map(sl => ({ v: sl.filter(c => ok(c) && !never(c)), off: sl.filter(c => ok(c) && never(c)) })).filter(sl => sl.v.length);
        // ethics/writing: a course already required elsewhere that is on this list satisfies it outright (e.g. 157W for Writing II)
        const overlap = gr._ew ? slots.map(sl => sl.v.find(c => chosenBy.has(c) && chosenBy.get(c) !== gr.key)).filter(Boolean) : [];
        if (overlap.length && overlap.length >= k) {
          for (const c of overlap.slice(0, k)) gr.chosen.push({ code: c, auto: true, why: `already required for ${nameOf(chosenBy.get(c))}; it is on this list, so it counts here too` });
        } else if (slots.length > k) { // the owner decides: only pins are chosen, every viable option is listed
          gr.choice = true;
          gr.alternatives = slots.flatMap(sl => sl.v).map(c => facts(c, gr)).sort(byReadiness).map(({ code, ready, unmet, why }) => ({ code, ready, unmet, why }));
          gr._open = k;
        } else {
          if (slots.length < k) warnings.push(`${gr.name}: audit lists fewer options than it needs (${pins.length + slots.length} of ${gr.need}).`);
          const n = pins.length + slots.length;
          for (const sl of slots) {
            if (sl.v.length === 1) {
              gr.chosen.push({ code: sl.v[0], auto: true, why: [`required: ${n} of ${n}`].concat(sl.off.length ? [sl.off.join(', ') + ' never offered'] : [], extras(sl.v[0], gr)).join('; ') });
              continue;
            }
            // "157 OR 157W" with both offered: that slot is its own pick-1 choice
            const sub = Object.assign({}, gr, { key: gr.key + '|' + sl.v.join(' OR '), name: sl.v.join(' OR '), need: 1, taken: [], options: sl.v, optionCount: sl.v.length,
              _slots: sl.v.map(c => [c]), _notFrom: [], _slotUnits: COURSES[sl.v[0]].u, _parent: gr });
            groups.splice(groups.indexOf(gr) + 1, 0, sub);
            choose(sub);
          }
        }
      }
      for (const c of gr.chosen) if (!chosenBy.has(c.code)) chosenBy.set(c.code, gr.key);
    }
    const groupUnits = x => x.placeholder || x.choice ? x._slotUnits * x.need : x.chosen.reduce((u, c) => u + ((COURSES[c.code] || {}).u || 4), 0);
    const altSlots = [], pathChoices = []; // one path choice per alternative set; CHOOSE slot per missing pick
    const dept = c => (DARS.splitCode(c) || {}).dept;
    const joinCodes = cs => cs.map((c, i) => i && dept(c) && dept(c) === dept(cs[i - 1]) ? c.slice(dept(c).length + 1) : c).join(' + ');
    function resolve(set, k, sTitle) {
      const key = set[0].key, keys = set.map(x => x.key);
      // explicit path pick first, then groups the user pinned a course in
      const want = (choices['path:' + key] || []).filter(gk => keys.includes(gk));
      const pinnedIn = set.filter(x => (choices[x.key] || []).some(c => x.options.includes(c))).map(x => x.key);
      const pickedKeys = [...new Set(want.concat(pinnedIn))].slice(0, k), pickedSet = set.filter(x => pickedKeys.includes(x.key));
      for (const x of set) {
        x.selected = pickedSet.includes(x);
        x.altGroupKeys = set.filter(y => y !== x).map(y => y.key);
        x.undecided = !x.selected && pickedSet.length < k;
        if (!x.selected) for (const [c, key] of chosenBy) if (key === x.key) chosenBy.delete(c);
      }
      // title: common leading words of the path names (>= 2 words), else the section title
      const words = set.map(x => x.name.split(' '));
      let n = 0; while (n < words[0].length && words.every(w => w[n] === words[0][n])) n++;
      const title = n >= 2 ? words[0].slice(0, n).join(' ') : sTitle;
      const paths = set.map(x => {
        const choice = x.choice || x.placeholder, courses = x.chosen.filter(c => !choice || !c.auto).map(c => c.code);
        // a choice path not yet pinned is judged by its best option
        // otherwise: distinct missing prereqs outside the path (177B needing 177A of the same path is not a gap)
        const miss = new Set(courses.flatMap(c => [...unmet(c)]).filter(c => !courses.includes(c)));
        const um = x.placeholder ? 0 : choice && !courses.length ? Math.min(...x.alternatives.map(a => a.unmet).concat(x.alternatives.length ? [] : [0])) : miss.size;
        const rest = x.name.split(' ').slice(n).join(' ') || x.name.split(' ').pop();
        return { groupKey: x.key, name: x.name, courses, units: groupUnits(x), choice, need: x.need, placeholder: x.placeholder,
          ready: !um, unmet: um,
          summary: choice ? `pick ${x.need} of ${x.placeholder ? x.optionCount : x.chosen.length + x.alternatives.length} from ${rest} list` : joinCodes(courses) };
      });
      pathChoices.push({ key, section: sTitle, title, pick: k, paths, chosenPaths: pickedSet.map(x => x.key) });
      const rest = set.filter(x => !x.selected), units = Math.min(...rest.map(groupUnits));
      const what = paths.filter(p => !pickedKeys.includes(p.groupKey)).map(p => p.summary).join(' or ');
      for (let i = pickedSet.length; i < k; i++) {
        const name = title + (k - pickedSet.length > 1 ? ' #' + (i - pickedSet.length + 1) : '') + ': ' + what;
        altSlots.push({ code: 'CHOOSE: ' + name, units, groupKey: rest[0].key, title: name, pathChoiceKey: key });
      }
    }
    // ethics/writing last so overlap info (157W in the core) is known
    for (const { s, sec } of bySection.filter(b => !EW.test(b.s.title)).concat(bySection.filter(b => EW.test(b.s.title)))) {
      sec.forEach(choose);
      if (s.needSubgroups) { if (sec.length > s.needSubgroups) resolve(sec, s.needSubgroups, s.title); continue; }
      // same-name groups, and groups the audit printed "OR)" before, are alternatives (pick 1)
      const id = sec.map((x, i) => i);
      sec.forEach((x, i) => { id[i] = x._orPrev && i ? id[i - 1] : id[sec.findIndex(y => y.name === x.name)]; });
      for (const r of new Set(id)) { const set = sec.filter((x, i) => id[i] === r); if (set.length > 1) resolve(set, 1, s.title); }
    }
    for (const gr of groups) if (gr._parent) gr.selected = gr._parent.selected;
    for (const gr of groups) if (gr.choice && gr.selected && gr._open) gr.undecided = true;

    // nodes: taken + chosen + transitive prereqs
    const nodes = new Map();
    const add = (code, extra) => {
      if (nodes.has(code)) return;
      const c = COURSES[code], t = taken[code];
      nodes.set(code, Object.assign({ code, title: c ? c.t : t ? t.title : code, units: c ? c.u : t ? t.units : 4, offered: c ? c.off : '?', prereqs: c ? c.pre : [] }, c && c.note ? { note: c.note } : {}, c && c.req && !c.pre.length ? { req: c.req } : {}, extra));
    };
    const viaSrc = new Set(Object.values(taken).map(t => t.via).filter(Boolean));
    for (const [code, t] of Object.entries(taken)) if (!ALIAS[code] && !viaSrc.has(code) && !(t.via && !COURSES[code])) add(code, { status: st(t), term: t.term });
    for (const gr of groups) if (gr.selected) for (const c of gr.chosen) {
      if (c.code.startsWith('GE: ')) add(c.code, { title: gr.name, units: gr._slotUnits, offered: 'FWS', status: 'placeholder', groupKey: gr.key });
      else add(c.code, { groupKey: chosenBy.get(c.code) || gr.key });
    }
    // pending decisions hold their units in the plan; scheduled like GE slots
    const slot = (code, title, units, groupKey, extra) => { let c = code, i = 2; while (nodes.has(c)) c = code + ' (' + i++ + ')'; add(c, Object.assign({ title, units, offered: 'FWS', status: 'placeholder', groupKey, prereqs: [] }, extra)); };
    for (const gr of groups) if (gr.undecided && gr.selected) for (let i = 1; i <= gr._open; i++) slot('CHOOSE: ' + gr.name + (gr._open > 1 ? ' #' + i : ''), gr.name, gr._slotUnits, gr.key);
    for (const a of altSlots) slot(a.code, a.title, a.units, a.groupKey, { pathChoiceKey: a.pathChoiceKey });
    const pull = stack => { while (stack.length) for (const grp of nodes.get(stack.pop()).prereqs) {
      const m = grp.find(x => nodes.has(x)) || grp[0];
      if (!nodes.has(m)) { add(m, {}); stack.push(m); }
    } };
    pull([...nodes.keys()].filter(c => !taken[c]));
    // one PATH node per path choice; its prereqs = prereqs of the relevant paths' courses from outside the path
    // (undecided: every path; decided: the taken ones). Prereqs only an undecided path needs are added but not planned.
    const open = pc => pc.chosenPaths.length < pc.pick, relevant = pc => pc.paths.filter(p => open(pc) || pc.chosenPaths.includes(p.groupKey));
    const before = new Set(nodes.keys());
    for (const pc of pathChoices) {
      const pre = new Map();
      for (const p of relevant(pc)) for (const c of p.courses) for (const grp of (COURSES[c] || { pre: [] }).pre)
        if (!grp.some(x => p.courses.includes(x))) pre.set(grp.join('|'), grp);
      add('PATH: ' + pc.key, { title: pc.title, units: Math.min(...pc.paths.map(p => p.units)), offered: '', status: 'path', pathChoiceKey: pc.key, prereqs: [...pre.values()] });
    }
    pull(pathChoices.map(pc => 'PATH: ' + pc.key));
    for (const n of nodes.values()) if (!before.has(n.code) && n.status !== 'path') n.pathPrereq = true;
    for (const n of nodes.values()) if (!n.status) n.status = n.prereqs.every(grp => grp.some(x => taken[x])) ? 'ready' : 'locked';
    const edges = [];
    for (const n of nodes.values()) for (const grp of n.prereqs) for (const p of grp) if (nodes.has(p)) edges.push({ from: p, to: n.code });
    // each path's courses in prerequisite order: pre = prereqs present as nodes, after = courses of the same path
    for (const pc of pathChoices) for (const p of pc.paths) {
      const seen = new Set(), visit = c => {
        if (seen.has(c)) return; seen.add(c);
        const ps = (COURSES[c] || { pre: [] }).pre.flat(), after = ps.filter(x => x !== c && p.courses.includes(x));
        after.forEach(visit);
        p.chain.push({ code: c, pre: [...new Set(ps.filter(x => !p.courses.includes(x) && nodes.has(x)))], after });
      };
      p.chain = []; p.courses.forEach(visit);
    }

    // plan
    const todo = [...nodes.values()].filter(n => !taken[n.code] && n.status !== 'path' && !n.pathPrereq);
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
      currentTerm: parsed.currentTerm, expectedTerm: parsed.student.expected, warnings, groups, pathChoices,
      nodes: [...nodes.values()], edges, plan,
      stats: { unitsEarned: Object.values(parsed.taken).filter(x => st(x) === 'done' && !x.via).reduce((u, x) => u + x.units, 0),
        unitsNeeded: parsed.unitsNeeded, plannedUnits, coursesRemaining: plan.reduce((n, p) => n + p.courses.length, 0) },
    };
  }
  g.MODEL = { build };
})(typeof module !== 'undefined' ? module.exports : window);
