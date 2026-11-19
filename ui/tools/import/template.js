export default `
<div class="tool-head"><span>临时数据建表</span><span class="hint" id="import-hint">粘贴 JSON / CSV，生成建表与插入 SQL</span></div>
<div class="tool-actions">
  <input type="file" id="import-file" accept=".csv,.xlsx,.xls,text/csv" title="导入 CSV / Excel 文件" />
  <input id="import-table" placeholder="表名（如 tmp_orders）" value="tmp_data" />
  <select id="import-dialect">
    <option value="postgres">PostgreSQL</option>
    <option value="mysql">MySQL</option>
    <option value="sqlite">SQLite</option>
    <option value="mssql">SQL Server</option>
    <option value="oracle">Oracle</option>
  </select>
  <button id="import-run" type="button">生成 SQL</button>
  <button id="import-copy" type="button">复制 SQL</button>
</div>
<textarea id="import-source" class="sql-input" spellcheck="false" placeholder='粘贴数据，例如：[{"id":1,"name":"demo"}] 或 CSV 文本'></textarea>
<textarea id="import-sql" class="sql-output" spellcheck="false" readonly placeholder="生成的 CREATE TABLE / INSERT 语句会显示在这里"></textarea>
`;
