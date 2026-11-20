import { escapeHtml } from '../../js/json-grid.js';
import { csvTable, readCsvFile } from '../../shared/csv.js';
import template from './template.js';

const PAGE_ROWS = 100;
const PAGE_COLS = 50;

export default function mount({ toast }, panel) {
  panel.innerHTML = template;
  const get = name => panel.querySelector('#csv-' + name);
  const input = get('file'), search = get('search'), host = get('table'), info = get('info');
  let fileData, matches = [], page = 0, columnPage = 0, revision = 0;
  let timer;

  function reset(message) {
    fileData = null;
    search.disabled = true;
    get('pages').hidden = true;
    info.textContent = '';
    const state = document.createElement('div');
    state.className = 'tool-empty';
    state.textContent = message;
    host.replaceChildren(state);
  }
  function render() {
    if (!fileData) return;
    const start = page * PAGE_ROWS;
    const firstCol = columnPage * PAGE_COLS;
    const columns = fileData.columns.slice(firstCol, firstCol + PAGE_COLS);
    const pages = Math.max(1, Math.ceil(matches.length / PAGE_ROWS));
    const columnPages = Math.max(1, Math.ceil(fileData.columns.length / PAGE_COLS));
    get('pages').hidden = false;
    get('previous').disabled = !page;
    get('next').disabled = page + 1 >= pages;
    get('previous-cols').hidden = get('next-cols').hidden = columnPages === 1;
    get('previous-cols').disabled = !columnPage;
    get('next-cols').disabled = columnPage + 1 >= columnPages;
    get('range').textContent = matches.length
      ? (start + 1) + '–' + Math.min(start + PAGE_ROWS, matches.length) + ' / ' + matches.length + ' 行'
      : '0 行';
    if (columnPages > 1) get('range').textContent += ' · 列 ' + (firstCol + 1) + '–' + (firstCol + columns.length);
    host.innerHTML = '<table class="jgrid objarray"><thead><tr><th class="rownum">#</th>' +
      columns.map(name => '<th scope="col">' + escapeHtml(name) + '</th>').join('') + '</tr></thead><tbody>' +
      matches.slice(start, start + PAGE_ROWS).map(index => '<tr class="row"><td class="rownum">' + (index + 1) + '</td>' +
        fileData.rows[index].slice(firstCol, firstCol + PAGE_COLS).map(value => '<td class="val">' + escapeHtml(value) + '</td>').join('') +
      '</tr>').join('') + '</tbody></table>' +
      (!matches.length ? '<div class="tool-empty">没有匹配的数据</div>' : '');
    host.scrollTo(0, 0);
  }
  function filter() {
    if (!fileData) return;
    const query = search.value.trim().toLowerCase();
    matches = [];
    fileData.rows.forEach((row, index) => {
      if (!query || row.some(value => value.toLowerCase().includes(query))) matches.push(index);
    });
    page = 0;
    render();
  }
  search.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(filter, 130);
  });
  get('previous').addEventListener('click', () => { page--; render(); });
  get('next').addEventListener('click', () => { page++; render(); });
  get('previous-cols').addEventListener('click', () => { columnPage--; render(); });
  get('next-cols').addEventListener('click', () => { columnPage++; render(); });
  input.addEventListener('change', async () => {
    const file = input.files[0];
    input.value = '';
    if (!file) return;
    const request = ++revision;
    reset('正在读取 ' + file.name);
    search.value = '';
    try {
      const { text, separator, encoding } = await readCsvFile(file);
      if (request !== revision) return;
      fileData = csvTable(text, separator);
      info.textContent = file.name + ' · ' + fileData.rows.length + ' 行 × ' + fileData.columns.length + ' 列 · ' + encoding;
      search.disabled = false;
      columnPage = 0;
      filter();
      toast('已载入 ' + file.name, 'ok');
    } catch (error) {
      if (request !== revision) return;
      reset(error.message);
      toast('读取失败：' + error.message, 'error');
    }
  });
  get('clear').addEventListener('click', () => {
    clearTimeout(timer);
    revision++;
    input.value = search.value = '';
    reset('选择 CSV 或 TSV 文件后在这里预览');
  });
  return { dispose() { revision++; clearTimeout(timer); } };
}
