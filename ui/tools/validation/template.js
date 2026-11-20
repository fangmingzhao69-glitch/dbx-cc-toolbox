export default `
<div class="tool-head"><span>数据验证排查</span><span class="hint">生成只读校验 SQL，可直接在 DBX 执行</span></div>
<div class="tool-actions">
  <select id="val-connection" aria-label="数据库连接"><option value="">选择连接…</option></select>
  <button id="val-refresh" type="button">刷新连接</button>
  <input id="val-table" placeholder="表名，如 public.orders" />
  <input id="val-columns" placeholder="要校验的字段（逗号分隔）" />
  <button id="val-generate" type="button">生成校验 SQL</button>
  <button id="val-run" type="button">执行校验</button>
  <button id="val-copy" type="button">复制 SQL</button>
</div>
<div class="tool-actions">
  <label><input type="checkbox" id="val-null" checked /> 空值</label>
  <label><input type="checkbox" id="val-dup" checked /> 重复值</label>
  <label><input type="checkbox" id="val-len" checked /> 超长</label>
  <label><input type="checkbox" id="val-enum" /> 枚举外值</label>
  <input id="val-enum-values" placeholder="允许的枚举值，逗号分隔" />
  <input id="val-dup-columns" placeholder="重复值检查字段（默认第一个字段）" />
  <input id="val-max-len" type="number" value="255" title="最大长度" />
</div>
<textarea id="val-sql" class="sql-output" spellcheck="false" readonly placeholder="校验 SQL 会显示在这里"></textarea>
<div id="val-result" class="csv-table"><div class="tool-empty">连接可用时可直接执行校验并查看结果</div></div>

<div class="tool-head" style="height:auto;padding:6px 10px">离线数据校验（不需要数据库连接）</div>
<textarea id="val-source" class="sql-input" spellcheck="false" placeholder="粘贴 INSERT SQL、CSV 或 JSON 数组，直接在本地按规则校验"></textarea>
<div class="tool-actions">
  <input id="val-regex" placeholder="正则（可选，例如 ^1\\d{10}$）" />
  <input id="val-rule-fields" aria-label="枚举与正则校验字段" placeholder="枚举与正则字段（逗号分隔，留空校验全部）" />
  <button id="val-offline-run" type="button">离线校验</button>
  <button id="val-offline-export" type="button">导出报告 CSV</button>
</div>
<div id="val-offline-result" class="csv-table"><div class="tool-empty">离线校验结果会显示在这里</div></div>
`;
