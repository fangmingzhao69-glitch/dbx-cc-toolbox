// XML 1.0 tree with UTF-16 source ranges, used by the editor and safe formatter.
const ENTITIES = new Map([['amp', '&'], ['lt', '<'], ['gt', '>'], ['quot', '"'], ['apos', "'"]]);
const namePattern = /[:A-Z_a-z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u02FF\u0370-\u037D\u037F-\u1FFF\u200C-\u200D\u2070-\u218F\u2C00-\u2FEF\u3001-\uD7FF\uF900-\uFDCF\uFDF0-\uFFFD\u{10000}-\u{EFFFF}][-.:0-9A-Z_a-z\u00B7\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u037D\u037F-\u1FFF\u200C-\u200D\u203F-\u2040\u2070-\u218F\u2C00-\u2FEF\u3001-\uD7FF\uF900-\uFDCF\uFDF0-\uFFFD\u{10000}-\u{EFFFF}]*/uy;
const invalidChar = /[^\u0009\u000A\u000D\u0020-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/u;
const whitespace = /^[ \r\n\t]*$/;
const declaration = /^<\?xml[ \r\n\t]+version[ \r\n\t]*=[ \r\n\t]*(["'])1\.0\1(?:[ \r\n\t]+encoding[ \r\n\t]*=[ \r\n\t]*(["'])[A-Za-z][A-Za-z0-9._-]*\2)?(?:[ \r\n\t]+standalone[ \r\n\t]*=[ \r\n\t]*(["'])(?:yes|no)\3)?[ \r\n\t]*\?>/;
export const MAX_XML_CHARS = 2 * 1024 * 1024;

