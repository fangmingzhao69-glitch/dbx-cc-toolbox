export default `
<div class="tool-head"><span>首页数据概览</span><span class="hint" id="home-hint">读取 DBX 连接信息</span></div>
<div class="tool-actions">
  <button id="home-refresh" type="button">刷新连接信息</button>
</div>
<div class="tool-actions">
  <button type="button" class="home-link" data-goto="import">前往临时建表</button>
  <button type="button" class="home-link" data-goto="json">前往 JSON 解析</button>
  <button type="button" class="home-link" data-goto="jsondiff">前往 JSON 比对</button>
  <button type="button" class="home-link" data-goto="csvviewer">前往 CSV 预览</button>
  <button type="button" class="home-link" data-goto="invoice">前往发票打印</button>
</div>
<div class="home-cards" id="home-cards"><div class="tool-empty">点击「刷新连接信息」读取当前 DBX 的连接列表</div></div>
`;
