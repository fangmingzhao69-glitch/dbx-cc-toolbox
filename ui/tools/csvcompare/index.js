import { escapeHtml } from '../../js/json-grid.js';
import { csvTable, readCsvFile, rowsToCsvText } from '../../shared/csv.js';
import template from './template.js';

const displayLimit = 500;
const label = { added: '新增', removed: '删除', changed: '修改', same: '相同', 'column-added': '新增列', 'column-removed': '删除列' };

function indexRows(rows, indexes, side) {
  const indexed = new Map();
  for (const [index, row] of rows.entries()) {
    const values = indexes.map(index => row[index]);
    if (values.some(value => value.trim() === '')) throw new Error(side + ' 文件第 ' + (index + 1) + ' 条数据的主键为空');
    const key = JSON.stringify(values);
    const previous = indexed.get(key);
    if (previous) throw new Error(side + ' 文件存在重复主键 ' + key + '（第 ' + previous.position + '、' + (index + 1) + ' 条数据）');
    indexed.set(key, { row, position: index + 1 });
  }
  return indexed;
}

export function compareCsv(first, second, keys) {
  const indexesA = new Map(first.columns.map((column, index) => [column, index]));
  const indexesB = new Map(second.columns.map((column, index) => [column, index]));
  if (keys.some(key => !indexesA.has(key) || !indexesB.has(key))) throw new Error('主键列必须同时存在于 A 和 B');
  const common = first.columns.filter(column => indexesB.has(column));
  const schema = second.columns.filter(column => !indexesA.has(column)).map(key => ({ status: 'column-added', key, detail: '仅 B 含此列' }))
    .concat(first.columns.filter(column => !indexesB.has(column)).map(key => ({ status: 'column-removed', key, detail: '仅 A 含此列' })));
  const rows = [];
  function append(a, b, key) {
    if (!b) rows.push({ status: 'removed', key, detail: 'B 中不存在该行' });
    else if (!a) rows.push({ status: 'added', key, detail: 'A 中不存在该行' });
    else {
      const changes = common.flatMap(name => {
        const before = a[indexesA.get(name)], after = b[indexesB.get(name)];
        return before === after ? [] : [name + ': ' + JSON.stringify(before) + ' → ' + JSON.stringify(after)];
      });
      rows.push({ status: changes.length ? 'changed' : 'same', key, detail: changes.join('；') });
    }
  }
  if (keys.length) {
    const a = indexRows(first.rows, keys.map(key => indexesA.get(key)), 'A');
    const b = indexRows(second.rows, keys.map(key => indexesB.get(key)), 'B');
    for (const key of new Set([...a.keys(), ...b.keys()])) append(a.get(key)?.row, b.get(key)?.row, JSON.parse(key).join(', '));
  } else {
    for (let i = 0; i < Math.max(first.rows.length, second.rows.length); i++) append(first.rows[i], second.rows[i], '第 ' + (i + 1) + ' 行');
  }
  return { rows, schema };
}

