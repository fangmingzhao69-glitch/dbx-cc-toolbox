import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

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
  const nestedHeight = await page.evaluate(() => {
    const block = document.querySelector('.nested-box .table-block');
    return block ? getComputedStyle(block).maxHeight : '';
  });
  check('嵌套表格视口约 20 行', parseInt(nestedHeight, 10) > 0 && parseInt(nestedHeight, 10) <= 550);
  await page.screenshot({ path: 'E:/cxgj/AIgonzhuoqu/XMWJ/_json-analysis/_shots/dbx-plugin-expand2.png' });
} else {
  check('second level toggle exists', false);
}

// 点击单元格 → 左侧定位高亮
const jump = await page.evaluate(() => {
  const cells = [...document.querySelectorAll('.nested-box td.val[data-kind="value"]')];
  const target = cells.find((td) => td.querySelector('.v')) || cells[0];
  if (!target) return null;
  const inner = target.querySelector('.v') || target;
  inner.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  const editor = document.querySelector('#editor');
  return { start: editor.selectionStart, length: editor.selectionEnd - editor.selectionStart };
});
check('点击单元格左侧定位并选中', Boolean(jump) && jump.start > 0 && jump.length > 0);

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

// 分割条拖动
const splitter = await page.$('#splitter');
if (splitter) {
  const box = await splitter.boundingBox();
  const before = await page.evaluate(() => getComputedStyle(document.querySelector('.split')).gridTemplateColumns);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 220, box.y + box.height / 2, { steps: 6 });
  await page.mouse.up();
  await new Promise((r2) => setTimeout(r2, 200));
  const after = await page.evaluate(() => getComputedStyle(document.querySelector('.split')).gridTemplateColumns);
  check('splitter drag resizes panes', before !== after);
} else {
  check('splitter exists', false);
}

// 自动换行开关
const wrapBefore = await page.evaluate(() => document.querySelector('#editor').classList.contains('wrap'));
await page.click('[data-act="wrap"]');
await new Promise((r2) => setTimeout(r2, 200));
const wrapAfter = await page.evaluate(() => document.querySelector('#editor').classList.contains('wrap'));
check('wrap toggle works', wrapBefore !== wrapAfter);
await page.click('[data-act="wrap"]');

// 表格列宽上限与换行
const layout = await page.evaluate(() => {
  const host = document.querySelector('#grid');
  const table = host.querySelector('table.jgrid');
  if (!table) return null;
  const cols = [...table.querySelectorAll(':scope > colgroup > col')].map((col) => parseFloat(col.style.width) || 0);
  const rows = [...table.querySelectorAll(':scope > tbody > tr.row')].map((tr) => tr.getBoundingClientRect().height);
  const cell = table.querySelector('td.val');
  return { cols, maxRowHeight: Math.max(0, ...rows), whiteSpace: cell ? getComputedStyle(cell).whiteSpace : '', color: getComputedStyle(cell || table).color, tableWidth: Math.round(table.getBoundingClientRect().width) };
});
check('每列宽度不超过 650px（约50汉字）', Boolean(layout) && layout.cols.every((width) => width <= 650));
check('行号列不被拉宽', Boolean(layout) && layout.cols[0] <= 60);
check('键列约 15 个字符宽', Boolean(layout) && layout.cols[1] >= 120 && layout.cols[1] <= 170);
check('值列占满剩余宽度', Boolean(layout) && layout.cols[2] >= 300);
check('单元格默认换行', Boolean(layout) && layout.whiteSpace === 'normal');
check('长内容行高增长', Boolean(layout) && layout.maxRowHeight > 26);
check('表格文字纯黑', Boolean(layout) && layout.color === 'rgb(0, 0, 0)');

