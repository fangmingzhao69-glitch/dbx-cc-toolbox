import template from './template.js';

const templateKey = 'cc-toolbox-invoice-templates';
const historyKey = 'cc-toolbox-invoice-history';
const supported = /\.(pdf|png|jpe?g|bmp|tiff?|gif|ico)$/i;
const settingsFields = {
  paper: 'paper', customWidth: 'paper-w', customHeight: 'paper-h', orientation: 'orientation',
  layout: 'layout', copies: 'copies', quality: 'quality', marginTopMm: 'margin-top',
  marginBottomMm: 'margin-bottom', marginLeftMm: 'margin-left', marginRightMm: 'margin-right',
  gapMm: 'gap', offsetXmm: 'offset-x', offsetYmm: 'offset-y', cutLines: 'cut-lines'
};

function base64(bytes) {
  let text = '';
  for (let offset = 0; offset < bytes.length; offset += 8192)
    text += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return btoa(text);
}

export default function mount({ toast: notify, bridge, preferences }, panel) {
  panel.innerHTML = template;
  const get = name => panel.querySelector('#inv-' + name);
  const list = get('list');
  let workspace;
  let closing = false;
  let files = [];
  let activeId;
  let mode = 'sheet';
  let sheet = 1;
  let zoom = 100;
  let busy = false;
  let job;
  let jobTimer;
  let previewVersion = 0;
  let templates = [];
  let history = [];
  let templatesLoaded = false;
  let historyLoaded = false;
  const area = get('preview-area');
  const hint = get('hint');
  const current = () => files.find(file => file.id === activeId);
  const available = () => Boolean(bridge?.invoke);
  const checkedFiles = () => files.filter(file => file.selected);
  const describeError = error => error?.message || String(error);
  const title = file => file.path || file.name;

  async function invoke(method, params = {}, timeoutMs = 15000) {
    if (!available()) throw new Error('发票打印需要 DBX Windows x64 插件侧车');
    await bridge.ready;
    return bridge.invoke('invoice/' + method, params, { timeoutMs });
  }

  async function work(method, params = {}, timeoutMs) {
    if (closing) throw new Error('发票工作台正在关闭');
    if (!workspace) {
      const version = await invoke('version');
      if (!version.workspaces) throw new Error('请同步更新插件和发票打印侧车');
      const opened = await invoke('workspace/open');
      if (closing) {
        await invoke('workspace/close', { workspaceId: opened.id }).catch(() => {});
        throw new Error('发票工作台正在关闭');
      }
      workspace = opened;
    }
    try { return await invoke(method, { ...params, workspaceId: workspace.id }, timeoutMs); }
    catch (error) {
      if (describeError(error).includes('工作区已失效')) {
        workspace = undefined;
        files = [];
        activeId = undefined;
        sheet = 1;
        invalidatePreview();
        showFiles();
      }
      throw error;
    }
  }

  function report(message, tone = 'info') {
    hint.textContent = message;
    notify(message, tone);
  }

  async function run(action, progress) {
    if (busy || closing) return;
    if (!available()) { report('发票打印需要 DBX Windows x64 插件侧车', 'error'); return; }
    busy = true;
    if (progress) hint.textContent = progress;
    updateControls();
    try { await action(); }
    catch (error) { report(describeError(error), 'error'); }
    finally { busy = false; updateControls(); }
  }

  function readSettings() {
    const fields = {};
    for (const [name, suffix] of Object.entries(settingsFields)) {
      const input = get(suffix);
      if (input.type === 'number') {
        if ((name === 'customWidth' || name === 'customHeight') && get('paper').value !== 'custom') {
          fields[name] = input.valueAsNumber || Number(input.defaultValue);
          continue;
        }
        if (!input.checkValidity() || !Number.isFinite(input.valueAsNumber)) {
          input.reportValidity();
          throw new Error('请检查纸张、边距、套打偏移或份数设置');
        }
        fields[name] = input.valueAsNumber;
      } else fields[name] = input.type === 'checkbox' ? input.checked : input.value;
    }
    return fields;
  }

  function printSettings() {
    const settings = readSettings();
    const dimensions = settings.paper === 'invoice' ? [240, 140] : settings.paper === 'custom'
      ? [settings.customWidth, settings.customHeight] : [210, 297];
    return { ...settings, printer: get('printer').value, layout: Number(settings.layout),
      paperWidthMm: dimensions[0], paperHeightMm: dimensions[1] };
  }

  function selection() {
    return checkedFiles().map(file => {
      if (!Number.isInteger(file.first) || !Number.isInteger(file.last) || file.first < 1 || file.last < file.first || file.last > file.pages)
        throw new Error('请检查「' + title(file) + '」的起止页');
      return { fileId: file.id, first: file.first, last: file.last, rotation: file.rotation };
    });
  }

  function sheetCount() {
    const originals = checkedFiles().reduce((count, file) => {
      const pageCount = file.last - file.first + 1;
      return count + (Number.isFinite(pageCount) ? Math.max(0, pageCount) : 0);
    }, 0);
    return Math.ceil(originals / Number(get('layout').value));
  }

  function invalidatePreview() {
    previewVersion++;
    const placeholder = document.createElement('div');
    placeholder.className = 'tool-empty';
    placeholder.textContent = files.length ? '点击预览查看当前设置' : '导入 PDF 或图片后可预览';
    area.replaceChildren(placeholder);
  }

  function updateControls() {
    const hasFiles = files.length !== 0;
    const enabled = available() && !busy;
    const file = current();
    const max = mode === 'source' ? file?.pages || 0 : sheetCount();
    const page = mode === 'source' ? file?.page || 1 : sheet;
    const hasSelection = checkedFiles().length !== 0;
    get('count').textContent = '共 ' + files.length + ' 个文件，已选 ' + checkedFiles().length + ' 个';
    get('page-label').textContent = max ? (mode === 'source' ? '原稿 ' : '排版 ') + page + ' / ' + max : '尚无预览页';
    get('custom-paper').hidden = get('paper').value !== 'custom';
    for (const name of ['import', 'import-folder', 'refresh']) get(name).disabled = !enabled;
    for (const name of ['select-all', 'select-none', 'clear']) get(name).disabled = !enabled || !hasFiles;
    get('source-preview').disabled = !enabled || !file;
    get('preview').disabled = !enabled || !hasSelection;
    get('rotate').disabled = !enabled || !file;
    get('prev').disabled = !enabled || max === 0 || page <= 1;
    get('next').disabled = !enabled || max === 0 || page >= max;
    get('print').disabled = !enabled || !hasSelection || !get('printer').value || Boolean(job && !job.terminal);
    get('zoom-reset').textContent = zoom + '%';
    for (const control of list.querySelectorAll('button,input')) control.disabled = busy || control.dataset.edge === 'true';
  }

  function inputsChanged() {
    sheet = Math.min(sheet, Math.max(1, sheetCount()));
    invalidatePreview();
    updateControls();
  }

  function showFiles() {
    const rows = files.map((file, index) => {
      const row = document.createElement('li');
      row.className = file.id === activeId ? 'active' : '';
      const line = document.createElement('div');
      line.className = 'invoice-file-line';
      const selected = document.createElement('input');
      selected.type = 'checkbox';
      selected.checked = file.selected;
      selected.setAttribute('aria-label', '选择打印 ' + title(file));
      selected.addEventListener('change', () => { file.selected = selected.checked; inputsChanged(); });

      const name = document.createElement('button');
      name.type = 'button';
      name.className = 'invoice-filename';
      name.textContent = title(file);
      name.title = title(file);
      name.setAttribute('aria-pressed', String(file.id === activeId));
      name.addEventListener('click', () => {
        activeId = file.id;
        mode = 'source';
        showFiles();
        void run(renderPreview, '正在生成原稿预览…');
      });
      line.append(selected, name);

      function button(content, label, action, edge = false) {
        const element = document.createElement('button');
        element.type = 'button';
        element.title = label;
        element.setAttribute('aria-label', label + ' ' + title(file));
        element.textContent = content;
        element.dataset.edge = String(edge);
        element.addEventListener('click', action);
        line.append(element);
      }
      function move(delta) {
        [files[index], files[index + delta]] = [files[index + delta], files[index]];
        showFiles();
        inputsChanged();
      }
      button('↑', '上移', () => move(-1), index === 0);
      button('↓', '下移', () => move(1), index === files.length - 1);
      button('×', '删除', () => run(async () => {
        await work('files/remove', { fileId: file.id });
        files = files.filter(item => item !== file);
        if (file.id === activeId) activeId = files[Math.min(index, files.length - 1)]?.id;
        showFiles();
        inputsChanged();
      }));
      row.append(line);

      const detail = document.createElement('div');
      detail.className = 'invoice-file-detail';
      detail.append(file.pages + ' 页' + (file.rotation ? ' · 旋转 ' + file.rotation + '°' : ''));
      if (file.pages > 1) {
        for (const [key, labelText] of [['first','起页'], ['last','止页']]) {
          const label = document.createElement('label');
          label.textContent = labelText + ' ';
          const input = document.createElement('input');
          input.type = 'number'; input.min = '1'; input.max = String(file.pages); input.required = true;
          input.value = String(file[key]);
          input.addEventListener('input', () => { file[key] = input.valueAsNumber; inputsChanged(); });
          label.append(input);
          detail.append(label);
        }
      }
      row.append(detail);
      return row;
    });
    list.replaceChildren(...rows);
    updateControls();
  }

  async function importFiles(incoming) {
    const totals = { imported: 0, duplicates: 0, skipped: 0, failures: [] };
    for (const file of incoming) {
      if (!supported.test(file.name)) { totals.skipped++; continue; }
      const path = file.webkitRelativePath || '';
      const label = path || file.name;
      let id;
      try {
        hint.textContent = '正在导入 ' + label;
        const upload = await work('files/open', { length: file.size });
        id = upload.id;
        for (let offset = 0; offset < file.size; offset += workspace.chunkBytes) {
          const bytes = new Uint8Array(await file.slice(offset, offset + workspace.chunkBytes).arrayBuffer());
          const result = await work('files/write', { fileId: id, offset, data: base64(bytes) });
          if (result.written !== bytes.length) throw new Error('文件数据未完整传输');
          hint.textContent = '正在导入 ' + label + ' · ' + Math.round((offset + bytes.length) * 100 / file.size) + '%';
        }
        const result = await work('files/finish', { fileId: id }, 60000);
        if (result.duplicate) { totals.duplicates++; continue; }
        files.push({ id, name: file.name, path, pages: result.pages, first: 1, last: result.pages, page: 1, rotation: 0, selected: true });
        activeId ??= id;
        totals.imported++;
      } catch (error) {
        if (id && workspace) await work('files/remove', { fileId: id }).catch(() => {});
        totals.failures.push(label + '：' + describeError(error));
      }
    }
    showFiles();
    inputsChanged();
    const summary = '已导入 ' + totals.imported + ' 个 · 重复 ' + totals.duplicates + ' 个 · 不支持 ' + totals.skipped + ' 个 · 失败 ' + totals.failures.length + ' 个';
    hint.title = totals.failures.join('\n');
    report(summary + (totals.failures.length ? '。' + totals.failures[0] : ''), totals.failures.length ? 'error' : 'ok');
  }

  function setZoom(next) {
    zoom = Math.max(25, Math.min(250, next));
    const image = area.querySelector('img');
    if (image) image.style.width = zoom + '%';
    updateControls();
  }

  async function renderPreview() {
    const version = ++previewVersion;
    const file = current();
    const result = mode === 'source'
      ? await work('file/preview', { fileId: file.id, page: file.page, rotation: file.rotation }, 60000)
      : await work('preview', { files: selection(), settings: printSettings(), sheet }, 60000);
    if (version !== previewVersion) return;
    const img = document.createElement('img');
    img.alt = mode === 'sheet' ? '排版预览第 ' + sheet + ' 页' : '原稿第 ' + file.page + ' 页';
    img.src = 'data:image/png;base64,' + result.png;
    img.style.width = zoom + '%';
    area.replaceChildren(img);
    hint.textContent = mode === 'sheet' ? '纸张 ' + result.widthMm + ' × ' + result.heightMm + ' mm' : title(file);
  }

  function navigate(delta) {
    void run(async () => {
      const file = current();
      const old = mode === 'source' ? file.page : sheet;
      const next = old + delta;
      if (mode === 'source') file.page = next; else sheet = next;
      try { await renderPreview(); }
      catch (error) { if (mode === 'source') file.page = old; else sheet = old; throw error; }
    }, '正在生成预览…');
  }

  function showTemplates(selected = '') {
    const control = get('templates');
    control.replaceChildren(new Option('选择模板', ''), ...templates.map(item => new Option(item.name, item.name)));
    control.value = selected;
  }

  function showHistory() {
    get('history').replaceChildren(...history.map(entry => {
      const item = document.createElement('li');
      const time = new Date(entry.created).toLocaleString();
      item.textContent = [time, entry.printer, entry.total + ' 页', entry.message].join(' · ');
      return item;
    }));
  }

  function showJob() {
    const progress = get('progress');
    progress.hidden = !job;
    if (!job) return;
    progress.max = job.total || 1;
    progress.value = job.rendered || 0;
    get('job-message').textContent = job.message + '（已排版 ' + (job.rendered || 0) + ' / ' + progress.max + ' 页）';
    updateControls();
  }

  function recordJob() {
    if (!historyLoaded) return;
    history = [{ ...job }, ...history.filter(item => item.id !== job.id)].slice(0, 50);
    showHistory();
    void preferences.write(historyKey, history).catch(error => report('打印历史保存失败：' + describeError(error), 'error'));
  }

  function pollJob() {
    clearTimeout(jobTimer);
    if (closing || !job || job.terminal) return;
    jobTimer = setTimeout(async () => {
      try { job = { ...job, ...await invoke('job/status', { jobId: job.id }) }; }
      catch (error) {
        job = { ...job, message: '无法查询状态，请检查系统打印队列：' + describeError(error), terminal: true };
      }
      if (closing) return;
      showJob();
      if (job.terminal) recordJob();
      else pollJob();
    }, 1000);
  }

  async function refreshPrinters() {
    const printer = get('printer');
    const previous = printer.value;
    const result = await invoke('printers');
    printer.replaceChildren(...result.printers.map(item => new Option(item.name, item.name, false, item.isDefault)));
    if (result.printers.some(item => item.name === previous)) printer.value = previous;
    hint.textContent = result.printers.length ? '已读取 ' + result.printers.length + ' 台打印机' : '系统未检测到打印机，可继续预览';
  }

  const click = (name, handler) => get(name).addEventListener('click', handler);
  for (const [button, input] of [['import','files'],['import-folder','folder']]) {
    click(button, () => get(input).click());
    get(input).addEventListener('change', event => {
      const incoming = [...event.target.files];
      event.target.value = '';
      if (incoming.length) void run(() => importFiles(incoming), '正在读取发票文件…');
    });
  }
  for (const [name, selected] of [['select-all',true],['select-none',false]]) click(name, () => {
    for (const file of files) file.selected = selected;
    showFiles();
    inputsChanged();
  });
  click('clear', () => run(async () => {
    if (workspace) await invoke('workspace/close', { workspaceId: workspace.id });
    workspace = undefined;
    files = [];
    activeId = undefined;
    sheet = 1;
    showFiles();
    inputsChanged();
  }));
  click('source-preview', () => { mode = 'source'; void run(renderPreview, '正在生成原稿预览…'); });
  click('preview', () => { mode = 'sheet'; void run(renderPreview, '正在生成排版预览…'); });
  click('prev', () => navigate(-1));
  click('next', () => navigate(1));
  click('zoom-out', () => setZoom(zoom - 25));
  click('zoom-in', () => setZoom(zoom + 25));
  click('zoom-reset', () => setZoom(100));
  click('rotate', () => {
    const file = current();
    if (!file) return;
    file.rotation = (file.rotation + 90) % 360;
    showFiles();
    invalidatePreview();
    void run(renderPreview, '正在更新预览…');
  });
  for (const suffix of Object.values(settingsFields)) get(suffix).addEventListener('input', inputsChanged);
  get('paper').addEventListener('change', () => {
    if (get('paper').value === 'invoice') get('orientation').value = 'landscape';
    if (get('paper').value === 'A4') get('orientation').value = 'portrait';
    inputsChanged();
  });
  get('printer').addEventListener('change', updateControls);
  click('refresh', () => run(refreshPrinters, '正在读取打印机…'));
  click('print', () => run(async () => {
    const request = { files: selection(), settings: printSettings() };
    try {
      job = await work('print', request);
    } catch (error) {
      throw new Error('未能确认打印请求结果，重试前请检查系统打印队列。' + describeError(error));
    }
    showJob();
    recordJob();
    pollJob();
  }, '正在提交打印…'));

  const saveTemplates = async (next, selected) => {
    await preferences.write(templateKey, next);
    templates = next;
    showTemplates(selected);
  };
  click('template-save', () => run(async () => {
    if (!templatesLoaded) throw new Error('打印模板尚未读取');
    const name = get('template-name').value.trim();
    if (!name) throw new Error('请输入模板名称');
    const previous = templates.find(item => item.name === name);
    if (previous && get('templates').value !== name) throw new Error('此名称已存在。选择同名模板后再保存即可覆盖');
    if (!previous && templates.length >= 30) throw new Error('最多保存 30 个模板，请先删除不用的模板');
    await saveTemplates([...templates.filter(item => item.name !== name), { name, fields: readSettings(), printer: get('printer').value }], name);
    report('模板已保存', 'ok');
  }));
  click('template-load', () => {
    const template = templates.find(item => item.name === get('templates').value);
    if (!template) return;
    for (const [key, suffix] of Object.entries(settingsFields)) {
      if (!Object.hasOwn(template.fields, key)) continue;
      const input = get(suffix);
      if (input.type === 'checkbox') input.checked = template.fields[key]; else input.value = template.fields[key];
    }
    if ([...get('printer').options].some(option => option.value === template.printer)) get('printer').value = template.printer;
    get('template-name').value = template.name;
    inputsChanged();
    report('模板已应用', 'ok');
  });
  click('template-delete', () => run(async () => {
    const name = get('templates').value;
    if (!templatesLoaded || !name) return;
    await saveTemplates(templates.filter(item => item.name !== name), '');
    get('template-name').value = '';
    report('模板已删除', 'ok');
  }));

  void preferences.read(templateKey, []).then(value => {
    if (closing) return;
    templates = Array.isArray(value) ? value : []; templatesLoaded = true; showTemplates();
  })
    .catch(error => report('打印模板读取失败：' + describeError(error), 'error'));
  void preferences.read(historyKey, []).then(value => {
    if (closing) return;
    history = Array.isArray(value) ? value : [];
    historyLoaded = true;
    showHistory();
    const inProgress = history.find(item => !item.terminal);
    if (inProgress && !job && available()) { job = inProgress; showJob(); pollJob(); }
    else if (job) recordJob();
  }).catch(error => report('打印历史读取失败：' + describeError(error), 'error'));
  if (available()) {
    void run(refreshPrinters, '正在读取打印机…');
  } else hint.textContent = '发票打印需要 DBX Windows x64 插件侧车';
  updateControls();
  return {
    async dispose() {
      closing = true;
      clearTimeout(jobTimer);
      if (workspace) await invoke('workspace/close', { workspaceId: workspace.id });
    },
  };
}
