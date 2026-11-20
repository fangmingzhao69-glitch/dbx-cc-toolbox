export default `
<div class="tool-head"><span>CSV 内容比对</span><span class="hint" id="cmp-hint">选择两个 CSV 文件后比对</span></div>
<div class="tool-actions">
  <label>A：<input type="file" id="cmp-file-a" accept=".csv,.tsv,text/csv,text/tab-separated-values" /></label>
  <label>B：<input type="file" id="cmp-file-b" accept=".csv,.tsv,text/csv,text/tab-separated-values" /></label>
  <input id="cmp-keys" placeholder="主键列（逗号分隔，可空=按行号）" />
  <select id="cmp-key-picker" aria-label="从共同表头添加主键列"></select>
  <button id="cmp-run" type="button">开始比对</button>
  <button id="cmp-swap" type="button">交换 A/B</button>
  <button id="cmp-export" type="button">导出差异 CSV</button>
  <label><input type="checkbox" id="cmp-only-changes" checked /> 仅看差异</label>
</div>
<div id="cmp-summary" class="diff-summary"></div>
<div id="cmp-result" class="csv-table"><div class="tool-empty">选择 A、B 两个 CSV 文件后点击「开始比对」</div></div>
`;
