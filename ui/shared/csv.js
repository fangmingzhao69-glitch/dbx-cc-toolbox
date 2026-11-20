export function parseCsv(text, separator = ',') {
  const rows = [];
  const source = String(text ?? '').replace(/^\uFEFF/, '');
  let row = [], field = '', quoted = false, closed = false, started = false;
  function finishField() {
    row.push(field);
    field = '';
    closed = false;
  }
  function finishRecord() {
    if (started || field.trim()) {
      finishField();
      rows.push(row);
    }
    row = [];
    field = '';
    started = closed = false;
  }
  const syntaxError = message => new Error('CSV 第 ' + (rows.length + 1) + ' 条记录：' + message);

  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (quoted) {
      if (ch === '"' && source[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') { quoted = false; closed = true; }
      else field += ch;
    } else if (ch === separator) {
      started = true;
      finishField();
    } else if (ch === '\n' || ch === '\r') {
      finishRecord();
      if (ch === '\r' && source[i + 1] === '\n') i++;
    } else if (ch === '"' && !closed && field === '') {
      quoted = started = true;
    } else {
      if (closed || ch === '"') throw syntaxError('引号位置不正确');
      field += ch;
    }
  }
  if (quoted) throw syntaxError('带引号的字段没有闭合');
  finishRecord();
  return rows;
}

export function csvTable(text, separator = ',') {
  const [header, ...rows] = parseCsv(text, separator);
  if (!header) throw new Error('文件没有表头');
  const columns = header.map((name, index) => name.trim() || 'col_' + (index + 1));
  if (new Set(columns).size !== columns.length) throw new Error('CSV 表头有重复列名，请先修正');
  const bad = rows.findIndex(row => row.length !== columns.length);
  if (bad >= 0) throw new Error('第 ' + (bad + 1) + ' 条数据有 ' + rows[bad].length + ' 列，表头有 ' + columns.length + ' 列');
  return { columns, rows };
}

export async function readCsvFile(file) {
  if (file.size > 64 * 1024 * 1024) throw new Error('文件超过 64 MiB，请拆分后再导入');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const separator = /\.tsv$/i.test(file.name) ? '\t' : ',';
  const utf16 = bytes[0] === 0xFF && bytes[1] === 0xFE ? 'utf-16le'
    : bytes[0] === 0xFE && bytes[1] === 0xFF ? 'utf-16be' : null;
  try { return { text: new TextDecoder(utf16 || 'utf-8', { fatal: true }).decode(bytes), separator, encoding: utf16 || 'UTF-8' }; }
  catch {
    if (utf16 || (bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF))
      throw new Error('文件的 Unicode 编码不完整');
    try { return { text: new TextDecoder('gb18030', { fatal: true }).decode(bytes), separator, encoding: 'GB18030' }; }
    catch { throw new Error('无法读取文件编码，请另存为 UTF-8'); }
  }
}

export function rowsToCsvText(rows) {
  return rows.map(row => Array.from(row, cell => {
    const value = cell == null ? '' : String(cell);
    return /[",\r\n]/.test(value) || (value === '' && row.length === 1)
      ? '"' + value.replace(/"/g, '""') + '"' : value;
  }).join(',')).join('\r\n');
}
