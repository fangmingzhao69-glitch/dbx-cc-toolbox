import { escapeHtml } from './json-grid.js';
let runtimeStorage;

function readStorage(key, fallback = null) {
  if (runtimeStorage) return runtimeStorage.get(key, fallback);
  try { return localStorage.getItem(key) ?? fallback; } catch (error) { return fallback; }
}
function writeStorage(key, value) {
  if (runtimeStorage) { runtimeStorage.set(key, value); return; }
  try { localStorage.setItem(key, value); } catch (error) { /* 忽略 */ }
}

export function initTools({ toast, storage } = {}) {
  runtimeStorage = storage;
  const notify = typeof toast === 'function' ? toast : () => {};
  initJsonDiff(notify);
  initCsvViewer(notify);
  initDrawBoard(notify);
  initSettings(notify);
  initHome(notify);
  initImport(notify);
  initQuickSheet(notify);
  initValidation(notify);
  initInvoice(notify);
  initCsvCompare(notify);
  initOfflineValidation(notify);
}

// ---------- JSON 内容比对 ----------
function diffLines(a, b) {
  const left = a.split('\n');
  const right = b.split('\n');
  const n = left.length;
  const m = right.length;
  if (n * m > 4_000_000) return [{ type: 'same', text: '（内容过大，仅显示部分差异）', ln: 0 }];
  const dir = new Uint8Array((n + 1) * (m + 1));
  const width = m + 1;
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      const index = i * width + j;
      if (left[i] === right[j]) dir[index] = 0;
      else if (dir[(i + 1) * width + j] >= dir[i * width + j + 1]) dir[index] = 1;
      else dir[index] = 2;
    }
  }
  const rows = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (left[i] === right[j]) { rows.push({ type: 'same', text: left[i], ln: i + 1 }); i += 1; j += 1; }
    else if (dir[i * width + j] === 1) { rows.push({ type: 'del', text: left[i], ln: i + 1 }); i += 1; }
    else { rows.push({ type: 'add', text: right[j], ln: j + 1 }); j += 1; }
  }
  while (i < n) { rows.push({ type: 'del', text: left[i], ln: i + 1 }); i += 1; }
  while (j < m) { rows.push({ type: 'add', text: right[j], ln: j + 1 }); j += 1; }
  return rows;
}

function normalizeJsonText(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) return { text: '', valid: true };
  try { return { text: JSON.stringify(JSON.parse(trimmed), null, 2), valid: true }; }
  catch (error) { return { text: text.replace(/\r\n/g, '\n'), valid: false }; }
}

function treeDiff(a, b, path, out, depth = 0) {
  if (depth > 24 || out.length > 5000) return;
  const kind = (value) => value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
  const ka = kind(a);
  const kb = kind(b);
  if (ka !== kb) { out.push({ path, type: 'changed', old: a, new: b }); return; }
  if (ka === 'object') {
    const keys = Array.from(new Set(Object.keys(a).concat(Object.keys(b))));
    for (const key of keys) {
      const next = path ? path + '.' + key : key;
      if (!(key in a)) out.push({ path: next, type: 'added', old: undefined, new: b[key] });
      else if (!(key in b)) out.push({ path: next, type: 'removed', old: a[key], new: undefined });
      else treeDiff(a[key], b[key], next, out, depth + 1);
    }
    return;
  }
  if (ka === 'array') {
    const length = Math.max(a.length, b.length);
    for (let index = 0; index < length; index += 1) {
      const next = path + '[' + index + ']';
      if (index >= a.length) out.push({ path: next, type: 'added', old: undefined, new: b[index] });
      else if (index >= b.length) out.push({ path: next, type: 'removed', old: a[index], new: undefined });
      else treeDiff(a[index], b[index], next, out, depth + 1);
    }
    return;
  }
  if (a !== b) out.push({ path, type: 'changed', old: a, new: b });
}

function formatTreeValue(value) {
  if (value === undefined) return '';
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return escapeHtml(String(text).length > 300 ? String(text).slice(0, 300) + '…' : String(text));
}

function initJsonDiff(notify) {
  const left = document.getElementById('diff-left');
  const right = document.getElementById('diff-right');
  const result = document.getElementById('diff-result');
  const hint = document.getElementById('diff-hint');
  const mode = document.getElementById('diff-mode');
  if (!left || !right || !result) return;

  const renderTree = () => {
    let a;
    let b;
    try { a = JSON.parse(left.value); } catch (error) { notify('左侧 JSON 不合法：' + error.message, 'error'); return; }
    try { b = JSON.parse(right.value); } catch (error) { notify('右侧 JSON 不合法：' + error.message, 'error'); return; }
    const diffs = [];
    treeDiff(a, b, '', diffs);
    const added = diffs.filter((item) => item.type === 'added').length;
    const removed = diffs.filter((item) => item.type === 'removed').length;
    const changed = diffs.filter((item) => item.type === 'changed').length;
    if (hint) hint.textContent = '结构差异：新增 ' + added + ' · 删除 ' + removed + ' · 修改 ' + changed;
    result.innerHTML = '<div class="diff-summary">新增 ' + added + ' 个节点，删除 ' + removed + ' 个节点，修改 ' + changed + ' 个节点</div>' +
      diffs.map((item) => '<div class="diff-row diff-' + (item.type === 'added' ? 'add' : item.type === 'removed' ? 'del' : 'changed') + '">' +
        '<span class="ln">' + escapeHtml(item.path || '(根)') + '</span><span>' +
        (item.type === 'added' ? '+ ' + formatTreeValue(item.new)
          : item.type === 'removed' ? '- ' + formatTreeValue(item.old)
          : escapeHtml(String(item.old)) + '  →  ' + formatTreeValue(item.new)) + '</span></div>').join('') ||
      '<div class="tool-empty">两侧 JSON 结构完全一致</div>';
    notify('结构比对完成：' + (added + removed + changed) + ' 处差异', added + removed + changed ? 'ok' : 'info');
  };

  const renderText = () => {
    const a = normalizeJsonText(left.value);
    const b = normalizeJsonText(right.value);
    const rows = diffLines(a.text, b.text);
    const added = rows.filter((row) => row.type === 'add').length;
    const removed = rows.filter((row) => row.type === 'del').length;
    if (hint) hint.textContent = (a.valid && b.valid ? 'JSON 合法 · ' : '') + '新增 ' + added + ' 行 / 删除 ' + removed + ' 行';
    result.innerHTML = '<div class="diff-summary">共 ' + rows.length + ' 行，新增 ' + added + ' 行，删除 ' + removed + ' 行</div>' +
      rows.map((row) => '<div class="diff-row diff-' + row.type + '"><span class="ln">' + row.ln + '</span><span>' +
        escapeHtml((row.type === 'add' ? '+ ' : row.type === 'del' ? '- ' : '  ') + row.text) + '</span></div>').join('');
    notify('比对完成：新增 ' + added + ' 行，删除 ' + removed + ' 行', added || removed ? 'ok' : 'info');
  };

  const render = () => {
    if (mode && mode.value === 'text') renderText();
    else if (!left.value.trim() && !right.value.trim()) notify('请先输入或导入两侧 JSON', 'error');
    else renderTree();
  };

  const bindFile = (inputId, textarea) => {
    document.getElementById(inputId)?.addEventListener('change', async () => {
      const input = document.getElementById(inputId);
      const file = input.files && input.files[0];
      if (!file) return;
      textarea.value = await file.text();
      notify('已导入 ' + file.name, 'ok');
      render();
    });
  };
  bindFile('diff-file-left', left);
  bindFile('diff-file-right', right);

  document.getElementById('diff-run')?.addEventListener('click', render);
  mode?.addEventListener('change', render);
  document.getElementById('diff-swap')?.addEventListener('click', () => {
    const temp = left.value; left.value = right.value; right.value = temp; render();
  });
  document.getElementById('diff-format')?.addEventListener('click', () => {
    const a = normalizeJsonText(left.value);
    const b = normalizeJsonText(right.value);
    if (!a.valid || !b.valid) { notify('存在非法 JSON，无法格式化', 'error'); return; }
    left.value = a.text; right.value = b.text; render();
  });
  document.getElementById('diff-sample')?.addEventListener('click', () => {
    left.value = JSON.stringify({ id: 1, name: 'demo', tags: ['a', 'b'], score: 60, extra: { keep: true } }, null, 2);
    right.value = JSON.stringify({ id: 1, name: 'demo', tags: ['a', 'c'], score: 80 }, null, 2);
    render();
  });
}

