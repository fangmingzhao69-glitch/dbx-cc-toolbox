import { escapeHtml } from '../../js/json-grid.js';

import template from './template.js';

function initHome(panel, notify, toolHost, showTool) {
  const get = id => panel.querySelector('#' + id);
  const cards = get('home-cards');
  if (!cards) return;
  const tableCountSql = (dialect) => {
    switch (String(dialect || '').toLowerCase()) {
      case 'mysql': return 'SELECT COUNT(*) AS tables FROM information_schema.tables WHERE table_schema = DATABASE()';
      case 'sqlite': return "SELECT COUNT(*) AS tables FROM sqlite_master WHERE type = 'table'";
      case 'mssql': return 'SELECT COUNT(*) AS tables FROM sys.tables';
      case 'oracle': return 'SELECT COUNT(*) AS tables FROM user_tables';
      default: return "SELECT COUNT(*) AS tables FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog', 'information_schema')";
    }
  };
  const refresh = async () => {
    cards.innerHTML = '<div class="tool-empty">正在读取连接信息…</div>';
    const connections = await toolHost.loadConnections(notify) ?? [];
    if (!connections.length) {
      cards.innerHTML = '<div class="tool-empty">没有读取到 DBX 连接：需要 DBX 支持连接读取，并在弹窗中允许插件访问</div>';
      return;
    }
    cards.innerHTML = connections.map((conn) => '<div class="home-card" data-conn="' + escapeHtml(conn.id) + '" data-dialect="' + escapeHtml(conn.dialect || conn.dbType || 'postgres') + '">' +
      '<b>' + escapeHtml(conn.name) + '</b>' +
      '方言：' + escapeHtml(conn.dialect || conn.dbType || '-') + '<br>' +
      '状态：' + (conn.connected || conn.isConnected ? '已连接' : '未连接') + '<br>' +
      '数据库：' + escapeHtml(conn.database || '-') + '<br>' +
      '只读：' + (conn.readOnly ? '是' : '否') + '<br>' +
      '<button type="button" class="home-test">查询表数量</button> <span class="home-count"></span>' +
      '</div>').join('');
    cards.querySelectorAll('.home-test').forEach((button) => {
      button.addEventListener('click', async () => {
        const card = button.closest('.home-card');
        try {
          const result = await toolHost.queryData(card.dataset.conn, tableCountSql(card.dataset.dialect));
          card.querySelector('.home-count').textContent = '表数量：' + (result.rows[0] ? result.rows[0][0] : '?');
        } catch (error) {
          card.querySelector('.home-count').textContent = '查询失败';
          notify('查询失败：' + (error && error.message ? error.message : error), 'error');
        }
      });
    });
  };
  get('home-refresh')?.addEventListener('click', refresh);
  for (const button of panel.querySelectorAll('.home-link')) {
    button.addEventListener('click', () => showTool(button.dataset.goto));
  }
}

export default function mount(ctx, panel) {
  panel.innerHTML = template;
  return initHome(panel, ctx.toast, ctx.host, ctx.showTool);
}
