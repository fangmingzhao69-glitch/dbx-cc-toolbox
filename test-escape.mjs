import assert from 'node:assert/strict';
import { encodeEscape, decodeEscape } from './ui/tools/escape/codec.js';

assert.equal(encodeEscape('AZaz09*@_+./-'), 'AZaz09*@_+./-');
assert.equal(encodeEscape('中😀 é%'), '%u4E2D%uD83D%uDE00%20%E9%25');
assert.equal(decodeEscape('%u0041%0D%0A%e9%uD83D%uDE00'), 'A\r\né😀');
assert.equal(decodeEscape('%25u4E2D+%U0041%2G%u12%Z'), '%u4E2D+%U0041%2G%u12%Z');
assert.equal(decodeEscape('%u00411'), 'A1');

// Compare every UTF-16 code unit, including surrogate halves, with the reference semantics.
let source = '';
for (let i = 0; i <= 0xFFFF; i++) source += String.fromCharCode(i);
assert.equal(encodeEscape(source), globalThis.escape(source));
assert.equal(decodeEscape(encodeEscape(source)), source);
console.log('PASS Escape compatibility for all 65536 UTF-16 code units and malformed sequences');
