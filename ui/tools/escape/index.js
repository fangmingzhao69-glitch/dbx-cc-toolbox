import template from './template.js';
import { encodeEscape, decodeEscape } from './codec.js';

export default function mount({ host, toast }, panel) {
  panel.innerHTML = template;
  const get = name => panel.querySelector('#escape-' + name);
  const input = get('input');
  const output = get('output');
  const hint = get('hint');
  const copy = get('copy');
  const reuse = get('reuse');
  let result;
  // A textarea normalizes CR to LF. Retain the exact result when it is used for the next operation.
  let reusedInput;

  function showResult(value, message) {
    result = value;
    output.value = value ?? '';
    copy.disabled = reuse.disabled = value === undefined;
    hint.textContent = message;
  }

  function convert(operation, label) {
    const text = reusedInput ?? input.value;
    if (!text) {
      showResult(undefined, '请先输入文本');
      input.focus();
      return;
    }
    showResult(operation(text), label + '完成');
  }

  input.addEventListener('input', () => {
    reusedInput = undefined;
    showResult(undefined, '请选择编码或解码');
  });
  get('encode').addEventListener('click', () => convert(encodeEscape, '编码'));
  get('decode').addEventListener('click', () => convert(decodeEscape, '解码'));
  copy.addEventListener('click', () => {
    if (result !== undefined) void host.copyText(result, toast);
  });
  reuse.addEventListener('click', () => {
    if (result === undefined) return;
    reusedInput = result;
    input.value = result;
    showResult(undefined, '结果已移到输入区');
    input.focus();
  });
  get('clear').addEventListener('click', () => {
    reusedInput = undefined;
    input.value = '';
    showResult(undefined, '兼容 %XX 和 %uXXXX 转义');
    input.focus();
  });
}
