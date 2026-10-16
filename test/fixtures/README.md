# Parser fixtures (SYNTHETIC)

Every file here is a **synthetic** UCLA DARS audit written by hand for tests. None is a real student's audit.
They copy the layout of the two real audits in `sample/` (header block, program table, section / group / data /
continuation / annotation columns, print chrome) and use line shapes documented for the CollegeSource u.achieve
engine that UCLA DARS runs on. Course codes are plausible UCLA codes; program codes (`LS0598` etc.), counseling unit
names and the requirement wording for non-engineering schools are invented. A synthetic fixture shows the parser
handles a shape; it does not prove a real audit for that school prints the shape that way.

Each file is `[{x, line}]`, the same format `DARS.linesFromItems` produces from a PDF. Column x positions follow one of
three layouts: `dars` (the DARS site's own PDF, like `sample/dars-lines.json`), `print` (browser print with wider margins
and page chrome, like `sample/dars-lines-2.json`) and `narrow` (smaller margins).

| File | Stands in for | Notable shapes |
|---|---|---|
| `ls-psychology.json` | Letters & Science, Psychology BA | Writing II, foreign language, diversity, GE `NEEDS: 1 SUB-GROUP`, units-only GE need, `TO` range with `NOT FROM` list, digit-bearing group title right after a `SELECT FROM` |
| `eng-computer-science.json` | Engineering, Computer Science BS | `COM SCI 1@@` wildcard, `NOT FROM`, undeclared technical breadth, expired date window, `TA` transfer grade, page chrome |
| `arts-design-media-arts.json` | Arts & Architecture, Design Media Arts BA | `Earned:` / `In-Progress:` lines, `NEEDS: 2 SUB-GROUPS`, lone `R` marker line, range plus list |
| `tft-film-television.json` | Theater, Film & Television, Film & TV BA | `OR)` alternative group, `NP` on a required course, range with letter suffixes (`122M TO 122T`) |
| `music-performance.json` | School of Music, Music Performance BM | repeatable course over several terms with `>R` / `(R)` flags, units-only need |
| `nursing-bs.json` | School of Nursing, Nursing BS | `AND)` connector, `MINIMUM 'C' GRADE REQUIRED` note under a group title |
| `luskin-public-affairs.json` | Luskin, Public Affairs BA | range and course list mixed in one `SELECT FROM` |
| `education-est.json` | Education & Information Studies, Education and Social Transformation BA | grade note as the only group title, `NOT FROM` |
| `double-major-econ-polisci.json` | Double major (MAJOR1 Economics, MAJOR2 Political Science) | program table with two majors, `MAJOR1: ECONOMICS` / `MAJOR2: POLITICAL SCIENCE` headers in the body |
| `minor-stats-ftvdm.json` | Major plus minor (MINOR1 Film, Television, and Digital Media) | program name and `... MINOR` as body headers |
| `transfer-igetc-economics.json` | Transfer student, IGETC certified | `ADVANCED STANDING`, `TA`/`TB+`/`TP`/`UA` transfer grades, `T01` course with `ALTERNATE CRS:` |
| `failed-withdrawn-repeats.json` | Student with failed, withdrawn, incomplete and repeated courses | `F >D` then `B+ >R`, `W` then `IP`, `NP`, `I`, `DR`, `NR`, `U`, `WF`, unknown grade `Q`, `RP` |
| `hostile-psychology.json` | Worst case | page break splitting a `SELECT FROM` list mid-date-window, section header repeated after the break, Chrome / Firefox / Safari print chrome, inline `OK`/`NO`/`IP`/`+`/`-`/`-R`/`IP+` markers, unknown `~` and `??` markers, `-->` arrow, `NEEDS` with units and courses, `@` / `**` / `XX` wildcards, `NOT FROM` range, two-line section title, malformed `NEEDS` and course lines |

Expected parse results for every file are in `test/parser.test.mjs` (`FIX`). When a real audit shows a shape these
fixtures get wrong, add the real (redacted) lines as a new fixture rather than editing these to match.
