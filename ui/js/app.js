import {
  escapeHtml, formatBytes, parseJsonDocument,
} from './json-grid.js';
import { initTools } from './tools.js';
import { parseDocument, serializeNode, csvDocument, assertFilterSafe, mapFilterOrigins } from './json-document.js';
import { createGridView } from './json-view.js';
import { createHostAdapter } from './host-adapter.js';

const editor = document.getElementById('editor');
editor.readOnly = true;
const startupButtons = [...document.querySelectorAll('.actions button, #tab-add')];
startupButtons.forEach(button => { button.disabled = true; });
let hostAdapter, gridModel = null, saveTimer, filterTicket = 0;
let saveGeneration = 0, pendingSave, saving, automaticSaveEnabled = true;
const saveLabel = document.getElementById('json-save-state');
const gutter = document.getElementById('gutter');
const gridHost = document.getElementById('grid');
const statusEl = document.getElementById('status');
const statsEl = document.getElementById('stats');
const editorHint = document.getElementById('editor-hint');
const gridHint = document.getElementById('grid-hint');

const SAMPLE = {
  patientId: '202607521_1',
  patientName: '',
  qcCode: 'integrated',
  assessmentStatus: 'needs_review',
  qcResults: [
    {
      ruleCode: '64',
      documentIds: ['0d0c85cb-b75d-46fb-8e95-00c53894a1c1', '0d0c85cb-b75d-46fb-8e95-10c53894a1c2'],
      finding: '中医四诊内容不全，缺失望、闻、问、切相关内容',
      basis: '检查点64.1检查要求：核对望、闻、问、切相关内容是否完整到能够支持本次辨证，指出缺失项。',
      evidence: '日常病程记录中仅记录了西医查体及辅助检查结果，无中医四诊内容。',
      reviewRequired: true,
      score: 2,
    },
    {
      ruleCode: '28',
      documentIds: ['0d0c85cb-b75d-46fb-8e95-10c53894a1c3'],
      finding: '存在语句不通顺（标点符号使用错误导致语句不通顺）',
      basis: '检查点4.1检查要求：检查是否存在语义错误、指代不明或语句不通顺，并引用具体原文。',
      evidence: '现意识状态仍较差，合并肺动脉高压，患者仍昏迷，痰多，无发热。',
      reviewRequired: true,
      score: 1,
    },
    {
      ruleCode: '4',
      documentIds: ['0d0c85cb-b75d-46fb-8e95-20c53894a1c4'],
      finding: '存在错字或漏字（多打逗号）',
      basis: '检查点4.2检查要求：指出错字、漏字及其所在语句。',
      evidence: '双下肢静脉血栓形成、肺动脉血栓栓塞，予以抗凝治疗，患者家属拒绝。',
      reviewRequired: false,
      score: 1,
    },
  ],
  error: '模型调用失败，需人工复核；检查点存在未满足的证据依赖：cross_document 5（证据组依赖未满足）、cross_document 7（证据组依赖未满足）。',
};

const state = {
  original: null,
  filtered: null,
  text: '',
  filterCode: null,
  parser: null,
  tabs: [],
  activeId: null,
};

function toast(message, kind = 'info') {
  statusEl.textContent = message;
  statusEl.className = kind === 'error' ? 'error' : kind === 'ok' ? 'ok' : '';
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { statusEl.textContent = '就绪'; statusEl.className = ''; }, 4200);
}

// ---------- 行号 / 自动换行 / 分割条 / 表格宽度自适应 ----------
const measureCanvas = document.createElement('canvas');
const measureCtx = measureCanvas.getContext('2d');
let wrapEnabled = true;

function renderGutter() {
  const lines = editor.value.split('\n');
  const style = getComputedStyle(editor);
  measureCtx.font = [style.fontStyle, style.fontWeight, style.fontSize, style.fontFamily].filter(Boolean).join(' ');
  const available = Math.max(60, editor.clientWidth - 24);
  const spacing = parseFloat(style.letterSpacing) || 0;
  const measure = (value) => measureCtx.measureText(value).width + value.length * spacing;
  const parts = [];
  for (let i = 0; i < lines.length; i += 1) {
    parts.push(String(i + 1));
    if (wrapEnabled) {
      const width = measure(lines[i] || ' ');
      const rows = Math.max(1, Math.ceil(width / available));
      for (let r = 1; r < rows; r += 1) parts.push('');
    }
  }
  gutter.textContent = parts.join('\n');
  gutter.dataset.lines = String(lines.length);
}

