import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const { DARS } = require('../parser.js');
const { MODEL } = require('../model.js');
const { EXPORT } = require('../export.js');
const load = f => JSON.parse(readFileSync(new URL('../' + f, import.meta.url), 'utf8'));
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok  ' + name); };

function check(file, opts = { perQuarter: 4 }) {
  const lines = load(file), parsed = DARS.parse(lines), m = MODEL.build(parsed, opts), html = EXPORT.buildDocument(m, parsed);
  const unesc = s => s.replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"');
  t(file + ': one row per plan term, in order', () => {
    const body = html.slice(html.indexOf('<tbody>'), html.indexOf('</tbody>'));
    const terms = [...body.matchAll(/<tr><td class="term">([A-Za-z]+ \d{4})/g)].map(x => x[1]);
    assert.deepEqual(terms, m.plan.map(q => EXPORT.termLabel(q.term)));
    assert.equal((body.match(/<tr>/g) || []).length, m.plan.length);
  });
  t(file + ': every planned course code appears', () => {
    const text = unesc(html);
    for (const c of m.plan.flatMap(q => q.courses).filter(c => !/^(GE|CHOOSE): /.test(c))) assert.ok(text.includes('<b>' + c + '</b>'), c);
  });
  t(file + ': no student name or ID', () => {
    const header = lines.map(l => l.line).find(l => / \/ \d{9}/.test(l)), m2 = /- (.+?) \/ (\d{9})/.exec(header || '');
    assert.ok(m2, 'sample header line has name / ID');
    assert.ok(!html.includes(m2[1]) && !html.includes(m2[2]) && !html.includes(header));
  });
  t(file + ': monochrome (only black, white, greys)', () => {
    const grey = h => { h = h.length === 4 ? h.replace(/[0-9a-f]/gi, x => x + x) : h; return h.slice(1, 3) === h.slice(3, 5) && h.slice(3, 5) === h.slice(5, 7); };
    for (const [h] of html.matchAll(/#[0-9a-f]{6}\b|#[0-9a-f]{3}\b/gi)) assert.ok(grey(h.toLowerCase()), h);
    assert.ok(!/\b(rgba?|hsla?)\(/i.test(html));
    assert.ok(!/(?:color|fill|stroke)\s*[:=]\s*"?(?!#|none|inherit|currentColor)[a-z]{3,}/i.test(html.replace(/(?:color|fill|stroke)\s*[:=]\s*"?(black|white|gr[ae]y)\b/gi, '')));
  });
  t(file + ': one connector per prereq edge between rendered boxes', () => {
    const svgs = [...html.matchAll(/<svg class="tree"[\s\S]*?<\/svg>/g)].map(x => x[0]);
    assert.ok(svgs.length >= 1);
    let total = 0;
    for (const svg of svgs) {
      const col = new Map([...svg.matchAll(/data-code="([^"]+)" data-col="(\d+)"/g)].map(x => [unesc(x[1]), +x[2]]));
      const drawn = new Set([...svg.matchAll(/class="edge" data-from="([^"]+)" data-to="([^"]+)"/g)].map(x => unesc(x[1]) + '>' + unesc(x[2])));
      const want = m.edges.filter(e => col.has(e.from) && col.get(e.to) > 0); // edges inside the Completed column are not drawn
      assert.equal(drawn.size, (svg.match(/class="edge"/g) || []).length, 'no duplicate connectors');
      assert.deepEqual([...drawn].sort(), want.map(e => e.from + '>' + e.to).sort());
      total += want.length;
    }
    assert.ok(total > 0);
  });
  return { m, html };
}

check('sample/dars-lines.json');
const { html: h2 } = check('sample/dars-lines-2.json');
t('pending decisions and choose slots', () => {
  assert.ok(h2.includes('Bioengineering Capstone: BIOENGR 177A + 177B, or BIOENGR 177C'));
  assert.ok(h2.includes('<i>Choose: Bioengineering Capstone</i>'));
});
t('term names', () => {
  assert.equal(EXPORT.termLabel('WI27'), 'Winter 2027');
  assert.equal(EXPORT.termLabel('FA26'), 'Fall 2026');
  assert.equal(EXPORT.termLabel('SU28'), 'Summer 2028');
});
t('long plans split the tree across pages', () => {
  const parsed = DARS.parse(load('sample/dars-lines.json')), m = MODEL.build(parsed, { perQuarter: 3 });
  const html = EXPORT.buildDocument(m, parsed), pages = (html.match(/<svg class="tree"/g) || []).length;
  assert.equal(pages, Math.ceil(m.plan.length / 6));
  if (pages > 1) assert.ok(html.includes('continued') && html.includes('Completed / earlier'));
});
console.log(n + ' export tests passed');