// 多解析窗口（页签）
const tabCountBefore = await page.evaluate(() => document.querySelectorAll('.tab').length);
await page.click('#tab-add');
await new Promise((r) => setTimeout(r, 400));
const tabCountAfter = await page.evaluate(() => document.querySelectorAll('.tab').length);
check('可以新增解析窗口', tabCountAfter === tabCountBefore + 1);
await page.evaluate(() => {
  const ed = document.querySelector('#editor');
  ed.value = '{"tab":"second"}';
  ed.dispatchEvent(new Event('input', { bubbles: true }));
});
await new Promise((r) => setTimeout(r, 600));
await page.evaluate(() => { document.querySelectorAll('.tab')[0].click(); });
await new Promise((r) => setTimeout(r, 500));
const firstTabText = await page.evaluate(() => document.querySelector('#editor').value);
check('切换页签后内容隔离', firstTabText.includes('patientId') && !firstTabText.includes('"tab": "second"'));
await page.evaluate(() => { document.querySelectorAll('.tab')[1].click(); });
await new Promise((r) => setTimeout(r, 500));
const secondTabText = await page.evaluate(() => document.querySelector('#editor').value);
check('第二个窗口内容保留', secondTabText.includes('second'));
// 切回页签保持展开状态与滚动位置
await page.evaluate(() => { document.querySelectorAll('.tab')[0].click(); });
await new Promise((r) => setTimeout(r, 500));
await page.evaluate(() => {
  const tgl = document.querySelector('.tgl');
  if (tgl) tgl.click();
  document.querySelector('#editor').scrollTop = 300;
});
await new Promise((r) => setTimeout(r, 500));
const beforeSwitch = await page.evaluate(() => ({
  open: document.querySelectorAll('.nested-box:not([hidden])').length,
  scroll: Math.round(document.querySelector('#editor').scrollTop),
}));
await page.evaluate(() => { document.querySelectorAll('.tab')[1].click(); });
await new Promise((r) => setTimeout(r, 400));
await page.evaluate(() => { document.querySelectorAll('.tab')[0].click(); });
await new Promise((r) => setTimeout(r, 600));
const afterSwitch = await page.evaluate(() => ({
  open: document.querySelectorAll('.nested-box:not([hidden])').length,
  scroll: Math.round(document.querySelector('#editor').scrollTop),
}));
check('切回页签保持展开状态(' + beforeSwitch.open + '/' + afterSwitch.open + ')', afterSwitch.open === beforeSwitch.open && afterSwitch.open > 0);
check('切回页签保持编辑器滚动位置', Math.abs(afterSwitch.scroll - beforeSwitch.scroll) <= 2);

// 定位高亮与提示在切换后保留
const jumpClick = await page.evaluate(() => {
  const cell = [...document.querySelectorAll('.nested-box td.val[data-kind="value"]')].find((td) => td.querySelector('.v'));
  if (!cell) return null;
  cell.querySelector('.v').dispatchEvent(new MouseEvent('click', { bubbles: true }));
  const ed = document.querySelector('#editor');
  return { status: document.querySelector('#status').textContent, start: ed.selectionStart, length: ed.selectionEnd - ed.selectionStart };
});
await new Promise((r) => setTimeout(r, 350));
await page.evaluate(() => { document.querySelectorAll('.tab')[1].click(); });
await new Promise((r) => setTimeout(r, 400));
await page.evaluate(() => { document.querySelectorAll('.tab')[0].click(); });
await new Promise((r) => setTimeout(r, 700));
const restoredStatus = await page.evaluate(() => ({
  status: document.querySelector('#status').textContent,
  start: document.querySelector('#editor').selectionStart,
  length: document.querySelector('#editor').selectionEnd - document.querySelector('#editor').selectionStart,
}));
check('切换后保留定位提示', Boolean(jumpClick) && restoredStatus.status.includes('已定位到第'));
check('切换后保留高亮选中', restoredStatus.length > 0);

// 工具箱多工具
const sideCount = await page.evaluate(() => document.querySelectorAll('.side-item').length);
check('侧边栏包含全部工具', sideCount >= 10);
await page.evaluate(() => { document.querySelector('[data-tool="jsondiff"]').click(); });
await new Promise((r) => setTimeout(r, 300));
const diffPane = await page.evaluate(() => ({
  diff: !document.querySelector('#tool-jsondiff').hidden,
  jsonHidden: document.querySelector('#tool-json').hidden,
  actionsHidden: document.querySelector('#actions').hidden,
}));
check('切换到 JSON 内容比对', diffPane.diff && diffPane.jsonHidden && diffPane.actionsHidden);
await page.click('#diff-sample');
await new Promise((r) => setTimeout(r, 300));
await page.click('#diff-run');
await new Promise((r) => setTimeout(r, 300));
check('JSON 比对生成差异', (await page.evaluate(() => document.querySelectorAll('#diff-result .diff-row').length)) > 0);
await page.evaluate(() => { document.querySelector('[data-tool="csvviewer"]').click(); });
await new Promise((r) => setTimeout(r, 250));
check('CSV 文件预览可用', await page.evaluate(() => !document.querySelector('#tool-csvviewer').hidden && Boolean(document.querySelector('#csv-file'))));
await page.evaluate(() => { document.querySelector('[data-tool="drawboard"]').click(); });
await new Promise((r) => setTimeout(r, 300));
check('在线绘图工具可用', await page.evaluate(() => !document.querySelector('#tool-drawboard').hidden && Boolean(document.querySelector('#draw-canvas'))));
await page.evaluate(() => { document.querySelector('[data-tool="settings"]').click(); });
await new Promise((r) => setTimeout(r, 250));
check('系统参数配置可用', await page.evaluate(() => !document.querySelector('#tool-settings').hidden));
// 临时数据建表（生成 SQL）
await page.evaluate(() => { document.querySelector('[data-tool="import"]').click(); });
await new Promise((r) => setTimeout(r, 250));
const importVisible = await page.evaluate(() => !document.querySelector('#tool-import').hidden);
await page.evaluate(() => {
  document.querySelector('#import-source').value = '[{"id":1,"name":"demo","score":12.5},{"id":2,"name":"test","score":88}]';
  document.querySelector('#import-table').value = 'tmp_demo';
});
await page.click('#import-run');
await new Promise((r) => setTimeout(r, 300));
const importSql = await page.evaluate(() => document.querySelector('#import-sql').value);
check('临时建表生成 SQL', importVisible && importSql.includes('CREATE TABLE') && importSql.includes('INSERT INTO') && importSql.includes('tmp_demo'));