let fitRaf = 0;
function scheduleFitTables() {
  if (fitRaf) return;
  fitRaf = requestAnimationFrame(() => { fitRaf = 0; fitTables(); fitNestedViewports(); });
}

const MAX_COLUMN_WIDTH = 650; // 约 50 个汉字

function fitTables() {
  const host = gridHost;
  if (!host || !host.clientWidth) return;
  host.querySelectorAll('table.jgrid').forEach((table) => {
    // 只取当前表格自己的列，避免把嵌套表格的列也算进来
    const colgroup = table.querySelector(':scope > colgroup');
    const columns = colgroup ? Array.from(colgroup.children) : [];
    if (!columns.length) return;
    const container = table.closest('.nested-box') || host;
    const available = Math.max(160, (container.clientWidth || host.clientWidth) - 24);

    // 键值表：键列固定约 15 个字符（140px），值列占满剩余宽度
    if (table.classList.contains('kv') && columns.length === 3) {
      const keyWidth = 140;
      const valueWidth = Math.max(220, available - 46 - keyWidth);
      columns[0].style.width = '46px';
      columns[1].style.width = keyWidth + 'px';
      columns[2].style.width = valueWidth + 'px';
      table.style.width = (46 + keyWidth + valueWidth) + 'px';
      return;
    }
    // 数组表：值列按可用宽度自适应，最宽 650px；根级占满
    if (table.classList.contains('idx') && columns.length === 2) {
      const nested = table.closest('.nested-box');
      const valueWidth = nested
        ? Math.min(MAX_COLUMN_WIDTH, Math.max(110, available - 46))
        : Math.max(220, available - 46);
      columns[0].style.width = '46px';
      columns[1].style.width = valueWidth + 'px';
      table.style.width = (46 + valueWidth) + 'px';
      return;
    }

    let baseTotal = 0;
    for (const column of columns) {
      if (!column.dataset.base) column.dataset.base = String(parseFloat(column.style.width) || 0);
      baseTotal += Number(column.dataset.base);
    }
    if (!baseTotal) return;
    let ratio = Math.min(2.2, Math.max(1, available / baseTotal));
    for (const column of columns) {
      const base = Number(column.dataset.base) || 1;
      ratio = Math.min(ratio, MAX_COLUMN_WIDTH / base);
    }
    let total = 0;
    for (const column of columns) {
      const width = Math.min(MAX_COLUMN_WIDTH, Math.round(Number(column.dataset.base) * ratio));
      column.style.width = width + 'px';
      total += width;
    }
    table.style.width = total + 'px';
  });
}

function applyWrap() {
  editor.classList.toggle('wrap', wrapEnabled);
  const button = document.querySelector('[data-act="wrap"]');
  if (button) button.classList.toggle('active', wrapEnabled);
  renderGutter();
  scheduleFitTables();
}

function syncScroll() {
  gutter.scrollTop = editor.scrollTop;
}

function setStats() {
  const text = editor.value;
  const root = state.parser?.document?.root;
  const summary = root ? { kind: root.kind, count: root.children.length } : null;
  const kindText = summary ? (summary.kind === 'array' ? '数组 ' + summary.count + ' 项' : summary.kind === 'object' ? '对象 ' + summary.count + ' 个字段' : summary.kind) : '未解析';
  const lines = text ? text.split('\n').length : 0;
  const chars = text.length;
  statsEl.textContent = kindText + ' · ' + lines + ' 行 · ' + chars + ' 字符 · ' + formatBytes(new Blob([text]).size);
}

function setHint(ok, message) {
  editorHint.textContent = message;
  editorHint.className = 'hint ' + (ok ? 'ok' : 'error');
}

