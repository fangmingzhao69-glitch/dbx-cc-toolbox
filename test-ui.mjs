import puppeteer from 'puppeteer-core';

const edgePaths = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
];
let executablePath = null;
for (const p of edgePaths) { try { const fs = await import('node:fs'); if (fs.existsSync(p)) { executablePath = p; break; } } catch {} }
if (!executablePath) throw new Error('Edge not found');

const browser = await puppeteer.launch({ executablePath, headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
const page = await browser.newPage();
await page.setViewport({ width: 1500, height: 950 });
const errors = [];
page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
page.on('pageerror', (err) => errors.push(String(err)));
await page.goto('http://127.0.0.1:5199/index.html', { waitUntil: 'networkidle0' });
await page.waitForSelector('table.jgrid', { timeout: 8000 });

const results = [];
const check = (name, ok) => results.push((ok ? 'PASS ' : 'FAIL ') + name);

check('root table rendered', await page.$('table.jgrid') !== null);
check('findbar hidden by default', await page.evaluate(() => document.querySelector('#findbar').offsetParent === null));
check('filter panel hidden by default', await page.evaluate(() => document.querySelector('#filter-panel').offsetParent === null));
check('badge count exists', await page.evaluate(() => (document.querySelector('.badge')?.textContent || '').includes('[')));

// 展开 qcResults
const toggles = await page.$$('.tgl');
check('has toggle buttons', toggles.length > 0);
await toggles[0].click();
await new Promise((r) => setTimeout(r, 400));
const nested = await page.evaluate(() => {
  const boxes = [...document.querySelectorAll('.nested-box')].filter((b) => !b.hidden);
  return boxes.map((box) => ({ rows: box.querySelectorAll('tr.row').length, tables: box.querySelectorAll('table.jgrid').length, text: box.textContent.slice(0, 40) }));
});
console.log('nested after expand:', JSON.stringify(nested));
check('nested table appeared', nested.length > 0 && nested[0].tables > 0);
check('nested rows rendered', nested.length > 0 && nested[0].rows >= 2);
await page.screenshot({ path: 'E:/cxgj/AIgonzhuoqu/XMWJ/_json-analysis/_shots/dbx-plugin-expand.png' });

// 展开二级 documentIds
const boxHTML = await page.evaluate(() => {
  const box = [...document.querySelectorAll('.nested-box')].find((b) => !b.hidden);
  return box ? box.innerHTML.slice(0, 120) : '';
});
console.log('nested head:', boxHTML.replace(/\s+/g, ' ').slice(0, 120));
const secondToggle = await page.evaluateHandle(() => {
  const box = [...document.querySelectorAll('.nested-box')].find((b) => !b.hidden);
  return box ? box.querySelector('.tgl') : null;
});
if (secondToggle.asElement()) {
  await secondToggle.asElement().click();
  await new Promise((r) => setTimeout(r, 400));
  const deep = await page.evaluate(() => [...document.querySelectorAll('.nested-box')].filter((b) => !b.hidden).length);
  check('second level expand works', deep >= 2);
  await page.screenshot({ path: 'E:/cxgj/AIgonzhuoqu/XMWJ/_json-analysis/_shots/dbx-plugin-expand2.png' });
} else {
  check('second level toggle exists', false);
}

// 高级筛选
await page.click('[data-act="filter"]');
await new Promise((r) => setTimeout(r, 250));
check('filter panel opens', await page.evaluate(() => { const el = document.querySelector('#filter-panel'); return !el.hidden && el.getBoundingClientRect().height > 0; }));
await page.evaluate(() => { document.querySelector('#filter-code').value = 'return Array.isArray(data) ? data : { only: data.qcCode };'; });
await page.click('#filter-apply');
await new Promise((r) => setTimeout(r, 400));
check('filter applied', await page.evaluate(() => document.querySelector('#grid').textContent.includes('only')));
await page.click('#filter-close');

// 格式化 / 清空 / 示例
await page.click('[data-act="minify"]');
await new Promise((r) => setTimeout(r, 400));
const singleLine = await page.evaluate(() => document.querySelector('#editor').value.split('\n').length);
check('minify works', singleLine === 1);
await page.click('[data-act="format"]');
await new Promise((r) => setTimeout(r, 400));
check('format works', await page.evaluate(() => document.querySelector('#editor').value.split('\n').length > 5));

// CSV 导出：直接调用渲染器函数校验
const csv = await page.evaluate(async () => {
  const mod = await import('/js/json-grid.js');
  return mod.toCsv([{ a: 1, b: 'x' }, { a: 2, b: null }]);
});
check('csv export works', csv.startsWith('a,b') && csv.includes('x'));

console.log(results.join('\n'));
if (errors.length) console.log('console errors: ' + errors.slice(0, 3).join(' | '));
const failed = results.filter((r) => r.startsWith('FAIL'));
await browser.close();
if (failed.length) { console.log('FAILED: ' + failed.length); process.exit(1); }
console.log('ALL UI CHECKS OK');
