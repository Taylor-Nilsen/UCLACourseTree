# Internal interface contract (model.js <-> ui.js)

All files are plain browser scripts (no bundler, no ES modules in the browser) that attach to `window`
and also work under Node via the `(typeof module!=='undefined'?module.exports:window)` footer pattern
already used in parser.js and courses.js.

## Inputs already available
- `window.COURSES` (courses.js): `{ [code]: { t, u, pre: string[][], off: 'F'|'W'|'S' combos or '', w2?: true, note?, rec?: number } }`
  `pre` is an AND of OR-groups, e.g. `[['MECH&AE M20','COM SCI 31'], ['MECH&AE 82']]`.
- `window.ALIAS` (courses.js): `{ 'MATH T03': 'MATH 31B', ... }`
- `window.DARS.parse(lines)` (parser.js). Input: `[{x, line}]` from `DARS.linesFromItems(pdfjsTextItems)`, or plain text.
  **Never throws.** Returns:
```
{ ok: boolean, reason?: string /* ok:false only: why there is nothing to plan; show it instead of a blank page */,
  student: { auditDate, expected: 'SP29', major /* = first MAJOR program's name */, auditStatus?: 'complete',
             programs: [ { key: 'MAJOR1'|'MAJOR2'|'MINOR1'|..., type: 'major'|'minor'|..., catalogTerm: '2025 FALL', code: 'EN0279', name } ] },
  currentTerm: 'FA26', unitsNeeded: 69,
  taken: { [code]: { term:'WI26', units:4, grade:'B+'|'IP'|'AP'|'TA'|'P'|'F'|'W'..., title, via?, flags?: ['>R'|'>D'|'(R)'|'RP'...],
                     status: 'done'|'ip'|'failed'|'withdrawn'|'incomplete'|'unknown' } },
  sections: [ { title, program: 'MAJOR2'|null /* last program header printed above it, if the audit prints one */,
      note?: string /* extra header lines */, needSubgroups: number|null,
      groups: [ { section, name, needCourses, needUnits, taken: string[] /* done/ip only */, notFrom: string[],
                  notFromRanges?: option[] /* "NOT FROM: PSYCH 192 TO 199" */, note?, attributes?: string[] /* "F:W2T" */,
                  orPrev?: true /* "OR)" group: alternative to the previous group in the section */,
                  undeclared?: true /* technical-breadth group with no SELECT FROM: student has not declared a TBA */,
                  options: [ { dept, num, alts: string[] /* 'MECH&AE 157','MECH&AE 157W' = one slot */,
                               to?: '187' /* range num..to */, wildcard?: '1@@' /* '@' = one digit; all-'@' = any course; alts: [] */ } ] } ] } ],
  unparsed: [ { section, line, why? } ] /* lines inside a requirement section the parser did not understand */ }
```
  Grades: `status` is `done` only for a passing grade (A..D with +/-, P, S, CR, AP/IB/TE/EX test credit, T/U-prefixed transfer
  grades such as TA, TB+, UA, TP); `ip` for IP/PL/planned/registered; `failed` for F, NP, NC, U, NOCR; `withdrawn` for W, WF, DROP;
  `incomplete` for I, NR, DR; anything else `unknown`. When a course appears more than once the best attempt is kept
  (done > ip > incomplete > unknown > withdrawn > failed). Status markers (OK/NO/IP/+/-/R/(R)) and course flags (>R, >D, RP, ...)
  never appear in names or codes. `DARS.redact(lines)` returns the lines with the name/ID line, 9-digit numbers, school names and
  letter grades removed (for the "Copy diagnostic" button); `DARS.gradeStatus(grade)` exposes the grade classes.
  Notes: a group whose `options` is empty is a "count check" (use only for warnings). Two groups in the same
  section with the same `name` are alternatives (pick one). `section.needSubgroups = k` means pick k of that
  section's groups. A group with `orPrev: true` is an alternative to the group just before it. GE groups have hundreds of options that are not in COURSES.
  The model expands ranges and wildcards against COURSES, drops NOT FROM courses from `options`, and counts only `done`/`ip` courses.
