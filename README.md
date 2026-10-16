# DARS Skill Tree

Upload your UCLA DARS degree-audit PDF and get a prerequisite "skill tree" plus a quarter-by-quarter plan to graduation. Built for the Aerospace Engineering BS. Everything runs in your browser; the PDF is not uploaded anywhere.

## What it does

- Reads your audit: completed courses, courses in progress, what each requirement group still needs, and your expected graduation term.
- Draws the remaining courses as a tree, with arrows from prerequisites to the courses they unlock.
- Spreads the remaining courses over the quarters you have left, respecting prerequisites and, where known, when each course is offered.
- Never picks between real options for you. Where a requirement offers more courses than it needs, it shows every option with its prerequisites and you pin your pick.

## Run it

```
npm start
```

Then open http://localhost:8080. You can also just open `index.html` in a browser. pdf.js is loaded from cdnjs, so you need a network connection to upload a PDF. There is a redacted sample audit in `sample/` if you want to try it without your own.

Tests: `npm test` (needs Node, no dependencies).

## Get your DARS PDF

1. Sign in to the UCLA DARS site and run (or open) your degree audit.
2. Go to the Audit Results tab.
3. Print the page and choose "Save as PDF" as the destination.
4. Upload that PDF to the app.

## What the colors mean

- Done: you finished the course with a final grade.
- In progress: you are enrolled this quarter.
- Ready: every prerequisite is done or in progress, so you can take it next.
- Locked: at least one prerequisite is still missing.
- Placeholder: a general education or elective slot with no specific course picked yet.

## How choices work

- A requirement that needs N courses and lists N or fewer usable options uses all of them automatically. Options that are never offered, excluded by the audit, or already used by another requirement do not count as usable.
- A requirement that lists more options than it needs becomes a "Pick N of M" box in the tree. Each option shows a green dot when its prerequisites are done or in progress and a grey dot otherwise. Click the box to see every option's prerequisites and quarters offered, then pin the ones you want.
- Until you pick, the quarter plan holds a "choose" slot for each open course so the timeline stays honest.
- Alternative requirement groups (for example two capstone options) are all shown, and pinning a course in one selects that group.
- Ethics and writing are the exception to "one course, one requirement": a required course that appears on the writing list, such as MECH&AE 157W, satisfies writing too.
- General education and other long lists (over 60 options) stay as searchable slots in their own lane at the bottom of the tree.
- Pins are saved in your browser.

## Data sources

- UCLA Samueli 2025-26 catalog course pages:
  - https://seasoasa.ucla.edu/curric-25-26/71-mechaero-cours-25.html (Mechanical and Aerospace Engineering)
  - https://seasoasa.ucla.edu/curric-25-26/64-matsci-cours-25.html (Materials Science)
  - https://seasoasa.ucla.edu/curric-25-26/57-ece-cours-25.html (Electrical and Computer Engineering)
  - https://seasoasa.ucla.edu/curric-25-26/74-schlwd-25.html (School-wide courses)
- MAE term offerings: https://seasoasa.ucla.edu/mae-course-term-offerings/
- Technical breadth area (TBA) list: https://seasoasa.ucla.edu/undergraduates/undergraduate-technical-breadth-area-tba

- UCLA General Catalog 2026-27 (all undergraduate courses), see "Course database" below. `courses.js` adds hand-checked quarter offerings and notes for the Aerospace Engineering major on top of it.

## Limitations

- Prerequisites come from the catalog's requisite sentences. 291 courses have wording too irregular to parse; their raw catalog text shows in the detail panel instead of tree links.
- The catalog no longer publishes which quarters a course is offered. Offerings are known only for engineering courses (2025-26 Samueli pages, plus the 2026-27 MAE schedule). Everything else is assumed to be offered every quarter.
- The parser is tested on two real audits (Aerospace and Bioengineering, both UCLA Samueli) plus 13 synthetic audits covering Letters & Science, Arts, TFT, Music, Nursing, Luskin, Education, minors, double majors, transfer students and failed or withdrawn courses. The synthetic ones are modeled on the engine's documented format, not on real UCLA printouts. If your audit shows "lines were not understood", use "Copy diagnostic" and send it to the maintainer.
- When an audit's course-count check disagrees with its itemized requirements, the app flags the mismatch rather than guessing which is right.
- The audit is the source of truth. Confirm your plan with a counselor.

## Course database

`data/ucla-courses.js` sets `UCLA_COURSES`, which covers every UCLA undergraduate course (about 9,100 courses in 182 subject areas).
It uses the same shape as `courses.js`: `{ t, u, pre, off, req?, w2?, last? }`.
It is generated by `scripts/build-course-db.mjs` (see `scripts/README.md`) from the 2026-27 UCLA General Catalog.

- Keys use the Registrar/DARS subject codes (`MECH&AE 102`, `COM SCI 32`, `C&EE M20`).
- `u` is the unit count. For a range such as "2 to 4", it is the maximum.
- `pre` is parsed from the catalog's "Requisite(s)" and "Enforced requisite(s)" sentences. Recommended preparation, corequisites, courses that "may be taken concurrently" and grade minimums are left out. An alternative that is not a course (a placement test or a GPA) drops that group. When the text can't be parsed, `pre` is `[]` and the raw sentence is kept in `req`.
- `off` comes from the Samueli 2025-26 pages and covers engineering subjects only (about 320 courses). Everywhere else it is `"?"`. The UCLA catalog does not publish quarters offered.
- `last` marks a course that was dropped from the current catalog. Its value is the last catalog year that listed it (2021-2025). These courses are kept because DARS still shows them.
- `courses.js` stays the hand-checked overlay for the Aerospace Engineering major. Its `off` values come from the MAE 2026-27 term-offerings page.
