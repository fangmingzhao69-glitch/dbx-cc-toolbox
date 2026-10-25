import {
  escapeHtml, formatBytes, parseJsonDocument, renderRoot, summarize, toCsv,
} from './json-grid.js';

const editor = document.getElementById('editor');
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
};

function toast(message, kind = 'info') {
  statusEl.textContent = message;
  statusEl.className = kind === 'error' ? 'error' : kind === 'ok' ? 'ok' : '';
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { statusEl.textContent = '就绪'; statusEl.className = ''; }, 4200);
}

function updateGutter() {
  const lines = editor.value.split('\n').length;
  if (gutter.dataset.lines === String(lines)) return;
  gutter.dataset.lines = String(lines);
  let text = '';
  for (let i = 1; i <= lines; i += 1) text += i + '\n';
  gutter.textContent = text;
}

function syncScroll() {
  gutter.scrollTop = editor.scrollTop;
}

function setStats() {
  const text = editor.value;
  const summary = state.parser && state.parser.ok ? summarize(state.parser.data) : null;
  const kindText = summary ? (summary.kind === 'array' ? '数组 ' + summary.count + ' 项' : summary.kind === 'object' ? '对象 ' + summary.count + ' 个字段' : summary.kind) : '未解析';
  const lines = text ? text.split('\n').length : 0;
  const chars = text.length;
  statsEl.textContent = kindText + ' · ' + lines + ' 行 · ' + chars + ' 字符 · ' + formatBytes(new Blob([text]).size);
}

function setHint(ok, message) {
  editorHint.textContent = message;
  editorHint.className = 'hint ' + (ok ? 'ok' : 'error');
}

function renderGrid() {
  const data = state.filtered !== null ? state.filtered : (state.parser && state.parser.ok ? state.parser.data : null);
  if (state.parser && !state.parser.ok && state.filtered === null) {
    gridHost.innerHTML = '<div class="grid-error">JSON 解析失败<br><span>' + escapeHtml(state.parser.error.message) +
      (state.parser.error.line ? '（第 ' + state.parser.error.line + ' 行，第 ' + state.parser.error.column + ' 列）' : '') + '</span></div>';
    gridHint.textContent = '解析失败';
    return;
  }
  if (!data) {
    gridHost.innerHTML = '<div class="grid-empty">粘贴或输入 JSON 后，这里会显示表格视图</div>';
    gridHint.textContent = '等待数据';
    return;
  }
  gridHost.innerHTML = renderRoot(data);
  const rows = gridHost.querySelectorAll('table.jgrid > tbody > tr.row').length;
  gridHint.textContent = '表格已生成';
  if (state.filtered !== null) gridHint.textContent += '（筛选后）';
  gridHost.dataset.rootRows = String(rows);
}

function parseAndRender({ silent = false } = {}) {
  state.text = editor.value;
  state.parser = parseJsonDocument(editor.value);
  if (!state.parser.ok) {
    setHint(false, '解析失败');
    renderGrid();
    setStats();
    return false;
  }
  state.filtered = null;
  setHint(true, 'JSON 合法');
  renderGrid();
  setStats();
  if (!silent) toast('解析成功', 'ok');
  persist();
  return true;
}

function persist() {
  try { localStorage.setItem('cc-toolbox-json-text', editor.value.slice(0, 2_000_000)); } catch (error) { /* 忽略存储失败 */ }
}

function setEditorText(text, { parse = true } = {}) {
  editor.value = text;
  updateGutter();
  if (parse) parseAndRender({ silent: true });
}

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
      setEditorText(JSON.stringify(parsed.data, null, 2));
      toast('已格式化', 'ok');
      break;
    }
    case 'minify': {
      const parsed = parseJsonDocument(editor.value);
      if (!parsed.ok) { toast('JSON 不合法，无法压缩：' + parsed.error.message, 'error'); return; }
      setEditorText(JSON.stringify(parsed.data));
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
  state.filtered = null;
  if (state.parser && state.parser.ok) { renderGrid(); toast('已还原原始数据', 'ok'); }
});
document.getElementById('filter-apply').addEventListener('click', () => {
  if (!state.parser || !state.parser.ok) { toast('请先输入合法 JSON', 'error'); return; }
  try {
    const fn = new Function('data', '_', filterCode.value);
    const cloned = JSON.parse(JSON.stringify(state.parser.data));
    const result = fn(cloned, window._);
    if (result === undefined) throw new Error('筛选函数需要 return 一个结果');
    state.filtered = result;
    renderGrid();
    toast('筛选已应用', 'ok');
  } catch (error) {
    toast('筛选失败：' + (error && error.message ? error.message : error), 'error');
  }
});