function currentDocument() { return state.filtered?.document || state.parser?.document; }
function renderGrid() {
  gridModel = null;
  if (!state.parser) { gridHost.innerHTML = '<div class="grid-empty">正在解析当前内容…</div>'; gridHint.textContent = '待解析'; return; }
  if (!state.parser.ok) {
    gridHost.innerHTML = !editor.value.trim() ? '<div class="grid-empty">粘贴或输入 JSON 后，这里会显示表格视图</div>' : '<div class="grid-error">JSON 解析失败<br><span>' + escapeHtml(state.parser.error.message) + '（第 ' + state.parser.error.line + ' 行，第 ' + state.parser.error.column + ' 列）</span></div>';
    gridHint.textContent = editor.value.trim() ? '解析失败' : '等待数据'; return;
  }
  const doc = currentDocument(); gridModel = createGridView(doc, currentTab()?.view);
  gridHost.innerHTML = gridModel.render(); gridModel.restore(gridHost);
  gridHint.textContent = state.filtered ? state.filtered.origins.size ? '筛选结果（保留来源的节点可定位原文）' : '筛选结果（独立结果，无法定位原文）' : '表格已生成';
  if (doc.duplicates.length) gridHint.textContent += ' · 存在重复字段';
  gridHost.dataset.rootRows = String(doc.root.children.length);
  scheduleFitTables(); requestAnimationFrame(fitNestedViewports);
}
function parseAndRender({ silent = false } = {}) {
  clearTimeout(editor._timer);
  if (state.filtered && currentTab()) currentTab().view = {};
  state.filtered = null;
  state.text = editor.value; state.parser = parseJsonDocument(editor.value);
  const tab = currentTab(); if (tab) { tab.text = editor.value; tab.parser = state.parser; tab.filtered = null; }
  setHint(state.parser.ok, state.parser.ok ? 'JSON 合法' : editor.value.trim() ? '解析失败' : '');
  renderGrid(); setStats(); persist(); if (!silent && state.parser.ok) toast('解析成功', 'ok'); return state.parser.ok;
}
function persist() { updateTabText(); saveTabs(); }
function onEditorChanged({ immediate = false } = {}) {
  clearTimeout(editor._timer); filterTicket++;
  const tab = currentTab(); if (!tab) return;
  tab.text = editor.value; tab.revision = (tab.revision || 0) + 1; tab.parser = null; tab.filtered = null; tab.view = {};
  state.parser = null; state.filtered = null;
  renderGutter(); setStats(); renderGrid(); setHint(true, '待解析'); saveTabs();
  const { id, revision, text } = tab;
  const parse = () => { if (state.activeId === id && currentTab()?.revision === revision && editor.value === text) parseAndRender({ silent: true }); };
  if (immediate) parse(); else editor._timer = setTimeout(parse, 260);
}
function setEditorText(text, { parse = true } = {}) { editor.value = text; onEditorChanged({ immediate: parse }); }

// ---------- 多解析窗口（页签） ----------
const tabsEl = document.getElementById('tabs');
const tabAddBtn = document.getElementById('tab-add');

function currentTab() {
  return state.tabs.find((tab) => tab.id === state.activeId) || state.tabs[0] || null;
}

function updateTabText() {
  const tab = currentTab();
  if (tab) tab.text = editor.value;
}

function sessionSnapshot() {
  return { activeId: state.activeId, tabs: state.tabs.map(t => ({ id: t.id, title: t.title, text: t.text, view: t.filtered ? {} : t.view,
    editorScrollTop: t.editorScrollTop, editorSelection: t.editorSelection, gridScrollTop: t.gridScrollTop, gridScrollLeft: t.gridScrollLeft, filterCode: t.filterCode })) };
}
function saveTabs() {
  if (!hostAdapter || !automaticSaveEnabled) return;
  saveGeneration++; saveLabel.textContent = '文档待保存'; clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { void flushSession().catch(() => {}); }, 150);
}
function flushSession() {
  if (!automaticSaveEnabled) return Promise.resolve();
  clearTimeout(saveTimer);
  pendingSave = { generation: saveGeneration, session: sessionSnapshot() };
  if (saving) return saving;
  saving = (async () => {
    while (pendingSave) {
      const task = pendingSave; pendingSave = null; saveLabel.textContent = '文档保存中…';
      await hostAdapter.saveTabs(task.session);
      saveLabel.textContent = task.generation === saveGeneration ? '文档已保存' : '文档待保存';
    }
  })().catch(error => { saveLabel.textContent = '文档未保存，请导出'; throw error; }).finally(() => { saving = null; });
  return saving;
}

function renderTabs() {
  if (!tabsEl) return;
  tabsEl.innerHTML = state.tabs.map((tab) =>
    '<div class="tab' + (tab.id === state.activeId ? ' active' : '') + '" data-tab-id="' + tab.id + '">' +
      '<span class="tab-title" title="双击重命名">' + escapeHtml(tab.title) + '</span>' +
      '<button class="tab-close" type="button" data-close-tab="' + tab.id + '" title="关闭">×</button>' +
    '</div>').join('');
}