// ---------- CSV 文件预览 ----------
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  const source = String(text || '').replace(/^\uFEFF/, '');
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if (inQuotes) {
      if (ch === '"') {
        if (source[i + 1] === '"') { field += '"'; i += 1; } else { inQuotes = false; }
      } else field += ch;
      continue;
    }
    if (ch === '"') inQuotes = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (ch === '\r') { /* 忽略 */ }
    else field += ch;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter((items) => items.some((item) => item.trim() !== ''));
}

function initCsvViewer(notify) {
  const input = document.getElementById('csv-file');
  const tableHost = document.getElementById('csv-table');
  const info = document.getElementById('csv-info');
  if (!input || !tableHost) return;

  input.addEventListener('change', async () => {
    const file = input.files && input.files[0];
    if (!file) return;
    try {
      const rows = parseCsv(await file.text());
      const header = rows[0] || [];
      const body = rows.slice(1, 501);
      if (info) info.textContent = file.name + ' · ' + rows.length + ' 行 × ' + header.length + ' 列 · ' + Math.round(file.size / 1024) + ' KB';
      tableHost.innerHTML = '<table class="jgrid objarray" style="width:max-content;min-width:100%">' +
        '<thead><tr><th class="rownum">#</th>' + header.map((h) => '<th>' + escapeHtml(h) + '</th>').join('') + '</tr></thead><tbody>' +
        body.map((row, index) => '<tr class="row"><td class="rownum">' + (index + 1) + '</td>' +
          header.map((_, col) => '<td class="val">' + escapeHtml(row[col] === undefined ? '' : row[col]) + '</td>').join('') + '</tr>').join('') +
        '</tbody></table>' + (rows.length > 501 ? '<div class="tool-empty">仅显示前 500 行</div>' : '');
      notify('CSV 已加载：' + rows.length + ' 行', 'ok');
    } catch (error) {
      notify('读取 CSV 失败：' + (error && error.message), 'error');
    }
  });
  document.getElementById('csv-clear')?.addEventListener('click', () => {
    input.value = '';
    if (info) info.textContent = '';
    tableHost.innerHTML = '<div class="tool-empty">选择一个 CSV 文件后在这里预览</div>';
  });
}

// ---------- 在线绘图 ----------
function initDrawBoard(notify) {
  const canvas = document.getElementById('draw-canvas');
  if (!canvas) return;
  const context = canvas.getContext('2d');
  const colorInput = document.getElementById('draw-color');
  const sizeInput = document.getElementById('draw-size');
  let drawing = false;
  let last = null;

  const resize = () => {
    const rect = canvas.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    const snapshot = document.createElement('canvas');
    snapshot.width = canvas.width; snapshot.height = canvas.height;
    snapshot.getContext('2d').drawImage(canvas, 0, 0);
    canvas.width = Math.max(1, Math.floor(rect.width * ratio));
    canvas.height = Math.max(1, Math.floor(rect.height * ratio));
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, rect.width, rect.height);
    if (snapshot.width && snapshot.height) context.drawImage(snapshot, 0, 0, snapshot.width / ratio, snapshot.height / ratio);
  };

  const point = (event) => {
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  canvas.addEventListener('pointerdown', (event) => {
    drawing = true; last = point(event); canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener('pointermove', (event) => {
    if (!drawing || !last) return;
    const next = point(event);
    context.strokeStyle = colorInput ? colorInput.value : '#2e7d32';
    context.lineWidth = sizeInput ? Number(sizeInput.value) : 3;
    context.lineCap = 'round'; context.lineJoin = 'round';
    context.beginPath(); context.moveTo(last.x, last.y); context.lineTo(next.x, next.y); context.stroke();
    last = next;
  });
  const stop = () => { drawing = false; last = null; };
  canvas.addEventListener('pointerup', stop);
  canvas.addEventListener('pointerleave', stop);

  document.getElementById('draw-clear')?.addEventListener('click', () => {
    const rect = canvas.getBoundingClientRect();
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, rect.width, rect.height);
    notify('画布已清空', 'ok');
  });
  document.getElementById('draw-save')?.addEventListener('click', () => {
    const link = document.createElement('a');
    link.download = 'cc-drawing-' + Date.now() + '.png';
    link.href = canvas.toDataURL('image/png');
    link.click();
    notify('已导出 PNG', 'ok');
  });

  if (window.ResizeObserver) new ResizeObserver(() => { if (canvas.clientWidth) resize(); }).observe(canvas.parentElement || canvas);
  requestAnimationFrame(resize);
}

// ---------- 系统参数 ----------
function initSettings(notify) {
  const themeButton = document.getElementById('set-theme');
  if (!themeButton) return;
  const batchInput = document.getElementById('set-batch');
  if (batchInput) batchInput.value = readStorage('cc-toolbox-batch', '100');
  document.getElementById('set-batch-save')?.addEventListener('click', () => {
    const value = Math.max(1, Math.min(1000, Number(batchInput.value) || 100));
    writeStorage('cc-toolbox-batch', String(value));
    notify('每批行数已保存：' + value, 'ok');
  });
  const versionEl = document.getElementById('set-version');
  if (versionEl) versionEl.textContent = '见 DBX 插件中心（GitHub Pages 自托管仓库）';

  const applyZoom = (value) => {
    const zoom = Math.min(1.35, Math.max(0.85, value));
    document.body.style.zoom = String(Math.round(zoom * 100) / 100);
    writeStorage('cc-toolbox-zoom', String(zoom));
  };
  const savedZoom = Number(readStorage('cc-toolbox-zoom', '1'));
  if (savedZoom && savedZoom !== 1) applyZoom(savedZoom);

  themeButton.addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    writeStorage('cc-toolbox-theme', next);
    notify(next === 'dark' ? '已切换深色主题' : '已切换淡绿主题', 'ok');
  });
  document.getElementById('set-font-up')?.addEventListener('click', () => {
    applyZoom(Number(readStorage('cc-toolbox-zoom', '1')) + 0.05);
    notify('字号已放大', 'ok');
  });
  document.getElementById('set-font-down')?.addEventListener('click', () => {
    applyZoom(Number(readStorage('cc-toolbox-zoom', '1')) - 0.05);
    notify('字号已缩小', 'ok');
  });
  document.getElementById('set-clear')?.addEventListener('click', async () => {
    if (runtimeStorage) {
      try { await runtimeStorage.clear(); } catch (error) { notify('清除失败：' + error.message, 'error'); return; }
      window.location.reload(); return;
    }
    try {
      Object.keys(localStorage)
        .filter((key) => key.startsWith('cc-toolbox-'))
        .forEach((key) => localStorage.removeItem(key));
    } catch (error) { /* 忽略 */ }
    notify('缓存已清除，正在重新加载…', 'ok');
    setTimeout(() => window.location.reload(), 500);
  });
}

