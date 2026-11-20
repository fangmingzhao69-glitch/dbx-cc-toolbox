// Legacy JavaScript Escape uses UTF-16 code units, not UTF-8 bytes.
export function encodeEscape(text) {
  return text.replace(/[^A-Za-z0-9*@_+./-]/g, character => {
    const value = character.charCodeAt(0);
    const hex = value.toString(16).toUpperCase();
    return value <= 0xFF ? '%' + hex.padStart(2, '0') : '%u' + hex.padStart(4, '0');
  });
}

export function decodeEscape(text) {
  return text.replace(/%u([0-9a-fA-F]{4})|%([0-9a-fA-F]{2})/g, (match, wide, narrow) =>
    String.fromCharCode(Number.parseInt(wide ?? narrow, 16)));
}
