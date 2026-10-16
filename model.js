// Degree-plan model: parsed DARS -> requirement choices, prerequisite graph and a quarter-by-quarter plan.
// Contract: INTERFACE.md. Depends on COURSES (data/ucla-courses.js) and DARS (parser.js).
(function (g) {
  const env = typeof module !== 'undefined' ? Object.assign({}, require('./data/ucla-courses.js'), require('./parser.js')) : g;
  const { COURSES, DARS } = env;
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
    // done/ip only (failed, withdrawn, incomplete attempts do not count); AP/transfer credit arrives already mapped by the parser (`via`)
    const st = t => t.status || (t.grade === 'IP' ? 'ip' : 'done');
    const taken = {};
    for (const [c, t] of Object.entries(parsed.taken)) if (['done', 'ip'].includes(st(t))) taken[c] = t;
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
          _slots: slots, _notFrom: [...notFrom], _all: options, _orPrev: !!gr.orPrev, _ew: EW.test(s.title), _writing: /WRITING/.test(s.title),
          _slotUnits: gr.needUnits && gr.needCourses ? gr.needUnits / gr.needCourses : 4 };
        sec.push(out); groups.push(out);
      });
      if (sec.length) bySection.push({ s, sec });
    }
    const gName = key => (groups.find(x => x.key === key) || { name: key.split('|').pop() }).name; // a sub-group key may not exist yet
    const nameOf = key => gName(key).toLowerCase();
    // exclusive picks: a course pinned for one requirement is no option anywhere else, whatever the document order.
    // Pins in "A OR B" sub-groups (key = parent key + '|...') belong to their parent. A course pinned twice keeps its first pin.
    const pickedBy = new Map(), own = (gr, k) => k === gr.key || k.startsWith(gr.key + '|');
    for (const gr of groups) for (const [k, cs] of Object.entries(choices)) if (own(gr, k)) for (const c of cs) {
      if (!gr.options.includes(c)) continue;
      const was = pickedBy.get(c);
      if (!was) pickedBy.set(c, k);
      else if (was !== k) warnings.push(`${c} was selected for both ${gName(was)} and ${gName(k)}; it is kept for ${gName(was)} only.`);
    }
    const pickedElse = (gr, c) => pickedBy.has(c) && !own(gr, pickedBy.get(c));
    for (const gr of groups) { gr.options = gr.options.filter(c => !pickedElse(gr, c)); gr.optionCount = gr.options.length; }
    const writingGroups = groups.filter(x => x._writing);
    const writingOpen = () => writingGroups.some(w => !w.chosen.length && !(choices[w.key] || []).length);
    // "ready" = every prereq is done, in progress or pinned (not merely planned)
    const pinned = new Set(pickedBy.keys());
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
      const pins = (choices[gr.key] || []).filter(c => gr.options.includes(c) && pickedBy.get(c) === gr.key);
      gr.chosen = pins.map(c => ({ code: c, auto: false, why: gr.placeholder ? 'selected by you' : 'selected by you; ' + facts(c, gr).why }));
      const k = Math.max(0, gr.need - pins.length);
      if (gr.undeclared) { // TBA not declared yet: nothing to list, but the plan must still hold the courses
        gr.choice = true; gr._open = k;
        warnings.push(`${gr.section}: no technical breadth area is declared, so the plan holds ${plural(k, 'open slot')}. Declare one at my.engineering.ucla.edu and re-export the audit.`);
        return;
      }
      // ethics/writing: a course picked or already required elsewhere that is on this list satisfies it outright
      // (a lab that also counts for Writing II); picks first. A course picked elsewhere is never offered here.
      const already = gr._ew ? gr._all.filter(c => !pins.includes(c) && (pickedElse(gr, c) || chosenBy.has(c) && chosenBy.get(c) !== gr.key))
        .sort((a, b) => pickedElse(gr, b) - pickedElse(gr, a)).slice(0, k) : [];
      if (already.length && already.length >= k) {
        for (const c of already) gr.chosen.push({ code: c, auto: true, why: pickedElse(gr, c) ? `selected for ${nameOf(pickedBy.get(c))}; it is on this list, so it counts here too`
          : `already required for ${nameOf(chosenBy.get(c))}; it is on this list, so it counts here too` });
        gr._byPick = already.some(c => pickedElse(gr, c));
        gr.placeholder = false;
      } else if (gr.placeholder) {
        for (let i = 1; i <= k; i++) gr.chosen.push({ code: 'GE: ' + gr.name + (k > 1 ? ' #' + i : ''), auto: true, why: 'Select any approved course from this list; the plan holds a slot for it.' });
      } else {
        // viable = not excluded, not already used (ethics/writing may double count), not known to be never offered
        const ok = c => !gr._notFrom.includes(c) && !taken[c] && !pickedElse(gr, c) && (gr._ew || !chosenBy.has(c));
        const never = c => COURSES[c] && COURSES[c].off === '';
        const slots = gr._slots.filter(sl => !sl.some(c => pins.includes(c)))
          .map(sl => ({ v: sl.filter(c => ok(c) && !never(c)), off: sl.filter(c => ok(c) && never(c)) })).filter(sl => sl.v.length);
        // same rule per slot
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
              gr.chosen.push({ code: sl.v[0], auto: true, why: [`required: ${n} of ${n}`].concat(sl.off.length ? [sl.off.join(', ') + ' not offered recently'] : [], extras(sl.v[0], gr)).join('; ') });
              continue;
            }
            // "A OR B" with both offered: that slot is its own pick-1 choice
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
      const pinnedIn = set.filter(x => x._byPick || [...pickedBy.values()].some(k => own(x, k))).map(x => x.key);
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
          summary: choice ? `select ${x.need} of ${x.placeholder ? x.optionCount : x.chosen.length + x.alternatives.length} from ${rest} list` : joinCodes(courses) };
      });
      pathChoices.push({ key, section: sTitle, title, pick: k, paths, chosenPaths: pickedSet.map(x => x.key) });
      const rest = set.filter(x => !x.selected), units = Math.min(...rest.map(groupUnits));
      const what = paths.filter(p => !pickedKeys.includes(p.groupKey)).map(p => p.summary).join(' or ');
      for (let i = pickedSet.length; i < k; i++) {
        const name = title + (k - pickedSet.length > 1 ? ' #' + (i - pickedSet.length + 1) : '') + ': ' + what;
        altSlots.push({ code: 'CHOOSE: ' + name, units, groupKey: rest[0].key, title: name, pathChoiceKey: key });
      }
    }
    // ethics/writing last so overlap info (a required course that is also on the writing list) is known
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
      nodes.set(code, Object.assign({ code, title: c ? c.t : t ? t.title : code, units: c ? c.u : t ? t.units : 4, offered: c ? c.off : '?', prereqs: c ? c.pre : [] }, c && c.req && !c.pre.length ? { req: c.req } : {}, extra));
    };
    const viaSrc = new Set(Object.values(taken).map(t => t.via).filter(Boolean));
    for (const [code, t] of Object.entries(taken)) if (!viaSrc.has(code) && !(t.via && !COURSES[code])) add(code, { status: st(t), term: t.term });
    for (const gr of groups) if (gr.selected) for (const c of gr.chosen) {
      if (c.code.startsWith('GE: ')) add(c.code, { title: gr.name, units: gr._slotUnits, offered: 'FWS', status: 'placeholder', groupKey: gr.key });
      else add(c.code, { groupKey: pickedBy.get(c.code) || chosenBy.get(c.code) || gr.key });
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
    // undecided path choice: one PATH node; its prereqs = prereqs of every path's courses from outside the path.
    // Prereqs only an undecided path needs are added but not planned. Decided: no PATH node; the taken paths' courses
    // and slots are ordinary nodes tagged fromPath.
    const open = pc => pc.chosenPaths.length < pc.pick;
    for (const pc of pathChoices) if (!open(pc)) for (const n of nodes.values())
      if (n.groupKey && !n.pathChoiceKey && pc.chosenPaths.some(k => n.groupKey === k || n.groupKey.startsWith(k + '|'))) n.fromPath = pc.key;
    // a course the user picked in a pick-N-of-M group (or a taken list path): the UI offers "change pick" on it
    for (const n of nodes.values()) { const g = groups.find(x => x.key === pickedBy.get(n.code)); if (g && g.choice && g.selected) n.pickedFor = g.key; }
    const before = new Set(nodes.keys());
    for (const pc of pathChoices.filter(open)) {
      const pre = new Map();
      for (const p of pc.paths) for (const c of p.courses) for (const grp of (COURSES[c] || { pre: [] }).pre)
        if (!grp.some(x => p.courses.includes(x))) pre.set(grp.join('|'), grp);
      add('PATH: ' + pc.key, { title: pc.title, units: Math.min(...pc.paths.map(p => p.units)), offered: '', status: 'path', pathChoiceKey: pc.key, prereqs: [...pre.values()] });
    }
    pull(pathChoices.filter(open).map(pc => 'PATH: ' + pc.key));
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
    for (const n of real) if (n.offered === '') warnings.push(`${n.code} can't be scheduled: ${COURSES[n.code].offNote || 'not offered'}.`);
    for (let changed = true; changed;) { // drop courses that can never be scheduled, and whatever depends on them
      changed = false;
      const keep = real.filter(n => n.offered !== '' && n.prereqs.every(grp => grp.some(x => taken[x] || real.some(r => r.code === x))));
      if (keep.length < real.length) { real.filter(n => !keep.includes(n) && n.offered !== '').forEach(n => warnings.push(`${n.code} can't be scheduled because a prerequisite is never offered.`)); real = keep; changed = true; }
    }
    // priority: longest chain of later courses, then most direct dependents, then units. Sorted once: every quarter takes
    // the first `per` eligible courses in this order, so the scheduler can be re-run cheaply under other constraints.
    const kids = new Map(real.map(n => [n.code, []]));
    for (const n of real) for (const grp of n.prereqs) for (const x of new Set(grp)) if (kids.has(x) && x !== n.code) kids.get(x).push(n.code);
    const hMemo = new Map(), height = c => hMemo.get(c) ?? (hMemo.set(c, 1), hMemo.set(c, 1 + Math.max(0, ...kids.get(c).map(height))), hMemo.get(c));
    const order = real.slice().sort((a, b) => height(b.code) - height(a.code) || kids.get(b.code).length - kids.get(a.code).length || b.units - a.units);
    const exp = DARS.termIndex(parsed.student.expected), t0 = DARS.termIndex(parsed.currentTerm), have0 = Object.keys(taken), NONE = new Set();
    const qOf = t => 'FWSU'[((t % 4) + 4) % 4];
    const usable = t => opts.useSummer || qOf(t) !== 'U';
    // notBefore: code -> earliest term index (defers, what-if slips); ban: code -> term indexes it may not use (conflicts)
    function schedule(notBefore, ban) {
      const at = new Map(), plan = [], have = new Set(have0);
      let left = order, sl = slots.slice(), t = t0, quarters = 0;
      while ((left.length || sl.length) && quarters < 16) {
        if (!usable(++t)) continue;
        quarters++;
        const q = qOf(t), picks = [];
        for (const n of left) {
          if (picks.length >= per) break;
          if ((n.offered === '?' || n.offered.includes(q)) && !(notBefore.get(n.code) > t) && !(ban.get(n.code) || NONE).has(t) &&
            n.prereqs.every(grp => grp.some(x => have.has(x)))) picks.push(n);
        }
        picks.push(...sl.splice(0, per - picks.length));
        if (!picks.length) continue;
        left = left.filter(n => !picks.includes(n));
        picks.forEach(n => { at.set(n.code, t); have.add(n.code); });
        plan.push({ t, picks });
      }
      return { at, plan, left: left.concat(sl), final: plan.length ? plan[plan.length - 1].t : null };
    }
    const past = run => [...run.at].filter(([, t]) => t > exp).map(([c]) => c);
    const tn = t => t == null ? 'nowhere' : DARS.termName(t);
    // quarters between two terms, not counting summers when summer is off
    const ord = t => opts.useSummer ? t : t - Math.floor((t + 1) / 4);
    const nextOff = (n, t) => { for (let u = t + 1; u <= t + 8; u++) if (usable(u) && (n.offered === '?' || n.offered.includes(qOf(u)))) return u; return null; };

    // defers: not before that term (still only in offered quarters)
    const realSet = new Set(real.map(n => n.code)), notBefore = new Map();
    for (const [c, term] of Object.entries(opts.defers || {})) {
      const ti = DARS.termIndex(term);
      if (!realSet.has(c)) warnings.push(`Ignored your deferral of ${c}: it is not a course in the plan.`);
      else if (ti == null) warnings.push(`Ignored your deferral of ${c}: "${term}" is not a term.`);
      else notBefore.set(c, ti);
    }
    // conflicts: a and b can't share `term`. Plan it both ways and keep the course whose move hurts less:
    // unscheduled courses, then final term, then courses past expected graduation, then other courses moved, then total shift.
    let ban = new Map(), cur = schedule(notBefore, ban);
    const conflictResolutions = [];
    const unlocks = c => { const seen = new Set(), go = x => kids.get(x).forEach(k => { if (!seen.has(k)) { seen.add(k); go(k); } }); go(c); return seen.size; };
    for (const cf of opts.conflicts || []) {
      const { a, b, term } = cf || {}, T = DARS.termIndex(term);
      if (!realSet.has(a) || !realSet.has(b) || a === b || T == null) {
        warnings.push(`Ignored your conflict between ${a || '?'} and ${b || '?'}${term ? ' in ' + term : ''}: ${a === b ? 'it names one course twice' : T == null ? 'no valid term' : 'both must be courses in the plan'}.`);
        continue;
      }
      if (cur.at.get(a) !== T || cur.at.get(b) !== T) {
        conflictResolutions.push({ a, b, term, kept: null, moved: null, movedTo: null, filledBy: null, why: `No clash now: ${a} is planned for ${tn(cur.at.get(a))} and ${b} for ${tn(cur.at.get(b))}.` });
        continue;
      }
      const bump = c => {
        const bn = new Map(ban); bn.set(c, new Set(ban.get(c)).add(T));
        const run = schedule(notBefore, bn), pb = new Set(past(cur));
        let changed = 0, shift = 0;
        for (const [x, t] of cur.at) { const u = run.at.get(x); if (u !== t && x !== a && x !== b) changed++; shift += u == null ? 16 : Math.abs(ord(u) - ord(t)); }
        return { ban: bn, run, score: [run.left.length, run.final, past(run).filter(x => !pb.has(x)).length, changed, shift], changed };
      };
      const A = bump(a), B = bump(b), cmp = A.score.findIndex((v, i) => v !== B.score[i]);
      const keepA = cmp < 0 || B.score[cmp] < A.score[cmp]; // a tie keeps the first-named course
      const [kept, moved, win, lose] = keepA ? [a, b, B, A] : [b, a, A, B];
      const cost = r => r.run.left.length ? `leaves ${r.run.left.map(n => n.code).join(', ')} unscheduled`
        : r.run.final > cur.final ? `delays your last quarter to ${tn(r.run.final)}`
          : r.score[2] ? `puts ${plural(r.score[2], 'course')} past expected graduation`
            : r.changed ? `moves ${plural(r.changed, 'other course')}` : 'changes nothing else';
      const u = unlocks(kept);
      const why = cmp < 0 ? `Kept ${kept}: moving either course ${cost(win)}, so the first-named one stays; ${moved} moves to ${tn(win.run.at.get(moved))}.`
        : `Kept ${kept}: ${u ? `it unlocks ${plural(u, 'later course')}` : `moving it ${cost(lose)}`}; moving ${moved} instead ${cost(win)}.`;
      const prev = cur;
      ban = win.ban; cur = win.run;
      const into = (cur.plan.find(p => p.t === T) || { picks: [] }).picks.map(n => n.code).find(c => c !== kept && prev.at.get(c) !== T);
      conflictResolutions.push({ a, b, term, kept, moved, movedTo: cur.at.has(moved) ? tn(cur.at.get(moved)) : null, filledBy: into || null, why });
    }
    // critical: slipping it one offered quarter pushes the last quarter past expected graduation, puts a course past expected graduation
    // that wasn't, or leaves something unscheduled. slack = offered quarters it can slip without that (max 4).
    // ponytail: one scheduler re-run per slip (<= 5 per course); fine for a degree's ~40 courses.
    const pastBase = new Set(past(cur));
    // A later last quarter only counts when it lands after expected graduation (or no expected term is known);
    // finishing a quarter later but still on time is not a cascade.
    const lateEnd = run => run.final > cur.final && (Number.isNaN(exp) || run.final > exp);
    const hurts = run => run.left.length > cur.left.length || lateEnd(run) || past(run).some(c => !pastBase.has(c));
    for (const n of real) {
      if (!cur.at.has(n.code)) continue;
      let s = 0, t = cur.at.get(n.code), why = null;
      while (s < 4 && (t = nextOff(n, t)) != null) {
        const nb = new Map(notBefore); nb.set(n.code, t);
        const run = schedule(nb, ban);
        if (hurts(run)) {
          const np = past(run).filter(c => !pastBase.has(c)), gone = run.left.filter(x => !cur.left.includes(x)).map(x => x.code);
          why = lateEnd(run) ? `your last quarter to ${tn(run.final)}, past expected graduation` : np.length ? `${np.slice(0, 2).join(', ')}${np.length > 2 ? ' and more' : ''} past expected graduation` : `${gone.join(', ')} out of the plan`;
          break;
        }
        s++;
      }
      n.slack = s; n.critical = s === 0 && !!why;
      if (n.critical) n.criticalWhy = why;
    }
    for (const [c, t] of cur.at) nodes.get(c).planned = DARS.termName(t);
    const plan = cur.plan.map(({ t, picks }) => ({ term: DARS.termName(t), courses: picks.map(n => n.code), units: picks.reduce((u, n) => u + n.units, 0), beyondExpected: t > exp }));
    if (cur.left.length) warnings.push(`Stopped planning after 16 quarters; still unscheduled: ${cur.left.map(n => n.code).join(', ')}.`);

    for (const gr of groups) for (const k of Object.keys(gr)) if (k[0] === '_') delete gr[k];
    const plannedUnits = plan.reduce((u, p) => u + p.units, 0);
    return {
      currentTerm: parsed.currentTerm, expectedTerm: parsed.student.expected, warnings, groups, pathChoices, conflictResolutions,
      nodes: [...nodes.values()], edges, plan,
      stats: { unitsEarned: Object.values(parsed.taken).filter(x => st(x) === 'done' && !x.via).reduce((u, x) => u + x.units, 0),
        unitsNeeded: parsed.unitsNeeded, plannedUnits, coursesRemaining: plan.reduce((n, p) => n + p.courses.length, 0) },
    };
  }
  // What-if for the UI: { before, after, diff, opts } where opts is `opts` with the change applied (hand it to build to keep it).
  // change: { type: 'defer', code } (to the next quarter it is offered after its planned one) | { type: 'conflict', a, b, term }
  //       | { type: 'undefer', code } | { type: 'unconflict', a, b, term }. Never throws on a course that is not planned.
  function previewChange(parsed, opts = {}, change = {}) {
    const before = build(parsed, opts), o = Object.assign({}, opts, { defers: Object.assign({}, opts.defers), conflicts: (opts.conflicts || []).slice() });
    const same = (x, y) => x && y && x.term === y.term && [x.a, x.b].sort().join('|') === [y.a, y.b].sort().join('|');
    const n = before.nodes.find(x => x.code === change.code), subject = [change.code, change.a, change.b].filter(Boolean);
    if (change.type === 'defer' && n && n.planned) {
      const t = DARS.termIndex(n.planned);
      for (let u = t + 1; u <= t + 8; u++) {
        const q = 'FWSU'[u % 4];
        if ((opts.useSummer || q !== 'U') && (n.offered === '?' || n.offered.includes(q))) { o.defers[n.code] = DARS.termName(u); break; }
      }
    } else if (change.type === 'undefer') delete o.defers[change.code];
    else if (change.type === 'conflict' && !o.conflicts.some(x => same(x, change))) o.conflicts.push({ a: change.a, b: change.b, term: change.term });
    else if (change.type === 'unconflict') o.conflicts = o.conflicts.filter(x => !same(x, change));
    const after = build(parsed, o);
    const at = m => new Map(m.plan.flatMap(p => p.courses.map(c => [c, p.term])));
    const late = m => new Set(m.plan.filter(p => p.beyondExpected).flatMap(p => p.courses));
    const last = m => m.plan.length ? m.plan[m.plan.length - 1].term : null;
    const A = at(before), B = at(after), lb = late(before);
    const moved = [...A].filter(([c, t]) => B.has(c) && B.get(c) !== t).map(([code, from]) => ({ code, from, to: B.get(code) }));
    const unschedulable = [...A.keys()].filter(c => !B.has(c)), pastExpected = [...late(after)].filter(c => !lb.has(c));
    const finalTermBefore = last(before), finalTermAfter = last(after), others = moved.filter(x => !subject.includes(x.code) && !/^(GE|CHOOSE): /.test(x.code)).length; // slots are not courses
    const later = finalTermBefore && finalTermAfter && DARS.termIndex(finalTermAfter) > DARS.termIndex(finalTermBefore);
    const severity = later || pastExpected.length || unschedulable.length || others >= 3 ? 'major' : others ? 'minor' : 'none';
    return { before, after, opts: o, diff: { finalTermBefore, finalTermAfter, pastExpected, moved, unschedulable, severity } };
  }
  g.MODEL = { build, previewChange };
})(typeof module !== 'undefined' ? module.exports : window);