// ================= 数据库 / 报表工具 =================
const BACKTICK = String.fromCharCode(96);

async function getBridge() {
  if (!window.dbxPlugin || !window.dbxPlugin.ready) return null;
  try { await window.dbxPlugin.ready; } catch (error) { return null; }
  return window.dbxPlugin;
}

async function loadConnections(select, notify) {
  const bridge = await getBridge();
  if (!bridge || !bridge.capabilities || !bridge.capabilities.connectionsApi) {
    if (notify) notify('当前 DBX 宿主不支持插件读取连接列表', 'error');
    return [];
  }
  try {
    const connections = await bridge.getConnections();
    if (select) {
      select.innerHTML = '<option value="">选择连接…</option>' + connections.map((conn) =>
        '<option value="' + escapeHtml(conn.id) + '">' + escapeHtml(conn.name) + ' (' + escapeHtml(conn.dialect || conn.dbType || '') + (conn.connected ? ' · 已连接' : ' · 未连接') + ')</option>').join('');
    }
    return connections;
  } catch (error) {
    if (notify) notify('读取连接失败：' + (error && error.message ? error.message : error), 'error');
    return [];
  }
}

async function queryData(connectionId, sql, extra = {}) {
  const bridge = await getBridge();
  if (!bridge || !bridge.capabilities || !bridge.capabilities.dataApi) throw new Error('当前 DBX 宿主不支持插件数据查询');
  return bridge.queryData(Object.assign({ connectionId, sql, maxRows: 500 }, extra));
}

async function copyText(text, notify) {
  const bridge = await getBridge();
  try {
    if (bridge && typeof bridge.copy === 'function') { await bridge.copy(text); notify('已复制到剪贴板', 'ok'); return; }
  } catch (error) { /* 回退 */ }
  try {
    const area = document.createElement('textarea');
    area.value = text;
    document.body.appendChild(area);
    area.select();
    document.execCommand('copy');
    area.remove();
    notify('已复制到剪贴板', 'ok');
  } catch (error) {
    notify('复制失败，请手动选择文本复制', 'error');
  }
}

function quoteIdent(dialect, name) {
  const raw = String(name);
  if (dialect === 'mysql') return BACKTICK + raw.split(BACKTICK).join(BACKTICK + BACKTICK) + BACKTICK;
  return '"' + raw.replace(/"/g, '""') + '"';
}

function sqlString(value) {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  return "'" + String(value).replace(/'/g, "''") + "'";
}

function inferColumnType(values, dialect) {
  const sample = values.filter((v) => v !== null && v !== undefined && v !== '');
  const allInt = sample.length > 0 && sample.every((v) => (typeof v === 'number' && Number.isInteger(v)) || /^-?\d+$/.test(String(v).trim()));
  const allNumber = sample.length > 0 && sample.every((v) => typeof v === 'number' || /^-?\d+(\.\d+)?$/.test(String(v)));
  const allBool = sample.length > 0 && sample.every((v) => typeof v === 'boolean' || v === 'true' || v === 'false');
  if (allBool) return dialect === 'mysql' ? 'TINYINT(1)' : dialect === 'mssql' ? 'BIT' : dialect === 'oracle' ? 'NUMBER(1)' : 'BOOLEAN';
  if (allInt) return dialect === 'sqlite' ? 'INTEGER' : dialect === 'oracle' ? 'NUMBER(19)' : 'BIGINT';
  if (allNumber) return dialect === 'oracle' ? 'NUMBER(18,4)' : 'NUMERIC(18,4)';
  if (dialect === 'postgres') return 'TEXT';
  if (dialect === 'oracle') return 'VARCHAR2(500)';
  if (dialect === 'mssql') return 'NVARCHAR(500)';
  return 'VARCHAR(500)';
}

function dataRowsFromText(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) return { columns: [], rows: [] };
  try {
    const data = JSON.parse(trimmed);
    if (Array.isArray(data) && data.length && data.every((item) => item && typeof item === 'object' && !Array.isArray(item))) {
      const columns = [];
      for (const item of data) for (const key of Object.keys(item)) if (!columns.includes(key)) columns.push(key);
      return { columns, rows: data.map((item) => columns.map((key) => (item[key] === undefined ? null : item[key]))), hasHeader: false };
    }
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      const columns = Object.keys(data);
      return { columns, rows: [columns.map((key) => data[key])], hasHeader: false };
    }
  } catch (error) { /* 按 CSV 处理 */ }
  const rows = parseCsv(trimmed);
  if (!rows.length) return { columns: [], rows: [] };
  const columns = rows[0].map((name, index) => name || 'col_' + (index + 1));
  return { columns, rows: rows.slice(1), hasHeader: true };
}