// ---------- 导出 ----------
function exportCsv() {
  const data = state.filtered !== null ? state.filtered : (state.parser && state.parser.ok ? state.parser.data : null);
  if (!data) { toast('没有可导出的数据', 'error'); return; }
  try {
    const csv = toCsv(data);
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'cc-toolbox-export-' + new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-') + '.csv';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    toast('已导出 CSV', 'ok');
  } catch (error) {
    toast('导出失败：' + (error && error.message ? error.message : error), 'error');
  }
}

// ---------- 主题 ----------
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  try { localStorage.setItem('cc-toolbox-theme', theme); } catch (error) { /* 忽略 */ }
}
function toggleTheme() {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  toast(next === 'dark' ? '深色主题' : '淡绿主题', 'ok');
}

// ---------- 表格交互 ----------
gridHost.addEventListener('click', (event) => {
  const toggle = event.target.closest('.tgl');
  if (!toggle) return;
  const targetId = toggle.dataset.target;
  const box = targetId ? document.getElementById(targetId) : null;
  if (!box) return;
  const expanded = toggle.getAttribute('aria-expanded') === 'true';
  toggle.setAttribute('aria-expanded', expanded ? 'false' : 'true');
  toggle.textContent = expanded ? '+' : '−';
  box.hidden = expanded;
});

// ---------- 编辑器事件 ----------
editor.addEventListener('input', () => {
  updateGutter();
  setStats();
  clearTimeout(editor._timer);
  editor._timer = setTimeout(() => parseAndRender({ silent: true }), 260);
});
editor.addEventListener('scroll', syncScroll);
editor.addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); parseAndRender(); }
  if (event.key === 'Tab') {
    event.preventDefault();
    const start = editor.selectionStart;
    const end = editor.selectionEnd;
    editor.setRangeText('  ', start, end, 'end');
  }
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
    if (fromContext) {
      setEditorText(JSON.stringify(fromContext, null, 2));
      toast('已从 DBX 上下文载入 JSON', 'ok');
      return;
    }
    if (window.dbxPlugin.onContext) {
      window.dbxPlugin.onContext((next) => {
        const data = extractJsonFromContext(next);
        if (data) setEditorText(JSON.stringify(data, null, 2));
      });
    }
  } catch (error) {
    // 非 DBX 环境（浏览器直接打开）忽略
  }
}

function extractJsonFromContext(context) {
  if (!context || typeof context !== 'object') return null;
  if (Array.isArray(context)) return context;
  const candidates = ['json', 'data', 'rows', 'result', 'text', 'payload'];
  for (const key of candidates) {
    const value = context[key];
    if (value === undefined || value === null) continue;
    if (typeof value === 'string') {
      const parsed = parseJsonDocument(value);
      if (parsed.ok) return parsed.data;
      continue;
    }
    if (typeof value === 'object') return value;
  }
  return null;
}

// ---------- 启动 ----------
(function start() {
  let saved = null;
  try { saved = localStorage.getItem('cc-toolbox-json-text'); } catch (error) { /* 忽略 */ }
  const savedTheme = (() => { try { return localStorage.getItem('cc-toolbox-theme'); } catch (error) { return null; } })();
  applyTheme(savedTheme === 'dark' ? 'dark' : 'light');
  setEditorText(saved && saved.trim() ? saved : JSON.stringify(SAMPLE, null, 2), { parse: false });
  updateGutter();
  parseAndRender({ silent: true });
  initBridge();
})();
