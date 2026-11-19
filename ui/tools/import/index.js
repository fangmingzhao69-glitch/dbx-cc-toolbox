import { rowsToCsvText } from '../../shared/csv.js';
import { buildImportSql } from '../../shared/sql.js';

import template from './template.js';

function initImport(panel, notify, settings, toolHost) {
  const get = id => panel.querySelector('#' + id);
  const source = get('import-source');
  const output = get('import-sql');
  if (!source || !output) return;
  const generate = () => {
    try {
      const result = buildImportSql(source.value, get('import-table').value, get('import-dialect').value, settings.get('cc-toolbox-batch', '100'));
      output.value = result.sql;
      get('import-hint').textContent = result.rowCount + ' 行 × ' + result.columns + ' 列，SQL 已生成';
      notify('已生成 SQL：' + result.rowCount + ' 行', 'ok');
    } catch (error) {
      output.value = '';
      notify('生成失败：' + error.message, 'error');
    }
  };
  get('import-file')?.addEventListener('change', async () => {
    const input = get('import-file');
    const file = input.files && input.files[0];
    if (!file) return;
    try {
      let text;
      if (/\.(xlsx|xls)$/i.test(file.name)) {
        if (typeof XLSX === 'undefined') throw new Error('Excel 解析库未加载');
        const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' });
        const sheetName = workbook.SheetNames[0];
        const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, raw: true });
        text = rowsToCsvText(rows);
        notify('已读取工作表「' + sheetName + '」，共 ' + (rows.length - 1) + ' 行', 'ok');
      } else {
        text = await file.text();
      }
      source.value = text;
      generate();
    } catch (error) {
      notify('导入失败：' + (error && error.message ? error.message : error), 'error');
    }
  });
  get('import-run')?.addEventListener('click', generate);
  get('import-copy')?.addEventListener('click', () => toolHost.copyText(output.value, notify));
}

export default function mount(ctx, panel) {
  panel.innerHTML = template;
  return initImport(panel, ctx.toast, ctx.settings, ctx.host);
}