function rowsToCsvText(rows) {
  return rows.map((row) => row.map((cell) => {
    const value = cell === null || cell === undefined ? '' : String(cell);
    return /[",\r\n]/.test(value) ? '"' + value.replace(/"/g, '""') + '"' : value;
  }).join(',')).join('\r\n');
}

function buildImportSql(source, tableName, dialect) {
  const parsed = dataRowsFromText(source);
  const columns = parsed.columns;
  const rows = parsed.rows;
  if (!columns.length) throw new Error('没有解析到数据，请粘贴 JSON 数组或带表头的 CSV');
  const table = quoteIdent(dialect, tableName || 'tmp_data');
  const columnDefs = columns.map((column, index) => quoteIdent(dialect, column) + ' ' + inferColumnType(rows.map((row) => row[index]), dialect));
  const lines = ['CREATE TABLE ' + table + ' (', '  ' + columnDefs.join(',\n  '), ');', ''];
  const chunkSize = Math.max(1, Math.min(1000, Number(readStorage('cc-toolbox-batch', '100')) || 100));
  for (let start = 0; start < rows.length; start += chunkSize) {
    const batch = rows.slice(start, start + chunkSize);
    lines.push('INSERT INTO ' + table + ' (' + columns.map((column) => quoteIdent(dialect, column)).join(', ') + ') VALUES');
    lines.push(batch.map((row) => '(' + row.map((value) => sqlString(value)).join(', ') + ')').join(',\n') + ';');
    lines.push('');
  }
  return { sql: lines.join('\n'), rowCount: rows.length, columns: columns.length };
}

function initImport(notify) {
  const source = document.getElementById('import-source');
  const output = document.getElementById('import-sql');
  if (!source || !output) return;
  const generate = () => {
    try {
      const result = buildImportSql(source.value, document.getElementById('import-table').value, document.getElementById('import-dialect').value);
      output.value = result.sql;
      document.getElementById('import-hint').textContent = result.rowCount + ' 行 × ' + result.columns + ' 列，SQL 已生成';
      notify('已生成 SQL：' + result.rowCount + ' 行', 'ok');
    } catch (error) {
      output.value = '';
      notify('生成失败：' + error.message, 'error');
    }
  };
  document.getElementById('import-file')?.addEventListener('change', async () => {
    const input = document.getElementById('import-file');
    const file = input.files && input.files[0];
    if (!file) return;
    try {
      let text;
      if (/\.(xlsx|xls)$/i.test(file.name)) {
        if (typeof XLSX === 'undefined') throw new Error('Excel 解析库未加载');
        const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' });
        const sheetName = workbook.SheetNames[0];
        const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, raw: true });
        text = rowsToCsvText(rows);
        notify('已读取工作表「' + sheetName + '」，共 ' + (rows.length - 1) + ' 行', 'ok');
      } else {
        text = await file.text();
      }
      source.value = text;
      generate();
    } catch (error) {
      notify('导入失败：' + (error && error.message ? error.message : error), 'error');
    }
  });
  document.getElementById('import-run')?.addEventListener('click', generate);
  document.getElementById('import-copy')?.addEventListener('click', () => copyText(output.value, notify));
}

function initQuickSheet(notify) {
  const host = document.getElementById('sheet-columns');
  if (!host) return;
  const addRow = (name = '', type = 'TEXT', notNull = false, primary = false) => {
    const row = document.createElement('div');
    row.className = 'sheet-col';
    row.innerHTML = '<input class="col-name" placeholder="字段名" value="' + escapeHtml(name) + '" />' +
      '<select class="col-type"><option>TEXT</option><option>VARCHAR(255)</option><option>INTEGER</option><option>BIGINT</option><option>NUMERIC(18,4)</option><option>BOOLEAN</option><option>DATE</option><option>TIMESTAMP</option></select>' +
      '<label><input type="checkbox" class="col-notnull" /> 非空</label>' +
      '<label><input type="checkbox" class="col-pk" /> 主键</label>' +
      '<button type="button" class="col-remove">删除</button>';
    row.querySelector('.col-type').value = type;
    row.querySelector('.col-notnull').checked = notNull;
    row.querySelector('.col-pk').checked = primary;
    row.querySelector('.col-remove').addEventListener('click', () => row.remove());
    host.appendChild(row);
  };
  addRow('id', 'BIGINT', true, true);
  addRow('name', 'VARCHAR(255)');
  addRow('created_at', 'TIMESTAMP');

  document.getElementById('sheet-add-col')?.addEventListener('click', () => addRow());
  document.getElementById('sheet-run')?.addEventListener('click', () => {
    const dialect = document.getElementById('sheet-dialect').value;
    const table = quoteIdent(dialect, document.getElementById('sheet-table').value || 'new_table');
    const columns = Array.from(host.querySelectorAll('.sheet-col')).map((row) => {
      const name = row.querySelector('.col-name').value.trim() || 'column_name';
      const type = row.querySelector('.col-type').value;
      return quoteIdent(dialect, name) + ' ' + type + (row.querySelector('.col-notnull').checked ? ' NOT NULL' : '') + (row.querySelector('.col-pk').checked ? ' PRIMARY KEY' : '');
    }).filter(Boolean);
    const sql = 'CREATE TABLE ' + table + ' (\n  ' + columns.join(',\n  ') + '\n);';
    document.getElementById('sheet-sql').value = sql;
    notify('CREATE TABLE 已生成', 'ok');
  });
  document.getElementById('sheet-copy')?.addEventListener('click', () => copyText(document.getElementById('sheet-sql').value, notify));
  document.getElementById('sheet-parse-insert')?.addEventListener('click', () => {
    try {
      const parsed = parseInsertSql(document.getElementById('sheet-insert').value);
      document.getElementById('sheet-table').value = parsed.table;
      host.innerHTML = '';
      parsed.columns.forEach((column, index) => {
        const values = parsed.rows.map((row) => row[index]);
        addRow(column, pickSelectType(inferColumnType(values, 'postgres')));
      });
      document.getElementById('sheet-run').click();
      notify('已解析 INSERT 并生成 CREATE TABLE', 'ok');
    } catch (error) {
      notify('解析失败：' + error.message, 'error');
    }
  });
}

