// 纯函数 JSON → 表格/树 HTML 渲染器（无外部依赖，可单独测试）
export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function kindOf(value) {
  if (value === null || value === undefined) return 'null';
  if (Array.isArray(value)) return 'array';
  switch (typeof value) {
    case 'object': return 'object';
    case 'string': return 'string';
    case 'number': return 'number';
    case 'boolean': return 'boolean';
    default: return 'unknown';
  }
}

export function displayScalar(value) {
  const kind = kindOf(value);
  if (kind === 'string') return value;
  if (kind === 'null') return 'null';
  return String(value);
}

export function formatBytes(bytes) {
  if (!bytes) return '0 B';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1024 / 1024).toFixed(2) + ' MB';
}

function scanJsonStructure(text) {
  let i = 0;
  const n = text.length;
  const fail = (message) => { const error = new Error(message); error.pos = i; throw error; };
  const ws = () => { while (i < n && /\s/.test(text[i])) i += 1; };
  const value = () => {
    ws();
    if (i >= n) fail('Unexpected end of input');
    const c = text[i];
    if (c === '{') {
      i += 1; ws();
      if (text[i] === '}') { i += 1; return; }
      while (true) {
        ws();
        if (text[i] === '"') stringLiteral(); else fail('Expected property name');
        ws();
        if (text[i] !== ':') fail('Expected ":"');
        i += 1; value(); ws();
        if (text[i] === ',') { i += 1; continue; }
        if (text[i] === '}') { i += 1; return; }
        fail('Expected "," or "}"');
      }
    } else if (c === '[') {
      i += 1; ws();
      if (text[i] === ']') { i += 1; return; }
      while (true) {
        value(); ws();
        if (text[i] === ',') { i += 1; continue; }
        if (text[i] === ']') { i += 1; return; }
        fail('Expected "," or "]"');
      }
    } else if (c === '"') {
      stringLiteral();
    } else if (text.startsWith('true', i)) { i += 4; }
    else if (text.startsWith('false', i)) { i += 5; }
    else if (text.startsWith('null', i)) { i += 4; }
    else {
      const match = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(text.slice(i));
      if (!match) fail('Unexpected token');
      i += match[0].length;
    }
  };
  const stringLiteral = () => {
    i += 1;
    while (i < n) {
      const c = text[i];
      if (c === '\\') { i += 2; continue; }
      if (c === '"') { i += 1; return; }
      if (c === '\n') fail('Unterminated string');
      i += 1;
    }
    fail('Unterminated string');
  };
  try {
    value(); ws();
    if (i < n) fail('Unexpected content after JSON');
    return null;
  } catch (error) {
    return { pos: error.pos, message: error.message };
  }
}

function locate(text, position) {
  const before = text.slice(0, Math.max(0, Math.min(position, text.length)));
  const line = before.split('\n').length;
  const column = position - before.lastIndexOf('\n');
  return { line, column };
}

// 解析 JSON 文本，返回 { ok, data, error: { message, line, column } }
export function parseJsonDocument(text) {
  const raw = String(text ?? '').replace(/^﻿/, '');
  if (!raw.trim()) return { ok: false, data: null, error: { message: '内容为空', line: 0, column: 0 } };
  try {
    return { ok: true, data: JSON.parse(raw), error: null };
  } catch (error) {
    let message = String(error && error.message ? error.message : error);
    let position = -1;
    const match = /position\s+(\d+)/i.exec(message);
    if (match) position = Math.min(Number(match[1]), raw.length);
    if (position < 0) {
      const scanned = scanJsonStructure(raw);
      if (scanned) { position = scanned.pos; message = scanned.message; }
    }
    const where = position >= 0 ? locate(raw, position) : { line: 0, column: 0 };
    return { ok: false, data: null, error: { message, line: where.line, column: where.column } };
  }
}

let uidCounter = 0;
function uid() {
  uidCounter += 1;
  return 'jgn' + uidCounter;
}

const MAX_DEPTH = 12;

function collectKeys(rows) {
  const keys = [];
  const seen = new Set();
  for (const row of rows) {
    if (!isPlainObject(row)) continue;
    for (const key of Object.keys(row)) {
      if (!seen.has(key)) { seen.add(key); keys.push(key); }
    }
  }
  return keys;
}

