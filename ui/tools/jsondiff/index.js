import { parseDocument, serializeNode, MAX_TEXT } from '../../js/json-document.js';
import { escapeHtml } from '../../js/json-grid.js';
import { compareJson, compareLines } from './compare.js';
import template from './template.js';

const displayLimit = 2000;
const empty = message => '<div class="tool-empty">' + escapeHtml(message) + '</div>';

function previewValue(node) {
  if (!node) return '';
  const text = serializeNode(node);
  return escapeHtml(text.length > 300 ? text.slice(0, 300) + '…' : text);
}

export default function mount({ toast }, panel) {
  panel.innerHTML = template;
  const get = name => panel.querySelector('#diff-' + name);
  const left = get('left'), right = get('right'), result = get('result'), hint = get('hint');
  const mode = get('mode'), changedOnly = get('changed-only');
  const revisions = { left: 0, right: 0 };
  let lastLines = null;

  function invalidate() {
    hint.textContent = '内容已更新，等待比对';
    result.innerHTML = empty('点击「开始比对」或按 Ctrl+Enter');
    lastLines = null;
  }
  function parse(value, side) {
    const doc = parseDocument(value);
    if (!doc.ok) throw new Error(side + ' JSON 第 ' + doc.error.line + ' 行：' + doc.error.message);
    return doc;
  }
  function showLines(rows) {
    const added = rows.filter(row => row.type === 'add').length;
    const removed = rows.filter(row => row.type === 'del').length;
    hint.textContent = '新增 ' + added + ' 行 / 删除 ' + removed + ' 行';
    const visible = changedOnly.checked ? rows.filter(row => row.type !== 'same') : rows;
    result.innerHTML = '<div class="diff-summary">' + escapeHtml(hint.textContent) + '</div>' +
      (visible.length ? visible.slice(0, displayLimit).map(row => {
        const marker = row.type === 'add' ? '+ ' : row.type === 'del' ? '− ' : '  ';
        const text = row.text.length > 1000 ? row.text.slice(0, 1000) + '…' : row.text;
        return '<div class="diff-row diff-' + row.type + '"><span class="ln">' +
          (row.left ?? '–') + ' / ' + (row.right ?? '–') + '</span><span>' + escapeHtml(marker + text) + '</span></div>';
      }).join('') : empty('两侧文本一致')) +
      (visible.length > displayLimit ? empty('仅显示前 ' + displayLimit + ' 行结果') : '');
  }
  function render() {
    invalidate();
    changedOnly.disabled = mode.value !== 'text';
    try {
      if (!left.value.trim() && !right.value.trim()) throw new Error('请先输入或导入待比对内容');
      if (mode.value === 'text') {
        lastLines = compareLines(left.value, right.value);
        if (!lastLines) throw new Error('文本差异范围过大，请缩小范围或使用结构比对');
        showLines(lastLines);
        return;
      }
      const { changes, limited } = compareJson(parse(left.value, '左侧'), parse(right.value, '右侧'));
      const added = changes.filter(item => item.type === 'added').length;
      const removed = changes.filter(item => item.type === 'removed').length;
      const changed = changes.length - added - removed;
      hint.textContent = '结构差异：新增 ' + added + ' · 删除 ' + removed + ' · 修改 ' + changed + (limited ? ' · 未全部统计' : '');
      result.innerHTML = '<div class="diff-summary">' + escapeHtml(hint.textContent) + '</div>' +
        (changes.length ? changes.slice(0, displayLimit).map(item => {
          const type = item.type === 'added' ? 'add' : item.type === 'removed' ? 'del' : 'changed';
          const before = previewValue(item.before), after = previewValue(item.after);
          const description = type === 'add' ? '+ ' + after : type === 'del' ? '− ' + before : before + ' → ' + after;
          return '<div class="diff-row diff-' + type + '"><span class="ln">' +
            escapeHtml(item.path || '(根)') + '</span><span>' + description + '</span></div>';
        }).join('') : empty('两侧结构一致')) +
        (changes.length > displayLimit ? empty('仅显示前 ' + displayLimit + ' 条差异') : '');
    } catch (error) {
      hint.textContent = error.message;
      result.innerHTML = empty(error.message);
      toast(error.message, 'error');
    }
  }

  for (const side of ['left', 'right']) {
    const editor = get(side);
    editor.addEventListener('input', () => { revisions[side]++; invalidate(); });
    editor.addEventListener('keydown', event => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); render(); }
    });
    const input = get('file-' + side);
    input.addEventListener('change', async () => {
      const file = input.files[0];
      input.value = '';
      if (!file) return;
      const request = ++revisions[side];
      try {
        if (file.size > MAX_TEXT) throw new Error('文件超过 20 MiB，请先缩小范围');
        const content = await file.text();
        if (request !== revisions[side]) return;
        editor.value = content;
        invalidate();
        if (left.value.trim() && right.value.trim()) render();
        else hint.textContent = '已导入 ' + file.name + '，请选择另一侧内容';
      } catch (error) {
        if (request === revisions[side]) toast('导入失败：' + error.message, 'error');
      }
    });
  }
  function setBoth(a, b) {
    revisions.left++;
    revisions.right++;
    left.value = a;
    right.value = b;
    render();
  }
  get('run').addEventListener('click', render);
  mode.addEventListener('change', render);
  changedOnly.addEventListener('change', () => { if (lastLines) showLines(lastLines); });
  get('swap').addEventListener('click', () => setBoth(right.value, left.value));
  get('format').addEventListener('click', () => {
    try {
      const format = (value, side) => value.trim() ? serializeNode(parse(value, side).root, true) : '';
      const a = format(left.value, '左侧'), b = format(right.value, '右侧');
      if (a.length > MAX_TEXT || b.length > MAX_TEXT) throw new Error('格式化结果超过大小限制');
      setBoth(a, b);
    } catch (error) { toast(error.message, 'error'); }
  });
  get('sample').addEventListener('click', () => setBoth(
    JSON.stringify({ id: 1, name: 'demo', tags: ['a', 'b'], score: 60, extra: { keep: true } }, null, 2),
    JSON.stringify({ id: 1, name: 'demo', tags: ['a', 'c'], score: 80 }, null, 2)));
}
