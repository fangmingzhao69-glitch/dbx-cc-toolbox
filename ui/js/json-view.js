const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const container = node => node.kind === 'array' || node.kind === 'object';
const text = node => node.kind === 'number' ? node.numberRaw : node.kind === 'null' ? 'null' : String(node.value);

// One table at a time. Folded nodes contain no child table or eager HTML.
export function createGridView(doc, saved = {}, pageSize = 100) {
  const view = { pages: { ...saved.pages }, columnPages: { ...saved.columnPages }, expanded: new Set(saved.expanded || []), scroll: { ...saved.scroll } };
  const attrs = node => ' data-node="' + node.id + '" data-path="' + esc(node.pointer) + '"';
  const scalar = node => '<span class="v ' + node.kind + '" title="' + esc(text(node)) + '">' + esc(text(node)) + '</span>';
  const val = node => !container(node) ? scalar(node) : '<span class="container-cell"><button type="button" class="tgl" data-target="jgn-' + node.id + '" data-expand="' + node.id + '" aria-expanded="false">+</button><span class="badge">[' + node.children.length + ']</span><span class="ctype">' + (node.kind === 'array' ? '[]' : '{}') + '</span></span>';
  const nested = (node, columns) => container(node) ? '<tr class="nested-row"><td colspan="' + columns + '"><div class="nested-box" id="jgn-' + node.id + '" data-box="' + node.id + '" hidden></div></td></tr>' : '';
  const cell = node => node ? '<td class="val"' + attrs(node) + ' data-kind="value">' + val(node) + '</td>' : '<td class="val missing">⊘</td>';
  function render(id = doc.root.id) {
    const node = doc.nodes.get(id);
    if (!node) return '';
    if (!container(node)) return '<div class="root-scalar"' + attrs(node) + ' data-kind="value">' + scalar(node) + '</div>';
    const total = node.children.length;
    const page = Math.max(0, Math.min(view.pages[id] || 0, Math.max(0, Math.ceil(total / pageSize) - 1)));
    view.pages[id] = page;
    const start = page * pageSize;
    const entries = node.children.slice(start, start + pageSize);
    const object = node.kind === 'object';
    const objArray = !object && total > 0 && node.children.every(n => n.kind === 'object' && new Set(n.children.map(c => c.key)).size === n.children.length);
    const allKeys = objArray ? [...new Set(entries.flatMap(n => n.children.map(c => c.key)))] : [];
    const columnPage = Math.max(0, Math.min(view.columnPages[id] || 0, Math.max(0, Math.ceil(allKeys.length / 50) - 1)));
    view.columnPages[id] = columnPage;
    const keys = allKeys.slice(columnPage * 50, (columnPage + 1) * 50);
    const widths = objArray ? keys.map(k => Math.max(110, Math.min(650, 56 + Math.max(k.length, ...entries.map(n => {
      const v = n.children.find(c => c.key === k); return v && !container(v) ? Math.min(40, text(v).length) : 10;
    })) * 9))) : object ? [140, 560] : [560];
    const allWidths = [46, ...widths];
    const colgroup = '<colgroup>' + allWidths.map(w => '<col data-base="' + w + '" style="width:' + w + 'px">').join('') + '</colgroup>';
    const head = '<thead><tr><th class="rownum">#</th>' + (object ? '<th>键</th><th>值</th>' : objArray ? keys.map(k => '<th>' + esc(k) + '</th>').join('') : '<th>值</th>') + '</tr></thead>';
    const body = entries.map((entry, index) => {
      const fields = objArray ? new Map(entry.children.map(c => [c.key, c])) : null;
      const values = objArray ? keys.map(k => fields.get(k)) : [entry];
      return '<tr class="row"' + attrs(entry) + '><td class="rownum">' + (start + index + 1) + '</td>' +
        (object ? '<td class="key"' + attrs(entry) + ' data-kind="key">' + esc(entry.key) + '</td>' : '') + values.map(cell).join('') + '</tr>' +
        values.filter(Boolean).map(n => nested(n, allWidths.length)).join('');
    }).join('');
    const pager = total > pageSize ? '<div class="json-pager"><button data-page-node="' + id + '" data-page="' + (page - 1) + '"' + (!page ? ' disabled' : '') + '>上一页</button><span>显示 ' + (start + 1) + '–' + Math.min(total, start + pageSize) + '，共 ' + total + ' 项</span><button data-page-node="' + id + '" data-page="' + (page + 1) + '"' + (start + pageSize >= total ? ' disabled' : '') + '>下一页</button></div>' : '';
    const columnPager = allKeys.length > 50 ? '<div class="json-pager"><button data-column-node="' + id + '" data-page="' + (columnPage - 1) + '"' + (!columnPage ? ' disabled' : '') + '>前 50 列</button><span>列 ' + (columnPage * 50 + 1) + '–' + Math.min(allKeys.length, (columnPage + 1) * 50) + '，当前行页共 ' + allKeys.length + ' 列</span><button data-column-node="' + id + '" data-page="' + (columnPage + 1) + '"' + ((columnPage + 1) * 50 >= allKeys.length ? ' disabled' : '') + '>后 50 列</button></div>' : '';
    return '<div class="table-block ' + (object ? 'kv-block' : 'array-block') + '" data-table-node="' + id + '">' + pager + columnPager + '<table class="jgrid ' + (object ? 'kv' : objArray ? 'objarray' : 'idx') + '" style="width:' + allWidths.reduce((a,b) => a+b, 0) + 'px">' + colgroup + head + '<tbody>' + body + '</tbody></table></div>';
  }
  function restore(host) {
    // Traverse only opened branches, so collapsing really releases descendant DOM.
    for (const button of host.querySelectorAll('.tgl')) {
      const id = button.dataset.expand;
      if (!view.expanded.has(id)) continue;
      const box = host.querySelector('[data-box="' + id + '"]');
      if (!box) continue;
      button.textContent = '−'; button.setAttribute('aria-expanded', 'true'); box.hidden = false;
      box.innerHTML = render(id); restore(box);
    }
    for (const block of host.querySelectorAll('[data-table-node]')) {
      const position = view.scroll[block.dataset.tableNode];
      if (position) { block.scrollTop = position.top; block.scrollLeft = position.left; }
    }
  }
  return { doc, view, render, restore, snapshot(host) {
    for (const block of host.querySelectorAll('[data-table-node]')) view.scroll[block.dataset.tableNode] = { top: block.scrollTop, left: block.scrollLeft };
    return { pages: { ...view.pages }, columnPages: { ...view.columnPages }, expanded: [...view.expanded], scroll: { ...view.scroll } };
  } };
}
