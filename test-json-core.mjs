import assert from 'node:assert/strict';
import { parseDocument, serializeNode, csvDocument, assertFilterSafe, toJs, mapFilterOrigins } from './ui/js/json-document.js';
import { parseJsonDocument } from './ui/js/json-grid.js';
import { createGridView } from './ui/js/json-view.js';
let checks = 0;
function test(name, fn) { fn(); checks++; console.log('PASS ' + name); }
test('J01 exact numeric tokens survive formatting and minifying', () => {
  const raw = '{"id":9007199254740993,"negative":-9007199254740993,"decimal":0.123456789012345678901,"exp":1e400,"small":1e-400,"zero":-0,"trailing":1.2300}';
  const doc = parseDocument(raw); assert.equal(doc.ok, true);
  assert.equal(serializeNode(parseDocument(serializeNode(doc.root, true)).root), raw);
  for (const field of doc.root.children) assert.ok(csvDocument(doc).includes(field.numberRaw));
  assert.throws(() => assertFilterSafe(doc), /不能保真/);
  assert.throws(() => parseJsonDocument(raw).data, /不能保真/);
});
test('J01 safe ordinary decimals and exponent notation can filter', () => {
  assert.doesNotThrow(() => assertFilterSafe(parseDocument('[0.1,1.2300,1e3,0.00001,42]')));
  for (const raw of ['9007199254740993','0.1234567890123456789','1e400','1e-400','-0']) assert.throws(() => assertFilterSafe(parseDocument(raw)));
});
test('J03 decoded keys, distinct pointers and UTF-16 ranges', () => {
  const raw = '{"a/b":11,"a":{"b":22},"a~b":33,"\\u0061":44,"emoji😀":"中文😀","a#key":55,"":66}';
  const doc = parseDocument(raw); assert.equal(doc.ok, true);
  const [slash,nested,tilde,unicode,emoji,suffix,empty] = doc.root.children;
  assert.equal(slash.pointer,'/a~1b'); assert.equal(nested.children[0].pointer,'/a/b'); assert.equal(tilde.pointer,'/a~0b');
  assert.equal(unicode.key,'a'); assert.equal(raw.slice(unicode.keyStart,unicode.keyEnd),'"\\u0061"');
  assert.equal(raw.slice(emoji.start,emoji.end),'"中文😀"'); assert.equal(empty.pointer,'/'); assert.equal(suffix.key,'a#key');
});
test('duplicate fields stay visible, preserve formatting and reject ambiguous filtering', () => {
  const doc = parseDocument('{"a":1,"a":2}'); assert.equal(doc.root.children.length,2); assert.equal(doc.duplicates.length,1);
  assert.equal(serializeNode(doc.root),'{"a":1,"a":2}'); assert.notEqual(doc.root.children[0].id,doc.root.children[1].id);
  assert.throws(() => assertFilterSafe(doc), /重复/);
});
test('J06 all primitive roots render and export', () => {
  for (const raw of ['0','false','null','""','[]','{}']) { const doc=parseDocument(raw); assert.ok(doc.ok); assert.ok(createGridView(doc).render()); assert.equal(typeof csvDocument(doc),'string'); }
});
test('J07 prototype fields are never inherited', () => {
  const doc=parseDocument('[{"toString":"hello","constructor":1,"__proto__":{"x":2}},{}]');
  const html=createGridView(doc).render(); assert.equal((html.match(/class="val missing"/g)||[]).length,3);
  assert.ok(!html.includes('native code')); assert.ok(!csvDocument(doc).includes('native code'));
  assert.equal(Object.getPrototypeOf(toJs(doc.root)[0]),null);
});
test('J08 nested CSV preserves JSON, escaping, numbers, null and missing', () => {
  const source=JSON.stringify([{id:1,meta:{a:1},items:[{b:2}],text:'a,"b"\nc',n:null},{}]).replace('"id":1','"id":9007199254740993');
  const csv=csvDocument(parseDocument(source));
  assert.ok(csv.includes('9007199254740993')); assert.ok(csv.includes('"{""a"":1}"')); assert.ok(csv.includes('"[{""b"":2}]"'));
  assert.ok(csv.includes('null')); assert.ok(csv.endsWith(',,,,')); assert.ok(!csv.includes('[object Object]'));
});
test('strict syntax, BOM offsets and error locations', () => {
  for (const raw of ['{"a":}','[1,]','{"a":1,}','01','true false','"\\q"','"a\nb"','[','\u00a01']) assert.equal(parseDocument(raw).ok,false,raw);
  const doc=parseDocument('\uFEFF{"x":1}'); assert.equal(doc.ok,true); assert.equal(doc.root.children[0].start,6);
  assert.equal(parseDocument('{\n "a": }').error.line,2);
});
test('J10 collapsed 5000-row data builds only one 100-row table', () => {
  const data=Array.from({length:5000},(_,id)=>({id,nested:{x:id,items:[1,2,3]}})); const doc=parseDocument(JSON.stringify(data));
  const grid=createGridView(doc), html=grid.render(); assert.equal((html.match(/<table /g)||[]).length,1);
  assert.equal((html.match(/<tr class="row"/g)||[]).length,100); assert.ok(html.length < 200000);
  grid.view.pages[doc.root.id]=49; const last=grid.render(); assert.ok(last.includes('4999')); assert.ok(last.includes('共 5000 项'));
  console.log('PERF',JSON.stringify({inputBytes:doc.text.length,initialHtmlBytes:html.length,tables:1}));
});
test('deep nodes are accessible beyond 12 with bounded parser depth', () => {
  const doc=parseDocument('['.repeat(30)+'1'+']'.repeat(30)); assert.ok(doc.ok); const grid=createGridView(doc);
  assert.ok(grid.render([...doc.nodes.values()][25].id).includes('table')); assert.equal(parseDocument('['.repeat(258)+'1'+']'.repeat(258)).ok,false);
});
test('J04 source mappings survive selection/reorder, reject mutation and invented objects', () => {
  const source=parseDocument('[{"id":1},{"id":2}]'), selected=parseDocument('[{"id":2}]');
  const mapping=mapFilterOrigins(source,selected,[['/0','/1']]);
  assert.equal(mapping.get(selected.root.children[0].children[0].id),source.root.children[1].children[0].id);
  assert.equal(mapFilterOrigins(source,parseDocument('[{"id":99}]'),[['/0','/1']]).size,0);
  assert.equal(mapFilterOrigins(source,selected,[]).size,0);
});
test('wide object arrays show bounded columns with access to the remainder', () => {
  const row=Object.fromEntries(Array.from({length:120},(_,i)=>['field'+i,i]));
  const doc=parseDocument(JSON.stringify([row])), grid=createGridView(doc);
  const html=grid.render(); assert.equal((html.match(/<col /g)||[]).length,51);assert.ok(!html.includes('field119'));
  grid.view.columnPages[doc.root.id]=2;assert.ok(grid.render().includes('field119'));
});
test('100000-row arrays have bounded initial DOM output', () => {
  const start=performance.now(),doc=parseDocument(JSON.stringify(Array.from({length:100000},(_,i)=>i)));
  assert.ok(doc.ok);const html=createGridView(doc).render();assert.equal((html.match(/<tr class="row"/g)||[]).length,100);
  console.log('PERF_LARGE_ARRAY',JSON.stringify({nodes:doc.nodes.size,htmlBytes:html.length,parseAndRenderMs:Math.round(performance.now()-start)}));
});
test('roundtrip deterministic JSON structures', () => {
  let seed=42; const random=()=>((seed=(seed*1664525+1013904223)>>>0)/2**32);
  const make=depth=>depth>3 ? Math.floor(random()*1000) : random()<.35 ? [make(depth+1),make(depth+1)] : random()<.5 ? { 'a/b':make(depth+1),'~中文':make(depth+1) } : [null,false,'中文😀\\"\n',0][Math.floor(random()*4)];
  for(let i=0;i<150;i++){const value=make(0);const doc=parseDocument(JSON.stringify(value));assert.ok(doc.ok);assert.deepEqual(JSON.parse(serializeNode(doc.root,true)),value);}
});
console.log('ALL '+checks+' CORE GROUPS OK');
