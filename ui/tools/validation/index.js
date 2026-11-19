import { escapeHtml } from '../../js/json-grid.js';
import { sqlString, parseInsertSql, dataRowsFromText } from '../../shared/sql.js';

import template from './template.js';

function initValidation(panel, notify, toolHost) {
  const get = id => panel.querySelector('#' + id);
  const select = get('val-connection');
  const output = get('val-sql');
  if (!select || !output) return;
  let loaded = false;

  const ensure = async () => {
    if (loaded) return;
    const connections = await toolHost.loadConnections(notify);
    if (connections === null) return;
    select.replaceChildren(new Option('选择连接…', ''), ...connections.map(connection => {
      const status = connection.connected ? '已连接' : '未连接';
      return new Option(connection.name + ' (' + (connection.dialect || connection.dbType || '') + ' · ' + status + ')', connection.id);
    }));
    loaded = true;
  };
  const currentDialect = () => {
    const option = select.options[select.selectedIndex];
    const match = option ? /\b(mysql|postgres|sqlite|mssql|oracle)\b/i.exec(option.textContent) : null;
    return match ? match[1].toLowerCase() : 'postgres';
  };

  const buildSql = () => {
    const table = get('val-table').value.trim();
    if (!table) throw new Error('请填写表名');
    const columns = get('val-columns').value.split(',').map((c) => c.trim()).filter(Boolean);
    if (!columns.length) throw new Error('请填写要校验的字段（逗号分隔）');
    const dialect = currentDialect();
    const maxLen = Number(get('val-max-len').value) || 255;
    const enumValues = get('val-enum-values').value.split(',').map((v) => v.trim()).filter(Boolean);
    const statements = [];
    for (const column of columns) {
      if (get('val-null').checked) {
        statements.push('-- ' + column + ' 空值检查\nSELECT COUNT(*) AS null_count FROM ' + table + ' WHERE ' + column + ' IS NULL;');
      }
      if (get('val-dup').checked) {
        statements.push('-- ' + column + ' 重复值\nSELECT ' + column + ' AS value, COUNT(*) AS cnt FROM ' + table + ' GROUP BY ' + column + ' HAVING COUNT(*) > 1;');
      }
      if (get('val-len').checked) {
        const lengthFn = dialect === 'mssql' ? 'LEN' : 'LENGTH';
        statements.push('-- ' + column + ' 超长检查（>' + maxLen + '）\nSELECT COUNT(*) AS too_long FROM ' + table + ' WHERE ' + lengthFn + '(' + column + ') > ' + maxLen + ';');
      }
      if (get('val-enum').checked && enumValues.length) {
        statements.push('-- ' + column + ' 枚举外值\nSELECT ' + column + ', COUNT(*) AS cnt FROM ' + table + ' WHERE ' + column + ' NOT IN (' + enumValues.map((v) => sqlString(v)).join(', ') + ') GROUP BY ' + column + ';');
      }
    }
    return statements.join('\n\n');
  };

  get('val-generate')?.addEventListener('click', async () => {
    try { await ensure(); output.value = buildSql(); notify('校验 SQL 已生成', 'ok'); }
    catch (error) { notify('生成失败：' + error.message, 'error'); }
  });
  get('val-copy')?.addEventListener('click', () => toolHost.copyText(output.value, notify));
  get('val-run')?.addEventListener('click', async () => {
    try {
      await ensure();
      const connectionId = select.value;
      if (!connectionId) { notify('请选择连接', 'error'); return; }
      const sqlText = buildSql();
      output.value = sqlText;
      const statements = sqlText.split(/;\s*\n/).map((part) => part.replace(/^--.*$/gm, '').trim()).filter(Boolean).map((part) => part + ';');
      const host = get('val-result');
      host.innerHTML = '';
      let index = 0;
      for (const statement of statements) {
        index += 1;
        const result = await toolHost.queryData(connectionId, statement);
        const html = '<div class="tool-head" style="height:auto;padding:6px 8px">第 ' + index + ' 条 · ' + result.rows.length + ' 行 · ' + (result.elapsedMs || 0) + ' ms</div>' +
          '<table class="jgrid objarray" style="width:max-content;min-width:100%"><thead><tr>' +
          result.columns.map((column) => '<th>' + escapeHtml(column.name) + '</th>').join('') + '</tr></thead><tbody>' +
          result.rows.map((row) => '<tr>' + row.map((value) => '<td class="val">' + escapeHtml(value === null ? '' : String(value)) + '</td>').join('') + '</tr>').join('') +
          '</tbody></table>';
        host.insertAdjacentHTML('beforeend', html);
      }
      notify('校验执行完成，共 ' + statements.length + ' 条', 'ok');
    } catch (error) {
      notify('执行失败：' + (error && error.message ? error.message : error), 'error');
    }
  });
}

function initOfflineValidation(panel, notify, saveFile) {
  const get = id => panel.querySelector('#' + id);
  const source = get('val-source');
  const host = get('val-offline-result');
  if (!source || !host) return;
  let issues = [];

  const rowsFromText = (text) => {
    const trimmed = String(text || '').trim();
    if (!trimmed) throw new Error('请先粘贴 INSERT / CSV / JSON 数据');
    if (/^insert\s+into/i.test(trimmed)) return parseInsertSql(trimmed);
    return dataRowsFromText(trimmed);
  };

  const run = () => {
    issues = [];
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
    } catch (error) {
      host.textContent = '校验失败：' + error.message;
      notify(host.textContent, 'error');
    }
  };

  get('val-offline-run')?.addEventListener('click', run);
  get('val-offline-export')?.addEventListener('click', async () => {
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