// 切换前把当前窗口的完整状态（内容/展开节点/滚动位置/筛选）记到页签上
function saveActiveState() {
  const tab = currentTab();
  if (!tab) return;
  tab.text = editor.value;
  tab.filtered = state.filtered;
  tab.filterCode = filterCode ? filterCode.value : '';
  tab.view = gridModel ? gridModel.snapshot(gridHost) : {};
  tab.gridHint = gridHint.textContent;
  tab.editorScrollTop = editor.scrollTop;
  tab.editorSelection = [editor.selectionStart, editor.selectionEnd];
  tab.gridScrollTop = gridHost.scrollTop;
  tab.gridScrollLeft = gridHost.scrollLeft;
  tab.statusMessage = statusEl.textContent;
  tab.statusClass = statusEl.className;
}

function activateTab(id, options = {}) {
  const next = state.tabs.find(t => t.id === id); if (!next) return;
  if (options.saveCurrent !== false) saveActiveState();
  clearTimeout(editor._timer); filterTicket++; state.activeId = id; editor.value = next.text || '';
  state.parser = next.parser || parseJsonDocument(editor.value); next.parser = state.parser; state.filtered = next.filtered || null;
  renderGutter(); renderTabs(); renderGrid(); filterCode.value = next.filterCode ?? filterCode.defaultValue;
  setHint(state.parser.ok, state.parser.ok ? 'JSON 合法' : editor.value.trim() ? '解析失败' : ''); setStats();
  clearTimeout(toast.timer); statusEl.textContent = next.statusMessage || '就绪'; statusEl.className = next.statusClass || '';
  const restore = () => {
    if (state.activeId !== id) return;
    gridHost.scrollTop = next.gridScrollTop || 0; gridHost.scrollLeft = next.gridScrollLeft || 0;
    if (Array.isArray(next.editorSelection)) editor.setSelectionRange(...next.editorSelection);
    editor.scrollTop = next.editorScrollTop || 0; syncScroll();
    for (const block of gridHost.querySelectorAll('[data-table-node]')) { const pos = next.view?.scroll?.[block.dataset.tableNode]; if (pos) { block.scrollTop = pos.top; block.scrollLeft = pos.left; } }
  }; restore(); requestAnimationFrame(restore); saveTabs();
}

function addTab(text, title) {
  saveActiveState();
  const id = 'tab-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
  state.tabs.push({ id, title: title || ('解析 ' + (state.tabs.length + 1)), text: text || '' });
  activateTab(id, { saveCurrent: false });
}

function closeTab(id) {
  if (state.tabs.length <= 1) {
    state.tabs[0] = { id: state.tabs[0].id, title: state.tabs[0].title, text: '', revision: 0 };
    activateTab(state.tabs[0].id, { saveCurrent: false });
    return;
  }
  const index = state.tabs.findIndex((tab) => tab.id === id);
  if (index < 0) return;
  const wasActive = state.activeId === id;
  state.tabs = state.tabs.filter((tab) => tab.id !== id);
  if (wasActive) {
    state.activeId = state.tabs[Math.min(index, state.tabs.length - 1)].id;
    activateTab(state.activeId, { saveCurrent: false });
  } else {
    renderTabs();
    saveTabs();
  }
}

function renameTab(id) {
  const tab = state.tabs.find(t => t.id === id);
  const label = [...tabsEl.querySelectorAll('[data-tab-id]')].find(el => el.dataset.tabId === id)?.querySelector('.tab-title');
  if (!tab || !label || label.querySelector('input')) return;
  const input = document.createElement('input'); input.value = tab.title; input.maxLength = 30; label.replaceChildren(input); input.focus(); input.select();
  let finished = false;
  const finish = save => { if (finished) return; finished = true; if (save && input.value.trim()) tab.title = input.value.trim(); renderTabs(); saveTabs(); };
  input.addEventListener('click', e => e.stopPropagation()); input.addEventListener('blur', () => finish(true));
  input.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); finish(e.key === 'Enter'); } });
}

if (tabsEl) {
  tabsEl.addEventListener('click', (event) => {
    const close = event.target.closest('[data-close-tab]');
    if (close) {
      event.stopPropagation();
      closeTab(close.dataset.closeTab);
      return;
    }
    const tab = event.target.closest('[data-tab-id]');
    if (tab && tab.dataset.tabId !== state.activeId) activateTab(tab.dataset.tabId);
  });
  tabsEl.addEventListener('dblclick', (event) => {
    const tab = event.target.closest('[data-tab-id]');
    if (tab) renameTab(tab.dataset.tabId);
  });
}
if (tabAddBtn) tabAddBtn.addEventListener('click', () => addTab(''));

