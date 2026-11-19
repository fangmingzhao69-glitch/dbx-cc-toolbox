import template from './template.js';

function initSettings(panel, notify, settings) {
  const get = id => panel.querySelector('#' + id);
  const themeButton = get('set-theme');
  if (!themeButton) return;
  const batchInput = get('set-batch');
  if (batchInput) batchInput.value = settings.get('cc-toolbox-batch', '100');
  get('set-batch-save')?.addEventListener('click', () => {
    const value = Math.max(1, Math.min(1000, Number(batchInput.value) || 100));
    settings.set('cc-toolbox-batch', String(value));
    notify('每批行数已保存：' + value, 'ok');
  });
  const versionEl = get('set-version');
  if (versionEl) versionEl.textContent = '见 DBX 插件中心（GitHub Pages 自托管仓库）';

  const applyZoom = (value) => {
    const zoom = Math.min(1.35, Math.max(0.85, value));
    document.body.style.zoom = String(Math.round(zoom * 100) / 100);
    settings.set('cc-toolbox-zoom', String(zoom));
  };
  themeButton.addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    settings.set('cc-toolbox-theme', next);
    notify(next === 'dark' ? '已切换深色主题' : '已切换淡绿主题', 'ok');
  });
  get('set-font-up')?.addEventListener('click', () => {
    applyZoom(Number(settings.get('cc-toolbox-zoom', '1')) + 0.05);
    notify('字号已放大', 'ok');
  });
  get('set-font-down')?.addEventListener('click', () => {
    applyZoom(Number(settings.get('cc-toolbox-zoom', '1')) - 0.05);
    notify('字号已缩小', 'ok');
  });
  get('set-clear')?.addEventListener('click', async () => {
    try {
      await settings.clear();
      window.location.reload();
    } catch (error) {
      notify('清除失败：' + error.message, 'error');
    }
  });
}

export default function mount(ctx, panel) {
  panel.innerHTML = template;
  return initSettings(panel, ctx.toast, ctx.settings);
}
