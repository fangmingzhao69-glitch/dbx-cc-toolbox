import { escapeHtml } from '../../js/json-grid.js';

import template from './template.js';

function diffLines(a, b) {
  const left = a.split('\n');
  const right = b.split('\n');
  const n = left.length;
  const m = right.length;
  if (n * m > 4_000_000) return [{ type: 'same', text: '（内容过大，仅显示部分差异）', ln: 0 }];
  const dir = new Uint8Array((n + 1) * (m + 1));
  const width = m + 1;
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      const index = i * width + j;
      if (left[i] === right[j]) dir[index] = 0;
      else if (dir[(i + 1) * width + j] >= dir[i * width + j + 1]) dir[index] = 1;
      else dir[index] = 2;
    }
  }
  const rows = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (left[i] === right[j]) { rows.push({ type: 'same', text: left[i], ln: i + 1 }); i += 1; j += 1; }
    else if (dir[i * width + j] === 1) { rows.push({ type: 'del', text: left[i], ln: i + 1 }); i += 1; }
    else { rows.push({ type: 'add', text: right[j], ln: j + 1 }); j += 1; }
  }
  while (i < n) { rows.push({ type: 'del', text: left[i], ln: i + 1 }); i += 1; }
  while (j < m) { rows.push({ type: 'add', text: right[j], ln: j + 1 }); j += 1; }
  return rows;
}

function normalizeJsonText(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) return { text: '', valid: true };
  try { return { text: JSON.stringify(JSON.parse(trimmed), null, 2), valid: true }; }
  catch (error) { return { text: text.replace(/\r\n/g, '\n'), valid: false }; }
}

function treeDiff(a, b, path, out, depth = 0) {
  if (depth > 24 || out.length > 5000) return;
  const kind = (value) => value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
  const ka = kind(a);
  const kb = kind(b);
  if (ka !== kb) { out.push({ path, type: 'changed', old: a, new: b }); return; }
  if (ka === 'object') {
    const keys = Array.from(new Set(Object.keys(a).concat(Object.keys(b))));
    for (const key of keys) {
      const next = path ? path + '.' + key : key;
      if (!(key in a)) out.push({ path: next, type: 'added', old: undefined, new: b[key] });
      else if (!(key in b)) out.push({ path: next, type: 'removed', old: a[key], new: undefined });
      else treeDiff(a[key], b[key], next, out, depth + 1);
    }
    return;
  }
  if (ka === 'array') {
    const length = Math.max(a.length, b.length);
    for (let index = 0; index < length; index += 1) {
      const next = path + '[' + index + ']';
      if (index >= a.length) out.push({ path: next, type: 'added', old: undefined, new: b[index] });
      else if (index >= b.length) out.push({ path: next, type: 'removed', old: a[index], new: undefined });
      else treeDiff(a[index], b[index], next, out, depth + 1);
    }
    return;
  }
  if (a !== b) out.push({ path, type: 'changed', old: a, new: b });
}

function formatTreeValue(value) {
  if (value === undefined) return '';
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return escapeHtml(String(text).length > 300 ? String(text).slice(0, 300) + '…' : String(text));
}

