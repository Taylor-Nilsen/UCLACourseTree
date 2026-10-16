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
             chosen: [{ code, auto: boolean, why: string }],           // what the plan uses
             alternatives: [{ code, why: string }],                     // not chosen, sorted best first
             placeholder: boolean,   // true when options aren't in COURSES (GE etc) -> plan uses a slot named by group
             optionCount: number, options: string[] /* all codes, for a search box */,
             selected: boolean,      // false when this group lost a pick-k-of-subgroups choice
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
Node status: done = taken with a non-IP grade; ip = in progress; ready = every prereq AND-group has a done/ip member;
locked = otherwise; placeholder = GE/elective slot. Placeholder node code format: `GE: <group name>`.
