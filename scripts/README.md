# scripts

## build-instructors.mjs

Regenerates `data/ucla-instructors.js` (the instructors the Schedule of Classes lists for the next term, and which courses and
instructors have no open section). Grades need no build:
the browser reads them from uclagrades.com.

```
node scripts/build-instructors.mjs                  # next term by today's date; caches in $TMPDIR/ucla-instructors-cache
node scripts/build-instructors.mjs --term 27W --cache ./instructors-cache
```

Plain Node 22, no dependencies. Run it after `build-course-db.mjs`, and again when the Schedule of Classes publishes
instructors for a new term or posts a new term. About 2,500 requests, 6 minutes cold. Seats change by the hour during enrollment: delete the cache
and rerun whenever you want a fresh snapshot (the file records its date as `asOf`).

- Every Fall/Winter/Spring term the site's term menu offers from the next term on is read for its course list (`listed`):
  one set of `CourseTitlesView` pages per subject per term. The planner treats those terms as published: a course runs there
  only if it is listed.
- For the next term only: after the `CourseTitlesView` pages, one `/Results/GetCourseSummary?model=...` per course (the
  `model` JSON is in the titles page). Names come as "Keranen, J.P."; "Tentative" and "The Staff" are skipped.
  A term further out than the next one lists only "Tentative".
- Each section's status column reads "Open ...", "Waitlist ..." or "Closed / Class Full (210)". A course or instructor gets
  `st: 'full'` when no section is open and none takes a waitlist, `st: 'wait'` when none is open and one takes a waitlist.
  "Closed by Dept" and cancelled sections are ignored.
- The Schedule of Classes sends no `Access-Control-Allow-Origin` header, so a browser on another site cannot make these
  requests. That is why this part is a file and not a live lookup.

## build-course-db.mjs

Regenerates `data/ucla-courses.js` (every UCLA undergraduate course, with the quarters it was offered) from the UCLA General
Catalog and the UCLA Schedule of Classes.

```
node scripts/build-course-db.mjs                    # current catalog year; caches in $TMPDIR/ucla-catalog-cache and $TMPDIR/ucla-soc-cache
node scripts/build-course-db.mjs --year 2027 --cache ./catalog-cache --soc-cache ./soc-cache
node test/coursedb.test.mjs                         # sanity checks on the output
```

Plain Node 22, no dependencies. A cold run makes about 900 catalog requests (one POST per 100 courses per catalog year, for
the current year and each older year the site offers) and about 4,600 Schedule of Classes requests (at most 4 at a time,
each retried up to 5 times). It takes about 25 minutes; a rerun against the caches takes seconds. Delete a cache directory to
refetch it. The Schedule of Classes cache is the one to clear when a new term is published.

What it reads:
- `catalog.registrar.ucla.edu/api/search/browsepage-academic-items`, the JSON API the catalog's own pages call.
  The `availableInYears` filter returns one catalog year in full. Each item carries the title, units (`credit_points_header`),
  level and the full description. The requisite sentence is part of the description.
- The Registrar's "Department and Subject Area Codes" table, which maps a subject's full name to its DARS code
  ("Computer Science" to `COM SCI`). Requisite prose names other subjects in full. Short names used in the prose
  ("Chemistry", "Civil Engineering") are mapped in `ALIASES`.
- The Schedule of Classes at `sa.ucla.edu/ro/public/soc`, no login needed:
  - `/ro/Public/SOC` (the search page) gives the term the site opens on, for example `26F`.
  - `/ro/Public/SOC/Results/CourseTitlesView?search_by=subject&model={subj_area_cd, term_cd, ...}&pageNumber=N&filterFlags={...}`
    is the HTML fragment the results page loads, 25 courses per page. `filterFlags.enrollment_status` is `O,W,C,T,S`
    (open, waitlisted, closed, tentative, not available), which leaves out courses whose every section was cancelled.
  - The script asks for every subject in the database and every Fall, Winter and Spring term from Fall two academic years back
    through the term after the current one (with `26F` current: `24F` to `27W`). That is the window. Summer is left out.
  - It also reads the 9 terms before the window, only to date `offNote`.

What it writes, per course:
- `off`: the quarters (`F`, `W`, `S`) with a live section in the window; `offTerms`: those terms, oldest first.
- `off: ""` and `offNote: "not offered since <Season Year>"` when the course had no section in the window
  (`"not offered since before Fall 2021"` when it had none in the lookback either).
- `off: "?"` with an `offNote` for a tutorial (catalog entry starts with "Tutorial", such as most 199s) that had no listed
  section: many departments enroll those by contract, so the Schedule of Classes never shows them.

The run prints counts, the most common dangling references and the stale alternatives it pruned. If a subject name in the
prose is mapped wrongly, it shows up there as a dangling `XYZ 123` reference. Fix it by adding an entry to `ALIASES`.
