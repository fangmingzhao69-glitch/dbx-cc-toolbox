import assert from 'node:assert/strict';
import { parseDocument } from './ui/js/json-document.js';
import { csvTable, readCsvFile, rowsToCsvText } from './ui/shared/csv.js';
import { buildCreateTableSql, buildImportSql, dataRowsFromText, parseInsertSql } from './ui/shared/sql.js';
import { compareCsv } from './ui/tools/csvcompare/index.js';
import { compareJson, compareLines } from './ui/tools/jsondiff/compare.js';

assert.deepEqual(csvTable('id,note\r1,"a\r\nb"\r,\r').rows, [['1', 'a\r\nb'], ['', '']]);
assert.deepEqual(csvTable(rowsToCsvText([['id'], ['']])).rows, [['']]);
assert.throws(() => csvTable('id,name\n1'), /第 1 条数据.*表头有 2 列/);
assert.throws(() => csvTable('id,id\n1,2'), /重复/);
assert.throws(() => csvTable('id\n"broken'), /引号.*闭合/);
const gbk = Buffer.from([0x6e,0x61,0x6d,0x65,0x0a,0xd6,0xd0,0xce,0xc4]);
const csv = await readCsvFile(new File([gbk], 'excel.csv'));
assert.equal(csv.encoding, 'GB18030');
assert.deepEqual(csvTable(csv.text).rows, [['中文']]);
const tsv = await readCsvFile(new File([Buffer.from('\uFEFFid\tname\r\n1\t中文', 'utf16le')], 'data.tsv'));
assert.deepEqual(csvTable(tsv.text, tsv.separator).rows, [['1', '中文']]);

const comparison = compareCsv(csvTable('id,old\n1,a'), csvTable('id,new\n1,b'), ['id']);
assert.deepEqual(comparison.schema.map(item => item.status), ['column-added', 'column-removed']);
assert.throws(() => compareCsv(csvTable('id,name\n,a'), csvTable('id,name\n1,a'), ['id']), /主键为空/);
assert.throws(() => compareCsv(csvTable('id,name\n1,a\n1,b'), csvTable('id,name\n1,b'), ['id']), /重复主键/);
console.log('PASS CSV quoting, encoding, variable widths and comparison schema/keys');

const data = dataRowsFromText('[{"id":9007199254740993123,"nested":{"n":1e100}},{"id":2}]');
assert.equal(String(data.rows[0][0]), '9007199254740993123');
assert.equal(data.rows[0][1], '{"n":1e100}');
assert.equal(data.rows[1][1], null);
assert.throws(() => dataRowsFromText('[{"id":1,"id":2}]'), /重复字段/);
assert.throws(() => dataRowsFromText('[bad, data'), /JSON 第/);
const generated = buildImportSql('id,serial\n9007199254740993123,0007\n2,0003', 'public.order', 'postgres', 50.5).sql;
assert.match(generated, /"public"\."order"/);
assert.match(generated, /\(9007199254740993123, '0007'\)/);
assert.match(buildImportSql('[{"amount":1.123456789}]', 't', 'mssql').sql, /NUMERIC\(10,9\)[\s\S]*\(1\.123456789\)/);
assert.match(buildImportSql('[{"text":"中文","flag":true}]', 'dbo.sample', 'mssql').sql, /\[dbo\]\.\[sample\][\s\S]*\(N'中文', 1\)/);
assert.equal((buildImportSql('id\n1\n2', 't', 'oracle').sql.match(/INSERT INTO/g) ?? []).length, 2);
assert.throws(() => buildImportSql('id,name\n1', 't', 'postgres'), /表头有 2 列/);
const ddl = buildCreateTableSql('dbo.orders', 'mssql', [
  { name: '商品', type: 'BIGINT', primary: true },
  { name: '仓库', type: 'BIGINT', primary: true },
  { name: '创建日期', type: 'TIMESTAMP' },
]);
assert.match(ddl, /PRIMARY KEY \(\[商品\], \[仓库\]\)/);
assert.match(ddl, /\[创建日期\] DATETIME2/);
assert.equal((ddl.match(/PRIMARY KEY/g) ?? []).length, 1);
assert.throws(() => buildCreateTableSql('t', 'mssql', [{ name: 'id', type: 'TEXT', primary: true }]), /可索引/);
const fromSql = parseInsertSql("-- rows\nINSERT INTO [dbo].[order details] ([id], [内容]) VALUES (9007199254740993123,N'a;b');" +
  "\n/* next */ INSERT INTO [dbo].[order details] ([id], [内容]) VALUES (2,N'中文'), (3,NULL);");
assert.equal(fromSql.rows.length, 3);
assert.equal(String(fromSql.rows[0][0]), '9007199254740993123');
assert.equal(fromSql.rows[0][1], 'a;b');
assert.deepEqual(fromSql.tableParts, ['dbo', 'order details']);
assert.throws(() => parseInsertSql('INSERT INTO t (id) VALUES (1); INSERT INTO s (id) VALUES (2)'), /同一张表/);
assert.throws(() => parseInsertSql('INSERT INTO t (id,name) VALUES (1)'), /字段数量/);
for (const dialect of ['postgres', 'mysql']) {
  const detail = "C:\\test\\a's;中文";
  const insert = buildImportSql(JSON.stringify({ detail }), 't', dialect).sql.split('\n\n')[1];
  assert.equal(parseInsertSql(insert).rows[0][0], detail);
}
console.log('PASS SQL exact values, multi-statement parsing, dialects and composite keys');

const deep = level => '{"branch":'.repeat(level);
const a = parseDocument('{"__proto__":1,"a/b":' + deep(32) + '9007199254740992' + '}'.repeat(33));
const b = parseDocument('{"a/b":' + deep(32) + '9007199254740993' + '}'.repeat(33));
const structured = compareJson(a, b);
assert.equal(structured.changes.length, 2);
assert.equal(structured.changes[0].path, '/__proto__');
assert.ok(structured.changes[1].path.startsWith('/a~1b/'));
assert.equal(structured.changes[1].after.numberRaw, '9007199254740993');
assert.equal(compareJson(parseDocument('{"n":1.00}'), parseDocument('{"n":1e0}')).changes.length, 0);
assert.throws(() => compareJson(parseDocument('{"a":1,"a":2}'), b), /重复字段/);
assert.equal(compareJson(a, b, 1).limited, true);
assert.deepEqual(compareLines('A\nB\nC', 'C\nA\nB').map(row => row.type), ['add', 'same', 'same', 'del']);
assert.equal(compareLines('a\nb\nc', 'x\ny\nz', 4), null);
console.log('PASS JSON comparison preserves precision and reports correct line changes and limits');