function initValidation(notify) {
  const select = document.getElementById('val-connection');
  const output = document.getElementById('val-sql');
  if (!select || !output) return;
  let loaded = false;

  const ensure = async () => {
    if (!loaded) { await loadConnections(select, notify); loaded = true; }
  };
  const currentDialect = () => {
    const option = select.options[select.selectedIndex];
    const match = option ? /\b(mysql|postgres|sqlite|mssql|oracle)\b/i.exec(option.textContent) : null;
    return match ? match[1].toLowerCase() : 'postgres';
  };

  const buildSql = () => {
    const table = document.getElementById('val-table').value.trim();
    if (!table) throw new Error('请填写表名');
    const columns = document.getElementById('val-columns').value.split(',').map((c) => c.trim()).filter(Boolean);
    if (!columns.length) throw new Error('请填写要校验的字段（逗号分隔）');
    const dialect = currentDialect();
    const maxLen = Number(document.getElementById('val-max-len').value) || 255;
    const enumValues = document.getElementById('val-enum-values').value.split(',').map((v) => v.trim()).filter(Boolean);
    const statements = [];
    for (const column of columns) {
      if (document.getElementById('val-null').checked) {
        statements.push('-- ' + column + ' 空值检查\nSELECT COUNT(*) AS null_count FROM ' + table + ' WHERE ' + column + ' IS NULL;');
      }
      if (document.getElementById('val-dup').checked) {
        statements.push('-- ' + column + ' 重复值\nSELECT ' + column + ' AS value, COUNT(*) AS cnt FROM ' + table + ' GROUP BY ' + column + ' HAVING COUNT(*) > 1;');
      }
      if (document.getElementById('val-len').checked) {
        const lengthFn = dialect === 'mssql' ? 'LEN' : 'LENGTH';
        statements.push('-- ' + column + ' 超长检查（>' + maxLen + '）\nSELECT COUNT(*) AS too_long FROM ' + table + ' WHERE ' + lengthFn + '(' + column + ') > ' + maxLen + ';');
      }
      if (document.getElementById('val-enum').checked && enumValues.length) {
        statements.push('-- ' + column + ' 枚举外值\nSELECT ' + column + ', COUNT(*) AS cnt FROM ' + table + ' WHERE ' + column + ' NOT IN (' + enumValues.map((v) => sqlString(v)).join(', ') + ') GROUP BY ' + column + ';');
      }
    }
    return statements.join('\n\n');
  };

  document.getElementById('val-generate')?.addEventListener('click', async () => {
    try { await ensure(); output.value = buildSql(); notify('校验 SQL 已生成', 'ok'); }
    catch (error) { notify('生成失败：' + error.message, 'error'); }
  });
  document.getElementById('val-copy')?.addEventListener('click', () => copyText(output.value, notify));
  document.getElementById('val-run')?.addEventListener('click', async () => {
    try {
      await ensure();
      const connectionId = select.value;
      if (!connectionId) { notify('请选择连接', 'error'); return; }
      const sqlText = buildSql();
      output.value = sqlText;
      const statements = sqlText.split(/;\s*\n/).map((part) => part.replace(/^--.*$/gm, '').trim()).filter(Boolean).map((part) => part + ';');
      const host = document.getElementById('val-result');
      host.innerHTML = '';
      let index = 0;
      for (const statement of statements) {
        index += 1;
        const result = await queryData(connectionId, statement);
        const html = '<div class="tool-head" style="height:auto;padding:6px 8px">第 ' + index + ' 条 · ' + result.rows.length + ' 行 · ' + (result.elapsedMs || 0) + ' ms</div>' +
          '<table class="jgrid objarray" style="width:max-content;min-width:100%"><thead><tr>' +
          result.columns.map((column) => '<th>' + escapeHtml(column.name) + '</th>').join('') + '</tr></thead><tbody>' +
          result.rows.map((row) => '<tr>' + row.map((value) => '<td class="val">' + escapeHtml(value === null ? '' : String(value)) + '</td>').join('') + '</tr>').join('') +
          '</tbody></table>';
        host.insertAdjacentHTML('beforeend', html);
      }
      notify('校验执行完成，共 ' + statements.length + ' 条', 'ok');
    } catch (error) {
      notify('执行失败：' + (error && error.message ? error.message : error), 'error');
    }
  });
}