const sampleButton = document.querySelectorAll('[data-act]');
sampleButton.forEach((button) => {
  button.addEventListener('click', () => handleAction(button.dataset.act));
});

function handleAction(action) {
  switch (action) {
    case 'sample':
      setEditorText(JSON.stringify(SAMPLE, null, 2));
      toast('已载入示例数据', 'ok');
      break;
    case 'format': {
      const parsed = parseJsonDocument(editor.value);
      if (!parsed.ok) { toast('JSON 不合法，无法格式化：' + parsed.error.message, 'error'); return; }
      setEditorText(serializeNode(parsed.document.root, true));
      toast('已格式化', 'ok');
      break;
    }
    case 'minify': {
      const parsed = parseJsonDocument(editor.value);
      if (!parsed.ok) { toast('JSON 不合法，无法压缩：' + parsed.error.message, 'error'); return; }
      setEditorText(serializeNode(parsed.document.root));
      toast('已压缩', 'ok');
      break;
    }
    case 'validate': {
      const parsed = parseJsonDocument(editor.value);
      if (parsed.ok) toast('JSON 合法', 'ok');
      else toast('JSON 不合法：' + parsed.error.message + (parsed.error.line ? '（第 ' + parsed.error.line + ' 行）' : ''), 'error');
      break;
    }
    case 'clear':
      setEditorText('');
      gutter.textContent = '1';
      gridHost.innerHTML = '<div class="grid-empty">粘贴或输入 JSON 后，这里会显示表格视图</div>';
      statsEl.textContent = '';
      setHint(true, '');
      break;
    case 'find':
      toggleFind();
      break;
    case 'wrap':
      wrapEnabled = !wrapEnabled;
      hostAdapter.set('cc-toolbox-wrap', wrapEnabled ? 'on' : 'off');
      applyWrap();
      toast(wrapEnabled ? '已开启自动换行' : '已关闭自动换行', 'ok');
      break;
    case 'filter':
      toggleFilter();
      break;
    case 'export':
      exportCsv();
      break;
    case 'theme':
      toggleTheme();
      break;
    default:
      break;
  }
}

// ---------- 查找 ----------
const findbar = document.getElementById('findbar');
const findInput = document.getElementById('find-input');
function toggleFind() {
  findbar.hidden = !findbar.hidden;
  if (!findbar.hidden) { findInput.focus(); findInput.select(); }
}
function findNext(backwards = false) {
  const query = findInput.value;
  if (!query) return;
  const text = editor.value;
  const index = backwards
    ? text.lastIndexOf(query, editor.selectionStart - 1)
    : text.indexOf(query, editor.selectionEnd);
  const wrapped = backwards ? text.lastIndexOf(query) : text.indexOf(query);
  const target = index >= 0 ? index : wrapped;
  if (target < 0) { toast('未找到：' + query, 'error'); return; }
  editor.focus();
  editor.setSelectionRange(target, target + query.length);
  const line = text.slice(0, target).split('\n').length;
  const lineHeight = parseFloat(getComputedStyle(editor).lineHeight) || 22;
  editor.scrollTop = Math.max(0, (line - 6) * lineHeight);
  syncScroll();
  toast('第 ' + line + ' 行', 'ok');
}
document.getElementById('find-next').addEventListener('click', () => findNext(false));
document.getElementById('find-prev').addEventListener('click', () => findNext(true));
document.getElementById('find-close').addEventListener('click', () => { findbar.hidden = true; });
findInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') { event.preventDefault(); findNext(event.shiftKey); }
  if (event.key === 'Escape') { findbar.hidden = true; }
});

