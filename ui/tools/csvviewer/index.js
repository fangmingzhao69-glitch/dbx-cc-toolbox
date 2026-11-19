import { escapeHtml } from '../../js/json-grid.js';
import { parseCsv } from '../../shared/csv.js';

import template from './template.js';

function initCsvViewer(panel, notify) {
  const get = id => panel.querySelector('#' + id);
  const input = get('csv-file');
  const tableHost = get('csv-table');
  const info = get('csv-info');
  if (!input || !tableHost) return;

  input.addEventListener('change', async () => {
    const file = input.files && input.files[0];
    if (!file) return;
    try {
      const rows = parseCsv(await file.text());
      const header = rows[0] || [];
      const body = rows.slice(1, 501);
      if (info) info.textContent = file.name + ' · ' + rows.length + ' 行 × ' + header.length + ' 列 · ' + Math.round(file.size / 1024) + ' KB';
      tableHost.innerHTML = '<table class="jgrid objarray" style="width:max-content;min-width:100%">' +
        '<thead><tr><th class="rownum">#</th>' + header.map((h) => '<th>' + escapeHtml(h) + '</th>').join('') + '</tr></thead><tbody>' +
        body.map((row, index) => '<tr class="row"><td class="rownum">' + (index + 1) + '</td>' +
          header.map((_, col) => '<td class="val">' + escapeHtml(row[col] === undefined ? '' : row[col]) + '</td>').join('') + '</tr>').join('') +
        '</tbody></table>' + (rows.length > 501 ? '<div class="tool-empty">仅显示前 500 行</div>' : '');
      notify('CSV 已加载：' + rows.length + ' 行', 'ok');
    } catch (error) {
      notify('读取 CSV 失败：' + (error && error.message), 'error');
    }
  });
  get('csv-clear')?.addEventListener('click', () => {
    input.value = '';
    if (info) info.textContent = '';
    tableHost.innerHTML = '<div class="tool-empty">选择一个 CSV 文件后在这里预览</div>';
  });
}

export default function mount(ctx, panel) {
  panel.innerHTML = template;
  return initCsvViewer(panel, ctx.toast);
}
