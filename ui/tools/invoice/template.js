export default `
<div class="tool-head"><span>发票打印操作</span><span class="hint" id="inv-hint" aria-live="polite">正在连接打印侧车…</span></div>
<div class="invoice-workspace">
  <section class="invoice-files" aria-label="发票文件">
    <div class="invoice-controls">
      <button id="inv-import" type="button">导入文件</button>
      <button id="inv-import-folder" type="button">导入文件夹</button>
      <input type="file" id="inv-files" accept=".pdf,.png,.jpg,.jpeg,.bmp,.tif,.tiff,.gif,.ico" multiple hidden />
      <input type="file" id="inv-folder" webkitdirectory multiple hidden />
    </div>
    <div class="invoice-controls">
      <button id="inv-select-all" type="button">全选</button>
      <button id="inv-select-none" type="button">取消全选</button>
      <button id="inv-clear" type="button">清空</button>
    </div>
    <div id="inv-count" class="hint"></div>
    <ul id="inv-list" class="invoice-file-list"></ul>
  </section>
  <section class="invoice-preview-panel" aria-label="发票预览">
    <div class="invoice-controls">
      <button id="inv-source-preview" type="button">原稿预览</button>
      <button id="inv-preview" type="button">排版预览</button>
      <button id="inv-rotate" type="button">旋转所选原稿</button>
      <button id="inv-zoom-out" type="button" aria-label="缩小">−</button>
      <button id="inv-zoom-reset" type="button" title="重置缩放">100%</button>
      <button id="inv-zoom-in" type="button" aria-label="放大">+</button>
    </div>
    <div class="invoice-controls">
      <button id="inv-prev" type="button">上一页</button>
      <span id="inv-page-label" class="hint" aria-live="polite"></span>
      <button id="inv-next" type="button">下一页</button>
    </div>
    <div id="inv-preview-area" class="invoice-preview"><div class="tool-empty">导入 PDF 或图片后可预览</div></div>
  </section>
  <section class="invoice-settings" aria-label="打印设置">
    <div class="invoice-controls">
      <label for="inv-printer">打印机</label><select id="inv-printer"></select>
      <button id="inv-refresh" type="button">刷新</button>
    </div>
    <div class="invoice-controls">
      <label>纸张 <select id="inv-paper"><option value="A4">A4</option><option value="invoice">发票纸 240 × 140 mm</option><option value="custom">自定义</option></select></label>
      <label>方向 <select id="inv-orientation"><option value="portrait">纵向</option><option value="landscape">横向</option></select></label>
    </div>
    <div class="invoice-controls" id="inv-custom-paper" hidden>
      <label>宽 (mm) <input id="inv-paper-w" type="number" value="240" min="25" max="1000" step="0.1" /></label>
      <label>高 (mm) <input id="inv-paper-h" type="number" value="140" min="25" max="1000" step="0.1" /></label>
    </div>
    <div class="invoice-controls">
      <label>版式 <select id="inv-layout"><option value="1">1 张/页</option><option value="2" selected>2 张/页</option><option value="4">4 张/页</option></select></label>
      <label>份数 <input id="inv-copies" type="number" value="1" min="1" max="99" required /></label>
      <label>质量 <select id="inv-quality"><option value="draft">草稿</option><option value="normal" selected>标准</option><option value="high">高质量</option></select></label>
    </div>
    <fieldset>
      <legend>边距与间距 (mm)</legend>
      <div class="invoice-controls">
        <label>上 <input id="inv-margin-top" type="number" value="0" min="0" max="500" step="0.1" required /></label>
        <label>下 <input id="inv-margin-bottom" type="number" value="0" min="0" max="500" step="0.1" required /></label>
        <label>左 <input id="inv-margin-left" type="number" value="0" min="0" max="500" step="0.1" required /></label>
        <label>右 <input id="inv-margin-right" type="number" value="0" min="0" max="500" step="0.1" required /></label>
        <label>间距 <input id="inv-gap" type="number" value="4" min="0" max="100" step="0.1" required /></label>
        <label><input id="inv-cut-lines" type="checkbox" /> 裁剪线</label>
      </div>
    </fieldset>
    <fieldset>
      <legend>套打偏移 (mm)</legend>
      <div class="invoice-controls">
        <label>X <input id="inv-offset-x" type="number" step="0.1" min="-100" max="100" value="0" required /></label>
        <label>Y <input id="inv-offset-y" type="number" step="0.1" min="-100" max="100" value="0" required /></label>
      </div>
    </fieldset>
    <details>
      <summary>打印模板</summary>
      <div class="invoice-controls">
        <select id="inv-templates" aria-label="打印模板"><option value="">选择模板</option></select>
        <button id="inv-template-load" type="button">应用</button>
        <button id="inv-template-delete" type="button">删除</button>
      </div>
      <div class="invoice-controls">
        <input id="inv-template-name" maxlength="40" placeholder="模板名称" aria-label="模板名称" />
        <button id="inv-template-save" type="button">保存模板</button>
      </div>
    </details>
    <div class="invoice-controls">
      <button id="inv-print" type="button">打印所选</button>
      <span id="inv-job-message" class="hint" aria-live="polite"></span>
    </div>
    <progress id="inv-progress" max="1" value="0" aria-label="打印提交进度" hidden></progress>
    <details>
      <summary>打印历史</summary>
      <ol id="inv-history" class="invoice-history"></ol>
    </details>
  </section>
</div>
`;
