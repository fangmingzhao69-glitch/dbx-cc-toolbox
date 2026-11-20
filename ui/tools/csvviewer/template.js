export default `
<div class="tool-head"><span>CSV 文件预览</span><span class="hint" id="csv-info"></span></div>
<div class="tool-actions">
  <input type="file" id="csv-file" accept=".csv,.tsv,text/csv,text/tab-separated-values" aria-label="选择 CSV 或 TSV 文件" />
  <input type="search" id="csv-search" placeholder="搜索全部数据" aria-label="搜索全部数据" disabled />
  <button id="csv-clear" type="button">清空</button>
</div>
<div id="csv-pages" class="tool-actions" hidden>
  <button type="button" id="csv-previous">上一页</button>
  <button type="button" id="csv-next">下一页</button>
  <button type="button" id="csv-previous-cols">上一组列</button>
  <button type="button" id="csv-next-cols">下一组列</button>
  <span class="hint" id="csv-range" role="status"></span>
</div>
<div id="csv-table" class="csv-table"><div class="tool-empty">选择一个 CSV 文件后在这里预览</div></div>
`;