export function parseXmlDocument(input) {
  const source = String(input ?? '');
  const bom = source.charCodeAt(0) === 0xFEFF ? 1 : 0;
  let pos = bom;
  let nodeCount = 0;
  const starts = text => source.startsWith(text, pos);
  const fail = (message, at = pos) => { throw Object.assign(new Error(message), { index: at }); };
  function skipWhitespace() {
    const start = pos;
    while (pos < source.length && ' \r\n\t'.includes(source[pos])) pos++;
    return pos !== start;
  }
  function readName() {
    namePattern.lastIndex = pos;
    const match = namePattern.exec(source);
    if (!match) fail('XML 名称无效或缺失');
    pos = namePattern.lastIndex;
    return match[0];
  }
  function addNode(node) {
    if (++nodeCount > 20000) fail('XML 节点超过 20000 个');
    return node;
  }
  function decode(text, offset) {
    return text.replace(/&([^&;<> \r\n\t]*;)?/g, (raw, entity, index) => {
      if (!entity) fail('未完整闭合的实体引用', offset + index);
      const name = entity.slice(0, -1);
      if (ENTITIES.has(name)) return ENTITIES.get(name);
      if (/^#(?:[0-9]+|x[0-9a-fA-F]+)$/.test(name)) {
        const point = name.startsWith('#x') ? Number.parseInt(name.slice(2), 16) : Number(name.slice(1));
        if (point <= 0x10ffff && !invalidChar.test(String.fromCodePoint(point))) return String.fromCodePoint(point);
      }
      fail('未知或非法的实体引用 ' + raw, offset + index);
    });
  }
  function readDelimited(kind, open, close) {
    const from = pos;
    const start = pos + open.length;
    const end = source.indexOf(close, start);
    if (end < 0) fail(kind + ' 未闭合', from);
    const text = source.slice(start, end);
    if (kind === 'comment' && (text.includes('--') || text.endsWith('-'))) fail('XML 注释中不能包含 --', start);
    pos = end + close.length;
    return addNode({ kind, text, from, to: pos });
  }
  function readProcessingInstruction() {
    const from = pos;
    pos += 2;
    const name = readName();
    if (name.toLowerCase() === 'xml') fail('XML 声明只能出现在文档开头', from);
    if (!skipWhitespace() && !starts('?>')) fail('处理指令名称后缺少空白');
    const end = source.indexOf('?>', pos);
    if (end < 0) fail('处理指令未闭合', from);
    const text = source.slice(pos, end);
    pos = end + 2;
    return addNode({ kind: 'pi', name, text, from, to: pos });
  }
  function readMisc(tokens) {
    for (;;) {
      skipWhitespace();
      const from = pos;
      if (starts('<!--')) readDelimited('comment', '<!--', '-->');
      else if (starts('<?')) readProcessingInstruction();
      else if (starts('<!DOCTYPE')) fail('不支持 DOCTYPE 或 DTD，请移除声明');
      else return;
      tokens.push(source.slice(from, pos));
    }
  }

  function parseElement(depth) {
    if (depth >= 128) fail('XML 嵌套超过 128 层');
    const from = pos++;
    const name = readName();
    const node = addNode({ kind: 'element', name, attrs: [], children: [], text: '', from });
    const attributes = new Set();
    for (;;) {
      const separated = skipWhitespace();
      if (starts('/>')) {
        pos += 2; node.openEnd = node.closeStart = node.to = pos; return node;
      }
      if (starts('>')) { node.openEnd = ++pos; break; }
      if (!separated) fail('属性前缺少空白');
      const attrFrom = pos;
      const attrName = readName();
      if (attributes.has(attrName)) fail('重复的属性 ' + attrName, attrFrom);
      if (attributes.size >= 1024) fail('单个 XML 元素属性超过 1024 个', attrFrom);
      attributes.add(attrName);
      skipWhitespace();
      if (source[pos] !== '=') fail('属性 ' + attrName + ' 缺少 =');
      pos++;
      skipWhitespace();
      const quote = source[pos++];
      if (quote !== '"' && quote !== "'") fail('属性值必须用引号包裹', pos - 1);
      const valueStart = pos;
      const valueEnd = source.indexOf(quote, pos);
      if (valueEnd < 0) fail('属性值未闭合', valueStart);
      const value = source.slice(valueStart, valueEnd);
      if (value.includes('<')) fail('属性值不能包含未转义的 <', valueStart + value.indexOf('<'));
      node.attrs.push({ name: attrName, value: decode(value, valueStart) });
      pos = valueEnd + 1;
    }

    while (pos < source.length) {
      if (starts('</')) {
        node.closeStart = pos;
        pos += 2;
        const closeName = readName();
        skipWhitespace();
        if (!starts('>')) fail('结束标签缺少 >');
        if (closeName !== name) fail('结束标签 </' + closeName + '> 与开始标签 <' + name + '> 不匹配', node.closeStart);
        node.to = ++pos;
        node.text = node.children.filter(child => child.kind === 'text' || child.kind === 'cdata').map(child => child.text).join('');
        return node;
      }
      if (starts('<![CDATA[')) node.children.push(readDelimited('cdata', '<![CDATA[', ']]>'));
      else if (starts('<!--')) node.children.push(readDelimited('comment', '<!--', '-->'));
      else if (starts('<?')) node.children.push(readProcessingInstruction());
      else if (starts('<!')) fail('元素中包含不支持的声明');
      else if (starts('<')) node.children.push(parseElement(depth + 1));
      else {
        const fromText = pos;
        const next = source.indexOf('<', pos);
        pos = next < 0 ? source.length : next;
        const raw = source.slice(fromText, pos);
        if (raw.includes(']]>')) fail('普通文本中不能包含 ]]>', fromText + raw.indexOf(']]>'));
        if (!whitespace.test(raw)) node.children.push(addNode({ kind: 'text', text: decode(raw, fromText), from: fromText, to: pos }));
      }
    }
    fail('元素 <' + name + '> 缺少结束标签', from);
  }

  try {
    if (source.length > MAX_XML_CHARS) fail('XML 输入超过 2 Mi 字符', 0);
    const invalid = source.search(invalidChar);
    if (invalid >= 0) fail('包含 XML 1.0 不允许的字符', invalid);
    const prolog = [];
    const epilog = [];
    if (/^<\?xml(?=[ \r\n\t?])/.test(source.slice(bom, bom + 7))) {
      const match = source.slice(bom).match(declaration);
      if (!match) fail('XML 1.0 声明无效');
      prolog.push(match[0]);
      pos += match[0].length;
    }
    readMisc(prolog);
    if (!starts('<') || starts('</')) fail('没有找到 XML 根元素');
    const root = parseElement(0);
    readMisc(epilog);
    if (pos < source.length) fail('根元素之后存在多余内容');
    Object.defineProperties(root, { source: { value: source }, prolog: { value: prolog }, epilog: { value: epilog } });
    return { ok: true, root, nodeCount: countNodes(root) };
  } catch (error) {
    const index = error.index ?? pos;
    const before = source.slice(0, index);
    const lines = before.split(/\r\n?|\n/);
    return { ok: false, root: null, error: { message: error.message, index, line: lines.length, column: lines.at(-1).length + 1 } };
  }
}

export function countNodes(node) {
  return node ? 1 + (node.children ?? []).reduce((sum, child) => sum + countNodes(child), 0) : 0;
}

function serializeXml(root, indent) {
  const source = root.source;
  const separator = indent ? '\n' : '';
  function hasInlineSpace(node) {
    let previousEnd = node.openEnd;
    for (const child of node.children) {
      // Same-line space between nodes can separate words in inline XML content.
      if (child.from > previousEnd && !/[\r\n]/.test(source.slice(previousEnd, child.from))) return true;
      previousEnd = child.to;
    }
    return node.closeStart > previousEnd && !/[\r\n]/.test(source.slice(previousEnd, node.closeStart));
  }
  function serialize(node, depth) {
    const pad = indent.repeat(depth);
    const raw = source.slice(node.from, node.to);
    if (node.kind !== 'element') return pad + raw;
    if (node.attrs.some(attr => attr.name === 'xml:space' && attr.value !== 'default') ||
      !node.children.length || node.children.some(child => child.kind === 'text' || child.kind === 'cdata') || hasInlineSpace(node)) {
      return pad + raw;
    }
    const children = node.children.map(child => serialize(child, depth + 1));
    return [pad + source.slice(node.from, node.openEnd), ...children, pad + source.slice(node.closeStart, node.to)].join(separator);
  }
  return [...root.prolog, serialize(root, 0), ...root.epilog].join(separator);
}

export function formatXml(root, indent = '  ') {
  return serializeXml(root, indent);
}

export function compressXml(root) {
  return serializeXml(root, '');
}