// 快速建数据表
await page.evaluate(() => { document.querySelector('[data-tool="quicksheet"]').click(); });
await new Promise((r) => setTimeout(r, 250));
await page.click('#sheet-run');
await new Promise((r) => setTimeout(r, 250));
const sheetSql = await page.evaluate(() => document.querySelector('#sheet-sql').value);
check('快速建表生成 CREATE TABLE', sheetSql.includes('CREATE TABLE') && sheetSql.includes('id'));

// 数据验证排查（无连接时也能生成 SQL）
await page.evaluate(() => { document.querySelector('[data-tool="validation"]').click(); });
await new Promise((r) => setTimeout(r, 250));
await page.evaluate(() => {
  document.querySelector('#val-table').value = 'public.orders';
  document.querySelector('#val-columns').value = 'status, amount';
});
await page.click('#val-generate');
await new Promise((r) => setTimeout(r, 500));
const valSql = await page.evaluate(() => document.querySelector('#val-sql').value);
check('数据验证生成校验 SQL', valSql.includes('SELECT COUNT(*)') && valSql.includes('orders'));

// 首页数据概览（无 DBX 桥时给出提示）
await page.evaluate(() => { document.querySelector('[data-tool="home"]').click(); });
await new Promise((r) => setTimeout(r, 250));
await page.click('#home-refresh');
await new Promise((r) => setTimeout(r, 500));
const homeText = await page.evaluate(() => document.querySelector('#home-cards').textContent);
check('首页概览可刷新连接', homeText.includes('没有读取到') || homeText.includes('连接'));

// 发票打印（侧车界面）
await page.evaluate(() => { document.querySelector('[data-tool="invoice"]').click(); });
await new Promise((r) => setTimeout(r, 500));
const invoiceInfo = await page.evaluate(() => ({
  hint: document.querySelector('#inv-hint').textContent,
  hasPreview: Boolean(document.querySelector('#inv-preview-area')),
  hasPrinter: Boolean(document.querySelector('#inv-printer')),
}));
check('发票打印界面已接入侧车', invoiceInfo.hasPreview && invoiceInfo.hasPrinter && (invoiceInfo.hint.includes('侧车') || invoiceInfo.hint.includes('打印机')));

// CSV 内容比对
const csvA = 'E:/cxgj/AIgonzhuoqu/XMWJ/_json-analysis/_shots/cmp-a.csv';
const csvB = 'E:/cxgj/AIgonzhuoqu/XMWJ/_json-analysis/_shots/cmp-b.csv';
fs.writeFileSync(csvA, 'id,name,score\n1,demo,60\n2,test,70\n3,old,50\n');
fs.writeFileSync(csvB, 'id,name,score\n1,demo,80\n2,test,70\n4,new,90\n');
await page.evaluate(() => { document.querySelector('[data-tool="csvcompare"]').click(); });
await new Promise((r) => setTimeout(r, 300));
await (await page.$('#cmp-file-a')).uploadFile(csvA);
await (await page.$('#cmp-file-b')).uploadFile(csvB);
await new Promise((r) => setTimeout(r, 400));
await page.evaluate(() => { document.querySelector('#cmp-keys').value = 'id'; document.querySelector('#cmp-run').click(); });
await new Promise((r) => setTimeout(r, 500));
const cmpSummary = await page.evaluate(() => document.querySelector('#cmp-summary').textContent);
check('CSV 内容比对可用', cmpSummary.includes('新增 1 行') && cmpSummary.includes('删除 1 行') && cmpSummary.includes('修改 1 行'));

