export default `
<div class="tool-head"><span>快速建数据表</span><span class="hint">定义字段并生成 CREATE TABLE</span></div>
<div class="tool-actions">
  <input id="sheet-table" placeholder="表名" value="new_table" />
  <select id="sheet-dialect">
    <option value="postgres">PostgreSQL</option>
    <option value="mysql">MySQL</option>
    <option value="sqlite">SQLite</option>
    <option value="mssql">SQL Server</option>
    <option value="oracle">Oracle</option>
  </select>
  <button id="sheet-add-col" type="button">添加字段</button>
  <button id="sheet-run" type="button">生成 SQL</button>
  <button id="sheet-copy" type="button">复制 SQL</button>
</div>
<textarea id="sheet-insert" class="sql-input" spellcheck="false" placeholder="或粘贴 INSERT SQL，自动解析表名/字段/类型并生成 CREATE TABLE"></textarea>
<div class="tool-actions">
  <button id="sheet-parse-insert" type="button">从 INSERT 解析</button>
</div>
<div id="sheet-columns" class="sheet-columns"></div>
<textarea id="sheet-sql" class="sql-output" spellcheck="false" readonly placeholder="生成的 CREATE TABLE 语句会显示在这里"></textarea>
`;
