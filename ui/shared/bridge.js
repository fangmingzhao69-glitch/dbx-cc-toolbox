export function createToolHost(bridge) {
  return {
    async loadConnections(notify) {
      if (!bridge?.capabilities?.connectionsApi) {
        notify('当前 DBX 宿主不支持插件读取连接列表', 'error');
        return null;
      }
      try { return await bridge.getConnections(); }
      catch (error) {
        notify('读取连接失败：' + error.message, 'error');
        return null;
      }
    },
    async queryData(connectionId, sql) {
      if (!bridge?.capabilities?.dataApi) throw new Error('当前 DBX 宿主不支持插件数据查询');
      return bridge.queryData({ connectionId, sql, maxRows: 500 });
    },
    async copyText(text, notify) {
      try {
        if (bridge?.copy) await bridge.copy(text);
        else {
          const area = document.createElement('textarea');
          area.value = text;
          document.body.appendChild(area);
          try {
            area.select();
            if (!document.execCommand('copy')) throw new Error('浏览器拒绝复制');
          } finally { area.remove(); }
        }
        notify('已复制到剪贴板', 'ok');
      } catch {
        notify('复制失败，请手动选择文本复制', 'error');
      }
    },
  };
}
