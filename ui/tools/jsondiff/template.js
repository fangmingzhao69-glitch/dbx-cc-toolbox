export default `
<div class="tool-head"><span>JSON 内容比对</span><span class="hint" id="diff-hint"></span></div>
<div class="diff-grid">
  <textarea id="diff-left" spellcheck="false" placeholder="粘贴原始 JSON"></textarea>
  <textarea id="diff-right" spellcheck="false" placeholder="粘贴对比 JSON"></textarea>
</div>
<div class="tool-actions">
  <input type="file" id="diff-file-left" accept=".json,application/json" title="导入左侧 JSON 文件" />
  <input type="file" id="diff-file-right" accept=".json,application/json" title="导入右侧 JSON 文件" />
  <select id="diff-mode">
    <option value="tree">结构差异（推荐）</option>
    <option value="text">文本行差异</option>
  </select>
  <button id="diff-run" type="button">开始比对</button>
  <button id="diff-swap" type="button">交换两侧</button>
  <button id="diff-format" type="button">格式化两侧</button>
  <button id="diff-sample" type="button">示例</button>
</div>
<div id="diff-result" class="diff-result"><div class="tool-empty">两侧内容相同或尚未比对</div></div>
`;