// 离线数据校验
await page.evaluate(() => { document.querySelector('[data-tool="validation"]').click(); });
await new Promise((r) => setTimeout(r, 300));
await page.evaluate(() => {
  document.querySelector('#val-source').value = "INSERT INTO users (id, name, phone, status) VALUES (1, '张三', '13800138000', 'active'), (1, '李四', '123', 'unknown'), (3, NULL, '13900139000', 'active');";
  document.querySelector('#val-enum-values').value = 'active,disabled';
  document.querySelector('#val-enum').checked = true;
  document.querySelector('#val-dup-columns').value = 'id';
  document.querySelector('#val-regex').value = '^1\\d{10}$';
  document.querySelector('#val-offline-run').click();
});
await new Promise((r) => setTimeout(r, 500));
const offlineResult = await page.evaluate(() => ({
  summary: document.querySelector('#val-offline-result .diff-summary')?.textContent || '',
  rows: document.querySelectorAll('#val-offline-result tbody tr').length,
}));
check('离线数据校验可用', offlineResult.summary.includes('发现问题') && offlineResult.rows > 0);

// JSON 结构差异
await page.evaluate(() => { document.querySelector('[data-tool="jsondiff"]').click(); });
await new Promise((r) => setTimeout(r, 300));
await page.evaluate(() => {
  document.querySelector('#diff-left').value = JSON.stringify({ id: 1, name: 'demo', tags: ['a', 'b'], extra: { keep: true } }, null, 2);
  document.querySelector('#diff-right').value = JSON.stringify({ id: 1, name: 'demo', tags: ['a', 'c'], score: 80 }, null, 2);
  document.querySelector('#diff-mode').value = 'tree';
  document.querySelector('#diff-run').click();
});
await new Promise((r) => setTimeout(r, 400));
const treeHint = await page.evaluate(() => document.querySelector('#diff-hint').textContent);
check('JSON 结构差异比对', treeHint.includes('新增 1') && treeHint.includes('删除 1') && treeHint.includes('修改 1'));

// 快速建表 INSERT 解析
await page.evaluate(() => { document.querySelector('[data-tool="quicksheet"]').click(); });
await new Promise((r) => setTimeout(r, 300));
await page.evaluate(() => {
  document.querySelector('#sheet-insert').value = "INSERT INTO orders (id, name, amount, paid) VALUES (1, 'demo', 12.5, TRUE), (2, 'test', 8, FALSE);";
  document.querySelector('#sheet-parse-insert').click();
});
await new Promise((r) => setTimeout(r, 500));
const sheetInfo = await page.evaluate(() => ({ table: document.querySelector('#sheet-table').value, sql: document.querySelector('#sheet-sql').value }));
check('INSERT SQL 解析生成建表', sheetInfo.table === 'orders' && sheetInfo.sql.includes('CREATE TABLE') && sheetInfo.sql.includes('BIGINT'));

// Excel 文件导入（SheetJS）
await page.evaluate(() => { document.querySelector('[data-tool="import"]').click(); });
await new Promise((r) => setTimeout(r, 300));
await (await page.$('#import-file')).uploadFile('E:/cxgj/AIgonzhuoqu/XMWJ/_json-analysis/_shots/test-import.xlsx');
await new Promise((r) => setTimeout(r, 900));
const excelSql = await page.evaluate(() => document.querySelector('#import-sql').value);
check('Excel 文件导入生成 SQL', excelSql.includes('CREATE TABLE') && excelSql.includes('demo') && excelSql.includes('score'));

// 首页快捷入口
await page.evaluate(() => { document.querySelector('[data-tool="home"]').click(); });
await new Promise((r) => setTimeout(r, 250));
await page.evaluate(() => { document.querySelector('.home-link[data-goto="json"]').click(); });
await new Promise((r) => setTimeout(r, 300));
check('首页快捷入口可用', await page.evaluate(() => !document.querySelector('#tool-json').hidden));

// 系统设置：批量行数
await page.evaluate(() => { document.querySelector('[data-tool="settings"]').click(); });
await new Promise((r) => setTimeout(r, 250));
await page.evaluate(() => { document.querySelector('#set-batch').value = '50'; document.querySelector('#set-batch-save').click(); });
await new Promise((r) => setTimeout(r, 300));
check('批量行数设置可保存', await page.evaluate(() => localStorage.getItem('cc-toolbox-batch') === '50'));

await page.evaluate(() => { document.querySelector('[data-tool="json"]').click(); });
await new Promise((r) => setTimeout(r, 300));
check('可切回 JSON 解析', await page.evaluate(() => !document.querySelector('#tool-json').hidden && !document.querySelector('#actions').hidden));

await page.screenshot({ path: 'E:/cxgj/AIgonzhuoqu/XMWJ/_json-analysis/_shots/dbx-toolbox.png' });
console.log(results.join('\n'));
if (errors.length) console.log('console errors: ' + errors.slice(0, 3).join(' | '));
const failed = results.filter((r) => r.startsWith('FAIL'));
await browser.close();
if (failed.length) { console.log('FAILED: ' + failed.length); process.exit(1); }
console.log('ALL UI CHECKS OK');