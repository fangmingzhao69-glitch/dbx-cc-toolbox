import assert from 'node:assert/strict';
import { parseXmlDocument, formatXml, countNodes } from './ui/tools/xml/xml-parser.js';

let pass = 0, fail = 0;
const test = (name, fn) => { try { fn(); console.log('PASS ' + name); pass++; } catch (e) { console.log('FAIL ' + name + ': ' + e.message); fail++; } };

test('解析根元素与子节点', () => {
  const r = parseXmlDocument('<root><a>1</a><b>2</b></root>');
  assert.equal(r.ok, true);
  assert.equal(r.root.name, 'root');
  assert.equal(r.root.children.length, 2);
  assert.equal(r.root.children[0].text, '1');
});

test('属性与实体解码', () => {
  const r = parseXmlDocument('<x a="1 &amp; 2" b="&lt;tag&gt;">v</x>');
  assert.equal(r.ok, true);
  assert.equal(r.root.attrs[0].value, '1 & 2');
  assert.equal(r.root.attrs[1].value, '<tag>');
});

test('CDATA 与注释', () => {
  const r = parseXmlDocument('<x><!-- hi --><![CDATA[a<b&c]]></x>');
  assert.equal(r.ok, true);
  assert.equal(r.root.children[0].kind, 'comment');
  assert.equal(r.root.children[1].kind, 'cdata');
  assert.equal(r.root.children[1].text, 'a<b&c');
});

test('自闭合与嵌套', () => {
  const r = parseXmlDocument('<root><br/><list><i>x</i></list></root>');
  assert.equal(r.ok, true);
  assert.equal(countNodes(r.root), 5);
});

test('中文与 UTF-8', () => {
  const r = parseXmlDocument('<订单><客户>张三</客户></订单>');
  assert.equal(r.ok, true);
  assert.equal(r.root.children[0].text, '张三');
});

test('错误定位到行列', () => {
  const r = parseXmlDocument('<root>\n  <a></b>\n</root>');
  assert.equal(r.ok, false);
  assert.equal(r.error.line, 2);
  assert.match(r.error.message, /不匹配|结束标签/);
});

test('未闭合标签报错', () => {
  const r = parseXmlDocument('<root><a></root>');
  assert.equal(r.ok, false);
});

test('格式化往返', () => {
  const src = '<root><a x="1">v</a><b/></root>';
  const r = parseXmlDocument(src);
  const pretty = formatXml(r.root);
  const r2 = parseXmlDocument(pretty);
  assert.equal(r2.ok, true);
  assert.equal(r2.root.children[0].attrs[0].value, '1');
});

test('声明与多余根元素', () => {
  assert.equal(parseXmlDocument('<?xml version="1.0"?><r/>').ok, true);
  assert.equal(parseXmlDocument('<a/><b/>').ok, false);
});

test('混合内容、实体字面量和 xml:space 保持原样', () => {
  for (const source of ['<p>前 <b>加粗</b> 后 &amp; &#x4E2D;</p>', '<r xml:space="preserve"> <a/> <b/> </r>', '<x>  </x>'])
    assert.equal(formatXml(parseXmlDocument(source).root), source);
});

test('声明、文档注释和处理指令保留', () => {
  const parsed = parseXmlDocument('<?xml version="1.0"?>\n<!--说明--><r><?edit yes?><a/></r><!--结束-->');
  assert.ok(parsed.ok);
  const output = formatXml(parsed.root);
  for (const value of ['<?xml version="1.0"?>', '<!--说明-->', '<?edit yes?>', '<!--结束-->']) assert.ok(output.includes(value));
  assert.ok(parseXmlDocument(output).ok);
});

test('拒绝重复属性、非法名称、未声明实体、不合法字符和 DTD', () => {
  for (const sample of ['<r a="1" a="2"/>', '<1r/>', '<r a="<"/>', '<r>&unknown;</r>',
    '<r>&#0;</r>', '<r>&#xD800;</r>', '<r>&broken</r>', '<r>]]></r>', '<r><!--bad--tail--></r>',
    '<!DOCTYPE r [<!ENTITY name "value">]><r>&name;</r>']) assert.equal(parseXmlDocument(sample).ok, false, sample);
});

test('限制嵌套、大小和节点数量', () => {
  assert.match(parseXmlDocument('<r>'.repeat(129) + '</r>'.repeat(129)).error.message, /128 层/);
  assert.match(parseXmlDocument('<r>' + 'x'.repeat(2 * 1024 * 1024) + '</r>').error.message, /2 Mi/);
  assert.match(parseXmlDocument('<r>' + '<n/>'.repeat(20_000) + '</r>').error.message, /20000/);
});

console.log('\nXML 解析核心：' + pass + ' 通过，' + fail + ' 失败');
if (fail) process.exit(1);
