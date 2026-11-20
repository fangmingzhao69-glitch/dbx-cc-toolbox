import { decimalKey, pointerSegment } from '../../js/json-document.js';

export function compareJson(left, right, limit = 5000) {
  if (left.duplicates.length || right.duplicates.length)
    throw new Error('有重复字段，请先修正，或切换至文本行差异');
  const changes = [];
  let limited = false;
  function record(path, before, after) {
    if (changes.length === limit) { limited = true; return; }
    const type = !before ? 'added' : !after ? 'removed' : 'changed';
    changes.push({ path, type, before, after });
  }
  function walk(a, b, path) {
    if (limited) return;
    if (!a || !b || a.kind !== b.kind) { record(path, a, b); return; }
    if (a.kind === 'object') {
      const first = new Map(a.children.map(node => [node.key, node]));
      const second = new Map(b.children.map(node => [node.key, node]));
      for (const [key, node] of first) {
        if (limited) return;
        walk(node, second.get(key), path + '/' + pointerSegment(key));
      }
      for (const [key, node] of second) {
        if (limited) return;
        if (!first.has(key)) record(path + '/' + pointerSegment(key), undefined, node);
      }
    } else if (a.kind === 'array') {
      for (let i = 0; i < Math.max(a.children.length, b.children.length) && !limited; i++)
        walk(a.children[i], b.children[i], path + '/' + i);
    } else if (a.kind === 'number' ? decimalKey(a.numberRaw) !== decimalKey(b.numberRaw) : a.value !== b.value) {
      record(path, a, b);
    }
  }
  walk(left.root, right.root, '');
  return { changes, limited };
}

export function compareLines(a, b, workLimit = 4_000_000) {
  const tooMany = 50_001;
  const left = a === '' ? [] : a.split(/\r\n?|\n/, tooMany);
  const right = b === '' ? [] : b.split(/\r\n?|\n/, tooMany);
  if (left.length === tooMany || right.length === tooMany) return null;
  let prefix = 0, lastA = left.length, lastB = right.length;
  while (prefix < Math.min(lastA, lastB) && left[prefix] === right[prefix]) prefix++;
  while (lastA > prefix && lastB > prefix && left[lastA - 1] === right[lastB - 1]) { lastA--; lastB--; }
  const countA = lastA - prefix, countB = lastB - prefix;
  if (countA * countB > workLimit) return null;
  const choices = new Uint8Array(countA * countB);
  let next = new Uint32Array(countB + 1);
  let current = new Uint32Array(countB + 1);
  for (let i = countA - 1; i >= 0; i--) {
    for (let j = countB - 1; j >= 0; j--) {
      if (left[prefix + i] === right[prefix + j]) current[j] = next[j + 1] + 1;
      else if (next[j] >= current[j + 1]) { choices[i * countB + j] = 1; current[j] = next[j]; }
      else { choices[i * countB + j] = 2; current[j] = current[j + 1]; }
    }
    [next, current] = [current, next];
  }
  const rows = [];
  const same = (i, j) => rows.push({ type: 'same', text: left[i], left: i + 1, right: j + 1 });
  for (let i = 0; i < prefix; i++) same(i, i);
  let i = prefix, j = prefix;
  while (i < lastA || j < lastB) {
    const choice = i === lastA ? 2 : j === lastB ? 1 : choices[(i - prefix) * countB + j - prefix];
    if (choice === 0) same(i++, j++);
    else if (choice === 1) rows.push({ type: 'del', text: left[i], left: ++i });
    else rows.push({ type: 'add', text: right[j], right: ++j });
  }
  while (i < left.length) same(i++, j++);
  return rows;
}
