import { escapeHtml } from '../../js/json-grid.js';
import { dataRowsFromText, parseInsertSql, quoteQualifiedIdent, sqlString } from '../../shared/sql.js';

import template from './template.js';

function initValidation(panel, notify, toolHost) {
  const get = id => panel.querySelector('#' + id);
  const select = get('val-connection');
  const output = get('val-sql');
  if (!select || !output) return;
  let loaded = false;
  let loading;
  let activeRun = 0;
  const copy = get('val-copy');
  const run = get('val-run');
  const results = get('val-result');
  const refresh = get('val-refresh');

  const ensure = (force = false, quiet = false) => {
    if (loading) return loading;
    if (loaded && !force) return Promise.resolve();
    refresh.disabled = true;
    loading = (async () => {
      const connections = await toolHost.loadConnections(quiet ? () => {} : notify);
      if (connections === null) return;
      const previous = select.value;
      select.replaceChildren(new Option('选择连接…', ''), ...connections.map(connection => {
        const status = (connection.connected || connection.isConnected) ? '已连接' : '未连接';
        const dialect = connection.dialect || connection.dbType || '';
        const option = new Option(connection.name + ' (' + dialect + ' · ' + status + ')', connection.id);
        option.dataset.dialect = dialect.toLowerCase();
        return option;
      }));
      if (connections.some(connection => connection.id === previous)) select.value = previous;
      loaded = true;
      if (!quiet) notify('已读取 ' + connections.length + ' 个连接', 'ok');
    })().finally(() => { loading = null; refresh.disabled = false; });
    return loading;
  };
  const currentDialect = () => {
    const dialect = select.selectedOptions[0]?.dataset.dialect;
    if (dialect === 'postgresql') return 'postgres';
    if (dialect === 'sqlserver' || dialect === 'sql server') return 'mssql';
    if (dialect === 'mariadb') return 'mysql';
    return dialect || 'postgres';
  };

  const buildSql = () => {
    const dialect = currentDialect();
    const table = quoteQualifiedIdent(dialect, get('val-table').value);
    const columns = get('val-columns').value.split(',').map((c) => c.trim()).filter(Boolean);
    if (!columns.length) throw new Error('请填写要校验的字段（逗号分隔）');
    const maxLen = get('val-max-len').valueAsNumber;
    if (get('val-len').checked && (!Number.isSafeInteger(maxLen) || maxLen < 0)) throw new Error('最大长度必须是非负整数');
    const enumValues = get('val-enum-values').value.split(',').map((v) => v.trim()).filter(Boolean);
    if (get('val-enum').checked && !enumValues.length) throw new Error('请填写允许的枚举值');
    const statements = [];
    for (const name of new Set(columns)) {
      const column = quoteQualifiedIdent(dialect, name);
      const add = (label, sql) => statements.push({ label: name + ' ' + label, sql });
      if (get('val-null').checked) {
        add('空值检查', 'SELECT COUNT(*) AS null_count FROM ' + table + ' WHERE ' + column + ' IS NULL');
      }
      if (get('val-dup').checked) {
        add('重复值', 'SELECT ' + column + ' AS value, COUNT(*) AS cnt FROM ' + table + ' GROUP BY ' + column + ' HAVING COUNT(*) > 1');
      }
      if (get('val-len').checked) {
        const lengthFn = dialect === 'mssql' ? 'LEN' : dialect === 'mysql' ? 'CHAR_LENGTH' : 'LENGTH';
        add('超长检查（>' + maxLen + '）', 'SELECT COUNT(*) AS too_long FROM ' + table + ' WHERE ' + lengthFn + '(' + column + ') > ' + maxLen);
      }
      if (get('val-enum').checked && enumValues.length) {
        add('枚举外值', 'SELECT ' + column + ', COUNT(*) AS cnt FROM ' + table + ' WHERE ' + column + ' NOT IN (' + enumValues.map(v => sqlString(v, dialect)).join(', ') + ') GROUP BY ' + column);
      }
    }
    if (!statements.length) throw new Error('请至少选择一项校验规则');
    output.value = statements.map(item => '-- ' + item.label.replace(/[\r\n]/g, ' ') + '\n' + item.sql + ';').join('\n\n');
    copy.disabled = false;
    return statements;
  };

  const invalidate = () => {
    activeRun++;
    run.disabled = false;
    output.value = '';
    copy.disabled = true;
    results.textContent = '校验条件已更改，请重新执行';
  };
  const sharedFields = ['val-null', 'val-dup', 'val-len', 'val-enum', 'val-enum-values', 'val-max-len'];
  for (const id of ['val-connection', 'val-table', 'val-columns', ...sharedFields]) get(id).addEventListener('input', invalidate);
  refresh.addEventListener('click', () => { void ensure(true); });
  void ensure(false, true);
  copy.disabled = true;
  get('val-generate').addEventListener('click', () => {
    output.value = '';
    copy.disabled = true;
    try { buildSql(); notify('校验 SQL 已生成', 'ok'); }
    catch (error) { notify('生成失败：' + error.message, 'error'); }
  });
  copy.addEventListener('click', () => { if (output.value) void toolHost.copyText(output.value, notify); });
  run.addEventListener('click', async () => {
    const request = ++activeRun;
    const connectionId = select.value;
    if (!connectionId) { notify('请选择连接，可先点击刷新连接', 'error'); return; }
    run.disabled = true;
    results.textContent = '';
    try {
      const statements = buildSql();
      let index = 0;
      for (const { label, sql } of statements) {
        index += 1;
        const result = await toolHost.queryData(connectionId, sql);
        if (request !== activeRun) return;
        const html = '<div class="tool-head" style="height:auto;padding:6px 8px">第 ' + index + ' 条 · ' +
          escapeHtml(label) + ' · ' + result.rows.length + ' 行 · ' + escapeHtml(result.elapsedMs || 0) + ' ms</div>' +
          '<table class="jgrid objarray" style="width:max-content;min-width:100%"><thead><tr>' +
          result.columns.map((column) => '<th>' + escapeHtml(column.name) + '</th>').join('') + '</tr></thead><tbody>' +
          result.rows.map((row) => '<tr>' + row.map((value) => '<td class="val">' + escapeHtml(value === null ? '' : String(value)) + '</td>').join('') + '</tr>').join('') +
          '</tbody></table>';
        results.insertAdjacentHTML('beforeend', html);
      }
      notify('校验执行完成，共 ' + statements.length + ' 条', 'ok');
    } catch (error) {
      if (request === activeRun) notify('执行失败：' + error.message, 'error');
    } finally {
      if (request === activeRun) run.disabled = false;
    }
  });
}

