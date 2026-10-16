// UCLA course database for the Aerospace Engineering BS (2025-26 catalog).
// Source: seasoasa.ucla.edu/curric-25-26 course pages + MAE 2026-27 term offerings page.
// pre: array of AND-groups; each AND-group is an array of OR-alternatives. off: quarters offered (F/W/S); '' = not offered 2025-27.
// w2: satisfies Writing II. rec: tie-break weight for recommendations (aero relevance), optional.
(function (g) {
  const C = {
    // ---- lower division (prereqs among these are from the standard UCLA sequence; all completed on Taylor's DARS)
    'MATH 31A': { t: 'Differential and Integral Calculus', u: 4, pre: [], off: 'FWS' },
    'MATH 31B': { t: 'Integration and Infinite Series', u: 4, pre: [['MATH 31A']], off: 'FWS' },
    'MATH 32A': { t: 'Calculus of Several Variables', u: 4, pre: [['MATH 31B']], off: 'FWS' },
    'MATH 32B': { t: 'Calculus of Several Variables', u: 4, pre: [['MATH 32A']], off: 'FWS' },
    'MATH 33A': { t: 'Linear Algebra and Applications', u: 4, pre: [['MATH 31B']], off: 'FWS' },
    'PHYSICS 1A': { t: 'Mechanics', u: 5, pre: [['MATH 31A']], off: 'FWS' },
    'PHYSICS 1B': { t: 'Oscillations, Waves, Electric and Magnetic Fields', u: 5, pre: [['PHYSICS 1A'], ['MATH 31B']], off: 'FWS' },
    'PHYSICS 1C': { t: 'Electrodynamics, Optics, and Special Relativity', u: 5, pre: [['PHYSICS 1B'], ['MATH 32A']], off: 'FWS' },
    'PHYSICS 4AL': { t: 'Mechanics Laboratory', u: 2, pre: [['PHYSICS 1A']], off: 'FWS' },
    'PHYSICS 4BL': { t: 'Electricity and Magnetism Laboratory', u: 2, pre: [['PHYSICS 1B']], off: 'FWS' },
    'CHEM 20A': { t: 'Chemical Structure', u: 4, pre: [], off: 'FWS' },
    'CHEM 20B': { t: 'Chemical Energetics and Change', u: 4, pre: [['CHEM 20A']], off: 'FWS' },
    'CHEM 20L': { t: 'General Chemistry Laboratory', u: 3, pre: [['CHEM 20A'], ['CHEM 20B']], off: 'FWS', note: '20B may be taken concurrently.' },
    'ENGCOMP 3': { t: 'English Composition, Rhetoric, and Language', u: 5, pre: [], off: 'FWS' },
    'COM SCI 31': { t: 'Introduction to Computer Science I', u: 4, pre: [], off: 'FWS' },
    'MECH&AE 1': { t: 'Undergraduate Seminar', u: 1, pre: [], off: 'F' },
    'MECH&AE M20': { t: 'Intro to Computer Programming with MATLAB', u: 4, pre: [['MATH 33A']], off: 'S' },
    // ---- MAE core
    'MECH&AE 82': { t: 'Mathematics of Engineering', u: 4, pre: [['MATH 33A']], off: 'FWS' },
    'MECH&AE 94': { t: 'Intro to Computer-Aided Design and Drafting', u: 4, pre: [], off: 'FWS' },
    'MECH&AE 101': { t: 'Statics and Strength of Materials', u: 4, pre: [['MATH 31A'], ['MATH 31B'], ['PHYSICS 1A']], off: 'FWS' },
    'MECH&AE 102': { t: 'Dynamics of Particles and Rigid Bodies', u: 4, pre: [['MECH&AE 101'], ['MATH 33A'], ['PHYSICS 1A']], off: 'FWS' },
    'MECH&AE 103': { t: 'Elementary Fluid Mechanics', u: 4, pre: [['MATH 32B'], ['MATH 33A'], ['PHYSICS 1B']], off: 'FWS' },
    'MECH&AE 105A': { t: 'Intro to Engineering Thermodynamics', u: 4, pre: [['CHEM 20B'], ['MATH 32B']], off: 'FWS' },
    'MECH&AE 105D': { t: 'Transport Phenomena', u: 4, pre: [['MECH&AE 82'], ['MECH&AE 103'], ['MECH&AE 105A']], off: 'FWS' },
    'MECH&AE 107': { t: 'Modeling and Analysis of Dynamic Systems', u: 4, pre: [['MECH&AE M20', 'COM SCI 31'], ['MECH&AE 82'], ['EC ENGR 100']], off: 'FWS', note: 'Enforced requisites.' },
    'MECH&AE 150A': { t: 'Intermediate Fluid Mechanics', u: 4, pre: [['MECH&AE 82'], ['MECH&AE 103']], off: 'FW', note: 'Enforced requisites.' },
    'MECH&AE 150B': { t: 'Aerodynamics', u: 4, pre: [['MECH&AE 103'], ['MECH&AE 150A']], off: 'S' },
    'MECH&AE C150P': { t: 'Aircraft Propulsion Systems', u: 4, pre: [['MECH&AE 105A'], ['MECH&AE 150A']], off: 'F' },
    'MECH&AE C150R': { t: 'Rocket Propulsion Systems', u: 4, pre: [['MECH&AE 103'], ['MECH&AE 105A']], off: 'S', note: 'Enforced requisites.', rec: 2 },
    'MECH&AE 154A': { t: 'Preliminary Design of Aircraft', u: 4, pre: [['MECH&AE 154S']], off: 'W', note: 'Enforced requisite.' },
    'MECH&AE 154S': { t: 'Flight Mechanics, Stability, and Control of Aircraft', u: 4, pre: [['MECH&AE 150A'], ['MECH&AE 150B']], off: 'F' },
    'MECH&AE 157': { t: 'Basic MAE Laboratory', u: 4, pre: [['MECH&AE 101'], ['MECH&AE 102'], ['MECH&AE 103'], ['MECH&AE 105A'], ['MECH&AE 105D'], ['EC ENGR 100']], off: '', note: 'Not offered 2025-26 or 2026-27. Take 157W instead.' },
    'MECH&AE 157W': { t: 'Basic MAE Laboratory with Writing', u: 6, pre: [['MECH&AE 101'], ['MECH&AE 102'], ['MECH&AE 103'], ['MECH&AE 105A'], ['MECH&AE 105D'], ['EC ENGR 100']], off: 'FWS', w2: true, note: 'Satisfies Writing II (Engineering Writing).' },
    'MECH&AE 157D': { t: 'Aerospace Design Laboratory I', u: 4, pre: [['MECH&AE 105A'], ['MECH&AE 150A'], ['MECH&AE 157', 'MECH&AE 157W'], ['MECH&AE 171A']], off: 'W', note: 'Winter only, seniors. Must be followed by 157E the next Spring.' },
    'MECH&AE 157E': { t: 'Aerospace Design Laboratory II', u: 4, pre: [['MECH&AE 157D']], off: 'S', note: 'Spring only. 171A recommended.' },
    'MECH&AE 161A': { t: 'Intro to Astronautics', u: 4, pre: [['MECH&AE 102']], off: 'F', note: 'Enforced requisite 102. 82 recommended.', rec: 1 },
    'MECH&AE 161B': { t: 'Intro to Space Technology', u: 4, pre: [], off: 'W', note: 'No enforced requisite. Recommended prep: 102, 161A.' },
    'MECH&AE 161C': { t: 'Spacecraft Design', u: 4, pre: [['MECH&AE 161B']], off: 'S', note: 'Enforced requisite.' },
    'MECH&AE 166A': { t: 'Analysis of Aerospace Structures', u: 4, pre: [['MECH&AE 82'], ['MECH&AE 101']], off: 'F', note: 'Fall only.' },
    'MECH&AE 171A': { t: 'Intro to Feedback and Control Systems', u: 4, pre: [['MECH&AE 107']], off: 'FWS', note: 'Enforced requisite.' },
    'EC ENGR 100': { t: 'Electrical and Electronic Circuits', u: 4, pre: [['MATH 33A'], ['MATH 33B', 'MECH&AE 82'], ['PHYSICS 1C']], off: 'FWS' },
    // ---- Materials Science (TBA candidates = MAT SCI 100-187)
    'MAT SCI 104': { t: 'Science of Engineering Materials', u: 4, pre: [['CHEM 20A'], ['CHEM 20B'], ['CHEM 20L'], ['PHYSICS 1A']], off: 'FWS' },
    'MAT SCI 105': { t: 'Principles of Nanoscience and Nanotechnology', u: 4, pre: [['CHEM 20A'], ['CHEM 20B'], ['PHYSICS 1C']], off: 'F' },
    'MAT SCI 110L': { t: 'Materials Characterization A Laboratory', u: 2, pre: [['MAT SCI 104']], off: 'F' },
    'MAT SCI 120': { t: 'Physics of Materials', u: 4, pre: [['MAT SCI 104'], ['MAT SCI 110']], off: 'W' },
    'MAT SCI 122': { t: 'Principles of Electronic Materials Processing', u: 4, pre: [['MAT SCI 104']], off: 'W' },
    'MAT SCI 130': { t: 'Phase Relations in Solids', u: 4, pre: [['MAT SCI 104']], off: 'F', rec: 1 },
    'MAT SCI 131': { t: 'Diffusion and Diffusion-Controlled Reactions', u: 4, pre: [['MAT SCI 130']], off: 'W' },
    'MAT SCI 132': { t: 'Structure and Properties of Metallic Alloys', u: 4, pre: [['MAT SCI 131']], off: 'S' },
    'MAT SCI 141L': { t: 'Computer Methods and Instrumentation in Materials Science', u: 2, pre: [], off: 'W' },
    'MAT SCI 143A': { t: 'Mechanical Behavior of Materials', u: 4, pre: [['MAT SCI 104'], ['MECH&AE 101']], off: 'W', rec: 3 },
    'MAT SCI 150': { t: 'Introduction to Polymers', u: 4, pre: [], off: 'W', rec: 1 },
    'MAT SCI 151': { t: 'Structure and Properties of Composite Materials', u: 4, pre: [['MAT SCI 104']], off: 'S', rec: 3 },
    'MAT SCI 160': { t: 'Introduction to Ceramics and Glasses', u: 4, pre: [['MAT SCI 104'], ['MAT SCI 130']], off: 'F' },
    'MAT SCI 161L': { t: 'Laboratory in Ceramics', u: 2, pre: [['MAT SCI 160']], off: 'S' },
    'MAT SCI 162': { t: 'Electronic Ceramics', u: 4, pre: [['MAT SCI 104'], ['PHYSICS 1C']], off: '', note: 'Not offered 2025-26.' },
    // ---- ethics / writing
    'ENGR 2': { t: 'Technology and Society', u: 2, pre: [], off: 'FWS', note: 'Ethics option for Aerospace majors. Does NOT satisfy Engineering Writing.' },
    'ENGR 181EW': { t: 'Ethical Negotiation in Technology', u: 4, pre: [['ENGCOMP 3']], off: 'FWS', w2: true },
    'ENGR 182EW': { t: 'Technology and Law', u: 4, pre: [['ENGCOMP 3']], off: 'FWS', w2: true },
    'ENGR 183EW': { t: 'Engineering and Society', u: 4, pre: [['ENGCOMP 3']], off: 'FWS', w2: true },
    'ENGR 184': { t: 'Humanities-Informed STEM', u: 4, pre: [], off: 'FWS' },
    'ENGR 185EW': { t: 'Art of Engineering Endeavors', u: 4, pre: [['ENGCOMP 3']], off: 'FWS', w2: true },
    'ENGR 186': { t: 'Ethics for Computer Scientists', u: 4, pre: [], off: 'F' },
    'ENGR 186W': { t: 'Ethics for Computer Scientists (W)', u: 5, pre: [['ENGCOMP 3']], off: 'F', w2: true },
    'ENGR 188EW': { t: 'Experimental Courses in Engineering Ethics', u: 4, pre: [['ENGCOMP 3']], off: 'FWS', w2: true },
  };
  // Courses the DARS lists under a different id that mean the same thing for prereq purposes.
  const ALIAS = { 'MATH T03': 'MATH 31B', 'CHEM T01': 'CHEM 20A' };
  // Merge with the UCLA-wide catalog database (data/ucla-courses.js). Catalog prereqs win; the hand-entered
  // entries above only contribute what the catalog lacks: quarters offered (2026-27 MAE schedule), notes, rec.
  const U = (typeof module !== 'undefined' ? require('./data/ucla-courses.js').UCLA_COURSES : g.UCLA_COURSES) || {};
  const ALL = Object.assign({}, U);
  for (const [k, c] of Object.entries(C)) ALL[k] = U[k] ? Object.assign({}, U[k], { off: c.off, note: c.note, rec: c.rec, w2: c.w2 || U[k].w2 }) : c;
  g.COURSES = ALL; g.ALIAS = ALIAS;
})(typeof module !== 'undefined' ? module.exports : window);