export default function mount({ toast, saveFile }, panel) {
  panel.innerHTML = template;
  const get = name => panel.querySelector('#cmp-' + name);
  const host = get('result'), summary = get('summary'), hint = get('hint');
  const keys = get('keys'), keyPicker = get('key-picker'), only = get('only-changes');
  const files = { a: null, b: null };
  const revision = { a: 0, b: 0 };
  const loading = new Set();
  let result;

  function invalidate() {
    result = null;
    summary.textContent = '';
    host.textContent = '请选择 A、B 文件并开始比对';
    get('export').disabled = true;
  }
  function refreshFiles() {
    hint.textContent = ['a', 'b'].map(side => side.toUpperCase() + '：' + (loading.has(side) ? '读取中…' : files[side]?.name || '-')).join(' · ');
    get('run').disabled = !!loading.size || !files.a || !files.b;
    get('swap').disabled = !!loading.size || (!files.a && !files.b);
    const common = files.a?.columns.filter(column => files.b?.columns.includes(column) && !column.includes(',')) ?? [];
    keyPicker.replaceChildren(new Option('添加主键列…', ''), ...common.map(column => new Option(column, column)));
    keyPicker.disabled = !common.length;
  }
  const keyList = () => [...new Set(keys.value.split(',').map(key => key.trim()).filter(Boolean))];
  keyPicker.addEventListener('change', () => {
    if (keyPicker.value) keys.value = [...new Set([...keyList(), keyPicker.value])].join(', ');
    keyPicker.value = '';
    invalidate();
  });
  keys.addEventListener('input', invalidate);
  for (const side of ['a', 'b']) {
    const input = get('file-' + side);
    input.addEventListener('change', async () => {
      const file = input.files[0];
      input.value = '';
      if (!file) return;
      const request = ++revision[side];
      files[side] = null;
      loading.add(side);
      invalidate();
      refreshFiles();
      try {
        const { text, separator } = await readCsvFile(file);
        if (request !== revision[side]) return;
        files[side] = { ...csvTable(text, separator), name: file.name };
        toast('已载入 ' + file.name, 'ok');
      } catch (error) {
        if (request === revision[side]) { host.textContent = error.message; toast('读取失败：' + error.message, 'error'); }
      } finally {
        if (request === revision[side]) { loading.delete(side); refreshFiles(); }
      }
    });
  }

  function render() {
    if (!result) return;
    const { rows, schema } = result;
    const count = state => rows.filter(row => row.status === state).length;
    summary.textContent = 'A 与 B：新增 ' + count('added') + ' 行，删除 ' + count('removed') + ' 行，修改 ' + count('changed') +
      ' 行，相同 ' + count('same') + ' 行；新增列 ' + schema.filter(item => item.status === 'column-added').length +
      ' 个，删除列 ' + schema.filter(item => item.status === 'column-removed').length + ' 个';
    const shown = [...schema, ...(only.checked ? rows.filter(row => row.status !== 'same') : rows)];
    host.innerHTML = shown.length ? '<table class="jgrid objarray" style="width:100%"><thead><tr><th>状态</th><th>行 / 主键 / 列</th>' +
      '<th>差异内容</th></tr></thead><tbody>' + shown.slice(0, displayLimit).map(row =>
        '<tr class="row"><td class="val">' + label[row.status] + '</td><td class="val">' + escapeHtml(row.key) +
        '</td><td class="val">' + escapeHtml(row.detail.length > 500 ? row.detail.slice(0, 500) + '…' : row.detail) + '</td></tr>').join('') +
      '</tbody></table>' : '<div class="tool-empty">没有差异</div>';
    if (shown.length > displayLimit) host.insertAdjacentHTML('beforeend', '<div class="tool-empty">仅预览前 500 条，可导出完整差异</div>');
    get('export').disabled = !schema.length && rows.every(row => row.status === 'same');
  }
  function run() {
    invalidate();
    if (loading.size || !files.a || !files.b) return;
    try { result = compareCsv(files.a, files.b, keyList()); render(); }
    catch (error) { summary.textContent = error.message; host.textContent = ''; toast(error.message, 'error'); }
  }
  get('run').addEventListener('click', run);
  only.addEventListener('change', render);
  get('swap').addEventListener('click', () => {
    [files.a, files.b] = [files.b, files.a];
    refreshFiles();
    run();
  });
  get('export').addEventListener('click', async () => {
    if (!result) return;
    const changes = [...result.schema, ...result.rows.filter(row => row.status !== 'same')];
    if (!changes.length) return;
    const text = rowsToCsvText([['状态', '行或主键', '差异内容'], ...changes.map(row => [label[row.status], row.key, row.detail])]);
    try {
      const saved = await saveFile('csv-diff-' + Date.now() + '.csv', 'text/csv;charset=utf-8', '\uFEFF' + text);
      toast(saved ? '差异 CSV 已导出' : '已取消导出', saved ? 'ok' : 'info');
    } catch (error) { toast('导出失败：' + error.message, 'error'); }
  });
  invalidate();
  refreshFiles();
  return { dispose() { revision.a++; revision.b++; } };
}
