# Internal interface contract (model.js <-> ui.js)

All files are plain browser scripts (no bundler, no ES modules in the browser) that attach to `window`
and also work under Node via the `(typeof module!=='undefined'?module.exports:window)` footer pattern
already used in parser.js and courses.js.

## Inputs already available
- `window.COURSES` (courses.js): `{ [code]: { t, u, pre: string[][], off: 'F'|'W'|'S' combos or '', w2?: true, note?, rec?: number } }`
  `pre` is an AND of OR-groups, e.g. `[['MECH&AE M20','COM SCI 31'], ['MECH&AE 82']]`.
- `window.ALIAS` (courses.js): `{ 'MATH T03': 'MATH 31B', ... }`
- `window.DARS.parse(lines)` (parser.js) returns:
```
{ student: { auditDate, expected: 'SP29', major }, currentTerm: 'FA26', unitsNeeded: 69,
  taken: { [code]: { term:'WI26', units:4, grade:'B'|'IP'|'AP'|'TA'|'P'..., title, via? } },
  sections: [ { title, note?: string /* extra header lines */, needSubgroups: number|null,
      groups: [ { section, name, needCourses, needUnits, taken: string[], notFrom: string[],
                  orPrev?: true /* "OR)" group: alternative to the previous group in the section */,
                  undeclared?: true /* technical-breadth group with no SELECT FROM: student has not declared a TBA */,
                  options: [ { dept, num, alts: string[] /* 'MECH&AE 157','MECH&AE 157W' = one slot */, to?: '187' /* range */ } ] } ] } ] }
```
  Notes: a group whose `options` is empty is a "count check" (use only for warnings). Two groups in the same
  section with the same `name` are alternatives (pick one). `section.needSubgroups = k` means pick k of that
  section's groups. A group with `orPrev: true` is an alternative to the group just before it. GE groups have hundreds of options that are not in COURSES.
- `DARS.termIndex('WI27')` -> sortable int, `DARS.termName(int)` inverse. Quarter order FA, WI, SP, SU within an academic year.

## model.js must expose `window.MODEL.build(parsed, opts) -> model`
`opts = { choices: { [groupKey]: string[] }  /* user-pinned course codes per group */, perQuarter: 4, useSummer: false }`
```
model = {
  currentTerm, expectedTerm, warnings: string[],
  groups: [{ key, section, name, need, taken: string[],
             chosen: [{ code, auto: boolean, why: string }],           // what the plan uses (auto:false = pinned)
             alternatives: [{ code, ready: boolean, unmet: number, why: string }], // choice groups only, see below
             placeholder: boolean,   // true when no option is in COURSES (GE etc) -> plan uses a slot named by group
             choice: boolean,        // more viable options than needed: the user picks, nothing is auto-chosen
             undecided: boolean,     // a pick is still pending here (open choice slots, or an unresolved alternative group)
             optionCount: number, options: string[] /* all codes, for a search box */,
             selected: boolean,      // true when this group counts toward the plan (see alternatives below)
             altGroupKeys: string[] }], 
  nodes: [{ code, title, units, status: 'done'|'ip'|'ready'|'locked'|'placeholder',
            term?: 'WI26' /* when taken */, planned?: 'WI27', groupKey?, offered: string, note?: string,
            prereqs: string[][] }],
  edges: [{ from, to }],            // prerequisite -> course, only between nodes present
  plan:  [{ term: 'WI27', courses: string[], units: number, beyondExpected: boolean }],
  stats: { unitsEarned, unitsNeeded, plannedUnits, coursesRemaining }
}
```
Group key: `section + '|' + name + '|' + index` (stable across rebuilds).

### Selection rules (the model never picks between real options for the user)
- `viable` options of a group = options minus `notFrom`, minus taken courses, minus courses already used by another
  requirement (ethics/writing groups may reuse them), minus courses with `off === ''`. Courses not in COURSES and
  `off === '?'` stay viable. An option like "157 OR 157W" is one slot; never-offered alts are dropped from it.
- `viable <= need`: every viable slot is chosen, `auto: true`, `why` starts `required: N of N` (plus e.g.
  `MECH&AE 157 never offered`). Fewer than needed adds the warning "audit lists fewer options than it needs".
  A slot that still has 2+ viable alts becomes its own choice group (need 1, key `<parent key>|A OR B`,
  name `A OR B`), inserted right after its parent.
- `viable > need`: `choice: true`; `chosen` holds only pins (`auto: false`); `alternatives` lists every unpinned
  viable option sorted ready first, then fewest unmet transitive prereqs, then course-number order.
  `ready` = every prereq AND-group has a done/in-progress/pinned member; `unmet` = count of missing transitive prereqs;
  `why` is a short fact ("prereqs met", "no prereqs", "needs 2 prereqs: MECH&AE 103, MECH&AE 105A",
  "not in course database", "writing credit", "also satisfies Engineering Writing",
  "already planned for <group>, counts for both"). Nothing is labeled recommended.
- Alternative groups (pick k of a section's groups when it has more than k; same-name groups; `orPrev` pairs)
  are never auto-resolved: a group is `selected` only when it has a pin (or there is no choice). While fewer than k
  are pinned, every unpinned group in the set is `selected: false, undecided: true` and the plan holds one
  `CHOOSE: <section title>` slot per missing pick (units of the smallest alternative). Once k groups have pins the
  rest are `selected: false, undecided: false` (pinning in one of those switches; the UI drops the rivals' pins).
- Placeholder (GE) groups: unchanged; one `GE: <group name>[ #i]` slot node per needed course until pinned.

### Pending-decision slots
Each open slot of a selected choice group is a node `CHOOSE: <group name>[ #i]` (status `placeholder`,
`groupKey`, units = needUnits/need or 4, no prereqs). A section-level `CHOOSE: <section title>` carries the
`groupKey` of the first undecided alternative group. These, like `GE:` slots, are scheduled last in the plan so
unit totals stay honest. The UI draws non-GE `CHOOSE:` slots as one choice node per undecided group instead,
and puts GE groups' nodes in a separate "General Education" lane.
Node status: done = taken with a non-IP grade; ip = in progress; ready = every prereq AND-group has a done/ip member;
locked = otherwise; placeholder = GE/elective slot or pending choice. Placeholder node codes: `GE: <group name>`,
`CHOOSE: <group or section name>`.

`opts.choices[groupKey]` pins: kept up to `need` per group (UI drops the oldest); a pin must be one of the group's
`options`. Pinning in an alternative group selects that group.
