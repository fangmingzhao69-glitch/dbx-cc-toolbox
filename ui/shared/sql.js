import { parseCsv } from './csv.js';

const BACKTICK = String.fromCharCode(96);
const IDENT_QUOTE_RE = new RegExp('["' + BACKTICK + ']', 'g');

export function quoteIdent(dialect, name) {
  const raw = String(name);
  if (dialect === 'mysql') return BACKTICK + raw.split(BACKTICK).join(BACKTICK + BACKTICK) + BACKTICK;
  return '"' + raw.replace(/"/g, '""') + '"';
}

export function sqlString(value) {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  return "'" + String(value).replace(/'/g, "''") + "'";
}

export function inferColumnType(values, dialect) {
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

export function dataRowsFromText(text) {
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

export function buildImportSql(source, tableName, dialect, batchSize = 100) {
  const parsed = dataRowsFromText(source);
  const columns = parsed.columns;
  const rows = parsed.rows;
  if (!columns.length) throw new Error('没有解析到数据，请粘贴 JSON 数组或带表头的 CSV');
  const table = quoteIdent(dialect, tableName || 'tmp_data');
  const columnDefs = columns.map((column, index) => quoteIdent(dialect, column) + ' ' + inferColumnType(rows.map((row) => row[index]), dialect));
  const lines = ['CREATE TABLE ' + table + ' (', '  ' + columnDefs.join(',\n  '), ');', ''];
  const chunkSize = Math.max(1, Math.min(1000, Number(batchSize) || 100));
  for (let start = 0; start < rows.length; start += chunkSize) {
    const batch = rows.slice(start, start + chunkSize);
    lines.push('INSERT INTO ' + table + ' (' + columns.map((column) => quoteIdent(dialect, column)).join(', ') + ') VALUES');
    lines.push(batch.map((row) => '(' + row.map((value) => sqlString(value)).join(', ') + ')').join(',\n') + ';');
    lines.push('');
  }
  return { sql: lines.join('\n'), rowCount: rows.length, columns: columns.length };
}

export function stripIdent(name) {
  return String(name).replace(IDENT_QUOTE_RE, '').trim();
}

export function pickSelectType(type) {
  if (type.indexOf('BIGINT') >= 0) return 'BIGINT';
  if (type.indexOf('NUMERIC') >= 0) return 'NUMERIC(18,4)';
  if (type.indexOf('BOOLEAN') >= 0) return 'BOOLEAN';
  if (type.indexOf('INTEGER') >= 0) return 'INTEGER';
  if (type.indexOf('VARCHAR') >= 0) return 'VARCHAR(255)';
  return 'TEXT';
}

export function parseInsertSql(text) {
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