- `DARS.termIndex('WI27')` -> sortable int, `DARS.termName(int)` inverse. Quarter order FA, WI, SP, SU within an academic year.

## model.js must expose `window.MODEL.build(parsed, opts) -> model`
`opts = { choices: { [groupKey]: string[] /* user-pinned course codes per group */, ['path:' + pathChoiceKey]: string[] /* taken paths (group keys) */ }, perQuarter: 4, useSummer: false }`
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
  pathChoices: [{ key /* = first group's key */, section, title, pick: number /* k */,
                  paths: [{ groupKey, name, courses: string[] /* codes the path adds; [] for an unpinned choice/GE path */,
                            units, choice: boolean /* the path is itself a pick-N-of-M list */, need, placeholder: boolean,
                            ready: boolean, unmet: number, summary: string /* "BIOENGR 177A + 177B" | "pick 1 of 11 (ETHICS list)" */ }],
                  chosenPaths: string[] /* group keys */ }],
  nodes: [{ code, title, units, status: 'done'|'ip'|'ready'|'locked'|'placeholder'|'option',
            term?: 'WI26' /* when taken */, planned?: 'WI27', groupKey?, offered: string, note?: string,
            pathChoiceKey?, pathGroupKey? /* option nodes; pathChoiceKey also on a path CHOOSE slot */,
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
  form one **path choice** (`model.pathChoices`); each group is a **path**, taken as a whole bundle. They are never
  auto-resolved: a group is `selected` only when it is taken, by `opts.choices['path:' + pathChoiceKey]` (first) or
  by a pin inside it. While fewer than k are taken, every other group in the set is `selected: false, undecided: true`
  and contributes nothing to the plan; the plan holds one slot per missing pick, named
  `CHOOSE: <title>[ #i]: <path summary> or <path summary>` over the paths not taken (units of the smallest of them,
  `pathChoiceKey` set), and each such path's `courses` appear as `option` nodes. Once k are taken the rest are
  `selected: false, undecided: false` and add no nodes. The UI taking a path drops pins in the paths it leaves.
  `title` = the common leading words of the path names when there are 2 or more ("BIOENGINEERING CAPSTONE"), else
  the section title. A path's `ready` = every course's prereqs done/in progress/pinned (choice path: its best
  option); `unmet` = distinct missing transitive prereqs outside the path itself (choice path: its best option's).
- Placeholder (GE) groups: unchanged; one `GE: <group name>[ #i]` slot node per needed course until pinned.

### Pending-decision slots
Each open slot of a selected choice group is a node `CHOOSE: <group name>[ #i]` (status `placeholder`,
`groupKey`, units = needUnits/need or 4, no prereqs). A path-choice `CHOOSE: <title>: A or B` slot carries
`pathChoiceKey` and the `groupKey` of the first path not taken. These, like `GE:` slots, are scheduled last in the
plan so unit totals stay honest. The UI draws non-GE `CHOOSE:` slots as one choice node per undecided selected group
and one path node per path choice instead, and puts GE groups' nodes (and GE path choices' slots) in a separate
"General Education" lane.
Option nodes (`status: 'option'`): courses of a path not taken yet. Never planned (no `planned`), not in `plan` or
`stats`, and they pull in no prereq nodes; edges from prereqs already present are listed.
Node status: done = taken with a passing grade (`status: done`); ip = in progress; failed, withdrawn and incomplete attempts count as not taken; ready = every prereq AND-group has a done/ip member;
locked = otherwise; placeholder = GE/elective slot or pending choice; option = on an untaken path. Placeholder node
codes: `GE: <group name>`, `CHOOSE: <group name>`, `CHOOSE: <path choice title>: <summaries>`.

`opts.choices[groupKey]` pins: kept up to `need` per group (UI drops the oldest); a pin must be one of the group's
`options`. Pinning in an alternative group selects that group (the UI also records it as the taken path).
`opts.choices['path:' + pathChoiceKey]`: group keys of the taken paths, at most `pick` (UI drops the oldest).
