import template from './template.js';
import { parseXmlDocument, formatXml } from './xml-parser.js';
import { rowsToCsvText } from '../../shared/csv.js';

const SAMPLE = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<orders total="2">',
  '  <order id="1001" status="paid"><amount currency="CNY">128.50</amount></order>',
  '  <order id="1002" status="pending"><amount currency="CNY">99.00</amount></order>',
  '</orders>',
].join('\n');
const BRANCH_PAGE = 100;
const EXPANSION_BUDGET = 500;

function exportRows(root) {
  const rows = [['path', 'kind', 'name', 'value']];
  function walk(node, parent) {
    const path = parent + '/' + (node.name || node.kind);
    if (node.kind === 'element') {
      for (const attr of node.attrs) rows.push([path + '/@' + attr.name, 'attr', attr.name, attr.value]);
    } else rows.push([path, node.kind, node.name || '', node.text]);
    for (const child of node.children ?? []) walk(child, path);
  }
  walk(root, '');
  return rowsToCsvText(rows);
}

export default function mount({ toast, saveFile }, panel) {
  panel.innerHTML = template;
  const get = id => panel.querySelector('#xml-' + id);
  const editor = get('editor');
  const tree = get('tree');
  const hint = get('hint');
  const editorHint = get('editor-hint');
  const treeHint = get('tree-hint');
  let timer;
  let cachedSource;
  let parsed;

  function element(tag, className, text) {
    const node = panel.ownerDocument.createElement(tag);
    node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function parseCurrent() {
    if (editor.value !== cachedSource) {
      cachedSource = editor.value;
      parsed = parseXmlDocument(cachedSource);
    }
    return parsed;
  }

  function renderNode(node, parent, depth, expandBudget) {
    const row = element('div', 'xml-row');
    row.style.paddingInlineStart = Math.min(depth * 16, 400) + 'px';
    const children = node.children ?? [];
    const toggle = element('button', 'xml-toggle', children.length ? '▸' : '·');
    toggle.type = 'button';
    toggle.disabled = !children.length;
    toggle.setAttribute('aria-label', '展开 ' + (node.name || '节点'));
    if (children.length) toggle.setAttribute('aria-expanded', 'false');
    row.appendChild(toggle);
    if (node.kind === 'element') {
      row.appendChild(element('span', 'xml-tag', node.name));
      for (const attr of node.attrs) {
        const value = attr.name + '=' + JSON.stringify(attr.value);
        const chip = element('span', 'xml-attr', value.slice(0, 90));
        chip.title = value;
        row.appendChild(chip);
      }
    } else row.appendChild(element('span', 'xml-kind', node.name || node.kind));
    if (node.text) row.appendChild(element('span', 'xml-text', node.text.slice(0, 100)));
    row.addEventListener('click', () => {
      if (editor.value !== cachedSource) return;
      editor.focus();
      editor.setSelectionRange(node.from, node.to);
    });
    parent.appendChild(row);
    if (!children.length) return;

    const box = element('div', 'xml-children');
    const more = element('button', 'xml-more', '显示更多节点');
    more.type = 'button';
    more.style.marginInlineStart = Math.min((depth + 1) * 16, 400) + 'px';
    box.hidden = true;
    let offset = 0;
    function addChildren(budget) {
      more.remove();
      const end = Math.min(offset + BRANCH_PAGE, children.length);
      while (offset < end && (!budget || budget.remaining > 0)) {
        if (budget) budget.remaining--;
        renderNode(children[offset++], box, depth + 1, budget);
      }
      if (offset < children.length) {
        more.textContent = '显示更多节点（' + offset + ' / ' + children.length + '）';
        box.appendChild(more);
      }
    }
    function open(budget) {
      box.hidden = false;
      toggle.textContent = '▾';
      toggle.setAttribute('aria-expanded', 'true');
      toggle.setAttribute('aria-label', '折叠 ' + node.name);
      if (!offset) addChildren(budget);
    }
    more.addEventListener('click', () => addChildren());
    toggle.addEventListener('click', event => {
      event.stopPropagation();
      if (box.hidden) open();
      else {
        box.hidden = true;
        toggle.textContent = '▸';
        toggle.setAttribute('aria-expanded', 'false');
        toggle.setAttribute('aria-label', '展开 ' + node.name);
      }
    });
    parent.appendChild(box);
    if (depth === 0 || (expandBudget && expandBudget.remaining > 0)) open(expandBudget);
  }

  function refresh(expandAll = false) {
    clearTimeout(timer);
    if (!editor.value.trim()) {
      tree.replaceChildren(element('div', 'tool-empty', '粘贴 XML 后在这里显示节点树'));
      editorHint.textContent = treeHint.textContent = '';
      hint.textContent = '等待 XML';
      return;
    }
    const result = parseCurrent();
    if (!result.ok) {
      const { line, column, message } = result.error;
      tree.replaceChildren(element('div', 'xml-error', '第 ' + line + ' 行第 ' + column + ' 列：' + message));
      hint.textContent = '解析失败';
      treeHint.textContent = '第 ' + line + ' 行第 ' + column + ' 列';
      editorHint.textContent = '语法错误';
      return;
    }
    tree.replaceChildren();
    const budget = expandAll ? { remaining: EXPANSION_BUDGET } : null;
    renderNode(result.root, tree, 0, budget);
    hint.textContent = '解析成功 · ' + result.nodeCount + ' 个节点';
    if (expandAll && (budget.remaining === 0 || tree.querySelector('.xml-more')))
      hint.textContent += ' · 可按分支继续加载';
    treeHint.textContent = result.nodeCount + ' 个节点';
    editorHint.textContent = result.root.name;
  }

  editor.addEventListener('input', () => {
    clearTimeout(timer);
    hint.textContent = '待解析';
    timer = setTimeout(refresh, 180);
  });
  get('sample').addEventListener('click', () => { editor.value = SAMPLE; refresh(); });
  get('format').addEventListener('click', () => {
    const result = parseCurrent();
    if (!result.ok) { refresh(); toast('请先修正 XML 语法', 'error'); return; }
    editor.value = formatXml(result.root);
    refresh();
  });
  get('validate').addEventListener('click', () => {
    const result = parseCurrent();
    if (!result.ok) refresh();
    toast(result.ok ? 'XML 合法 · ' + result.nodeCount + ' 个节点' : '第 ' + result.error.line + ' 行：' + result.error.message,
      result.ok ? 'ok' : 'error');
  });
  get('expand').addEventListener('click', () => refresh(true));
  get('collapse').addEventListener('click', () => refresh());
  get('clear').addEventListener('click', () => { editor.value = ''; refresh(); });
  get('export').addEventListener('click', async () => {
    const result = parseCurrent();
    if (!result.ok) { refresh(); toast('没有可导出的 XML', 'error'); return; }
    try {
      const saved = await saveFile('xml-nodes.csv', 'text/csv;charset=utf-8', '\uFEFF' + exportRows(result.root));
      toast(saved ? '已导出 CSV' : '已取消导出', saved ? 'ok' : 'info');
    } catch (error) { toast('导出失败：' + error.message, 'error'); }
  });
  refresh();
  return { dispose() { clearTimeout(timer); } };
}
