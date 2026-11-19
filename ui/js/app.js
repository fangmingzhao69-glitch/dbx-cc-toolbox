import {
  escapeHtml, formatBytes, parseJsonDocument,
} from './json-grid.js';
import { MAX_TEXT, parseDocument, serializeNode, csvDocument, assertFilterSafe, mapFilterOrigins } from './json-document.js';
import { createGridView, describeContainer } from './json-view.js';
import { createHostAdapter } from './host-adapter.js';
import { createToolShell } from './registry.js';
import { createPreferences } from '../shared/storage.js';
import { createToolHost } from '../shared/bridge.js';

const editor = document.getElementById('editor');
editor.readOnly = true;
const startupButtons = [...document.querySelectorAll('.actions button, #tab-add')];
startupButtons.forEach(button => { button.disabled = true; });
let hostAdapter, gridModel = null, saveTimer, filterTicket = 0;
let saveGeneration = 0, pendingSave, saving, automaticSaveEnabled = true;
const saveLabel = document.getElementById('json-save-state');
const gutter = document.getElementById('gutter');
const gridHost = document.getElementById('grid');
const gridFocus = document.getElementById('grid-focus');
const gridFocusPath = document.getElementById('grid-focus-path');
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
  fitRaf = requestAnimationFrame(() => { fitRaf = 0; fitTables(); });
}

const MAX_COLUMN_WIDTH = 650; // 约 50 个汉字

