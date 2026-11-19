import template from './template.js';

function initDrawBoard(panel, notify, saveFile) {
  const get = id => panel.querySelector('#' + id);
  const canvas = get('draw-canvas');
  if (!canvas) return;
  const context = canvas.getContext('2d');
  const colorInput = get('draw-color');
  const sizeInput = get('draw-size');
  let drawing = false;
  let last = null;
  let previousRatio;

  const resize = () => {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const ratio = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.floor(rect.width * ratio));
    const height = Math.max(1, Math.floor(rect.height * ratio));
    if (previousRatio === ratio && canvas.width === width && canvas.height === height) return;
    const snapshot = document.createElement('canvas');
    snapshot.width = canvas.width; snapshot.height = canvas.height;
    snapshot.getContext('2d').drawImage(canvas, 0, 0);
    canvas.width = width;
    canvas.height = height;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, rect.width, rect.height);
    if (previousRatio) context.drawImage(snapshot, 0, 0, snapshot.width / previousRatio, snapshot.height / previousRatio);
    previousRatio = ratio;
  };

  const point = (event) => {
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  canvas.addEventListener('pointerdown', (event) => {
    drawing = true; last = point(event); canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener('pointermove', (event) => {
    if (!drawing || !last) return;
    const next = point(event);
    context.strokeStyle = colorInput ? colorInput.value : '#2e7d32';
    context.lineWidth = sizeInput ? Number(sizeInput.value) : 3;
    context.lineCap = 'round'; context.lineJoin = 'round';
    context.beginPath(); context.moveTo(last.x, last.y); context.lineTo(next.x, next.y); context.stroke();
    last = next;
  });
  const stop = () => { drawing = false; last = null; };
  canvas.addEventListener('pointerup', stop);
  canvas.addEventListener('pointercancel', stop);
  canvas.addEventListener('pointerleave', stop);

  get('draw-clear')?.addEventListener('click', () => {
    const rect = canvas.getBoundingClientRect();
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, rect.width, rect.height);
    notify('画布已清空', 'ok');
  });
  get('draw-save')?.addEventListener('click', async () => {
    try {
      const png = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
      if (!png) throw new Error('无法生成 PNG');
      const saved = await saveFile('cc-drawing-' + Date.now() + '.png', 'image/png', png);
      notify(saved ? '已导出 PNG' : '已取消导出', saved ? 'ok' : 'info');
    } catch (error) { notify('导出失败：' + error.message, 'error'); }
  });

  const observer = window.ResizeObserver ? new ResizeObserver(resize) : null;
  function hide() {
    stop();
    observer?.disconnect();
  }
  return {
    show() { resize(); observer?.observe(canvas.parentElement); },
    hide,
    dispose: hide,
  };
}

export default function mount(ctx, panel) {
  panel.innerHTML = template;
  return initDrawBoard(panel, ctx.toast, ctx.saveFile);
}
