import { readCsvFile, rowsToCsvText } from '../../shared/csv.js';
import { buildImportSql } from '../../shared/sql.js';

import template from './template.js';

function initImport(panel, notify, settings, toolHost) {
  const get = id => panel.querySelector('#' + id);
  const source = get('import-source');
  const output = get('import-sql');
  const copy = get('import-copy');
  const hint = get('import-hint');
  let revision = 0;
  const format = get('import-format');
  if (!source || !output) return;
  function invalidate() {
    output.value = '';
    copy.disabled = true;
    hint.textContent = '输入已更新，请生成 SQL';
  }
  source.addEventListener('input', () => { revision++; invalidate(); });
  for (const id of ['import-table', 'import-dialect', 'import-format']) get(id).addEventListener('input', invalidate);
  invalidate();
  const generate = () => {
    invalidate();
    try {
      const result = buildImportSql(source.value, get('import-table').value, get('import-dialect').value, settings.get('cc-toolbox-batch', '100'), format.value || undefined);
      output.value = result.sql;
      copy.disabled = false;
      hint.textContent = result.rowCount + ' 行 × ' + result.columns + ' 列，SQL 已生成';
      notify('已生成 SQL：' + result.rowCount + ' 行', 'ok');
    } catch (error) {
      hint.textContent = error.message;
      notify('生成失败：' + error.message, 'error');
    }
  };
  get('import-file')?.addEventListener('change', async () => {
    const input = get('import-file');
    const file = input.files && input.files[0];
    if (!file) return;
    input.value = '';
    const request = ++revision;
    invalidate();
    try {
      let text, sourceFormat;
      if (/\.(xlsx|xls)$/i.test(file.name)) {
        if (typeof XLSX === 'undefined') throw new Error('Excel 解析库未加载');
        if (file.size > 64 * 1024 * 1024) throw new Error('文件超过 64 MiB，请拆分后再导入');
        const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' });
        const sheetName = workbook.SheetNames[0];
        const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, raw: false, defval: '', blankrows: false });
        text = rowsToCsvText(rows);
        sourceFormat = 'csv';
      } else {
        const data = await readCsvFile(file);
        text = data.text;
        sourceFormat = /\.json$/i.test(file.name) ? 'json' : data.separator === '\t' ? 'tsv' : 'csv';
      }
      if (request !== revision) return;
      source.value = text;
      format.value = sourceFormat;
      generate();
    } catch (error) {
      if (request !== revision) return;
      hint.textContent = error.message;
      notify('导入失败：' + (error && error.message ? error.message : error), 'error');
    }
  });
  get('import-run')?.addEventListener('click', generate);
  copy.addEventListener('click', () => { if (output.value) void toolHost.copyText(output.value, notify); });
}

export default function mount(ctx, panel) {
  panel.innerHTML = template;
  return initImport(panel, ctx.toast, ctx.settings, ctx.host);
}