// ---------- 高级筛选 ----------
const filterPanel = document.getElementById('filter-panel');
const filterCode = document.getElementById('filter-code');
function toggleFilter() {
  filterPanel.hidden = !filterPanel.hidden;
  if (!filterPanel.hidden) filterCode.focus();
}
document.getElementById('filter-close').addEventListener('click', () => { filterPanel.hidden = true; });
document.getElementById('filter-reset').addEventListener('click', () => {
  filterTicket++; state.filtered = null; const tab = currentTab(); if (tab) { tab.filtered = null; tab.view = {}; } renderGrid();
  if (state.parser?.ok) toast('已还原原始数据', 'ok');
});
document.getElementById('filter-apply').addEventListener('click', async () => {
  if (!state.parser?.ok) { toast('请先输入合法 JSON', 'error'); return; }
  const tab = currentTab(), id = tab.id, revision = tab.revision || 0, ticket = ++filterTicket;
  const source = state.parser.document;
  try {
    assertFilterSafe(source); toast('正在筛选…');
    const result = await hostAdapter.filter(source.text, filterCode.value);
    if (state.activeId !== id || (currentTab().revision || 0) !== revision || ticket !== filterTicket) return;
    const document = parseDocument(result.text); if (!document.ok) throw new Error(document.error.message);
    state.filtered = { document, sourceRevision: revision, origins: mapFilterOrigins(source, document, result.origins) }; tab.filtered = state.filtered; tab.view = {};
    renderGrid(); toast('筛选已应用；只有来源未变的节点可定位原文', 'ok');
  } catch (error) { if (ticket === filterTicket) toast('筛选失败：' + error.message, 'error'); }
});
async function exportCsv() {
  if (!state.parser?.ok) { toast('没有合法数据可导出', 'error'); return; }
  try {
    const saved = await hostAdapter.saveFile('cc-toolbox-export-' + Date.now() + '.csv', 'text/csv;charset=utf-8', '\uFEFF' + csvDocument(currentDocument()));
    toast(saved ? '已导出 CSV' : '已取消导出', saved ? 'ok' : 'info');
  } catch (error) { toast('导出失败：' + error.message, 'error'); }
}

// ---------- 主题 ----------
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  hostAdapter?.set('cc-toolbox-theme', theme);
}
function toggleTheme() {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  toast(next === 'dark' ? '深色主题' : '淡绿主题', 'ok');
}

// ---------- 表格交互 ----------
gridHost.addEventListener('click', event => {
  if (!gridModel) return;
  const page = event.target.closest('[data-page-node]');
  if (page && !page.disabled) { currentTab().view = gridModel.snapshot(gridHost); currentTab().view.pages[page.dataset.pageNode] = Number(page.dataset.page); renderGrid(); saveTabs(); return; }
  const columns = event.target.closest('[data-column-node]');
  if (columns && !columns.disabled) { currentTab().view = gridModel.snapshot(gridHost); currentTab().view.columnPages[columns.dataset.columnNode] = Number(columns.dataset.page); renderGrid(); saveTabs(); return; }
  const toggle = event.target.closest('.tgl');
  if (toggle) {
    const id = toggle.dataset.expand, box = gridHost.querySelector('[data-box="' + id + '"]'); if (!box) return;
    const opened = gridModel.view.expanded.has(id);
    if (opened) { gridModel.snapshot(gridHost); gridModel.view.expanded.delete(id); box.hidden = true; box.replaceChildren(); }
    else { gridModel.view.expanded.add(id); box.hidden = false; box.innerHTML = gridModel.render(id); gridModel.restore(box); }
    toggle.setAttribute('aria-expanded', String(!opened)); toggle.textContent = opened ? '+' : '−';
    scheduleFitTables(); requestAnimationFrame(fitNestedViewports); saveActiveState(); saveTabs(); return;
  }
  const cell = event.target.closest('[data-node][data-kind]'); if (cell) jumpToPath(cell.dataset.node, cell.dataset.kind === 'key');
});
editor.addEventListener('input', () => onEditorChanged()); editor.addEventListener('scroll', syncScroll);
editor.addEventListener('keydown', event => {
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); parseAndRender(); }
  if (event.key === 'Tab') { event.preventDefault(); editor.setRangeText('  ', editor.selectionStart, editor.selectionEnd, 'end'); onEditorChanged(); }
});


function visualRowOfOffset(text, offset) {
  const lines = text.slice(0, offset).split('\n');
  const style = getComputedStyle(editor);
  measureCtx.font = [style.fontStyle, style.fontWeight, style.fontSize, style.fontFamily].filter(Boolean).join(' ');
  const available = Math.max(60, editor.clientWidth - 24);
  const spacing = parseFloat(style.letterSpacing) || 0;
  const measure = (value) => measureCtx.measureText(value).width + value.length * spacing;
  let rows = 0;
  for (let i = 0; i < lines.length - 1; i += 1) {
    const width = measure(lines[i] || ' ');
    rows += wrapEnabled ? Math.max(1, Math.ceil(width / available)) : 1;
  }
  if (wrapEnabled) {
    const width = measure(lines[lines.length - 1] || ' ');
    rows += Math.max(0, Math.floor(width / available));
  }
  return rows;
}