function fitTables() {
  const host = gridHost;
  if (!host || !host.clientWidth) return;
  for (const box of host.querySelectorAll('.nested-box:not([hidden])')) {
    const parentBlock = box.parentElement.closest('.table-block');
    const parentBox = box.parentElement.closest('.nested-box');
    const visibleWidth = parentBox ? parentBlock.clientWidth : host.clientWidth - 16;
    box.style.width = Math.max(0, visibleWidth) + 'px';
  }
  host.querySelectorAll('table.jgrid').forEach((table) => {
    // 只取当前表格自己的列，避免把嵌套表格的列也算进来
    const colgroup = table.querySelector(':scope > colgroup');
    const columns = colgroup ? Array.from(colgroup.children) : [];
    if (!columns.length) return;
    const block = table.parentElement;
    const nested = Boolean(table.closest('.nested-box'));
    const available = Math.max(140, block.clientWidth || host.clientWidth - 16);

    // 键值表：键列固定约 15 个字符（140px），值列占满剩余宽度
    if (table.classList.contains('kv') && columns.length === 3) {
      const keyWidth = nested ? Math.max(82, Math.min(140, Math.round(available * .28))) : 140;
      const valueWidth = Math.max(nested ? 92 : 220, available - 46 - keyWidth);
      columns[0].style.width = '46px';
      columns[1].style.width = keyWidth + 'px';
      columns[2].style.width = valueWidth + 'px';
      table.style.width = (46 + keyWidth + valueWidth) + 'px';
      return;
    }
    // 数组表：值列按可用宽度自适应，最宽 650px；根级占满
    if (table.classList.contains('idx') && columns.length === 2) {
      const valueWidth = Math.max(nested ? 92 : 220, available - 46);
      columns[0].style.width = '46px';
      columns[1].style.width = valueWidth + 'px';
      table.style.width = (46 + valueWidth) + 'px';
      return;
    }

    const dataColumns = columns.slice(1);
    const maxWidth = Math.min(MAX_COLUMN_WIDTH, Math.max(180, available * .55));
    const bases = dataColumns.map(column => Math.min(maxWidth, Number(column.dataset.base)));
    const dataWidth = bases.reduce((sum, width) => sum + width, 0);
    const ratio = Math.max(1, (available - 46) / (dataWidth || 1));
    let total = 46;
    for (const [index, column] of dataColumns.entries()) {
      const width = Math.min(maxWidth, Math.round(bases[index] * ratio));
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
  gridFocus.hidden = true;
  if (!state.parser) { gridHost.innerHTML = '<div class="grid-empty">正在解析当前内容…</div>'; gridHint.textContent = '待解析'; return; }
  if (!state.parser.ok) {
    gridHost.innerHTML = !editor.value.trim() ? '<div class="grid-empty">粘贴或输入 JSON 后，这里会显示表格视图</div>' : '<div class="grid-error">JSON 解析失败<br><span>' + escapeHtml(state.parser.error.message) + '（第 ' + state.parser.error.line + ' 行，第 ' + state.parser.error.column + ' 列）</span></div>';
    gridHint.textContent = editor.value.trim() ? '解析失败' : '等待数据'; return;
  }
  const doc = currentDocument();
  const model = createGridView(doc, currentTab()?.view);
  gridModel = model;
  const root = doc.nodes.get(model.rootId);
  gridHost.innerHTML = model.render(model.rootId);
  model.restore(gridHost);
  if (root !== doc.root) {
    const path = root.pointer.split('/').slice(1).map(part => part.replace(/~1/g, '/').replace(/~0/g, '~') || '""');
    const label = path.join(' › ') + ' · ' + describeContainer(root);
    gridFocusPath.textContent = label;
    gridFocusPath.title = label;
    gridFocus.hidden = false;
    gridFocus.querySelector('[data-focus-root]').hidden = model.view.focus.length <= 1;
  }
  gridHint.textContent = state.filtered ? state.filtered.origins.size ? '筛选结果（保留来源的节点可定位原文）' : '筛选结果（独立结果，无法定位原文）' : '表格已生成';
  if (doc.duplicates.length) gridHint.textContent += ' · 存在重复字段';
  gridHost.dataset.rootRows = String(doc.root.children.length);
  scheduleFitTables();
  const position = model.view.viewport[model.rootId]
    || (root === doc.root ? { top: currentTab()?.gridScrollTop, left: currentTab()?.gridScrollLeft } : null);
  gridHost.scrollTo(position?.left ?? 0, position?.top ?? 0);
  requestAnimationFrame(() => {
    if (gridModel !== model) return;
    gridHost.scrollTo(position?.left ?? 0, position?.top ?? 0);
    restoreNestedScroll(model.view.scroll);
  });
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
  tab.gridScrollTop = 0;
  tab.gridScrollLeft = 0;
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
  return { activeId: state.activeId, tabs: state.tabs.map(t => ({ id: t.id, title: t.title, text: t.text, splitRatio: t.splitRatio, view: t.filtered ? {} : t.view,
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
  tab.splitRatio = splitRatio;
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
  setSplitRatio(next.splitRatio ?? DEFAULT_SPLIT);
  state.parser = next.parser || parseJsonDocument(editor.value); next.parser = state.parser; state.filtered = next.filtered || null;
  renderGutter(); renderTabs(); renderGrid(); filterCode.value = next.filterCode ?? filterCode.defaultValue;
  setHint(state.parser.ok, state.parser.ok ? 'JSON 合法' : editor.value.trim() ? '解析失败' : ''); setStats();
  clearTimeout(toast.timer); statusEl.textContent = next.statusMessage || '就绪'; statusEl.className = next.statusClass || '';
  const restore = () => {
    if (state.activeId !== id) return;
    if (Array.isArray(next.editorSelection)) editor.setSelectionRange(...next.editorSelection);
    editor.scrollTop = next.editorScrollTop || 0; syncScroll();
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
function restoreNestedScroll(positions, host = gridHost) {
  for (const block of host.querySelectorAll('.nested-box > [data-table-node]')) {
    const position = positions[block.dataset.tableNode];
    if (position) block.scrollTo(position.left, position.top);
  }
}

function changeFocus(change) {
  if (!gridModel) return;
  const tab = currentTab();
  tab.view = gridModel.snapshot(gridHost);
  change(tab.view.focus);
  renderGrid();
  if (!gridFocus.hidden) gridFocus.querySelector('[data-focus-back]').focus({ preventScroll: true });
  saveTabs();
}

gridFocus.querySelector('[data-focus-back]').addEventListener('click', () => changeFocus(focus => focus.pop()));
gridFocus.querySelector('[data-focus-root]').addEventListener('click', () => changeFocus(focus => { focus.length = 0; }));

gridHost.addEventListener('click', event => {
  if (!gridModel) return;
  const focusButton = event.target.closest('[data-focus-node]');
  if (focusButton) {
    changeFocus(focus => focus.push(focusButton.dataset.focusNode));
    return;
  }
  const page = event.target.closest('[data-page-node], [data-column-node]');
  if (page && !page.disabled) {
    const tab = currentTab();
    tab.view = gridModel.snapshot(gridHost);
    const { pageNode, columnNode } = page.dataset;
    const id = pageNode || columnNode;
    const pagination = columnNode ? tab.view.columnPages : tab.view.pages;
    pagination[id] = Number(page.dataset.page);
    const positions = id === gridModel.rootId ? tab.view.viewport : tab.view.scroll;
    const previous = positions[id] || { top: 0, left: 0 };
    positions[id] = columnNode ? { top: previous.top, left: 0 } : { top: 0, left: previous.left };
    renderGrid();
    saveTabs();
    return;
  }
  const toggle = event.target.closest('.tgl');
  if (toggle) {
    const model = gridModel;
    const id = toggle.dataset.expand;
    const box = gridHost.querySelector('[data-box="' + id + '"]');
    if (!box) return;
    const opened = !model.view.expanded.has(id);
    if (opened) model.view.expanded.add(id);
    else {
      model.snapshot(gridHost);
      model.view.expanded.delete(id);
    }
    model.setExpanded(toggle, box, opened);
    scheduleFitTables();
    const rememberExpansion = () => {
      saveActiveState();
      saveTabs();
    };
    if (opened) requestAnimationFrame(() => {
      if (gridModel !== model || box.hidden || !box.isConnected) return;
      restoreNestedScroll(model.view.scroll, box);
      rememberExpansion();
    });
    else rememberExpansion();
    return;
  }
  const cell = event.target.closest('[data-node][data-kind]'); if (cell) jumpToPath(cell.dataset.node, cell.dataset.kind === 'key');
});
let insertingFormattedPaste = false;
editor.addEventListener('input', () => { if (!insertingFormattedPaste) onEditorChanged(); });
editor.addEventListener('scroll', syncScroll);
editor.addEventListener('paste', event => {
  if (editor.readOnly) return;
  const pasted = event.clipboardData?.getData('text/plain');
  if (!pasted) return;
  const current = editor.value;
  const candidate = current.slice(0, editor.selectionStart) + pasted.replace(/\r\n?/g, '\n') + current.slice(editor.selectionEnd);
  const doc = parseDocument(candidate);
  if (!doc.ok) return;
  const formatted = serializeNode(doc.root, true);
  if (formatted.length > MAX_TEXT) return;

  event.preventDefault();
  // Use the native text insertion command so the formatted paste can be undone in one step.
  insertingFormattedPaste = true;
  try {
    editor.select();
    if (!document.execCommand('insertText', false, formatted)) {
      editor.setRangeText(formatted, 0, editor.value.length, 'end');
    }
  } finally {
    insertingFormattedPaste = false;
  }
  onEditorChanged({ immediate: true });
});
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

// ---------- 每个页签独立的分割线 ----------
const split = document.getElementById('split');
const splitter = document.getElementById('splitter');
const DEFAULT_SPLIT = 40;
let splitRatio = DEFAULT_SPLIT;
let draggingTabId = null;

function setSplitRatio(value) {
  splitRatio = Number.isFinite(value) ? Math.round(Math.min(80, Math.max(20, value)) * 100) / 100 : DEFAULT_SPLIT;
  split.style.setProperty('--editor-width', splitRatio + '%');
  splitter.setAttribute('aria-valuenow', String(splitRatio));
}

function changeSplit(value, save = true) {
  const tab = currentTab();
  if (!tab) return;
  setSplitRatio(value);
  tab.splitRatio = splitRatio;
  scheduleFitTables();
  renderGutter();
  if (save) saveTabs();
}

const stackedSplit = () => getComputedStyle(splitter).cursor === 'row-resize';
const updateSplitOrientation = () => splitter.setAttribute('aria-orientation', stackedSplit() ? 'horizontal' : 'vertical');
splitter.addEventListener('mousedown', event => {
  if (event.button !== 0 || !currentTab()) return;
  draggingTabId = state.activeId;
  splitter.classList.add('dragging');
  document.body.classList.add('resizing');
  event.preventDefault();
});
window.addEventListener('mousemove', event => {
  if (!draggingTabId || draggingTabId !== state.activeId) return;
  const rect = split.getBoundingClientRect();
  const ratio = stackedSplit() ? (event.clientY - rect.top) / rect.height : (event.clientX - rect.left) / rect.width;
  changeSplit(ratio * 100, false);
});
function endSplitDrag() {
  if (!draggingTabId) return;
  draggingTabId = null;
  splitter.classList.remove('dragging');
  document.body.classList.remove('resizing');
  saveTabs();
}
window.addEventListener('mouseup', endSplitDrag);
window.addEventListener('blur', endSplitDrag);
splitter.addEventListener('dblclick', () => changeSplit(DEFAULT_SPLIT));
splitter.addEventListener('keydown', event => {
  const [decrease, increase] = stackedSplit() ? ['ArrowUp', 'ArrowDown'] : ['ArrowLeft', 'ArrowRight'];
  if (![decrease, increase, 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  if (event.key === 'Home' || event.key === 'End') changeSplit(event.key === 'Home' ? 20 : 80);
  else changeSplit(splitRatio + (event.key === decrease ? -2 : 2));
});
updateSplitOrientation();

if (window.ResizeObserver) {
  new ResizeObserver(() => scheduleFitTables()).observe(gridHost);
}
window.addEventListener('resize', () => {
  updateSplitOrientation();
  renderGutter();
  scheduleFitTables();
});

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

// ---------- 启动 ----------
(async function start() {
  statusEl.textContent = '正在恢复文档…'; hostAdapter = await createHostAdapter(toast);
  const clearStorage = hostAdapter.clear.bind(hostAdapter);
  hostAdapter.clear = async () => {
    automaticSaveEnabled = false; clearTimeout(saveTimer); pendingSave = null; await saving?.catch(() => {});
    try { await clearStorage(); } catch (error) { automaticSaveEnabled = true; throw error; }
  };
  applyTheme(hostAdapter.get('cc-toolbox-theme') === 'dark' ? 'dark' : 'light');
  const legacySplit = Number.parseFloat(hostAdapter.get('cc-toolbox-split', String(DEFAULT_SPLIT)));
  wrapEnabled = hostAdapter.get('cc-toolbox-wrap') !== 'off'; applyWrap();
  const stored = await hostAdapter.loadTabs();
  if (stored && Array.isArray(stored.tabs) && stored.tabs.length) {
    const used = new Set();
    state.tabs = stored.tabs.map((tab, i) => {
      const id = typeof tab.id === 'string' && /^tab-[a-zA-Z0-9-]+$/.test(tab.id) && !used.has(tab.id) ? tab.id : 'tab-restored-' + i; used.add(id);
      const ratio = Number.isFinite(tab.splitRatio) ? tab.splitRatio : legacySplit;
      return { ...tab, id, title: String(tab.title || '解析 ' + (i + 1)).slice(0,30), text: typeof tab.text === 'string' ? tab.text : '', splitRatio: ratio, revision: 0 };
    }); state.activeId = state.tabs.some(t => t.id === stored.activeId) ? stored.activeId : state.tabs[0].id;
  } else { state.tabs = [{ id:'tab-1', title:'解析 1', text:JSON.stringify(SAMPLE,null,2), splitRatio: legacySplit, revision:0 }]; state.activeId = 'tab-1'; }
  activateTab(state.activeId, { saveCurrent:false }); editor.readOnly = false; startupButtons.forEach(button => { button.disabled = false; }); window.__ccToast = toast;
  const zoom = Number(hostAdapter.get('cc-toolbox-zoom', '1'));
  if (zoom >= .85 && zoom <= 1.35) document.body.style.zoom = String(Math.round(zoom * 100) / 100);
  const preferences = createPreferences(hostAdapter.bridge);
  const shell = createToolShell({
    sidebar: document.getElementById('sidebar'), main: document.querySelector('.main'),
    title: document.getElementById('tool-title'), actions: document.getElementById('actions'),
    context: { toast, settings: hostAdapter, preferences, bridge: hostAdapter.bridge,
      host: createToolHost(hostAdapter.bridge), saveFile: hostAdapter.saveFile },
  });
  const close = async () => {
    saveActiveState();
    await Promise.all([flushSession(), shell.dispose(), preferences.flush()]);
    await hostAdapter.flush();
  };
  window.addEventListener('pagehide', () => { void close().catch(() => {}); });
  hostAdapter.bridge?.workbench?.onClose(close);
  await initBridge();
})().catch(error => toast('JSON 工作台启动失败：' + error.message, 'error'));
