import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { openTestBrowser } from './scripts/browser-test-support.mjs';
import { startSidecar } from './scripts/json-test-support.mjs';

function bitmap(width, height) {
  const stride = Math.ceil(width * 3 / 4) * 4;
  const data = Buffer.alloc(54 + stride * height);
  data.write('BM');
  data.writeUInt32LE(data.length, 2);
  data.writeUInt32LE(54, 10);
  data.writeUInt32LE(40, 14);
  data.writeInt32LE(width, 18);
  data.writeInt32LE(height, 22);
  data.writeUInt16LE(1, 26);
  data.writeUInt16LE(24, 28);
  data.writeUInt32LE(stride * height, 34);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = 54 + y * stride + x * 3;
      data[index] = 170; data[index + 1] = 60; data[index + 2] = 20;
    }
  }
  return data;
}

function pdf() {
  const stream = body => '<< /Length ' + body.length + ' >>\nstream\n' + body + '\nendstream';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Resources << >> /Contents 5 0 R >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 200] /Resources << >> /Contents 6 0 R >>',
    stream('1 0 0 rg 10 10 180 80 re f'),
    stream('0 0 1 rg 10 10 80 180 re f'),
  ];
  let text = '%PDF-1.4\n';
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(text.length);
    text += (index + 1) + ' 0 obj\n' + object + '\nendobj\n';
  }
  const xref = text.length;
  text += 'xref\n0 7\n0000000000 65535 f \n';
  for (const offset of offsets.slice(1)) text += String(offset).padStart(10, '0') + ' 00000 n \n';
  return Buffer.from(text + 'trailer\n<< /Size 7 /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF\n');
}

