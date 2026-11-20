import { escapeHtml } from '../../js/json-grid.js';
import { quoteIdent, inferColumnType, parseInsertSql, buildCreateTableSql } from '../../shared/sql.js';

import template from './template.js';

function initQuickSheet(panel, notify, toolHost) {
  const get = id => panel.querySelector('#' + id);
  const host = get('sheet-columns');
  if (!host) return;
  const output = get('sheet-sql');
  const copy = get('sheet-copy');
  function invalidate() { output.value = ''; copy.disabled = true; }
  const addRow = (name = '', type = 'TEXT', notNull = false, primary = false) => {
    const row = document.createElement('div');
    row.className = 'sheet-col';
    row.innerHTML = '<input class="col-name" placeholder="字段名" value="' + escapeHtml(name) + '" />' +
      '<select class="col-type"><option>TEXT</option><option>VARCHAR(255)</option><option>INTEGER</option><option>BIGINT</option><option>NUMERIC(18,4)</option><option>BOOLEAN</option><option>DATE</option><option>TIMESTAMP</option></select>' +
      '<label><input type="checkbox" class="col-notnull" /> 非空</label>' +
      '<label><input type="checkbox" class="col-pk" /> 主键</label>' +
      '<button type="button" class="col-remove">删除</button>';
    const select = row.querySelector('.col-type');
    if (![...select.options].some(option => option.value === type)) select.add(new Option(type, type));
    select.value = type;
    row.querySelector('.col-notnull').checked = notNull;
    row.querySelector('.col-pk').checked = primary;
    row.querySelector('.col-remove').addEventListener('click', () => { row.remove(); invalidate(); });
    host.appendChild(row);
    return row;
  };
  addRow('id', 'BIGINT', true, true);
  addRow('name', 'VARCHAR(255)');
  addRow('created_at', 'TIMESTAMP');

  invalidate();
  host.addEventListener('input', invalidate);
  for (const id of ['sheet-table', 'sheet-dialect', 'sheet-insert']) get(id).addEventListener('input', invalidate);
  get('sheet-add-col')?.addEventListener('click', () => {
    invalidate();
    addRow().querySelector('.col-name').focus();
  });
  function generate() {
    const columns = Array.from(host.querySelectorAll('.sheet-col'), row => ({
      name: row.querySelector('.col-name').value.trim(),
      type: row.querySelector('.col-type').value,
      notNull: row.querySelector('.col-notnull').checked,
      primary: row.querySelector('.col-pk').checked,
    }));
    output.value = buildCreateTableSql(get('sheet-table').value, get('sheet-dialect').value, columns);
    copy.disabled = false;
  }
  get('sheet-run')?.addEventListener('click', () => {
    try { generate(); notify('CREATE TABLE 已生成', 'ok'); }
    catch (error) { invalidate(); notify('生成失败：' + error.message, 'error'); }
  });
  copy.addEventListener('click', () => { if (output.value) void toolHost.copyText(output.value, notify); });
  get('sheet-parse-insert')?.addEventListener('click', () => {
    try {
      const parsed = parseInsertSql(get('sheet-insert').value);
      const dialect = get('sheet-dialect').value;
      const inferred = parsed.columns.map((column, index) => [column, inferColumnType(parsed.rows.map(row => row[index]), dialect)]);
      get('sheet-table').value = parsed.tableParts.length > 1 || parsed.table.includes('.')
        ? parsed.tableParts.map(part => quoteIdent(dialect, part)).join('.') : parsed.table;
      host.replaceChildren();
      for (const [name, type] of inferred) addRow(name, type);
      generate();
      notify('已解析 INSERT 并生成 CREATE TABLE', 'ok');
    } catch (error) {
      invalidate();
      notify('解析失败：' + error.message, 'error');
    }
  });
}

export default function mount(ctx, panel) {
  panel.innerHTML = template;
  return initQuickSheet(panel, ctx.toast, ctx.host);
}
