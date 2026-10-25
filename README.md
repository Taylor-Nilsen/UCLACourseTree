# DARS Skill Tree

Upload your UCLA DARS degree-audit PDF and get a prerequisite "skill tree" plus a quarter-by-quarter plan to graduation. It works for any UCLA undergraduate major, minor or double major. Everything runs in your browser; the PDF is not uploaded anywhere.

## What it does

- Reads your audit: completed courses, courses in progress, what each requirement group still needs, and your expected graduation term.
- Draws the remaining courses as a tree, with arrows from prerequisites to the courses they unlock.
- Spreads the remaining courses over the quarters you have left, respecting prerequisites and the quarters each course was actually offered.
- Never chooses between real options for you. Where a requirement offers more courses than it needs, it shows every option with its prerequisites and you select the ones you want.

## Run it

```
npm start
```

Then open http://localhost:8080. You can also just open `index.html` in a browser. pdf.js is loaded from cdnjs, so you need a network connection to upload a PDF. There is a redacted sample audit behind "Load sample audit" if you want to try it without your own.

Tests: `npm test` (needs Node, no dependencies).

## Get your DARS PDF

1. Sign in to the UCLA DARS site and run (or open) your degree audit.
2. Go to the Audit Results tab.
3. Print the page and choose "Save as PDF" as the destination.
4. Upload that PDF to the app.

## What the colors mean

- Done: you finished the course with a passing grade.
- In progress: you are enrolled this quarter.
- Ready: every prerequisite is done or in progress, so you can take it next.
- Locked: at least one prerequisite is still missing.
- Placeholder: a general education or elective slot with no specific course selected yet.

## How choices work

- A requirement that needs N courses and lists N or fewer usable options uses all of them automatically. Options that were not offered in recent terms, excluded by the audit, or already used by another requirement do not count as usable.
- A requirement that lists more options than it needs becomes a "Select N of M" box in the tree. Each option shows a green dot when its prerequisites are done or in progress and a grey dot otherwise. Click the box to see every option's prerequisites and the terms it was offered, then select the ones you want.
- Until you select, the quarter plan holds a "choose" slot for each open course so the timeline stays honest.
- Alternative requirement groups are all shown as one choice. For example, a capstone that is either A + B or C appears as one card with both paths, and selecting a course in one path selects it.
- Ethics and writing are the exception to "one course, one requirement": a lab course that also satisfies Writing II counts for both.
- General education and other long lists (over 60 options) stay as searchable slots in their own lane at the bottom of the tree.
- Selections are saved in your browser.

## Adjusting the quarter plan

Drag a class to another quarter to move it there. If it isn't offered in that quarter, a dialog says so and offers the nearest quarters it is offered, one before and one after. A moved class waits for its quarter and takes a seat there first; the planner refills the seat it left. If its prerequisites aren't done before that quarter, the move can't apply and the constraints list says why.

Hover (or tap) a class in the Quarter plan for two small buttons:

- » Defer: push it to the next quarter it is offered. Anything that needs it moves with it.
- ≠ Conflict: then click another class in the same quarter that meets at the same time. The planner keeps the one whose move would disrupt the plan least (later graduation first, then courses pushed past your expected graduation, then how many other courses move) and fills the freed seat with the next best course. The "Your scheduling constraints" list above the plan says what it kept and why; × removes a constraint.

A red asterisk in a class's upper-left corner means you need to take it that quarter: delaying it by one offered quarter would push you past your expected graduation, or leave a course with no quarter it can be taken in. Finishing a quarter later but still on time does not count. The detail panel says what it would push back, or how many quarters a class can slip.

Moves, defers and conflicts all show up in "Your scheduling constraints"; × removes one. Small changes apply at once with an Undo button. If a change pushes back graduation, pushes a course past your expected graduation, leaves a course unschedulable, or moves 3 or more other courses, a dialog lists what moves and lets you undo or continue. Constraints are saved in your browser and cleared when you load a new audit.

## What to take next

The "What to take next" tab is for course selection. Pick a quarter (it defaults to the next one) and it shows that quarter's planned classes, ranked most important on the left:

1. Classes you must take that quarter (red asterisk) first.
2. Then the ones with the least room to slip (fewest offered quarters they can move before graduation is pushed back).
3. Then the ones that unlock the most later courses.

Under each class are up to 3 alternates for if you can't get it, best on top. Each one can actually be taken that quarter: it is offered then, and its prerequisites are done, in progress or planned earlier. The order is:

1. Other options for the same requirement, when you selected that class from a list.
2. Courses planned for a later quarter that could move up, in the planner's own priority order.
3. Options for requirements you haven't selected yet.
4. A GE slot planned for later.

