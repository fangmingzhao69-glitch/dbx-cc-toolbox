import { parseJsonDocument, renderRoot, toCsv, summarize } from './ui/js/json-grid.js';

const sample = {
  id: 1,
  name: 'demo',
  tags: ['a', 'b'],
  nested: { x: 1, inner: { y: [1, 2, 3] } },
  rows: [
    { a: 1, b: 'x', arr: [1, 2] },
    { a: 2, b: null },
  ],
};

const parsed = parseJsonDocument(JSON.stringify(sample));
if (!parsed.ok) throw new Error('parse failed');
const html = renderRoot(parsed.data);
const checks = [
  ['has object table', html.includes('class="jgrid kv"')],
  ['has object array table', html.includes('class="jgrid objarray"')],
  ['has count badge', html.includes('class="badge"') && html.includes('[3]')],
  ['has toggle buttons', (html.match(/class="tgl"/g) || []).length >= 3],
  ['nested hidden by default', html.includes('hidden')],
  ['has type class string', html.includes('class="v string"')],
  ['has null', html.includes('class="v null"')],
];
for (const [name, ok] of checks) console.log((ok ? 'PASS ' : 'FAIL ') + name);
if (checks.some(([, ok]) => !ok)) process.exit(1);

const csv = toCsv(sample.rows);
console.log('CSV:\n' + csv);
console.log('summary:', JSON.stringify(summarize(sample)));

// 解析错误定位
const bad = parseJsonDocument('{\n  "a": 1,\n  "b": }');
console.log('bad ok=' + bad.ok + ' line=' + (bad.error && bad.error.line) + ' msg=' + (bad.error && bad.error.message).slice(0, 40));
console.log('ALL OK');
