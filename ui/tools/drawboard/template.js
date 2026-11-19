export default `
<div class="tool-head"><span>在线绘图工具</span><span class="hint" id="draw-hint"></span></div>
<div class="tool-actions">
  <input type="color" id="draw-color" value="#2e7d32" title="画笔颜色" />
  <input type="range" id="draw-size" min="1" max="12" value="3" title="画笔粗细" />
  <button id="draw-clear" type="button">清空画布</button>
  <button id="draw-save" type="button">保存 PNG</button>
</div>
<div class="draw-wrap"><canvas id="draw-canvas"></canvas></div>
`;
