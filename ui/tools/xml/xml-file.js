import { MAX_XML_CHARS } from './xml-parser.js';

export const MAX_XML_FILE_BYTES = 4 * MAX_XML_CHARS + 4;

function declaredEncoding(text) {
  return /^<\?xml[ \t\r\n]+[^?]*\bencoding[ \t\r\n]*=[ \t\r\n]*(['"])([A-Za-z][A-Za-z0-9._-]*)\1/i
    .exec(text)?.[2].toLowerCase();
}

export function decodeXmlFile(buffer) {
  const bytes = new Uint8Array(buffer);
  if (bytes.length > MAX_XML_FILE_BYTES) throw new Error('文件过大，请导入较小的 XML 文件');
  if (!bytes.length) throw new Error('XML 文件为空');

  const [a, b, c, d] = bytes;
  if ((a === 0xFF && b === 0xFE && c === 0 && d === 0) || (a === 0 && b === 0 && c === 0xFE && d === 0xFF))
    throw new Error('暂不支持 UTF-32 XML，请另存为 UTF-8 后导入');

  const xmlStart = byte => [9, 10, 13, 32, 60].includes(byte);
  const utf8Bom = a === 0xEF && b === 0xBB && c === 0xBF;
  const utf16le = (a === 0xFF && b === 0xFE) || (xmlStart(a) && b === 0);
  const utf16be = (a === 0xFE && b === 0xFF) || (a === 0 && xmlStart(b));
  const inferred = utf16le ? 'utf-16le' : utf16be ? 'utf-16be' : 'utf-8';
  const prefix = new TextDecoder(inferred).decode(bytes.subarray(0, 512), { stream: true });
  const declared = declaredEncoding(prefix);
  const legacy = ['gb18030', 'gbk', 'gb2312'];
  const validDeclaration = declared === undefined || declared === inferred
    || (inferred === 'utf-8' && declared === 'utf8')
    || ((utf16le || utf16be) && declared === 'utf-16');
  const encoding = !utf8Bom && !utf16le && !utf16be && legacy.includes(declared) ? declared : inferred;
  if (encoding === inferred && !validDeclaration) throw new Error('不支持所声明的编码或声明与文件字节不一致：' + declared);

  let text;
  try { text = new TextDecoder(encoding, { fatal: true }).decode(bytes); }
  catch { throw new Error('无法按 ' + encoding.toUpperCase() + ' 读取 XML 文件'); }
  if (text.length > MAX_XML_CHARS) throw new Error('XML 输入超过 2 Mi 字符');
  return text;
}
