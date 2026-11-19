export default `
<div class="tool-head"><span>CSV 文件预览</span><span class="hint" id="csv-info"></span></div>
<div class="tool-actions">
  <input type="file" id="csv-file" accept=".csv,text/csv" />
  <button id="csv-clear" type="button">清空</button>
</div>
<div id="csv-table" class="csv-table"><div class="tool-empty">选择一个 CSV 文件后在这里预览</div></div>
`;
