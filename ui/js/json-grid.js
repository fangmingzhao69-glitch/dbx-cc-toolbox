import { parseDocument, toJs, csvDocument, assertFilterSafe } from './json-document.js';
import { createGridView } from './json-view.js';
export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
}
export const isPlainObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export const kindOf = value => value == null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
export function displayScalar(value) {
  return value == null ? 'null' : typeof value === 'object' ? JSON.stringify(value) : String(value);
}
export function formatBytes(bytes) {
  return bytes < 1024 ? bytes + ' B' : bytes < 1048576 ? (bytes / 1024).toFixed(1) + ' KB' : (bytes / 1048576).toFixed(2) + ' MB';
}
export function parseJsonDocument(text) {
  const document = parseDocument(text);
  return { ok: document.ok, document, error: document.error, get data() {
    if (!document.ok) return null;
    assertFilterSafe(document);
    return toJs(document.root);
  } };
}
export function renderRoot(data) {
  const doc = parseDocument(JSON.stringify(data));
  if (!doc.ok) throw new Error(doc.error.message);
  return createGridView(doc).render();
}
export function summarize(data) {
  return { kind: kindOf(data), count: data && typeof data === 'object' ? Object.keys(data).length : 0 };
}
export function toCsv(data) { return csvDocument(parseDocument(JSON.stringify(data))); }