function initOfflineValidation(notify) {
  const source = document.getElementById('val-source');
  const host = document.getElementById('val-offline-result');
  if (!source || !host) return;
  let issues = [];

  const rowsFromText = (text) => {
    const trimmed = String(text || '').trim();
    if (!trimmed) throw new Error('请先粘贴 INSERT / CSV / JSON 数据');
    if (/^insert\s+into/i.test(trimmed)) return parseInsertSql(trimmed);
    return dataRowsFromText(trimmed);
  };

  const run = () => {
    try {
      const parsed = rowsFromText(source.value);
      const columns = parsed.columns;
      const rows = parsed.rows;
      if (!columns.length || !rows.length) throw new Error('没有解析到数据行');
      const maxLen = Number(document.getElementById('val-max-len').value) || 255;
      const enumValues = document.getElementById('val-enum-values').value.split(',').map((v) => v.trim()).filter(Boolean);
      const regexText = document.getElementById('val-regex').value.trim();
      const regex = regexText ? new RegExp(regexText) : null;
      const dupColumns = document.getElementById('val-dup-columns').value.split(',').map((name) => name.trim()).filter(Boolean);
      const dupTargets = dupColumns.length ? dupColumns : [columns[0]];
      issues = [];

      const rowOffset = parsed.hasHeader ? 2 : 1;
      const addIssue = (rowIndex, column, rule, value, message) => {
        issues.push({ row: rowIndex + rowOffset, column, rule, value: value === null || value === undefined ? '' : String(value), message });
      };
      const columnValues = columns.map((_, index) => rows.map((row) => row[index]));
      columns.forEach((column, index) => {
        const values = columnValues[index];
        if (document.getElementById('val-null').checked) {
          values.forEach((value, rowIndex) => { if (value === null || value === undefined || String(value).trim() === '') addIssue(rowIndex, column, '空值', value, '该字段为空'); });
        }
        if (document.getElementById('val-dup').checked && dupTargets.includes(column)) {
          const counts = new Map();
          values.forEach((value) => { const key = String(value); counts.set(key, (counts.get(key) || 0) + 1); });
          values.forEach((value, rowIndex) => { if (counts.get(String(value)) > 1) addIssue(rowIndex, column, '重复值', value, '出现 ' + counts.get(String(value)) + ' 次'); });
        }
        if (document.getElementById('val-len').checked) {
          values.forEach((value, rowIndex) => { if (value !== null && String(value).length > maxLen) addIssue(rowIndex, column, '超长', value, '长度 ' + String(value).length + ' > ' + maxLen); });
        }
        if (document.getElementById('val-enum').checked && enumValues.length) {
          const applies = values.some((value) => enumValues.includes(String(value)));
          if (applies) values.forEach((value, rowIndex) => { if (value !== null && String(value) !== '' && !enumValues.includes(String(value))) addIssue(rowIndex, column, '枚举外值', value, '不在允许值中'); });
        }
        if (regex) {
          const applies = values.some((value) => value !== null && String(value).trim() !== '' && regex.test(String(value)));
          if (applies) values.forEach((value, rowIndex) => {
            if (value === null || String(value).trim() === '') return;
            if (!regex.test(String(value))) addIssue(rowIndex, column, '格式不符', value, '不匹配正则 ' + regexText);
          });
        }
      });

      const summary = '共 ' + rows.length + ' 行 × ' + columns.length + ' 列，发现问题 ' + issues.length + ' 处';
      host.innerHTML = '<div class="diff-summary">' + summary + '</div>' +
        (issues.length
          ? '<table class="jgrid objarray" style="width:max-content;min-width:100%"><thead><tr><th>行号</th><th>字段</th><th>规则</th><th>值</th><th>说明</th></tr></thead><tbody>' +
            issues.slice(0, 1000).map((issue) => '<tr class="row"><td class="val">' + issue.row + '</td><td class="val">' + escapeHtml(issue.column) +
              '</td><td class="val">' + escapeHtml(issue.rule) + '</td><td class="val">' + escapeHtml(issue.value) +
              '</td><td class="val">' + escapeHtml(issue.message) + '</td></tr>').join('') + '</tbody></table>'
          : '<div class="tool-empty">没有发现问题</div>');
      notify(summary, issues.length ? 'info' : 'ok');
    } catch (error) {
      notify('校验失败：' + error.message, 'error');
    }
  };

  document.getElementById('val-offline-run')?.addEventListener('click', run);
  document.getElementById('val-offline-export')?.addEventListener('click', () => {
    if (!issues.length) { notify('没有可导出的问题', 'error'); return; }
    const header = '行号,字段,规则,值,说明\r\n';
    const body = issues.map((issue) => [issue.row, issue.column, issue.rule, issue.value, issue.message]
      .map((cell) => '"' + String(cell).replace(/"/g, '""') + '"').join(',')).join('\r\n');
    const blob = new Blob(['\uFEFF' + header + body], { type: 'text/csv;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'validation-report-' + Date.now() + '.csv';
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 3000);
    notify('校验报告已导出', 'ok');
  });
}

function initHome(notify) {
  const cards = document.getElementById('home-cards');
  if (!cards) return;
  const tableCountSql = (dialect) => {
    switch (String(dialect || '').toLowerCase()) {
      case 'mysql': return 'SELECT COUNT(*) AS tables FROM information_schema.tables WHERE table_schema = DATABASE()';
      case 'sqlite': return "SELECT COUNT(*) AS tables FROM sqlite_master WHERE type = 'table'";
      case 'mssql': return 'SELECT COUNT(*) AS tables FROM sys.tables';
      case 'oracle': return 'SELECT COUNT(*) AS tables FROM user_tables';
      default: return "SELECT COUNT(*) AS tables FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog', 'information_schema')";
    }
  };
  const refresh = async () => {
    cards.innerHTML = '<div class="tool-empty">正在读取连接信息…</div>';
    const connections = await loadConnections(null, notify);
    if (!connections.length) {
      cards.innerHTML = '<div class="tool-empty">没有读取到 DBX 连接：需要 DBX 支持连接读取，并在弹窗中允许插件访问</div>';
      return;
    }
    cards.innerHTML = connections.map((conn) => '<div class="home-card" data-conn="' + escapeHtml(conn.id) + '" data-dialect="' + escapeHtml(conn.dialect || conn.dbType || 'postgres') + '">' +
      '<b>' + escapeHtml(conn.name) + '</b>' +
      '方言：' + escapeHtml(conn.dialect || conn.dbType || '-') + '<br>' +
      '状态：' + (conn.connected || conn.isConnected ? '已连接' : '未连接') + '<br>' +
      '数据库：' + escapeHtml(conn.database || '-') + '<br>' +
      '只读：' + (conn.readOnly ? '是' : '否') + '<br>' +
      '<button type="button" class="home-test">查询表数量</button> <span class="home-count"></span>' +
      '</div>').join('');
    cards.querySelectorAll('.home-test').forEach((button) => {
      button.addEventListener('click', async () => {
        const card = button.closest('.home-card');
        try {
          const result = await queryData(card.dataset.conn, tableCountSql(card.dataset.dialect));
          card.querySelector('.home-count').textContent = '表数量：' + (result.rows[0] ? result.rows[0][0] : '?');
        } catch (error) {
          card.querySelector('.home-count').textContent = '查询失败';
          notify('查询失败：' + (error && error.message ? error.message : error), 'error');
        }
      });
    });
  };
  document.getElementById('home-refresh')?.addEventListener('click', refresh);
  document.querySelectorAll('.home-link').forEach((button) => {
    button.addEventListener('click', () => {
      const target = document.querySelector('[data-tool="' + button.dataset.goto + '"]');
      if (target) target.click();
    });
  });
}

function initInvoice(notify) {
  const printerSelect = document.getElementById('inv-printer');
  const previewArea = document.getElementById('inv-preview-area');
  const hint = document.getElementById('inv-hint');
  if (!printerSelect || !previewArea) return;
  const state = { images: [] };
  let bridge = null;
  const setHint = (value) => { if (hint) hint.textContent = value; };

  const ensureBridge = async () => {
    if (bridge) return bridge;
    bridge = await getBridge();
    if (!bridge || typeof bridge.invoke !== 'function') {
      setHint('当前插件未包含原生侧车（纯前端版本），无法打印');
      notify('发票打印需要 windows-x64 版本插件（含原生侧车）', 'error');
      return null;
    }
    try {
      await bridge.invoke('invoice/version', {}, { timeoutMs: 5000 });
    } catch (error) {
      setHint('侧车不可用：' + (error && error.message ? error.message : error));
      return null;
    }
    return bridge;
  };

  const paperSize = () => {
    const paper = document.getElementById('inv-paper').value;
    if (paper === 'invoice') return { width: 240, height: 140 };
    if (paper === 'custom') {
      return {
        width: Number(document.getElementById('inv-paper-w').value) || 210,
        height: Number(document.getElementById('inv-paper-h').value) || 297,
      };
    }
    return { width: 210, height: 297 };
  };

  const refreshPrinters = async () => {
    const api = await ensureBridge();
    if (!api) return;
    try {
      const result = await api.invoke('invoice/printers', {}, { timeoutMs: 8000 });
      const printers = (result && result.printers) || [];
      printerSelect.innerHTML = printers.map((item) =>
        '<option value="' + escapeHtml(item.name) + '"' + (item.isDefault ? ' selected' : '') + '>' + escapeHtml(item.name) + '</option>').join('');
      setHint('已读取 ' + printers.length + ' 台打印机');
      notify('打印机已刷新：' + printers.length + ' 台', 'ok');
    } catch (error) {
      notify('读取打印机失败：' + (error && error.message ? error.message : error), 'error');
    }
  };

  const readFiles = async (files) => {
    const images = [];
    for (const file of files) {
      const isImage = /^image\//.test(file.type);
      const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
      if (!isImage && !isPdf) { notify('仅支持 PDF 或图片发票：' + file.name, 'error'); continue; }
      images.push(await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      }));
    }
    state.images = images;
    setHint('已选择 ' + images.length + ' 个发票文件（PDF 会按页展开）');
    return images;
  };

  document.getElementById('inv-refresh')?.addEventListener('click', refreshPrinters);
  document.getElementById('inv-files')?.addEventListener('change', (event) => readFiles(Array.from(event.target.files || [])));
  document.getElementById('inv-preview')?.addEventListener('click', async () => {
    const api = await ensureBridge();
    if (!api) return;
    if (!state.images.length) { notify('请先选择发票图片', 'error'); return; }
    try {
      const paper = paperSize();
      const result = await api.invoke('invoice/preview', {
        images: state.images,
        layout: Number(document.getElementById('inv-layout').value),
        paperWidthMm: paper.width,
        paperHeightMm: paper.height,
      }, { timeoutMs: 60000 });
      const pages = (result && result.pages) || [];
      previewArea.innerHTML = pages.map((data, index) =>
        '<div class="invoice-page"><div class="invoice-page-label">第 ' + (index + 1) + ' 页</div><img src="data:image/png;base64,' + data + '" /></div>').join('') ||
        '<div class="tool-empty">没有生成预览</div>';
      setHint('预览：' + pages.length + ' 页');
      notify('预览已生成：' + pages.length + ' 页', 'ok');
    } catch (error) {
      notify('预览失败：' + (error && error.message ? error.message : error), 'error');
    }
  });
  document.getElementById('inv-print')?.addEventListener('click', async () => {
    const api = await ensureBridge();
    if (!api) return;
    if (!state.images.length) { notify('请先选择发票图片', 'error'); return; }
    try {
      const paper = paperSize();
      const result = await api.invoke('invoice/print', {
        printer: printerSelect.value,
        images: state.images,
        layout: Number(document.getElementById('inv-layout').value),
        copies: Number(document.getElementById('inv-copies').value) || 1,
        offsetXmm: Number(document.getElementById('inv-offset-x').value) || 0,
        offsetYmm: Number(document.getElementById('inv-offset-y').value) || 0,
        paperWidthMm: paper.width,
        paperHeightMm: paper.height,
      }, { timeoutMs: 120000 });
      setHint('已发送打印：' + ((result && result.pages) || 0) + ' 页');
      notify('已发送打印：' + ((result && result.pages) || 0) + ' 页', 'ok');
    } catch (error) {
      notify('打印失败：' + (error && error.message ? error.message : error), 'error');
    }
  });

  refreshPrinters();
}

const CSV_KEY_SEP = String.fromCharCode(1);
const IDENT_QUOTE_RE = new RegExp('["' + BACKTICK + ']', 'g');

function stripIdent(name) {
  return String(name).replace(IDENT_QUOTE_RE, '').trim();
}

function pickSelectType(type) {
  if (type.indexOf('BIGINT') >= 0) return 'BIGINT';
  if (type.indexOf('NUMERIC') >= 0) return 'NUMERIC(18,4)';
  if (type.indexOf('BOOLEAN') >= 0) return 'BOOLEAN';
  if (type.indexOf('INTEGER') >= 0) return 'INTEGER';
  if (type.indexOf('VARCHAR') >= 0) return 'VARCHAR(255)';
  return 'TEXT';
}

function parseInsertSql(text) {
  const sql = String(text || '').trim();
  if (!sql) throw new Error('请粘贴 INSERT SQL');
  const head = /^INSERT\s+INTO\s+([^\s(]+)\s*\(([^)]*)\)/i.exec(sql);
  if (!head) throw new Error('仅支持：INSERT INTO 表名(字段...) VALUES (...)');
  const table = stripIdent(head[1]).split('.').pop();
  const columns = head[2].split(',').map((name) => stripIdent(name)).filter(Boolean);
  if (!columns.length) throw new Error('没有解析到字段列表');
  const valuesIndex = sql.toUpperCase().indexOf('VALUES', head[0].length);
  if (valuesIndex < 0) throw new Error('缺少 VALUES');
  let i = valuesIndex + 'VALUES'.length;
  const length = sql.length;
  const rows = [];
  const skip = () => { while (i < length && /\s/.test(sql[i])) i += 1; };
  const parseValue = () => {
    skip();
    if (sql[i] === "'") {
      i += 1;
      let value = '';
      while (i < length) {
        if (sql[i] === "'" && sql[i + 1] === "'") { value += "'"; i += 2; continue; }
        if (sql[i] === "'") { i += 1; return value; }
        value += sql[i]; i += 1;
      }
      throw new Error('字符串未闭合');
    }
    const start = i;
    while (i < length && /[^,)]/.test(sql[i])) i += 1;
    const token = sql.slice(start, i).trim();
    if (/^NULL$/i.test(token)) return null;
    if (/^-?\d+(\.\d+)?$/.test(token)) return Number(token);
    if (/^TRUE$/i.test(token)) return true;
    if (/^FALSE$/i.test(token)) return false;
    return token;
  };
  while (i < length) {
    skip();
    if (sql[i] !== '(') break;
    i += 1;
    const row = [];
    while (true) {
      row.push(parseValue());
      skip();
      if (sql[i] === ',') { i += 1; continue; }
      if (sql[i] === ')') { i += 1; break; }
      throw new Error('VALUES 格式不正确');
    }
    rows.push(row);
    skip();
    if (sql[i] === ',') { i += 1; continue; }
    if (sql[i] === ';' || sql[i] === '') break;
    throw new Error('VALUES 之间存在无法识别的内容');
  }
  if (!rows.length) throw new Error('没有解析到 VALUES 数据行');
  return { table, columns, rows };
}

function initCsvCompare(notify) {
  const resultHost = document.getElementById('cmp-result');
  const summary = document.getElementById('cmp-summary');
  const hint = document.getElementById('cmp-hint');
  if (!resultHost) return;
  const state = { a: null, b: null, nameA: '', nameB: '' };
  let differences = [];

  const readFile = async (inputId, key) => {
    const input = document.getElementById(inputId);
    const file = input.files && input.files[0];
    if (!file) return;
    const rows = parseCsv(await file.text());
    state[key] = rows;
    state[key === 'a' ? 'nameA' : 'nameB'] = file.name;
    hint.textContent = 'A：' + (state.nameA || '-') + '（' + (state.a ? state.a.length - 1 : 0) + ' 行） · B：' +
      (state.nameB || '-') + '（' + (state.b ? state.b.length - 1 : 0) + ' 行）';
    notify('已载入 ' + file.name, 'ok');
  };
  document.getElementById('cmp-file-a')?.addEventListener('change', () => readFile('cmp-file-a', 'a'));
  document.getElementById('cmp-file-b')?.addEventListener('change', () => readFile('cmp-file-b', 'b'));

  const run = () => {
    if (!state.a || !state.b) { notify('请先选择 A、B 两个 CSV 文件', 'error'); return; }
    const headersA = (state.a[0] || []).map((name) => name.trim());
    const headersB = (state.b[0] || []).map((name) => name.trim());
    const common = headersA.filter((name) => headersB.includes(name));
    if (!common.length) { notify('两个 CSV 没有同名字段，无法比对', 'error'); return; }
    const keyNames = document.getElementById('cmp-keys').value.split(',').map((name) => name.trim()).filter(Boolean);
    const keyIndexesA = keyNames.map((name) => headersA.indexOf(name));
    const keyIndexesB = keyNames.map((name) => headersB.indexOf(name));
    if (keyNames.length && (keyIndexesA.includes(-1) || keyIndexesB.includes(-1))) {
      notify('主键列在 A 或 B 中不存在', 'error');
      return;
    }
    const rowsA = state.a.slice(1);
    const rowsB = state.b.slice(1);
    const rows = [];
    const commonA = common.map((name) => headersA.indexOf(name));
    const commonB = common.map((name) => headersB.indexOf(name));

    if (keyNames.length) {
      const mapA = new Map();
      const mapB = new Map();
      rowsA.forEach((row) => mapA.set(keyIndexesA.map((index) => row[index]).join(CSV_KEY_SEP), row));
      rowsB.forEach((row) => mapB.set(keyIndexesB.map((index) => row[index]).join(CSV_KEY_SEP), row));
      const keys = Array.from(new Set(Array.from(mapA.keys()).concat(Array.from(mapB.keys()))));
      for (const key of keys) {
        const rowA = mapA.get(key);
        const rowB = mapB.get(key);
        const keyText = key.split(CSV_KEY_SEP).join(', ');
        if (!rowB) { rows.push({ status: 'removed', key: keyText, detail: 'B 中不存在该行' }); continue; }
        if (!rowA) { rows.push({ status: 'added', key: keyText, detail: 'A 中不存在该行' }); continue; }
        const changes = [];
        common.forEach((name, index) => {
          const va = rowA[commonA[index]];
          const vb = rowB[commonB[index]];
          if (String(va) !== String(vb)) changes.push(name + ': ' + va + ' → ' + vb);
        });
        rows.push(changes.length ? { status: 'changed', key: keyText, detail: changes.join('；') } : { status: 'same', key: keyText, detail: '' });
      }
    } else {
      const length = Math.max(rowsA.length, rowsB.length);
      for (let index = 0; index < length; index += 1) {
        const rowA = rowsA[index];
        const rowB = rowsB[index];
        const keyText = '第 ' + (index + 1) + ' 行';
        if (!rowB) { rows.push({ status: 'removed', key: keyText, detail: 'B 中不存在' }); continue; }
        if (!rowA) { rows.push({ status: 'added', key: keyText, detail: 'A 中不存在' }); continue; }
        const changes = [];
        common.forEach((name, columnIndex) => {
          const va = rowA[commonA[columnIndex]];
          const vb = rowB[commonB[columnIndex]];
          if (String(va) !== String(vb)) changes.push(name + ': ' + va + ' → ' + vb);
        });
        rows.push(changes.length ? { status: 'changed', key: keyText, detail: changes.join('；') } : { status: 'same', key: keyText, detail: '' });
      }
    }

    const added = rows.filter((row) => row.status === 'added').length;
    const removed = rows.filter((row) => row.status === 'removed').length;
    const changed = rows.filter((row) => row.status === 'changed').length;
    const same = rows.filter((row) => row.status === 'same').length;
    differences = rows.filter((row) => row.status !== 'same');
    summary.textContent = 'A 与 B：新增 ' + added + ' 行，删除 ' + removed + ' 行，修改 ' + changed + ' 行，相同 ' + same + ' 行';
    const label = { added: '新增', removed: '删除', changed: '修改', same: '相同' };
    resultHost.innerHTML = '<table class="jgrid objarray" style="width:max-content;min-width:100%"><thead><tr><th>状态</th><th>行/主键</th><th>差异内容</th></tr></thead><tbody>' +
      rows.slice(0, 500).map((row) => '<tr class="row"><td class="val">' + label[row.status] + '</td><td class="val">' + escapeHtml(row.key) + '</td><td class="val">' + escapeHtml(row.detail) + '</td></tr>').join('') +
      '</tbody></table>' + (rows.length > 500 ? '<div class="tool-empty">仅显示前 500 行差异</div>' : '');
    notify('比对完成：' + differences.length + ' 处差异', 'ok');
  };

  document.getElementById('cmp-run')?.addEventListener('click', run);
  document.getElementById('cmp-swap')?.addEventListener('click', () => {
    const tempRows = state.a; state.a = state.b; state.b = tempRows;
    const tempName = state.nameA; state.nameA = state.nameB; state.nameB = tempName;
    hint.textContent = 'A：' + (state.nameA || '-') + ' · B：' + (state.nameB || '-');
    if (state.a && state.b) run();
  });
  document.getElementById('cmp-export')?.addEventListener('click', () => {
    if (!differences.length) { notify('没有差异可导出', 'error'); return; }
    const csv = '\uFEFF状态,行或主键,差异内容\r\n' + differences.map((row) =>
      '"' + row.status + '","' + row.key.replace(/"/g, '""') + '","' + row.detail.replace(/"/g, '""') + '"').join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'csv-diff-' + Date.now() + '.csv';
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 3000);
    notify('差异 CSV 已导出', 'ok');
  });
}