function initOfflineValidation(panel, notify, saveFile) {
  const get = id => panel.querySelector('#' + id);
  const source = get('val-source');
  const host = get('val-offline-result');
  if (!source || !host) return;
  let issues = [];
  const exportButton = get('val-offline-export');
  function clearResults() {
    issues = [];
    exportButton.disabled = true;
    host.textContent = '输入或规则已更改，请重新校验';
  }
  for (const id of ['val-source', 'val-regex', 'val-rule-fields', 'val-null', 'val-dup', 'val-len',
    'val-enum', 'val-enum-values', 'val-dup-columns', 'val-max-len']) get(id).addEventListener('input', clearResults);
  exportButton.disabled = true;

  const rowsFromText = (text) => {
    const trimmed = String(text || '').trim();
    if (!trimmed) throw new Error('请先粘贴 INSERT / CSV / JSON 数据');
    if (/^(?:--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/|\s)*insert\s+into\b/i.test(trimmed)) return parseInsertSql(trimmed);
    return dataRowsFromText(trimmed);
  };

  const run = () => {
    clearResults();
    try {
      const parsed = rowsFromText(source.value);
      const columns = parsed.columns;
      const rows = parsed.rows;
      if (!columns.length || !rows.length) throw new Error('没有解析到数据行');
      const maxLen = Number(get('val-max-len').value) || 255;
      const enumValues = get('val-enum-values').value.split(',').map((v) => v.trim()).filter(Boolean);
      const regexText = get('val-regex').value.trim();
      const regex = regexText ? new RegExp(regexText) : null;
      const dupColumns = get('val-dup-columns').value.split(',').map((name) => name.trim()).filter(Boolean);
      const dupTargets = dupColumns.length ? dupColumns : [columns[0]];
      const ruleFields = regex || (get('val-enum').checked && enumValues.length)
        ? get('val-rule-fields').value.split(',').map(name => name.trim()).filter(Boolean)
        : [];
      const unknown = ruleFields.filter(name => !columns.includes(name));
      if (unknown.length) throw new Error('数据中找不到规则字段：' + unknown.join('、'));

      const rowOffset = parsed.hasHeader ? 2 : 1;
      const addIssue = (rowIndex, column, rule, value, message) => {
        issues.push({ row: rowIndex + rowOffset, column, rule, value: value === null || value === undefined ? '' : String(value), message });
      };
      const columnValues = columns.map((_, index) => rows.map((row) => row[index]));
      columns.forEach((column, index) => {
        const values = columnValues[index];
        if (get('val-null').checked) {
          values.forEach((value, rowIndex) => { if (value === null || value === undefined || String(value).trim() === '') addIssue(rowIndex, column, '空值', value, '该字段为空'); });
        }
        if (get('val-dup').checked && dupTargets.includes(column)) {
          const counts = new Map();
          values.forEach((value) => { const key = String(value); counts.set(key, (counts.get(key) || 0) + 1); });
          values.forEach((value, rowIndex) => { if (counts.get(String(value)) > 1) addIssue(rowIndex, column, '重复值', value, '出现 ' + counts.get(String(value)) + ' 次'); });
        }
        if (get('val-len').checked) {
          values.forEach((value, rowIndex) => { if (value !== null && String(value).length > maxLen) addIssue(rowIndex, column, '超长', value, '长度 ' + String(value).length + ' > ' + maxLen); });
        }
        const applies = !ruleFields.length || ruleFields.includes(column);
        if (applies && get('val-enum').checked && enumValues.length) {
          values.forEach((value, rowIndex) => {
            if (value != null && String(value).trim() !== '' && !enumValues.includes(String(value)))
              addIssue(rowIndex, column, '枚举外值', value, '不在允许值中');
          });
        }
        if (applies && regex) {
          values.forEach((value, rowIndex) => {
            if (value == null || String(value).trim() === '') return;
            if (!regex.test(String(value))) addIssue(rowIndex, column, '格式不符', value, '不匹配正则 ' + regexText);
          });
        }
      });

      const summary = '共 ' + rows.length + ' 行 × ' + columns.length + ' 列，发现问题 ' + issues.length + ' 处';
      host.innerHTML = '<div class="diff-summary">' + summary + '</div>' +
        (issues.length
          ? '<table class="jgrid objarray" style="width:max-content;min-width:100%"><thead><tr><th>行号</th><th>字段</th><th>规则</th><th>值</th><th>说明</th></tr></thead><tbody>' +
            issues.slice(0, 1000).map((issue) => '<tr class="row"><td class="val">' + issue.row + '</td><td class="val">' + escapeHtml(issue.column) +
              '</td><td class="val">' + escapeHtml(issue.rule) + '</td><td class="val">' + escapeHtml(issue.value) +
              '</td><td class="val">' + escapeHtml(issue.message) + '</td></tr>').join('') + '</tbody></table>'
          : '<div class="tool-empty">没有发现问题</div>');
      notify(summary, issues.length ? 'info' : 'ok');
      exportButton.disabled = !issues.length;
    } catch (error) {
      host.textContent = '校验失败：' + error.message;
      notify(host.textContent, 'error');
    }
  };

  get('val-offline-run')?.addEventListener('click', run);
  exportButton.addEventListener('click', async () => {
    if (!issues.length) { notify('没有可导出的问题', 'error'); return; }
    const header = '行号,字段,规则,值,说明\r\n';
    const body = issues.map((issue) => [issue.row, issue.column, issue.rule, issue.value, issue.message]
      .map((cell) => '"' + String(cell).replace(/"/g, '""') + '"').join(',')).join('\r\n');
    try {
      const saved = await saveFile('validation-report-' + Date.now() + '.csv', 'text/csv;charset=utf-8', '\uFEFF' + header + body);
      notify(saved ? '校验报告已导出' : '已取消导出', saved ? 'ok' : 'info');
    } catch (error) { notify('导出失败：' + error.message, 'error'); }
  });
}

export default function mount(ctx, panel) {
  panel.innerHTML = template;
  initOfflineValidation(panel, ctx.toast, ctx.saveFile);
  return initValidation(panel, ctx.toast, ctx.host);
}