const sidecar = await startSidecar();
let browser;
try {
  const image = bitmap(1024, 640);
  const sourcePdf = pdf();
  const workspace = await sidecar.invoke('invoice/workspace/open');
  const rpc = (method, parameters) => sidecar.invoke('invoice/' + method, { workspaceId: workspace.id, ...parameters });
  async function upload(bytes) {
    const { id } = await rpc('files/open', { length: bytes.length });
    for (let offset = 0; offset < bytes.length; offset += workspace.chunkBytes) {
      const chunk = bytes.subarray(offset, offset + workspace.chunkBytes);
      const result = await rpc('files/write', { fileId: id, offset, data: chunk.toString('base64') });
      assert.equal(result.written, chunk.length);
    }
    return { id, ...await rpc('files/finish', { fileId: id }) };
  }
  assert.ok(4 * Math.ceil(image.length / 3) > 2 * 1024 * 1024, 'fixture exceeded the old unchunked request limit');
  const imageFile = await upload(image);
  const pdfFile = await upload(sourcePdf);
  assert.equal(imageFile.pages, 1);
  assert.equal(pdfFile.pages, 2);
  assert.equal((await upload(image)).duplicate, true);
  const incomplete = await rpc('files/open', { length: 128 });
  await assert.rejects(rpc('files/write', { fileId: incomplete.id, offset: 1, data: 'YQ==' }), /偏移/);
  await assert.rejects(rpc('files/finish', { fileId: incomplete.id }), /尚未传输完整/);
  await rpc('files/remove', { fileId: incomplete.id });
  const originals = [{ fileId: pdfFile.id, first: 2, last: 2, rotation: 90 }, { fileId: imageFile.id, first: 1, last: 1 }];
  const firstPage = await rpc('file/preview', { fileId: pdfFile.id, page: 1, rotation: 0 });
  const secondPageRotated = await rpc('file/preview', { fileId: pdfFile.id, page: 2, rotation: 90 });
  assert.ok(firstPage.width > firstPage.height && secondPageRotated.width > secondPageRotated.height);
  assert.notEqual(firstPage.png, secondPageRotated.png);
  const options = { layout: 1, paperWidthMm: 210, paperHeightMm: 297, marginTopMm: 35, marginBottomMm: 35, marginLeftMm: 35, marginRightMm: 35 };
  const original = await rpc('preview', { files: originals, settings: options, sheet: 1 });
  const shifted = await rpc('preview', { files: originals, settings: { ...options, offsetXmm: 12, offsetYmm: -7 }, sheet: 1 });
  assert.equal(original.sheets, 2);
  const wide = await rpc('preview', { files: originals, settings: { ...options, layout: 2, orientation: 'landscape', cutLines: true }, sheet: 1 });
  assert.deepEqual([wide.widthMm, wide.heightMm, wide.sheets], [297, 210, 1]);
  await assert.rejects(rpc('preview', { files: originals, settings: { ...options, marginTopMm: 295 }, sheet: 1 }), /排版空间/);
  await assert.rejects(rpc('preview', { files: [{ ...originals[0], first: 3, last: 3 }], settings: options, sheet: 1 }), /页码/);
  const job = await rpc('print', { files: originals, settings: { ...options, printer: 'CC_TEST_INVALID_PRINTER_51F747', copies: 2 } });
  assert.equal(job.total, 4);
  let ended;
  for (let attempt = 0; attempt < 30 && !ended?.terminal; attempt++) {
    ended = await sidecar.invoke('invoice/job/status', { jobId: job.id });
    if (!ended.terminal) await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.equal(ended?.state, 'failed');
  assert.equal(ended.rendered, 0);
  await rpc('workspace/close', {});
  await assert.rejects(rpc('file/preview', { fileId: pdfFile.id, page: 1, rotation: 0 }), /工作区已失效/);
  console.log('PASS real sidecar: chunk transfer, content dedup, PDF page range, rotation, validation and printer failure');

  browser = await openTestBrowser();
  const page = await browser.newPage();
  await page.setViewport({ width: 1510, height: 950 });
  async function blueCentroid(data) {
    return page.evaluate(async png => {
      const image = new Image();
      image.src = 'data:image/png;base64,' + png;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.width; canvas.height = image.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(image, 0, 0);
      const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let sumX = 0, sumY = 0, count = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        if (pixels[i] < 36 && pixels[i + 1] < 36 && pixels[i + 2] > 200) {
          sumX += (i / 4) % canvas.width; sumY += Math.floor(i / 4 / canvas.width); count++;
        }
      }
      return { x: sumX / count, y: sumY / count, scale: canvas.height / 297 };
    }, data);
  }
  const a = await blueCentroid(original.png), b = await blueCentroid(shifted.png);
  assert.ok(Math.abs((b.x - a.x) / a.scale - 12) < .4);
  assert.ok(Math.abs((b.y - a.y) / a.scale + 7) < .4);
  console.log('PASS rendered offset moves content by 12 mm horizontally and -7 mm vertically');

  const prefs = new Map(), errors = [];
  let printRequest;
  let workspaceCloses = 0;
  page.on('pageerror', error => errors.push(error.message));
  await page.exposeFunction('invoiceRpc', async (method, params) => {
    if (method === 'invoice/workspace/close') workspaceCloses++;
    assert.ok(Buffer.byteLength(JSON.stringify(params || {})) < 2 * 1024 * 1024);
    if (method === 'invoice/printers') return { printers: [{ name: '测试打印机', isDefault: true }] };
    if (method === 'invoice/print') {
      printRequest = params;
      return { id: 'mock', printer: params.settings.printer, created: new Date().toISOString(), total: 2, rendered: 0, message: '正在提交' };
    }
    if (method === 'invoice/job/status') return { id: 'mock', terminal: true, rendered: 2, state: 'completed', message: '队列完成' };
    return sidecar.invoke(method, params);
  });
  await page.exposeFunction('invoicePreference', (key, value, write) => {
    if (write) prefs.set(key, value);
    return prefs.get(key) ?? null;
  });
  const stub = `<script>window.dbxPlugin={ready:Promise.resolve(),capabilities:{storage:true},
    invoke:(m,p)=>invoiceRpc(m,p),storage:{get:k=>invoicePreference(k,null,false),set:(k,v)=>invoicePreference(k,v,true)},
    workbench:{onClose:()=>{}}};</script>`;
  const csp = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' http://127.0.0.1:5199; style-src 'unsafe-inline' http://127.0.0.1:5199; img-src data: http://127.0.0.1:5199; connect-src 'none'">`;
  await page.setRequestInterception(true);
  page.on('request', async request => {
    const url = new URL(request.url());
    if (url.origin !== 'http://127.0.0.1:5199') return request.continue();
    try {
      const root = path.resolve('ui');
      const file = path.resolve(root, '.' + url.pathname);
      if (!file.startsWith(root + path.sep)) throw new Error('Invalid asset');
      let body = await fs.readFile(file);
      if (url.pathname === '/index.html') body = Buffer.from(body.toString().replace('<head>', '<head>' + csp + stub));
      const mime = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml' }[path.extname(file)] || 'application/octet-stream';
      await request.respond({ status: 200, headers: { 'Content-Type': mime + '; charset=utf-8', 'Access-Control-Allow-Origin': '*' }, body });
    } catch { await request.respond({ status: 404, body: 'not found' }); }
  });
  await page.setContent('<iframe sandbox="allow-scripts" style="width:1500px;height:920px" src="http://127.0.0.1:5199/index.html"></iframe>');
  const frame = await (await page.$('iframe')).contentFrame();
  await frame.waitForSelector('[data-tool=invoice]');
  await frame.click('[data-tool=invoice]');
  await frame.waitForFunction(() => document.querySelector('#inv-printer')?.options.length === 1);
  await frame.evaluate(({ image, pdf }) => {
    const file = (encoded, name) => new File([Uint8Array.from(atob(encoded), ch => ch.charCodeAt(0))], name);
    const input = document.querySelector('#inv-folder');
    const transfer = new DataTransfer();
    transfer.items.add(file(pdf, '发票测试.pdf'));
    transfer.items.add(file(image, '扫描.bmp'));
    transfer.items.add(file(image, '重复.bmp'));
    input.files = transfer.files;
    input.dispatchEvent(new Event('change'));
  }, { image: image.toString('base64'), pdf: sourcePdf.toString('base64') });
  await frame.waitForFunction(() => document.querySelector('#inv-hint').textContent.includes('重复 1 个'));
  assert.equal(await frame.$$eval('#inv-list li', rows => rows.length), 2);
  await frame.click('#inv-source-preview');
  await frame.waitForFunction(() => document.querySelector('#inv-preview-area img')?.naturalWidth > 0);
  await frame.click('#inv-next');
  await frame.waitForFunction(() => document.querySelector('#inv-page-label').textContent.includes('2 / 2'));
  await frame.click('#inv-rotate');
  await frame.waitForFunction(() => document.querySelector('#inv-preview-area img')?.naturalWidth > document.querySelector('#inv-preview-area img')?.naturalHeight);
  await frame.click('#inv-zoom-in');
  assert.equal(await frame.$eval('#inv-zoom-reset', element => element.textContent), '125%');
  await frame.click('#inv-select-none');
  await frame.click('#inv-list li:first-child input[type=checkbox]');
  await frame.evaluate(() => {
    const first = document.querySelector('#inv-list input[type=number]');
    first.value = '2'; first.dispatchEvent(new Event('input'));
    document.querySelectorAll('.invoice-settings details').forEach(item => { item.open = true; });
    document.querySelector('#inv-template-name').value = '横向套打';
  });
  await frame.select('#inv-orientation', 'landscape');
  await frame.$eval('#inv-copies', element => { element.value = '2'; });
  await frame.click('#inv-template-save');
  await frame.waitForFunction(() => document.querySelector('#inv-templates').value === '横向套打');
  await frame.select('#inv-orientation', 'portrait');
  await frame.click('#inv-template-load');
  assert.equal(await frame.$eval('#inv-orientation', input => input.value), 'landscape');
  await frame.click('#inv-preview');
  await frame.waitForFunction(() => document.querySelector('#inv-preview-area img')?.alt.startsWith('排版'));
  if (process.env.CC_INVOICE_SCREENSHOT) await page.screenshot({ path: process.env.CC_INVOICE_SCREENSHOT });
  await frame.click('#inv-print');
  await frame.click('[data-tool=json]');
  await frame.waitForFunction(() => document.querySelector('#inv-history').textContent.includes('队列完成'));
  await frame.click('[data-tool=invoice]');
  assert.equal(workspaceCloses, 0);
  assert.equal(await frame.$$eval('#inv-list li', entries => entries.length), 2);
  assert.equal(printRequest.files.length, 1);
  assert.deepEqual(printRequest.files.map(({ first, last, rotation }) => [first, last, rotation]), [[2, 2, 90]]);
  assert.equal(printRequest.settings.copies, 2);
  assert.equal(prefs.get('cc-toolbox-invoice-history')[0].state, 'completed');
  await frame.click('#inv-template-delete');
  await frame.waitForFunction(() => document.querySelector('#inv-templates').options.length === 1);
  await frame.click('#inv-list li:last-child button[title=删除]');
  await frame.waitForFunction(() => document.querySelectorAll('#inv-list li').length === 1);
  await frame.click('#inv-clear');
  await frame.waitForFunction(() => document.querySelectorAll('#inv-list li').length === 0);
  assert.deepEqual(errors, []);
  console.log('PASS DBX-style iframe: file/folder list, paging, rotation, zoom, selection, template, print progress and history');
}
finally {
  if (browser) await browser.close();
  await sidecar.close();
}
