// Source text is authoritative. Offsets are UTF-16, matching textarea selections.
export const pointerSegment = (key) => String(key).replace(/~/g, '~0').replace(/\//g, '~1');
const MAX_TEXT = 20 * 1024 * 1024;
export function parseDocument(input) {
  const text = String(input ?? '');
  let i = text.charCodeAt(0) === 0xFEFF ? 1 : 0;
  const nodes = new Map();
  const duplicates = [];
  const fail = (message) => { throw Object.assign(new SyntaxError(message), { position: i }); };
  const ws = () => { while (i < text.length && /[\x20\t\r\n]/.test(text[i])) i++; };
  const string = () => {
    const start = i++;
    while (i < text.length) {
      if (text[i] === '"') {
        i++;
        const raw = text.slice(start, i);
        try { return { start, end: i, raw, value: JSON.parse(raw) }; }
        catch { fail('字符串转义不合法'); }
      }
      if (text.charCodeAt(i) < 32) fail('字符串中包含未转义的控制字符');
      if (text[i] === '\\') {
        i++;
        if (text[i] === 'u') {
          if (!/^[0-9a-fA-F]{4}$/.test(text.slice(i + 1, i + 5))) fail('Unicode 转义不合法');
          i += 5;
        } else {
          if (!text[i] || !'"\\/bfnrt'.includes(text[i])) fail('字符串转义不合法');
          i++;
        }
      } else i++;
    }
    fail('字符串未闭合');
  };
  const number = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
  const value = (pointer, depth = 0) => {
    ws();
    if (depth > 256) fail('嵌套超过 256 层，请拆分数据');
    if (nodes.size >= 500000) fail('节点超过 500000 个，请拆分数据');
    const node = { id: 'n' + nodes.size, pointer, start: i, end: i, children: [] };
    nodes.set(node.id, node);
    const ch = text[i];
    if (ch === '{' || ch === '[') {
      node.kind = ch === '{' ? 'object' : 'array';
      const close = ch === '{' ? '}' : ']';
      i++; ws();
      const keys = new Set();
      if (text[i] !== close) {
        while (true) {
          let key;
          if (node.kind === 'object') {
            if (text[i] !== '"') fail('应为双引号包围的字段名');
            key = string(); ws();
            if (text[i++] !== ':') { i--; fail('字段名后缺少冒号'); }
          }
          const segment = key ? key.value : node.children.length;
          const child = value(pointer + '/' + pointerSegment(segment), depth + 1);
          if (key) {
            Object.assign(child, { key: key.value, keyRaw: key.raw, keyStart: key.start, keyEnd: key.end });
            if (keys.has(key.value)) duplicates.push(child.pointer);
            keys.add(key.value);
          }
          node.children.push(child);
          ws();
          if (text[i] !== ',') break;
          i++; ws();
        }
      }
      if (text[i] !== close) fail('缺少 ' + close + ' 或数据项格式错误');
      i++;
    } else if (ch === '"') {
      Object.assign(node, string(), { kind: 'string' });
    } else if (text.startsWith('true', i) || text.startsWith('false', i) || text.startsWith('null', i)) {
      const raw = text.startsWith('true', i) ? 'true' : text.startsWith('false', i) ? 'false' : 'null';
      node.kind = raw === 'null' ? 'null' : 'boolean'; node.value = JSON.parse(raw); i += raw.length;
    } else {
      number.lastIndex = i;
      const match = number.exec(text);
      if (!match) fail(i >= text.length ? 'JSON 内容不完整' : '无法识别的 JSON 值');
      node.kind = 'number'; node.numberRaw = match[0]; i = number.lastIndex;
    }
    node.end = i;
    return node;
  };
  try {
    if (text.length > MAX_TEXT) fail('JSON 超过 20MiB，请拆分数据');
    ws(); if (i >= text.length) fail('内容为空');
    const root = value(''); ws();
    if (i !== text.length) fail('JSON 值之后存在多余内容');
    return { ok: true, text, root, nodes, duplicates, error: null };
  } catch (error) {
    const position = error.position ?? i;
    const prefix = text.slice(0, position);
    return { ok: false, text, nodes: new Map(), error: {
      message: error.message, position, line: prefix.split('\n').length, column: position - prefix.lastIndexOf('\n'),
    } };
  }
}

export function serializeNode(node, pretty = false, depth = 0) {
  if (node.kind === 'number') return node.numberRaw;
  if (node.kind === 'string') return node.raw ?? JSON.stringify(node.value);
  if (node.kind === 'boolean' || node.kind === 'null') return String(node.value);
  const object = node.kind === 'object';
  const [open, close] = object ? ['{', '}'] : ['[', ']'];
  if (!node.children.length) return open + close;
  const indent = pretty ? '  '.repeat(depth + 1) : '';
  const parts = node.children.map(child => (object ? (child.keyRaw ?? JSON.stringify(child.key)) + (pretty ? ': ' : ':') : '') + serializeNode(child, pretty, depth + 1));
  return pretty ? open + '\n' + indent + parts.join(',\n' + indent) + '\n' + '  '.repeat(depth) + close : open + parts.join(',') + close;
}

// Compatibility projection only. The editor/render/export paths use nodes, never this Number projection.
export function toJs(node) {
  if (node.kind === 'number') return Number(node.numberRaw);
  if (node.kind === 'array') return node.children.map(toJs);
  if (node.kind !== 'object') return node.value;
  const result = Object.create(null);
  for (const child of node.children) result[child.key] = toJs(child);
  return result;
}

function decimalKey(raw) {
  const match = /^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(raw);
  if (!match || (match[4]?.length ?? 0) > 1000) return raw;
  let digits = (match[2] + (match[3] || '')).replace(/^0+/, '');
  if (!digits) return match[1] + '0';
  let exponent = BigInt(match[4] || 0) - BigInt((match[3] || '').length);
  const trimmed = digits.replace(/0+$/, ''); exponent += BigInt(digits.length - trimmed.length); digits = trimmed;
  return match[1] + digits + 'e' + exponent;
}

export function assertFilterSafe(doc) {
  if (!doc.ok) throw new Error('请先输入合法 JSON');
  if (doc.duplicates.length) throw new Error('包含重复字段，不能无歧义地转换为 JavaScript 对象');
  for (const node of doc.nodes.values()) {
    if (node.kind !== 'number') continue;
    const value = Number(node.numberRaw);
    if (!Number.isFinite(value) || decimalKey(node.numberRaw) !== decimalKey(JSON.stringify(value))) {
      throw new Error('字段 ' + (node.pointer || '(根)') + ' 的数字不能保真转换为 JavaScript Number，已保留原文');
    }
  }
}

// A source identity alone is insufficient: user code may have mutated the selected
// object. Only unchanged, structurally identical subtrees receive source IDs.
export function mapFilterOrigins(source, result, origins = []) {
  const byPointer = new Map([...source.nodes.values()].map(n => [n.pointer, n]));
  const outputs = new Map([...result.nodes.values()].map(n => [n.pointer, n]));
  const mapping = new Map();
  const bind = (from, to) => {
    mapping.set(to.id, from.id);
    for (let i = 0; i < from.children.length; i++) bind(from.children[i], to.children[i]);
  };
  for (const [outputPath, sourcePath] of origins) {
    const from = byPointer.get(sourcePath), to = outputs.get(outputPath);
    if (!from || !to || (from.kind !== 'object' && from.kind !== 'array')) continue;
    // Also compare ordered keys/structure before pairing nodes by position.
    const same = (a,b) => a.kind === b.kind && a.key === b.key && a.children.length === b.children.length &&
      (a.kind === 'number' ? decimalKey(a.numberRaw) === decimalKey(b.numberRaw) : a.kind === 'string' || a.kind === 'null' || a.kind === 'boolean' ? a.value === b.value : true) &&
      a.children.every((c,i) => same(c,b.children[i]));
    // The selected container itself may move from an object key to an array slot.
    if (same({ ...from, key: undefined }, { ...to, key: undefined })) bind(from, to);
  }
  return mapping;
}

export function csvDocument(doc) {
  if (!doc.ok) throw new Error('JSON 不合法');
  const quote = value => /[",\r\n]/.test(value) ? '"' + value.replace(/"/g, '""') + '"' : value;
  const cell = node => !node ? '' : node.kind === 'string' ? node.value : serializeNode(node);
  const root = doc.root;
  let rows;
  if (root.kind === 'array' && root.children.length && root.children.every(n => n.kind === 'object')) {
    const keys = [...new Set(root.children.flatMap(n => n.children.map(c => c.key)))];
    if (doc.duplicates.length) throw new Error('重复字段不能映射到唯一 CSV 列，请先处理重复字段');
    rows = [keys, ...root.children.map(n => { const fields = new Map(n.children.map(c => [c.key, c])); return keys.map(k => cell(fields.get(k))); })];
  } else if (root.kind === 'object') rows = [['key', 'value'], ...root.children.map(n => [n.key, cell(n)])];
  else if (root.kind === 'array') rows = [['index', 'value'], ...root.children.map((n, i) => [String(i), cell(n)])];
  else rows = [['value'], [cell(root)]];
  return rows.map(row => row.map(quote).join(',')).join('\r\n');
}
