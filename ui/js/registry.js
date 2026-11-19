import mountXml from '../tools/xml/index.js';
import mountCsvViewer from '../tools/csvviewer/index.js';
import mountJsonDiff from '../tools/jsondiff/index.js';
import mountCsvCompare from '../tools/csvcompare/index.js';
import mountHome from '../tools/home/index.js';
import mountImport from '../tools/import/index.js';
import mountQuickSheet from '../tools/quicksheet/index.js';
import mountValidation from '../tools/validation/index.js';
import mountDrawboard from '../tools/drawboard/index.js';
import mountInvoice from '../tools/invoice/index.js';
import mountSettings from '../tools/settings/index.js';

export const toolGroups = [
  { label: '数据解析', tools: [
    { id: 'json', title: 'JSON 数据解析', actions: true },
    { id: 'xml', title: 'XML 数据解析', mount: mountXml },
    { id: 'csvviewer', title: 'CSV 文件预览', mount: mountCsvViewer },
  ] },
  { label: '比对', tools: [
    { id: 'jsondiff', title: 'JSON 内容比对', mount: mountJsonDiff },
    { id: 'csvcompare', title: 'CSV 内容比对', mount: mountCsvCompare },
  ] },
  { label: '数据处理', tools: [
    { id: 'home', title: '首页数据概览', mount: mountHome },
    { id: 'import', title: '临时数据建表', mount: mountImport },
    { id: 'quicksheet', title: '快速建数据表', mount: mountQuickSheet },
    { id: 'validation', title: '数据验证排查', mount: mountValidation },
  ] },
  { label: '辅助工具', tools: [
    { id: 'drawboard', title: '在线绘图工具', mount: mountDrawboard },
    { id: 'invoice', title: '发票打印操作', mount: mountInvoice },
  ] },
  { label: '系统', tools: [{ id: 'settings', title: '系统参数配置', mount: mountSettings }] },
];

export function createToolShell({ sidebar, main, title, actions, context, groups = toolGroups }) {
  const tools = new Map();
  const listeners = new AbortController();
  const doc = main.ownerDocument;
  let active;
  let disposing;
  const ctx = { ...context, showTool };

  for (const group of groups) {
    const heading = doc.createElement('div');
    heading.className = 'side-group';
    heading.textContent = group.label;
    sidebar.appendChild(heading);
    for (const tool of group.tools) {
      if (tools.has(tool.id)) throw new Error('重复的工具 ID：' + tool.id);
      const button = doc.createElement('button');
      button.type = 'button';
      button.className = 'side-item';
      button.dataset.tool = tool.id;
      button.textContent = tool.title;
      button.setAttribute('aria-controls', 'tool-' + tool.id);
      sidebar.appendChild(button);

      let panel = main.querySelector('#tool-' + tool.id);
      if (!panel) {
        panel = doc.createElement('section');
        panel.id = 'tool-' + tool.id;
        panel.className = 'tool-pane';
        panel.hidden = true;
        main.appendChild(panel);
      }
      tools.set(tool.id, { tool, button, panel, instance: tool.mount ? null : {} });
    }
  }

  function mountError(record, error) {
    const container = doc.createElement('div');
    container.className = 'tool-empty';
    const message = doc.createElement('p');
    message.textContent = record.tool.title + '加载失败：' + error.message;
    const retry = doc.createElement('button');
    retry.type = 'button';
    retry.textContent = '重试';
    retry.addEventListener('click', () => { if (!disposing && active === record) mount(record); }, { once: true });
    container.append(message, retry);
    record.panel.replaceChildren(container);
    ctx.toast(message.textContent, 'error');
  }

  function mount(record) {
    try {
      record.panel.replaceChildren();
      record.instance = record.tool.mount(ctx, record.panel) ?? {};
    } catch (error) {
      mountError(record, error);
      return;
    }
    invokeLifecycle(record, 'show');
  }

  function invokeLifecycle(record, hook) {
    try { record?.instance?.[hook]?.(); }
    catch (error) { ctx.toast(record.tool.title + '：' + error.message, 'error'); }
  }

  function showTool(id) {
    const next = tools.get(id);
    if (disposing || !next || active === next) return;
    invokeLifecycle(active, 'hide');
    active = next;
    for (const record of tools.values()) {
      const selected = record === active;
      record.panel.hidden = !selected;
      record.panel.classList.toggle('active', selected);
      record.button.classList.toggle('active', selected);
      if (selected) record.button.setAttribute('aria-current', 'true');
      else record.button.removeAttribute('aria-current');
    }
    title.textContent = next.tool.title;
    actions.hidden = !next.tool.actions;
    ctx.settings.set('cc-toolbox-tool', id);
    if (next.instance) invokeLifecycle(next, 'show');
    else mount(next);
  }

  sidebar.addEventListener('click', event => {
    const button = event.target.closest('.side-item');
    if (button) showTool(button.dataset.tool);
  }, { signal: listeners.signal });
  const saved = ctx.settings.get('cc-toolbox-tool');
  showTool(tools.has(saved) ? saved : tools.keys().next().value);

  return {
    dispose() {
      if (disposing) return disposing;
      listeners.abort();
      disposing = Promise.resolve().then(() => Promise.all([...tools.values()].map(async record => {
        try { await record.instance?.dispose?.(); }
        catch (error) { ctx.toast(record.tool.title + '关闭失败：' + error.message, 'error'); }
      })));
      return disposing;
    },
  };
}
