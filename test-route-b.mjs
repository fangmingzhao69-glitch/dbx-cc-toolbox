import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { openTestBrowser } from './scripts/browser-test-support.mjs';

const root = path.resolve('ui');
const base = 'http://dbx-plugin.localhost/com.cctoolbox.jsongrid/';
const policy = "default-src 'none'; script-src 'unsafe-inline' blob: http://dbx-plugin.localhost; style-src 'unsafe-inline' blob:; img-src data: blob: http://dbx-plugin.localhost; font-src data: blob: http://dbx-plugin.localhost; connect-src 'none'; media-src data: blob: http://dbx-plugin.localhost;";
const browser = await openTestBrowser();

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1500, height: 950 });
  const errors = [], violations = [], saved = [], queries = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.text().includes('Content Security Policy')) violations.push(message.text());
  });
  await page.exposeFunction('testSave', (options, data) => {
    saved.push({ ...options, data: Buffer.from(data) });
    return { saved: true };
  });
  await page.exposeFunction('testQuery', request => {
    queries.push(request);
    return { rows: [[7]], columns: [{ name: 'count' }], elapsedMs: 1 };
  });
  await page.setRequestInterception(true);
  page.on('request', async request => {
    if (!request.url().startsWith(base)) return request.continue();
    try {
      const file = path.resolve(root, decodeURIComponent(new URL(request.url()).pathname.slice('/com.cctoolbox.jsongrid/'.length)));
      assert.ok(file.startsWith(root + path.sep));
      const body = await fs.readFile(file);
      const types = { '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.css': 'text/css' };
      await request.respond({ status: 200, headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': types[path.extname(file)] }, body });
    } catch { await request.respond({ status: 404, body: 'missing plugin asset' }); }
  });
  const html = await fs.readFile(path.join(root, 'index.html'), 'utf8');
  const scripts = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)];
  const styles = [...html.matchAll(/<link rel="stylesheet" href="([^"]+)" \/>/g)];
  let source = html;
  // DBX inlines HTML-declared local styles and legacy scripts. Packaged ES modules keep their asset URL.
  for (const [tag, file] of styles) {
    const css = await fs.readFile(path.join(root, file), 'utf8');
    source = source.replace(tag, () => '<style>' + css + '</style>');
  }
  for (const [tag, file] of scripts) {
    const script = await fs.readFile(path.join(root, file), 'utf8');
    source = source.replace(tag, () => '<script>' + script.replace(/<\/script/gi, '<\\/script') + '</script>');
  }
  source = source.replace('src="js/app.js"', 'src="' + base + 'js/app.js"');
  const sdk = '<script>const prefs=new Map();window.dbxPlugin={ready:Promise.resolve(),' +
    'capabilities:{storage:true,connectionsApi:true,dataApi:true},' +
    'storage:{get:key=>Promise.resolve(prefs.get(key)??null),set:(key,value)=>Promise.resolve(prefs.set(key,value)),delete:key=>Promise.resolve(prefs.delete(key))},' +
    'getConnections:()=>Promise.resolve([{id:"c1",name:"Test",dialect:"postgres",connected:true}]),queryData:request=>testQuery(request),' +
    'saveFile:(info,bytes)=>testSave(info,Array.from(bytes)),workbench:{onClose:()=>{}},' +
    'invoke:async (m)=>m.endsWith("/open")?{id:"1"}:m.endsWith("/execute")?{length:4}:m.endsWith("/read")?{data:"bnVsbA==",length:4}:null};</script>';
  source = source.replace('<head>', () => '<head><base href="' + base + '"><meta http-equiv="Content-Security-Policy" content="' + policy + '">' + sdk);
  await page.setContent('<iframe sandbox="allow-scripts" style="width:1480px;height:920px"></iframe>');
  await page.$eval('iframe', (frame, html) => { frame.srcdoc = html; }, source);
  const frame = await (await page.$('iframe')).contentFrame();
  await frame.waitForSelector('.side-item[data-tool=xml]');
  const show = id => frame.click('[data-tool="' + id + '"]');
  assert.equal(await frame.$$eval('.side-item', items => items.length), 12);
  await show('xml');
  assert.equal(await frame.$eval('.xml-split', el => getComputedStyle(el).display), 'grid');
  const unchanged = await frame.evaluate(() => {
    document.querySelector('#xml-sample').click();
    const editor = document.querySelector('#xml-editor');
    editor.value = '<p>前 <b>加粗</b> 后</p>';
    editor.dispatchEvent(new Event('input'));
    document.querySelector('#xml-format').click();
    return editor.value;
  });
  assert.equal(unchanged, '<p>前 <b>加粗</b> 后</p>');
  await show('json');
  await show('xml');
  assert.equal(await frame.$eval('#xml-editor', editor => editor.value), unchanged);
  await frame.click('#xml-export');
  await frame.waitForFunction(() => document.querySelector('#status').textContent === '已导出 CSV');
  assert.match(saved.at(-1).data.toString(), /加粗/);
  console.log('PASS DBX CSP loads XML CSS, preserves current mixed content and exports through host');

  await show('drawboard');
  await frame.$eval('#draw-canvas', canvas => {
    const pixels = canvas.getContext('2d');
    pixels.fillStyle = 'red'; pixels.fillRect(0, 0, 5, 5);
  });
  await show('json');
  await show('drawboard');
  assert.deepEqual(await frame.$eval('#draw-canvas', canvas => Array.from(canvas.getContext('2d').getImageData(1, 1, 1, 1).data)), [255, 0, 0, 255]);
  await frame.click('#draw-save');
  await frame.waitForFunction(() => document.querySelector('#status').textContent === '已导出 PNG');
  assert.equal(saved.at(-1).data.subarray(1, 4).toString(), 'PNG');
  console.log('PASS drawing state survives panel switches and uses binary host export');

  await show('csvcompare');
  await frame.evaluate(() => {
    for (const [side, text] of Object.entries({ a: 'id,name\n1,old\n1,keep', b: 'id,name\n1,keep' })) {
      const transfer = new DataTransfer();
      transfer.items.add(new File([text], side + '.csv'));
      const input = document.querySelector('#cmp-file-' + side);
      input.files = transfer.files;
      input.dispatchEvent(new Event('change'));
    }
  });
  await frame.waitForFunction(() => /a\.csv.*b\.csv/.test(document.querySelector('#cmp-hint').textContent));
  await show('json');
  await show('csvcompare');
  await frame.type('#cmp-keys', 'id');
  await frame.click('#cmp-run');
  assert.match(await frame.$eval('#cmp-summary', e => e.textContent), /A 文件存在重复主键/);
  console.log('PASS CSV uploads persist across switches and duplicate keys cannot report a match');

  await show('validation');
  await frame.evaluate(() => {
    const get = id => document.getElementById('val-' + id);
    for (const rule of ['null', 'dup', 'len']) get(rule).checked = false;
    get('enum').checked = true;
    get('enum-values').value = 'approved';
    get('regex').value = '^approved$';
    get('rule-fields').value = 'status';
    get('source').value = 'status,id\nrejected,1\nwrong,2';
    get('offline-run').click();
  });
  assert.match(await frame.$eval('#val-offline-result .diff-summary', e => e.textContent), /发现问题 4 处/);
  await show('home');
  await frame.click('#home-refresh');
  await frame.waitForSelector('.home-test');
  await frame.click('.home-test');
  await frame.waitForFunction(() => document.querySelector('.home-count').textContent.includes('7'));
  assert.equal(queries.at(-1).connectionId, 'c1');
  await frame.click('.home-link[data-goto=json]');
  assert.equal(await frame.$eval('#tool-json', el => el.hidden), false);
  console.log('PASS offline checks report wholly invalid columns and home uses DBX and registry navigation');

  const lifecycle = await frame.evaluate(async assetBase => {
    const { createToolShell } = await import(assetBase + 'js/registry.js');
    const controls = Object.fromEntries(['sidebar', 'main', 'title', 'actions'].map(key => [key, document.createElement('div')]));
    document.body.append(...Object.values(controls));
    let failures = 0, healthyMounts = 0, disposeCalls = 0;
    const shell = createToolShell({ ...controls, groups: [{ label: 'Test', tools: [
      { id: 'badprobe', title: 'Broken', mount() { if (!failures++) throw Error('first attempt'); } },
      { id: 'goodprobe', title: 'Healthy', mount(ctx, panel) {
        healthyMounts++;
        panel.textContent = 'keep me';
        return { dispose() { disposeCalls++; } };
      } },
    ] }], context: { toast() {}, settings: { get() {}, set() {} } } });
    const broken = controls.main.querySelector('#tool-badprobe');
    const initialFailure = broken.textContent.includes('first attempt');
    controls.sidebar.querySelector('[data-tool=goodprobe]').click();
    const healthy = controls.main.querySelector('#tool-goodprobe').textContent;
    controls.sidebar.querySelector('[data-tool=badprobe]').click();
    controls.sidebar.querySelector('[data-tool=goodprobe]').click();
    await Promise.all([shell.dispose(), shell.dispose()]);
    return { initialFailure, healthy, failures, healthyMounts, disposeCalls };
  }, base);
  assert.deepEqual(lifecycle, { initialFailure: true, healthy: 'keep me', failures: 2, healthyMounts: 1, disposeCalls: 1 });
  assert.deepEqual(errors, []);
  assert.deepEqual(violations, []);
  console.log('PASS tool mounting failures are isolated, retry works and disposal is idempotent');
} finally { await browser.close(); }