function columnWidths(keys, rows) {
  return keys.map((key) => {
    let max = String(key).length;
    const sample = rows.slice(0, 80);
    for (const row of sample) {
      if (!isPlainObject(row)) continue;
      const value = row[key];
      if (value === undefined) continue;
      const text = Array.isArray(value) || isPlainObject(value) ? 10 : displayScalar(value);
      max = Math.max(max, Math.min(String(text).length, 40));
    }
    return Math.max(90, Math.min(280, 56 + max * 7.2));
  });
}

function containerBadge(value, path, keyName) {
  const id = uid();
  const count = Array.isArray(value) ? value.length : Object.keys(value).length;
  const icon = Array.isArray(value) ? '[]' : '{}';
  const label = keyName ? '<span class="cname">' + escapeHtml(keyName) + '</span>' : '';
  const html =
    '<span class="container-cell">' +
    '<button type="button" class="tgl" data-target="' + id + '" aria-expanded="false" title="展开/收起">+</button>' +
    '<span class="badge" title="' + (Array.isArray(value) ? '数组' : '对象') + '共 ' + count + ' 项">[' + count + ']</span>' +
    '<span class="ctype">' + icon + '</span>' +
    label +
    '</span>';
  return { html, id, value, path };
}

function scalarCell(value) {
  const kind = kindOf(value);
  const text = displayScalar(value);
  const title = text.length > 60 ? ' title="' + escapeHtml(text) + '"' : '';
  return '<span class="v ' + kind + '"' + title + '>' + escapeHtml(text) + '</span>';
}

function valueCell(value, path, keyName) {
  if (Array.isArray(value) || isPlainObject(value)) {
    return { cell: containerBadge(value, path, keyName), nestedValue: value };
  }
  return { cell: { html: scalarCell(value) }, nestedValue: null };
}

function nestedTable(value, path, depth) {
  if (depth > MAX_DEPTH) return '<div class="nested-note">嵌套层级过深，已折叠</div>';
  if (isPlainObject(value)) return renderKeyValueTable(value, path, depth);
  if (Array.isArray(value)) {
    if (value.length > 0 && value.every((item) => isPlainObject(item))) return renderObjectArrayTable(value, path, depth);
    return renderIndexValueTable(value, path, depth);
  }
  return '<div class="nested-scalar">' + scalarCell(value) + '</div>';
}

function nestedRow(nestedHtml, colspan) {
  return '<tr class="nested-row"><td colspan="' + colspan + '"><div class="nested-box">' + nestedHtml + '</div></td></tr>';
}

export function renderKeyValueTable(data, path, depth = 0) {
  const entries = Object.entries(data);
  const rows = [];
  let index = 0;
  for (const [key, value] of entries) {
    index += 1;
    const childPath = path + '/' + key;
    const cell = valueCell(value, childPath, key);
    rows.push(
      '<tr class="row" data-path="' + escapeHtml(childPath) + '">' +
        '<td class="rownum">' + index + '</td>' +
        '<td class="key">' + escapeHtml(key) + '</td>' +
        '<td class="val">' + cell.cell.html + '</td>' +
      '</tr>'
    );
    if (cell.nestedValue !== null) {
      rows.push(
        '<tr class="nested-row"><td colspan="3"><div class="nested-box" id="' + cell.cell.id + '" hidden>' +
          nestedTable(cell.nestedValue, childPath, depth + 1) +
        '</div></td></tr>'
      );
    }
  }
  return (
    '<div class="table-block kv-block">' +
      '<table class="jgrid kv">' +
        '<colgroup><col style="width:46px"><col style="width:220px"><col></colgroup>' +
        '<thead><tr><th class="rownum">#</th><th>键</th><th>值</th></tr></thead>' +
        '<tbody>' + rows.join('') + '</tbody>' +
      '</table>' +
    '</div>'
  );
}

