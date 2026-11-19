import { escapeHtml } from '../../js/json-grid.js';
import { parseCsv } from '../../shared/csv.js';

import template from './template.js';

function indexRows(rows, indexes) {
  const indexed = new Map();
  for (const [position, row] of rows.entries()) {
    const values = indexes.map(index => row[index]);
    const key = JSON.stringify(values);
    const previous = indexed.get(key);
    if (previous) return { duplicate: { values, first: previous.position, last: position + 1 } };
    indexed.set(key, { row, position: position + 1 });
  }
  return { indexed };
}

function initCsvCompare(panel, notify, saveFile) {
  const get = id => panel.querySelector('#' + id);
  const resultHost = get('cmp-result');
  const summary = get('cmp-summary');
  const hint = get('cmp-hint');
  if (!resultHost) return;
  const state = { a: null, b: null, nameA: '', nameB: '' };
  let differences = [];

  const readFile = async (inputId, key) => {
    const input = get(inputId);
    const file = input.files && input.files[0];
    if (!file) return;
    const rows = parseCsv(await file.text());
    state[key] = rows;
    state[key === 'a' ? 'nameA' : 'nameB'] = file.name;
    hint.textContent = 'A：' + (state.nameA || '-') + '（' + (state.a ? state.a.length - 1 : 0) + ' 行） · B：' +
      (state.nameB || '-') + '（' + (state.b ? state.b.length - 1 : 0) + ' 行）';
    notify('已载入 ' + file.name, 'ok');
  };
  get('cmp-file-a')?.addEventListener('change', () => readFile('cmp-file-a', 'a'));
  get('cmp-file-b')?.addEventListener('change', () => readFile('cmp-file-b', 'b'));

  const run = () => {
    differences = [];
    if (!state.a || !state.b) { notify('请先选择 A、B 两个 CSV 文件', 'error'); return; }
    const headersA = (state.a[0] || []).map((name) => name.trim());
    const headersB = (state.b[0] || []).map((name) => name.trim());
    const common = headersA.filter((name) => headersB.includes(name));
    if (!common.length) { notify('两个 CSV 没有同名字段，无法比对', 'error'); return; }
    const keyNames = get('cmp-keys').value.split(',').map((name) => name.trim()).filter(Boolean);
    const keyIndexesA = keyNames.map((name) => headersA.indexOf(name));
    const keyIndexesB = keyNames.map((name) => headersB.indexOf(name));
    if (keyNames.length && (keyIndexesA.includes(-1) || keyIndexesB.includes(-1))) {
      notify('主键列在 A 或 B 中不存在', 'error');
      return;
    }
    const rowsA = state.a.slice(1);
    const rowsB = state.b.slice(1);
    const rows = [];
    const commonA = common.map((name) => headersA.indexOf(name));
    const commonB = common.map((name) => headersB.indexOf(name));

    if (keyNames.length) {
      const first = indexRows(rowsA, keyIndexesA);
      const second = indexRows(rowsB, keyIndexesB);
      const duplicate = first.duplicate || second.duplicate;
      if (duplicate) {
        summary.textContent = (first.duplicate ? 'A' : 'B') + ' 文件存在重复主键 ' + JSON.stringify(duplicate.values) +
          '（第 ' + duplicate.first + '、' + duplicate.last + ' 条数据），请修改主键列或先去重';
        resultHost.replaceChildren();
        notify('发现重复主键，无法按主键比对', 'error');
        return;
      }
      const mapA = first.indexed;
      const mapB = second.indexed;
      const keys = Array.from(new Set(Array.from(mapA.keys()).concat(Array.from(mapB.keys()))));
      for (const key of keys) {
        const rowA = mapA.get(key)?.row;
        const rowB = mapB.get(key)?.row;
        const keyText = JSON.parse(key).join(', ');
        if (!rowB) { rows.push({ status: 'removed', key: keyText, detail: 'B 中不存在该行' }); continue; }
        if (!rowA) { rows.push({ status: 'added', key: keyText, detail: 'A 中不存在该行' }); continue; }
        const changes = [];
        common.forEach((name, index) => {
          const va = rowA[commonA[index]];
          const vb = rowB[commonB[index]];
          if (String(va) !== String(vb)) changes.push(name + ': ' + va + ' → ' + vb);
        });
        rows.push(changes.length ? { status: 'changed', key: keyText, detail: changes.join('；') } : { status: 'same', key: keyText, detail: '' });
      }
    } else {
      const length = Math.max(rowsA.length, rowsB.length);
      for (let index = 0; index < length; index += 1) {
        const rowA = rowsA[index];
        const rowB = rowsB[index];
        const keyText = '第 ' + (index + 1) + ' 行';
        if (!rowB) { rows.push({ status: 'removed', key: keyText, detail: 'B 中不存在' }); continue; }
        if (!rowA) { rows.push({ status: 'added', key: keyText, detail: 'A 中不存在' }); continue; }
        const changes = [];
        common.forEach((name, columnIndex) => {
          const va = rowA[commonA[columnIndex]];
          const vb = rowB[commonB[columnIndex]];
          if (String(va) !== String(vb)) changes.push(name + ': ' + va + ' → ' + vb);
        });
        rows.push(changes.length ? { status: 'changed', key: keyText, detail: changes.join('；') } : { status: 'same', key: keyText, detail: '' });
      }
    }

    const added = rows.filter((row) => row.status === 'added').length;
    const removed = rows.filter((row) => row.status === 'removed').length;
    const changed = rows.filter((row) => row.status === 'changed').length;
    const same = rows.filter((row) => row.status === 'same').length;
    differences = rows.filter((row) => row.status !== 'same');
    summary.textContent = 'A 与 B：新增 ' + added + ' 行，删除 ' + removed + ' 行，修改 ' + changed + ' 行，相同 ' + same + ' 行';
    const label = { added: '新增', removed: '删除', changed: '修改', same: '相同' };
    resultHost.innerHTML = '<table class="jgrid objarray" style="width:max-content;min-width:100%"><thead><tr><th>状态</th><th>行/主键</th><th>差异内容</th></tr></thead><tbody>' +
      rows.slice(0, 500).map((row) => '<tr class="row"><td class="val">' + label[row.status] + '</td><td class="val">' + escapeHtml(row.key) + '</td><td class="val">' + escapeHtml(row.detail) + '</td></tr>').join('') +
      '</tbody></table>' + (rows.length > 500 ? '<div class="tool-empty">仅显示前 500 行差异</div>' : '');
    notify('比对完成：' + differences.length + ' 处差异', 'ok');
  };

  get('cmp-run')?.addEventListener('click', run);
  get('cmp-swap')?.addEventListener('click', () => {
    const tempRows = state.a; state.a = state.b; state.b = tempRows;
    const tempName = state.nameA; state.nameA = state.nameB; state.nameB = tempName;
    hint.textContent = 'A：' + (state.nameA || '-') + ' · B：' + (state.nameB || '-');
    if (state.a && state.b) run();
  });
  get('cmp-export')?.addEventListener('click', async () => {
    if (!differences.length) { notify('没有差异可导出', 'error'); return; }
    const csv = '\uFEFF状态,行或主键,差异内容\r\n' + differences.map((row) =>
      '"' + row.status + '","' + row.key.replace(/"/g, '""') + '","' + row.detail.replace(/"/g, '""') + '"').join('\r\n');
    try {
      const saved = await saveFile('csv-diff-' + Date.now() + '.csv', 'text/csv;charset=utf-8', csv);
      notify(saved ? '差异 CSV 已导出' : '已取消导出', saved ? 'ok' : 'info');
    } catch (error) { notify('导出失败：' + error.message, 'error'); }
  });
}

export default function mount(ctx, panel) {
  panel.innerHTML = template;
  return initCsvCompare(panel, ctx.toast, ctx.saveFile);
}
