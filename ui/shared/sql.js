import { csvTable } from './csv.js';
import { parseDocument, serializeNode } from '../js/json-document.js';

const integerPattern = /^-?(?:0|[1-9]\d*)$/;
const decimalPattern = /^(-?)(0|[1-9]\d*)(?:\.(\d+))?$/;
const numberPattern = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;
const minBigint = -9223372036854775808n, maxBigint = 9223372036854775807n;

class ExactNumber {
  constructor(text) { this.text = text; }
  toString() { return this.text; }
}

export function quoteIdent(dialect, name) {
  const raw = String(name);
  if (!raw.trim() || /[\u0000-\u001f]/.test(raw)) throw new Error('表名或字段名为空，或含有控制字符');
  if (dialect === 'mssql') return '[' + raw.replace(/]/g, ']]') + ']';
  const delimiter = dialect === 'mysql' ? String.fromCharCode(96) : '"';
  return delimiter + raw.split(delimiter).join(delimiter + delimiter) + delimiter;
}

function readDelimited(source, start, close, escapeBackslash = false) {
  const escapes = { '\\': '\\', "'": "'", n: '\n', r: '\r', t: '\t', f: '\f', b: '\b' };
  let value = '';
  for (let i = start + 1; i < source.length; i++) {
    if (escapeBackslash && source[i] === '\\') {
      const character = source[++i];
      if (!Object.hasOwn(escapes, character)) throw new Error('暂不支持 E 字符串中的此类反斜杠转义');
      value += escapes[character];
      continue;
    }
    if (source[i] !== close) { value += source[i]; continue; }
    if (source[i + 1] !== close) return { value, next: i + 1 };
    value += close;
    i++;
  }
  throw new Error('字符串或标识符的引号没有闭合');
}

function quotedEnd(char) {
  if (char === '[') return ']';
  if (char === '"' || char.charCodeAt(0) === 96) return char;
  return null;
}

export function quoteQualifiedIdent(dialect, name) {
  const text = name.trim();
  let offset = 0;
  const parts = [];
  while (offset < text.length) {
    while (/\s/.test(text[offset] || '')) offset++;
    const close = quotedEnd(text[offset] || '');
    if (close) {
      const item = readDelimited(text, offset, close);
      parts.push(item.value);
      offset = item.next;
      while (/\s/.test(text[offset] || '')) offset++;
    } else {
      const end = text.indexOf('.', offset);
      const stop = end < 0 ? text.length : end;
      parts.push(text.slice(offset, stop).trim());
      offset = stop;
    }
    if (offset === text.length) break;
    if (text[offset++] !== '.' || offset === text.length) throw new Error('请用 schema.table 或带引号的标识符填写表名');
  }
  if (!parts.length) throw new Error('请填写表名');
  return parts.map(part => quoteIdent(dialect, part)).join('.');
}

