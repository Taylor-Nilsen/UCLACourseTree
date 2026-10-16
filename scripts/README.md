# scripts

## build-course-db.mjs

Regenerates `data/ucla-courses.js` (every UCLA undergraduate course) from the UCLA General Catalog.

```
node scripts/build-course-db.mjs                    # current catalog year, cache in $TMPDIR/ucla-catalog-cache
node scripts/build-course-db.mjs --year 2027 --cache ./catalog-cache
node test/coursedb.test.mjs                         # sanity checks on the output
```

Plain Node 22, no dependencies. A cold run makes about 900 requests (one POST per 100 courses per catalog year,
for the current year and each older year the site offers) and takes about 8 minutes; a rerun against the cache takes seconds.
Delete the cache directory to refetch.

What it reads:
- `catalog.registrar.ucla.edu/api/search/browsepage-academic-items`, the JSON API the catalog's own pages call.
  The `availableInYears` filter returns one catalog year in full. Each item carries the title, units (`credit_points_header`),
  level and the full description. The requisite sentence is part of the description.
- The Registrar's "Department and Subject Area Codes" table, which maps "Mechanical and Aerospace Engineering" to `MECH&AE`.
  Requisite prose names other subjects in full. Short names used in the prose ("Chemistry", "Civil Engineering") are
  mapped in `ALIASES`.
- The Samueli 2025-26 course pages (`SEAS_PAGES`). These are the only bulk source that states quarters offered, as "(F,W,Sp)".
  The catalog no longer prints offerings. Next year, update `SEAS` and the page names. If those pages move, `off` becomes "?".

The run prints counts, the most common dangling references and the stale alternatives it pruned. If a subject name in the
prose is mapped wrongly, it shows up there as a dangling `XYZ 123` reference. Fix it by adding an entry to `ALIASES`.