export function renderIndexValueTable(data, path, depth = 0) {
  const rows = [];
  data.forEach((value, i) => {
    const childPath = path + '/' + i;
    const cell = valueCell(value, childPath, null);
    rows.push(
      '<tr class="row" data-path="' + escapeHtml(childPath) + '">' +
        '<td class="rownum">' + (i + 1) + '</td>' +
        '<td class="val">' + cell.cell.html + '</td>' +
      '</tr>'
    );
    if (cell.nestedValue !== null) {
      rows.push(
        '<tr class="nested-row"><td colspan="2"><div class="nested-box" id="' + cell.cell.id + '" hidden>' +
          nestedTable(cell.nestedValue, childPath, depth + 1) +
        '</div></td></tr>'
      );
    }
  });
  return (
    '<div class="table-block">' +
      '<table class="jgrid idx">' +
        '<colgroup><col style="width:46px"><col></colgroup>' +
        '<thead><tr><th class="rownum">#</th><th>值</th></tr></thead>' +
        '<tbody>' + rows.join('') + '</tbody>' +
      '</table>' +
    '</div>'
  );
}

export function renderObjectArrayTable(rowsData, path, depth = 0) {
  const keys = collectKeys(rowsData);
  const widths = columnWidths(keys, rowsData);
  const colgroup = '<colgroup><col style="width:46px">' + widths.map((w) => '<col style="width:' + w + 'px">').join('') + '</colgroup>';
  const head = '<thead><tr><th class="rownum">#</th>' + keys.map((k) => '<th title="' + escapeHtml(k) + '">' + escapeHtml(k) + '</th>').join('') + '</tr></thead>';
  const body = [];
  rowsData.forEach((row, i) => {
    const childPath = path + '/' + i;
    const cells = [];
    const nested = [];
    for (const key of keys) {
      const cellPath = childPath + '/' + key;
      if (!isPlainObject(row) || row[key] === undefined) {
        cells.push('<td class="val missing">⊘</td>');
        continue;
      }
      const value = row[key];
      const cell = valueCell(value, cellPath, key);
      cells.push('<td class="val">' + cell.cell.html + '</td>');
      if (cell.nestedValue !== null) {
        nested.push(
          '<tr class="nested-row"><td colspan="' + (keys.length + 1) + '"><div class="nested-box" id="' + cell.cell.id + '" hidden>' +
            nestedTable(cell.nestedValue, cellPath, depth + 1) +
          '</div></td></tr>'
        );
      }
    }
    body.push('<tr class="row" data-path="' + escapeHtml(childPath) + '"><td class="rownum">' + (i + 1) + '</td>' + cells.join('') + '</tr>');
    body.push(...nested);
  });
  return (
    '<div class="table-block array-block">' +
      '<table class="jgrid objarray">' + colgroup + head + '<tbody>' + body.join('') + '</tbody></table>' +
    '</div>'
  );
}

export function renderRoot(data) {
  uidCounter = 0;
  if (Array.isArray(data)) {
    if (data.length > 0 && data.every((item) => isPlainObject(item))) return renderObjectArrayTable(data, '$', 0);
    return renderIndexValueTable(data, '$', 0);
  }
  if (isPlainObject(data)) return renderKeyValueTable(data, '$', 0);
  return '<div class="root-scalar">' + scalarCell(data) + '</div>';
}

export function summarize(data) {
  if (Array.isArray(data)) return { kind: 'array', count: data.length };
  if (isPlainObject(data)) return { kind: 'object', count: Object.keys(data).length };
  return { kind: kindOf(data), count: 0 };
}

// 生成 CSV（对象数组导出为表；其他情况导出键值/索引对）
export function toCsv(data) {
  const quote = (value) => {
    const text = value === null || value === undefined ? '' : String(value);
    return /[",\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
  };
  if (Array.isArray(data) && data.length > 0 && data.every((item) => isPlainObject(item))) {
    const keys = collectKeys(data);
    const lines = [keys.map(quote).join(',')];
    for (const row of data) lines.push(keys.map((key) => quote(isPlainObject(row) && row[key] !== undefined ? displayScalar(row[key]) : '')).join(','));
    return lines.join('\r\n');
  }
  if (isPlainObject(data)) {
    return ['key,value'].concat(Object.entries(data).map(([key, value]) => quote(key) + ',' + quote(displayScalar(value)))).join('\r\n');
  }
  if (Array.isArray(data)) {
    return ['index,value'].concat(data.map((value, i) => i + ',' + quote(displayScalar(value)))).join('\r\n');
  }
  return 'value\r\n' + quote(displayScalar(data));
}