function stringLiteral(value, dialect) {
  if (value.includes('\0')) throw new Error('字符串包含数据库文本不支持的 NUL 字符');
  if (dialect === 'mysql' && value.includes('\\')) {
    // Hex avoids mode-dependent backslash interpretation.
    const hex = Array.from(new TextEncoder().encode(value), byte => byte.toString(16).padStart(2, '0')).join('');
    return "CONVERT(X'" + hex + "' USING utf8mb4)";
  }
  const escaped = "'" + value.replace(/'/g, "''") + "'";
  if (dialect === 'mssql') return 'N' + escaped;
  if (dialect === 'postgres' && value.includes('\\')) return 'E' + escaped.replace(/\\/g, '\\\\');
  return escaped;
}

export function sqlString(value, dialect = 'postgres') {
  if (value == null) return 'NULL';
  if (value instanceof ExactNumber || (typeof value === 'number' && Number.isFinite(value))) return String(value);
  if (typeof value === 'boolean') {
    if (['mysql', 'mssql', 'oracle', 'sqlite'].includes(dialect)) return value ? '1' : '0';
    return value ? 'TRUE' : 'FALSE';
  }
  return stringLiteral(String(value), dialect);
}

function textType(samples, dialect) {
  if (dialect === 'mysql') return 'LONGTEXT';
  if (dialect === 'mssql') return 'NVARCHAR(MAX)';
  if (dialect === 'oracle') {
    if (samples.some(value => new TextEncoder().encode(String(value)).length > 4000))
      throw new Error('Oracle 文本含有超过 4000 字节的值，请使用参数化导入');
    return 'VARCHAR2(4000)';
  }
  return 'TEXT';
}

function classify(values, dialect) {
  const samples = values.filter(value => value != null);
  if (samples.length && samples.every(value => typeof value === 'boolean')) {
    const type = { mysql: 'TINYINT(1)', mssql: 'BIT', oracle: 'NUMBER(1)', sqlite: 'INTEGER' }[dialect] || 'BOOLEAN';
    return { type, kind: 'boolean' };
  }
  const decimals = samples.map(value => decimalPattern.exec(String(value)));
  if (samples.length && decimals.every(Boolean)) {
    if (samples.every(value => {
      const text = String(value);
      return integerPattern.test(text) && text.length <= 20 && BigInt(text) >= minBigint && BigInt(text) <= maxBigint;
    })) {
      return { type: dialect === 'oracle' ? 'NUMBER(19)' : dialect === 'sqlite' ? 'INTEGER' : 'BIGINT', kind: 'number' };
    }
    let scale = 0, digits = 0;
    for (const match of decimals) {
      scale = Math.max(scale, match[3]?.length ?? 0);
      digits = Math.max(digits, match[2] === '0' ? 0 : match[2].length);
    }
    const precision = Math.max(1, digits + scale);
    if (precision <= 38 && (dialect !== 'mysql' || scale <= 30) && dialect !== 'sqlite')
      return { type: (dialect === 'oracle' ? 'NUMBER' : 'NUMERIC') + '(' + precision + ',' + scale + ')', kind: 'number' };
  }
  // Scientific notation, identifiers with leading zeros and out-of-range numbers remain exact text.
  return { type: textType(samples, dialect), kind: 'text' };
}

export function inferColumnType(values, dialect) {
  return classify(values, dialect).type;
}

function requireUnique(columns) {
  if (new Set(columns.map(name => name.toLowerCase())).size !== columns.length)
    throw new Error('字段名重复（忽略大小写），请先调整字段');
}

export function dataRowsFromText(text, format) {
  const original = String(text ?? '').replace(/^\uFEFF/, '');
  const input = original.trim();
  if (!input) return { columns: [], rows: [] };
  if (format === 'json' || (!format && /^[{\[]/.test(input))) {
    const doc = parseDocument(input);
    if (!doc.ok) throw new Error('JSON 第 ' + doc.error.line + ' 行：' + doc.error.message);
    if (doc.duplicates.length) throw new Error('JSON 存在重复字段，请先处理重复项');
    const records = doc.root.kind === 'array' ? doc.root.children : [doc.root];
    if (records.some(node => node.kind !== 'object')) throw new Error('JSON 数据必须是对象或对象数组');
    const columns = [...new Set(records.flatMap(node => node.children.map(item => item.key)))];
    function valueOf(node) {
      if (node.kind === 'number') return new ExactNumber(node.numberRaw);
      return node.kind === 'array' || node.kind === 'object' ? serializeNode(node) : node.value;
    }
    const rows = records.map(node => {
      const fields = new Map(node.children.map(item => [item.key, valueOf(item)]));
      return columns.map(key => fields.get(key) ?? null);
    });
    return { columns, rows, hasHeader: false };
  }
  const parsed = csvTable(original, format === 'tsv' ? '\t' : ',');
  return { ...parsed, hasHeader: true };
}

export function buildImportSql(source, tableName, dialect, batchSize = 100, format) {
  const { columns, rows } = dataRowsFromText(source, format);
  if (!columns.length) throw new Error('没有解析到数据，请粘贴 JSON 数组或带表头的 CSV');
  requireUnique(columns);
  const table = quoteQualifiedIdent(dialect, tableName || 'tmp_data');
  const identifiers = columns.map(column => quoteIdent(dialect, column));
  const types = columns.map((column, index) => classify(rows.map(row => row[index]), dialect));
  const definitions = identifiers.map((identifier, index) => identifier + ' ' + types[index].type);
  const lines = ['CREATE TABLE ' + table + ' (', '  ' + definitions.join(',\n  '), ');', ''];
  // Compatible Oracle INSERT syntax has one VALUES row per statement.
  const chunkSize = dialect === 'oracle' ? 1 : Math.max(1, Math.min(1000, Math.trunc(Number(batchSize)) || 100));
  function renderRow(row) {
    const values = row.map((value, index) => {
      if (value == null) return 'NULL';
      if (types[index].kind === 'number') return String(value);
      return sqlString(types[index].kind === 'text' ? String(value) : value, dialect);
    });
    return '(' + values.join(', ') + ')';
  }
  for (let start = 0; start < rows.length; start += chunkSize) {
    lines.push('INSERT INTO ' + table + ' (' + identifiers.join(', ') + ') VALUES');
    lines.push(rows.slice(start, start + chunkSize).map(renderRow).join(',\n') + ';', '');
  }
  return { sql: lines.join('\n'), rowCount: rows.length, columns: columns.length };
}

export function buildCreateTableSql(name, dialect, columns) {
  if (!columns.length) throw new Error('请至少添加一个字段');
  requireUnique(columns.map(column => column.name));
  const definitions = columns.map(column => {
    const translations = {
      mssql: { BOOLEAN: 'BIT', TIMESTAMP: 'DATETIME2', TEXT: 'NVARCHAR(MAX)' },
      oracle: { BOOLEAN: 'NUMBER(1)', BIGINT: 'NUMBER(19)', INTEGER: 'NUMBER(10)', TEXT: 'VARCHAR2(4000)', 'VARCHAR(255)': 'VARCHAR2(255)' },
    };
    const type = translations[dialect]?.[column.type] ?? column.type;
    if (!type) throw new Error('请为每个字段填写类型');
    if (column.primary && ((dialect === 'mssql' && /\(MAX\)$|^TEXT$/i.test(type)) ||
      (dialect === 'mysql' && /TEXT$/i.test(type))))
      throw new Error('主键「' + column.name + '」请使用可索引的字段类型，例如 VARCHAR(255)');
    return quoteIdent(dialect, column.name) + ' ' + type + (column.notNull ? ' NOT NULL' : '');
  });
  const primary = columns.filter(column => column.primary);
  if (primary.length) definitions.push('PRIMARY KEY (' + primary.map(column => quoteIdent(dialect, column.name)).join(', ') + ')');
  return 'CREATE TABLE ' + quoteQualifiedIdent(dialect, name || 'new_table') + ' (\n  ' + definitions.join(',\n  ') + '\n);';
}

export function parseInsertSql(input) {
  const source = String(input ?? '').replace(/^\uFEFF/, '');
  const rows = [];
  let table, columns, tableParts;
  let i = 0;
  function skip() {
    for (;;) {
      if (/\s/.test(source[i] || '')) i++;
      else if (source.startsWith('--', i)) { const end = source.indexOf('\n', i); i = end < 0 ? source.length : end + 1; }
      else if (source.startsWith('/*', i)) {
        const end = source.indexOf('*/', i + 2);
        if (end < 0) throw new Error('SQL 注释未闭合');
        i = end + 2;
      } else return;
    }
  }
  function expect(char) {
    skip();
    if (source[i] !== char) throw new Error('第 ' + (i + 1) + ' 字符处需要 ' + char);
    i++;
  }
  function keyword(word) {
    skip();
    const token = /^[a-z_][a-z_0-9]*/i.exec(source.slice(i))?.[0];
    if (token?.toUpperCase() !== word) throw new Error('仅支持 INSERT INTO … (字段) VALUES (值)，此处需要 ' + word);
    i += token.length;
  }
  function identifier() {
    skip();
    const close = quotedEnd(source[i] || '');
    if (close) {
      const item = readDelimited(source, i, close);
      i = item.next;
      if (!item.value.trim()) throw new Error('标识符不能为空');
      return item.value;
    }
    const match = /^[\p{L}_][\p{L}\p{N}_$]*/u.exec(source.slice(i));
    if (!match) throw new Error('请输入有效的表名或字段名');
    i += match[0].length;
    return match[0];
  }
  function value() {
    skip();
    const hex = /^CONVERT\s*\(\s*X'((?:[0-9a-f]{2})*)'\s+USING\s+utf8mb4\s*\)/i.exec(source.slice(i));
    if (hex) {
      i += hex[0].length;
      const digits = hex[1].match(/../g) || [];
      return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(digits, digit => Number.parseInt(digit, 16)));
    }
    const prefix = /^[nNeE]'/.test(source.slice(i, i + 2)) ? source[i++].toUpperCase() : '';
    if (source[i] === "'") {
      const item = readDelimited(source, i, "'", prefix === 'E');
      i = item.next;
      return item.value;
    }
    const match = /^[^\s,());]+/.exec(source.slice(i));
    const token = match?.[0];
    if (!token) throw new Error('VALUES 缺少值');
    i += token.length;
    if (/^NULL$/i.test(token)) return null;
    if (/^TRUE$/i.test(token)) return true;
    if (/^FALSE$/i.test(token)) return false;
    if (numberPattern.test(token)) return new ExactNumber(token);
    throw new Error('暂不支持 VALUES 中的表达式：' + token.slice(0, 60));
  }
  skip();
  while (i < source.length) {
    if (source[i] === ';') { i++; skip(); continue; }
    keyword('INSERT');
    keyword('INTO');
    const parts = [identifier()];
    skip();
    while (source[i] === '.') { i++; parts.push(identifier()); skip(); }
    expect('(');
    const names = [identifier()];
    skip();
    while (source[i] === ',') { i++; names.push(identifier()); skip(); }
    expect(')');
    requireUnique(names);
    keyword('VALUES');
    if (!columns) { columns = names; tableParts = parts; table = parts.at(-1); }
    else if (JSON.stringify(parts) !== JSON.stringify(tableParts) || JSON.stringify(names) !== JSON.stringify(columns))
      throw new Error('多条 INSERT 必须使用同一张表及相同顺序的字段');

    for (;;) {
      expect('(');
      const row = [value()];
      skip();
      while (source[i] === ',') { i++; row.push(value()); skip(); }
      expect(')');
      if (row.length !== columns.length)
        throw new Error('第 ' + (rows.length + 1) + ' 条 VALUES 与字段数量不一致');
      rows.push(row);
      skip();
      if (source[i] !== ',') break;
      i++;
    }
    if (i < source.length) expect(';');
    skip();
  }
  if (!rows.length) throw new Error('请粘贴含 VALUES 的 INSERT SQL');
  return { table, tableParts, columns, rows };
}