function jumpToPath(id, preferKey) {
  if (state.filtered) {
    const sourceId = state.filtered.sourceRevision === (currentTab().revision || 0) && state.filtered.origins.get(id);
    if (!sourceId) { toast('结果由筛选生成或已改写，无法定位原文'); return; }
    id = sourceId;
  }
  const node = state.parser?.document?.nodes.get(id); if (!node) { toast('未找到对应的 JSON 位置', 'error'); return; }
  const start = preferKey && node.keyStart !== undefined ? node.keyStart : node.start, end = preferKey && node.keyEnd !== undefined ? node.keyEnd : node.end;
  editor.focus(); editor.setSelectionRange(start, end);
  const row = visualRowOfOffset(editor.value, start), lineHeight = parseFloat(getComputedStyle(editor).lineHeight) || 26;
  const apply = () => { editor.scrollTop = Math.max(0, row * lineHeight - editor.clientHeight / 3); syncScroll(); }; apply(); requestAnimationFrame(apply);
  const message = '已定位到第 ' + editor.value.slice(0, start).split('\n').length + ' 行'; clearTimeout(toast.timer); statusEl.textContent = message; statusEl.className = 'ok'; currentTab().statusMessage = message;
}

// ---------- 嵌套展开表格：固定显示 20 行 ----------
function fitNestedViewports() {
  document.querySelectorAll('#grid .nested-box > .table-block').forEach((block) => {
    const header = block.querySelector(':scope > table > thead');
    const rows = Array.from(block.querySelectorAll(':scope > table > tbody > tr.row'));
    if (!rows.length) return;
    const limit = Math.min(20, rows.length);
    let height = header ? header.getBoundingClientRect().height : 30;
    for (let i = 0; i < limit; i += 1) height += rows[i].getBoundingClientRect().height;
    block.style.maxHeight = Math.ceil(height) + 'px';
  });
}

// ---------- 左右分割条 ----------
const split = document.getElementById('split');
const splitter = document.getElementById('splitter');
let splitDragging = false;

function persistSplit() {
  hostAdapter.set('cc-toolbox-split', split.style.getPropertyValue('--editor-width'));
}

if (splitter) {
  splitter.addEventListener('mousedown', (event) => {
    splitDragging = true;
    splitter.classList.add('dragging');
    document.body.classList.add('resizing');
    event.preventDefault();
  });
  window.addEventListener('mousemove', (event) => {
    if (!splitDragging) return;
    const rect = split.getBoundingClientRect();
    const percent = Math.min(80, Math.max(20, ((event.clientX - rect.left) / rect.width) * 100));
    split.style.setProperty('--editor-width', percent.toFixed(2) + '%');
    scheduleFitTables();
    renderGutter();
  });
  window.addEventListener('mouseup', () => {
    if (!splitDragging) return;
    splitDragging = false;
    splitter.classList.remove('dragging');
    document.body.classList.remove('resizing');
    persistSplit();
  });
  splitter.addEventListener('dblclick', () => {
    split.style.setProperty('--editor-width', '40%');
    persistSplit();
    scheduleFitTables();
    renderGutter();
  });
}

if (window.ResizeObserver) {
  new ResizeObserver(() => scheduleFitTables()).observe(gridHost);
}
window.addEventListener('resize', () => scheduleFitTables());

// ---------- 与 DBX Host 集成 ----------
async function initBridge() {
  if (!window.dbxPlugin || !window.dbxPlugin.ready) return;
  try {
    await window.dbxPlugin.ready;
    const theme = window.dbxPlugin.theme;
    if (theme && theme.appearance === 'dark') applyTheme('dark');
    const context = window.dbxPlugin.context;
    const fromContext = extractJsonFromContext(context);
    if (fromContext !== undefined) {
      setEditorText(fromContext);
      toast('已从 DBX 上下文载入 JSON', 'ok');
    }
    if (window.dbxPlugin.onContext) {
      window.dbxPlugin.onContext((next) => {
        const data = extractJsonFromContext(next);
        if (data !== undefined) setEditorText(data);
      });
    }
  } catch (error) {
    // 非 DBX 环境（浏览器直接打开）忽略
  }
}