Each class lists at most one option per requirement, and a course already shown under a more important class only repeats when nothing else fits. Click an alternate to see its prerequisites or its requirement's options. Drag an alternate onto a class at the top to take it that quarter instead: the alternate is moved there (and selected, if it is an option for a requirement), and the class it replaces is deferred to the next quarter it is offered. » and ≠ work the same as in the Quarter plan.

## Export

Export opens a print-ready plan and prerequisite tree (with your constraints applied; a * marks classes that must be taken that quarter); save it as PDF from the print dialog.

## Deploy

GitHub Pages serves the site at https://uclacoursetree.taylornilsen.com. `.github/workflows/pages.yml` runs the tests on every push to `main` and publishes only the app files (no tests, scripts, docs or raw sample data).

One-time setup:

1. Repo Settings, Pages: set Source to "GitHub Actions" and Custom domain to `uclacoursetree.taylornilsen.com`. Turn on Enforce HTTPS once the certificate is issued.
2. DNS for taylornilsen.com (Cloudflare): a `CNAME` record `uclacoursetree` pointing to `taylor-nilsen.github.io`, proxy off (DNS only), so GitHub can issue the HTTPS certificate.
3. Recommended: verify `taylornilsen.com` under your GitHub profile Settings, Pages, so no other GitHub account can claim the subdomain.

Pages is free on a public repo. A private repo needs GitHub Pro (included with GitHub Education) and an account whose Actions billing is in good standing.

## Data sources

- UCLA General Catalog, 2026-27: https://catalog.registrar.ucla.edu/ (titles, units, requisites for every course).
- UCLA Schedule of Classes: https://sa.ucla.edu/ro/public/soc (which courses had sections in each term, Fall 2024 through Winter 2027).
- Registrar's Department and Subject Area Codes: https://registrar.ucla.edu/faculty-staff/courses-and-programs/department-and-subject-area-codes (maps subject names in requisite text to DARS codes such as `COM SCI`).

## Course database

`data/ucla-courses.js` sets `COURSES`, which covers every UCLA undergraduate course (about 9,100 courses in 182 subject areas). It is generated by `scripts/build-course-db.mjs` (see `scripts/README.md`). Each entry is `{ t, u, pre, off, offTerms?, offNote?, req?, w2?, last? }`.

- Keys use the Registrar/DARS subject codes (`COM SCI 32`, `C&EE M20`, `FILM TV 4`).
- `u` is the unit count. For a range such as "2 to 4", it is the maximum.
- `pre` is parsed from the catalog's "Requisite(s)" and "Enforced requisite(s)" sentences. Recommended preparation, corequisites, courses that "may be taken concurrently" and grade minimums are left out. An alternative that is not a course (a placement test or a GPA) drops that group. When the text can't be parsed, `pre` is `[]` and the raw sentence is kept in `req`.
- `off` is the set of quarters (`F`, `W`, `S`) in which the course had at least one section that was not cancelled, Fall 2024 through Winter 2027. `offTerms` lists those terms (`["25F","26W"]`). Summer is left out.
- `off` is `""` when the course had no sections in any of those terms. `offNote` then says when it last ran (`"not offered since Spring 2023"`, or `"not offered since before Fall 2021"`). The planner never schedules such a course and never chooses it over an offered alternative.
- Tutorials (supervised research, individual study, whose catalog entry starts with "Tutorial") that the Schedule of Classes never lists keep `off: "?"` with an `offNote` saying so. The planner treats `"?"` as any quarter.
- `w2` marks a course whose catalog text says it satisfies Writing II.
- `last` marks a course that was dropped from the current catalog. Its value is the last catalog year that listed it (2021-2025). These courses are kept because DARS still shows them.

## Limitations

- Prerequisites come from the catalog's requisite sentences. About 290 courses have wording too irregular to parse; their raw catalog text shows in the detail panel instead of tree links.
- Offerings are history, not a promise. A course that ran every Fall may still skip a year, and Winter 2027 sections were tentative when the data was pulled. Check the Schedule of Classes before you enroll.
- Many departments enroll individual-study courses (such as 199s) by contract, so the Schedule of Classes never lists them. Those are marked unknown rather than not offered.
- The parser is tested on two real audits (both UCLA Samueli engineering majors) plus 13 synthetic audits covering Letters & Science, Arts, TFT, Music, Nursing, Luskin, Education, minors, double majors, transfer students and failed or withdrawn courses. The synthetic ones are modeled on the engine's documented format, not on real UCLA printouts. If your audit shows "lines were not understood", use "Copy diagnostic" and send it to the maintainer.
- When an audit's course-count check disagrees with its itemized requirements, the app flags the mismatch rather than guessing which is right.
- The audit is the source of truth. Confirm your plan with a counselor.

## Privacy

Everything runs in your browser. The PDF is read locally with pdf.js and nothing is sent to a server. Selections and scheduling constraints are kept in your browser's local storage. The sample audits in `sample/` are real audits with the name, student ID and letter grades removed.
