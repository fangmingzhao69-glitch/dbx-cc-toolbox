export default `
<div class="tool-head"><span>系统参数配置</span><span class="hint">本地保存，仅影响本插件</span></div>
<div class="settings-list">
  <div class="settings-row"><span>界面主题</span><button id="set-theme" type="button">切换明暗</button></div>
  <div class="settings-row"><span>字号</span><button id="set-font-up" type="button">放大</button><button id="set-font-down" type="button">缩小</button></div>
  <div class="settings-row"><span>批量 INSERT 每批行数</span><input id="set-batch" type="number" min="1" max="1000" style="width:100px" /> <button id="set-batch-save" type="button">保存</button></div>
  <div class="settings-row"><span>本地缓存</span><button id="set-clear" type="button">清除页签与设置缓存</button></div>
  <div class="settings-row"><span>版本</span><span id="set-version">-</span></div>
</div>
`;