function initJsonDiff(panel, notify) {
  const get = id => panel.querySelector('#' + id);
  const left = get('diff-left');
  const right = get('diff-right');
  const result = get('diff-result');
  const hint = get('diff-hint');
  const mode = get('diff-mode');
  if (!left || !right || !result) return;

  const renderTree = () => {
    let a;
    let b;
    try { a = JSON.parse(left.value); } catch (error) { notify('左侧 JSON 不合法：' + error.message, 'error'); return; }
    try { b = JSON.parse(right.value); } catch (error) { notify('右侧 JSON 不合法：' + error.message, 'error'); return; }
    const diffs = [];
    treeDiff(a, b, '', diffs);
    const added = diffs.filter((item) => item.type === 'added').length;
    const removed = diffs.filter((item) => item.type === 'removed').length;
    const changed = diffs.filter((item) => item.type === 'changed').length;
    if (hint) hint.textContent = '结构差异：新增 ' + added + ' · 删除 ' + removed + ' · 修改 ' + changed;
    result.innerHTML = '<div class="diff-summary">新增 ' + added + ' 个节点，删除 ' + removed + ' 个节点，修改 ' + changed + ' 个节点</div>' +
      diffs.map((item) => '<div class="diff-row diff-' + (item.type === 'added' ? 'add' : item.type === 'removed' ? 'del' : 'changed') + '">' +
        '<span class="ln">' + escapeHtml(item.path || '(根)') + '</span><span>' +
        (item.type === 'added' ? '+ ' + formatTreeValue(item.new)
          : item.type === 'removed' ? '- ' + formatTreeValue(item.old)
          : escapeHtml(String(item.old)) + '  →  ' + formatTreeValue(item.new)) + '</span></div>').join('') ||
      '<div class="tool-empty">两侧 JSON 结构完全一致</div>';
    notify('结构比对完成：' + (added + removed + changed) + ' 处差异', added + removed + changed ? 'ok' : 'info');
  };

  const renderText = () => {
    const a = normalizeJsonText(left.value);
    const b = normalizeJsonText(right.value);
    const rows = diffLines(a.text, b.text);
    const added = rows.filter((row) => row.type === 'add').length;
    const removed = rows.filter((row) => row.type === 'del').length;
    if (hint) hint.textContent = (a.valid && b.valid ? 'JSON 合法 · ' : '') + '新增 ' + added + ' 行 / 删除 ' + removed + ' 行';
    result.innerHTML = '<div class="diff-summary">共 ' + rows.length + ' 行，新增 ' + added + ' 行，删除 ' + removed + ' 行</div>' +
      rows.map((row) => '<div class="diff-row diff-' + row.type + '"><span class="ln">' + row.ln + '</span><span>' +
        escapeHtml((row.type === 'add' ? '+ ' : row.type === 'del' ? '- ' : '  ') + row.text) + '</span></div>').join('');
    notify('比对完成：新增 ' + added + ' 行，删除 ' + removed + ' 行', added || removed ? 'ok' : 'info');
  };

  const render = () => {
    if (mode && mode.value === 'text') renderText();
    else if (!left.value.trim() && !right.value.trim()) notify('请先输入或导入两侧 JSON', 'error');
    else renderTree();
  };

  const bindFile = (inputId, textarea) => {
    get(inputId)?.addEventListener('change', async () => {
      const input = get(inputId);
      const file = input.files && input.files[0];
      if (!file) return;
      textarea.value = await file.text();
      notify('已导入 ' + file.name, 'ok');
      render();
    });
  };
  bindFile('diff-file-left', left);
  bindFile('diff-file-right', right);

  get('diff-run')?.addEventListener('click', render);
  mode?.addEventListener('change', render);
  get('diff-swap')?.addEventListener('click', () => {
    const temp = left.value; left.value = right.value; right.value = temp; render();
  });
  get('diff-format')?.addEventListener('click', () => {
    const a = normalizeJsonText(left.value);
    const b = normalizeJsonText(right.value);
    if (!a.valid || !b.valid) { notify('存在非法 JSON，无法格式化', 'error'); return; }
    left.value = a.text; right.value = b.text; render();
  });
  get('diff-sample')?.addEventListener('click', () => {
    left.value = JSON.stringify({ id: 1, name: 'demo', tags: ['a', 'b'], score: 60, extra: { keep: true } }, null, 2);
    right.value = JSON.stringify({ id: 1, name: 'demo', tags: ['a', 'c'], score: 80 }, null, 2);
    render();
  });
}

export default function mount(ctx, panel) {
  panel.innerHTML = template;
  return initJsonDiff(panel, ctx.toast);
}
