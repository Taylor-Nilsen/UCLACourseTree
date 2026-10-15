# DARS Skill Tree

Upload your UCLA DARS degree-audit PDF and get a prerequisite "skill tree" plus a quarter-by-quarter plan to graduation. Built for the Aerospace Engineering BS. Everything runs in your browser; the PDF is not uploaded anywhere.

## What it does

- Reads your audit: completed courses, courses in progress, what each requirement group still needs, and your expected graduation term.
- Draws the remaining courses as a tree, with arrows from prerequisites to the courses they unlock.
- Suggests which courses to take and spreads them over the quarters you have left, respecting prerequisites and when each course is offered.
- Lets you pin your own choice wherever a requirement offers several courses.

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

## How recommendations work

For each requirement that offers a choice, the app prefers the course with the fewest unmet prerequisites. Courses that are not offered in the quarters you have left are penalized. One course may count toward both the ethics and the writing requirement when the audit allows it. If two courses tie, the one more relevant to aerospace wins. The plan then places courses in the earliest quarter where their prerequisites are met and they are offered.

## Pin alternatives

Each requirement group shows the courses the app chose and the other options. Pick a different course for a group and the tree and plan rebuild around your choice. Pins are not saved between visits.

## Data sources

- UCLA Samueli 2025-26 catalog course pages:
  - https://seasoasa.ucla.edu/curric-25-26/71-mechaero-cours-25.html (Mechanical and Aerospace Engineering)
  - https://seasoasa.ucla.edu/curric-25-26/64-matsci-cours-25.html (Materials Science)
  - https://seasoasa.ucla.edu/curric-25-26/57-ece-cours-25.html (Electrical and Computer Engineering)
  - https://seasoasa.ucla.edu/curric-25-26/74-schlwd-25.html (School-wide courses)
- MAE term offerings: https://seasoasa.ucla.edu/mae-course-term-offerings/
- Technical breadth area (TBA) list: https://seasoasa.ucla.edu/undergraduates/undergraduate-technical-breadth-area-tba

The course data is in `courses.js`.

## Limitations

- The course database covers the Aerospace Engineering major only. Courses outside it (including general education) have no prerequisite data.
- Prerequisites among lower-division courses you have already completed were entered from the standard sequence and not re-verified.
- Offerings are the 2026-27 MAE schedule. Departments change it, so check the schedule before you enroll.
- General education options come straight from the audit and have no prerequisite data.
- The audit's course-count check asks for 7 departmental/TBA courses, while the itemized requirements add up to 6. The app flags this mismatch rather than guessing which is right.
- The audit is the source of truth. Confirm your plan with a counselor.
