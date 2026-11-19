import { escapeHtml } from '../../js/json-grid.js';
import { quoteIdent, inferColumnType, parseInsertSql, pickSelectType } from '../../shared/sql.js';

import template from './template.js';

function initQuickSheet(panel, notify, toolHost) {
  const get = id => panel.querySelector('#' + id);
  const host = get('sheet-columns');
  if (!host) return;
  const addRow = (name = '', type = 'TEXT', notNull = false, primary = false) => {
    const row = document.createElement('div');
    row.className = 'sheet-col';
    row.innerHTML = '<input class="col-name" placeholder="字段名" value="' + escapeHtml(name) + '" />' +
      '<select class="col-type"><option>TEXT</option><option>VARCHAR(255)</option><option>INTEGER</option><option>BIGINT</option><option>NUMERIC(18,4)</option><option>BOOLEAN</option><option>DATE</option><option>TIMESTAMP</option></select>' +
      '<label><input type="checkbox" class="col-notnull" /> 非空</label>' +
      '<label><input type="checkbox" class="col-pk" /> 主键</label>' +
      '<button type="button" class="col-remove">删除</button>';
    row.querySelector('.col-type').value = type;
    row.querySelector('.col-notnull').checked = notNull;
    row.querySelector('.col-pk').checked = primary;
    row.querySelector('.col-remove').addEventListener('click', () => row.remove());
    host.appendChild(row);
  };
  addRow('id', 'BIGINT', true, true);
  addRow('name', 'VARCHAR(255)');
  addRow('created_at', 'TIMESTAMP');

  get('sheet-add-col')?.addEventListener('click', () => addRow());
  get('sheet-run')?.addEventListener('click', () => {
    const dialect = get('sheet-dialect').value;
    const table = quoteIdent(dialect, get('sheet-table').value || 'new_table');
    const columns = Array.from(host.querySelectorAll('.sheet-col')).map((row) => {
      const name = row.querySelector('.col-name').value.trim() || 'column_name';
      const type = row.querySelector('.col-type').value;
      return quoteIdent(dialect, name) + ' ' + type + (row.querySelector('.col-notnull').checked ? ' NOT NULL' : '') + (row.querySelector('.col-pk').checked ? ' PRIMARY KEY' : '');
    }).filter(Boolean);
    const sql = 'CREATE TABLE ' + table + ' (\n  ' + columns.join(',\n  ') + '\n);';
    get('sheet-sql').value = sql;
    notify('CREATE TABLE 已生成', 'ok');
  });
  get('sheet-copy')?.addEventListener('click', () => toolHost.copyText(get('sheet-sql').value, notify));
  get('sheet-parse-insert')?.addEventListener('click', () => {
    try {
      const parsed = parseInsertSql(get('sheet-insert').value);
      get('sheet-table').value = parsed.table;
      host.innerHTML = '';
      parsed.columns.forEach((column, index) => {
        const values = parsed.rows.map((row) => row[index]);
        addRow(column, pickSelectType(inferColumnType(values, 'postgres')));
      });
      get('sheet-run').click();
      notify('已解析 INSERT 并生成 CREATE TABLE', 'ok');
    } catch (error) {
      notify('解析失败：' + error.message, 'error');
    }
  });
}

export default function mount(ctx, panel) {
  panel.innerHTML = template;
  return initQuickSheet(panel, ctx.toast, ctx.host);
}