function extractJsonFromContext(context) {
  if (!context || typeof context !== 'object') return undefined;
  if (Array.isArray(context)) return JSON.stringify(context);
  for (const key of ['json', 'data', 'rows', 'result', 'text', 'payload']) {
    if (!Object.hasOwn(context, key)) continue; const value = context[key];
    if (typeof value === 'string') { if (parseDocument(value).ok) return value; }
    else if (value !== undefined) return JSON.stringify(value);
  } return undefined;
}

// ---------- 侧边栏 / 多工具切换 ----------
function initToolShell() {
  const sidebar = document.getElementById('sidebar');
  const titleEl = document.getElementById('tool-title');
  const actions = document.getElementById('actions');
  const panes = Array.from(document.querySelectorAll('.tool-pane'));
  const titles = {
    json: 'JSON 数据解析', home: '首页数据概览', import: '临时数据建表', csvviewer: 'CSV 文件预览',
    quicksheet: '快速建数据表', validation: '数据验证排查', jsondiff: 'JSON 内容比对',
    drawboard: '在线绘图工具', invoice: '发票打印操作', settings: '系统参数配置',
  };
  function showTool(name) {
    const targetId = document.getElementById('tool-' + name) ? 'tool-' + name : 'tool-placeholder';
    panes.forEach((pane) => {
      const active = pane.id === targetId;
      pane.hidden = !active;
      pane.classList.toggle('active', active);
    });
    document.querySelectorAll('.side-item').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.tool === name);
    });
    titleEl.textContent = titles[name] || 'CC 工具箱';
    actions.hidden = name !== 'json';
    hostAdapter.set('cc-toolbox-tool', name);
  }
  if (sidebar) {
    sidebar.addEventListener('click', (event) => {
      const btn = event.target.closest('.side-item');
      if (btn) showTool(btn.dataset.tool);
    });
  }
  let saved = null;
  saved = hostAdapter.get('cc-toolbox-tool');
  showTool(saved && titles[saved] ? saved : 'json');
}

// ---------- 启动 ----------
(async function start() {
  statusEl.textContent = '正在恢复文档…'; hostAdapter = await createHostAdapter(toast);
  const clearStorage = hostAdapter.clear.bind(hostAdapter);
  hostAdapter.clear = async () => {
    automaticSaveEnabled = false; clearTimeout(saveTimer); pendingSave = null; await saving?.catch(() => {});
    try { await clearStorage(); } catch (error) { automaticSaveEnabled = true; throw error; }
  };
  applyTheme(hostAdapter.get('cc-toolbox-theme') === 'dark' ? 'dark' : 'light');
  const savedSplit = hostAdapter.get('cc-toolbox-split'); if (savedSplit) split.style.setProperty('--editor-width', savedSplit);
  wrapEnabled = hostAdapter.get('cc-toolbox-wrap') !== 'off'; applyWrap();
  const stored = await hostAdapter.loadTabs();
  if (stored && Array.isArray(stored.tabs) && stored.tabs.length) {
    const used = new Set();
    state.tabs = stored.tabs.map((tab, i) => {
      const id = typeof tab.id === 'string' && /^tab-[a-zA-Z0-9-]+$/.test(tab.id) && !used.has(tab.id) ? tab.id : 'tab-restored-' + i; used.add(id);
      return { ...tab, id, title: String(tab.title || '解析 ' + (i + 1)).slice(0,30), text: typeof tab.text === 'string' ? tab.text : '', revision: 0 };
    }); state.activeId = state.tabs.some(t => t.id === stored.activeId) ? stored.activeId : state.tabs[0].id;
  } else { state.tabs = [{ id:'tab-1', title:'解析 1', text:JSON.stringify(SAMPLE,null,2), revision:0 }]; state.activeId = 'tab-1'; }
  activateTab(state.activeId, { saveCurrent:false }); editor.readOnly = false; startupButtons.forEach(button => { button.disabled = false; }); window.__ccToast = toast;
  initToolShell(); initTools({ toast, storage: hostAdapter }); await initBridge();
  window.addEventListener('pagehide', () => { saveActiveState(); void flushSession().catch(() => {}); });
  hostAdapter.bridge?.workbench?.onClose(async () => { saveActiveState(); await flushSession(); await hostAdapter.flush(); });


})().catch(error => toast('JSON 工作台启动失败：' + error.message, 'error'));
