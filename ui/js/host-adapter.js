export async function createHostAdapter(notify = () => {}) {
  const bridge = window.dbxPlugin;
  if (bridge) await bridge.ready;
  const values = new Map();
  const keys = ['theme', 'wrap', 'split', 'tool', 'zoom', 'batch'].map(k => 'cc-toolbox-' + k);
  const report = error => notify('自动保存失败：' + error.message + '，请导出后再关闭', 'error');
  if (bridge) {
    if (!bridge.capabilities?.storage) notify('宿主不支持保存设置，本次设置仅在当前窗口有效', 'error');
    else for (const key of keys) {
      try { values.set(key, await bridge.storage.get(key)); } catch (error) { report(error); }
    }
  } else {
    for (const key of keys) try { values.set(key, localStorage.getItem(key)); } catch (error) { report(error); }
  }
  let queue = Promise.resolve();
  let cleared = false;
  let restorationFailed = false;
  const encode = bytes => { let text = ''; for (const byte of bytes) text += String.fromCharCode(byte); return btoa(text); };
  async function invokeJson(method, params = {}) {
    const bytes = new TextEncoder().encode(JSON.stringify(params));
    const { id } = await bridge.invoke('json/transport/open', { method, length: bytes.length });
    try {
      for (let offset = 0; offset < bytes.length; offset += 65536) {
        await bridge.invoke('json/transport/write', { id, offset, data: encode(bytes.subarray(offset, offset + 65536)) });
      }
      const { length } = await bridge.invoke('json/transport/execute', { id }, { timeoutMs: 8000 });
      if (!Number.isInteger(length) || length < 0 || length > 256 * 1024 * 1024) throw new Error('宿主返回的 JSON 大小不合法');
      const output = new Uint8Array(length);
      for (let offset = 0; offset < length;) {
        const chunk = await bridge.invoke('json/transport/read', { id, offset });
        const decoded = atob(chunk.data);
        if (!decoded.length || decoded.length !== chunk.length || offset + decoded.length > length) throw new Error('JSON 传输不完整');
        for (let i = 0; i < decoded.length; i++) output[offset + i] = decoded.charCodeAt(i);
        offset += decoded.length;
      }
      return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(output));
    } finally { await bridge.invoke('json/transport/release', { id }).catch(() => {}); }
  }
  const enqueue = fn => { const result = queue.then(fn); queue = result.catch(report); return result; };
  return {
    bridge,
    get(key, fallback = null) { return values.get(key) ?? fallback; },
    set(key, value) {
      if (values.get(key) === value) return;
      values.set(key, value);
      void enqueue(async () => {
        if (bridge) {
          if (!bridge.capabilities?.storage) throw new Error('宿主存储不可用');
          await bridge.storage.set(key, value);
        } else localStorage.setItem(key, value);
      }).catch(() => {});
    },
    async loadTabs() {
      try {
        const result = bridge ? await invokeJson('json/session/load') : JSON.parse(localStorage.getItem('cc-toolbox-tabs') || 'null');
        return result?.tabs?.length ? result : null;
      } catch (error) { restorationFailed = true; report(error); return null; }
    },
    saveTabs(session) {
      if (cleared) return Promise.resolve();
      if (restorationFailed) return Promise.reject(new Error('恢复失败，已保留原恢复文件；请导出当前内容'));
      return enqueue(async () => {
        if (bridge) await invokeJson('json/session/save', { session });
        else localStorage.setItem('cc-toolbox-tabs', JSON.stringify(session));
      });
    },
    async flush() { await queue; },
    async clear() {
      for (const key of keys) {
        values.delete(key);
        if (bridge) await enqueue(() => bridge.storage.delete(key));
        else localStorage.removeItem(key);
      }
      restorationFailed = false;
      await this.saveTabs({ activeId: null, tabs: [] });
      cleared = true;
    },
    async saveFile(fileName, contentType, text) {
      const bytes = new TextEncoder().encode(text);
      if (bridge) {
        if (typeof bridge.saveFile !== 'function') throw new Error('宿主不支持文件保存');
        // Host returns null when the user cancels the native dialog.
        if (bytes.length <= 4 * 1024 * 1024) return (await bridge.saveFile({ fileName, contentType }, bytes)) != null;
        const transfer = bridge.fileTransfer;
        if (!transfer) throw new Error('文件超过单次保存大小，当前宿主不支持分块保存');
        const handle = await transfer.beginSave({ name: fileName, contentType, size: bytes.length });
        if (!handle) return false;
        try {
          const chunkSize = Math.min(65536, Math.max(1, handle.chunkBytes || 65536));
          for (let offset = 0; offset < bytes.length; offset += chunkSize) {
            const chunk = bytes.subarray(offset, offset + chunkSize);
            const result = await transfer.write(handle.handleId, offset, chunk);
            if (result.written !== chunk.length) throw new Error('文件未完整写入');
          }
          await transfer.finish(handle.handleId); return true;
        } catch (error) { await transfer.cancel(handle.handleId).catch(() => {}); throw error; }
      }
      const url = URL.createObjectURL(new Blob([bytes], { type: contentType }));
      const link = document.createElement('a'); link.href = url; link.download = fileName;
      document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 4000);
      return true;
    },
    async filter(text, code) {
      if (bridge) {
        const result = await invokeJson('json/filter', { text, code });
        if (typeof result?.text !== 'string') throw new Error('侧车未返回 JSON 结果，请更新插件');
        return result;
      }
      // Standalone preview: isolated worker with a hard wall-clock timeout.
      // DBX always uses the interpreter sidecar, never unsafe-eval in its iframe.
      const lodashUrl = new URL('../assets/lodash.min.js', import.meta.url).href;
      const source = `importScripts(${JSON.stringify(lodashUrl)});onmessage=e=>{try{const {text,code}=e.data;
        const data=JSON.parse(text),source=new WeakMap(),origins=[];let count=0;
        const segment=k=>k.replace(/~/g,'~0').replace(/\\//g,'~1');
        function index(v,p){if(v&&typeof v==='object'){if(++count>100000)throw Error('筛选对象超过限制');source.set(v,p);for(const k of Object.keys(v))index(v[k],p+'/'+segment(k));}}index(data,'');
        const value=new Function('data','_',code)(data,self._);
        const result=JSON.stringify(value,(k,v)=>{if(v===undefined||typeof v==='function'||typeof v==='symbol'||typeof v==='bigint'||typeof v==='number'&&!Number.isFinite(v))throw Error('结果包含非 JSON 值');return v;});
        if(result===undefined)throw Error('筛选函数需要 return JSON 结果');
        function locate(v,p){if(v&&typeof v==='object'){if(source.has(v))origins.push([p,source.get(v)]);for(const k of Object.keys(v))locate(v[k],p+'/'+segment(k));}}locate(value,'');
        postMessage({text:result,origins});
        }catch(e){postMessage({error:e.message})}}`;
      const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
      let worker;
      try {
        return await new Promise((resolve, reject) => {
          worker = new Worker(url);
          const timer = setTimeout(() => { worker.terminate(); reject(new Error('筛选执行超过 2 秒，已终止')); }, 2000);
          const done = fn => value => { clearTimeout(timer); worker.terminate(); fn(value); };
          worker.onmessage = done(e => e.data.error ? reject(new Error(e.data.error)) : resolve(e.data));
          worker.onerror = done(e => reject(new Error(e.message || '筛选执行失败')));
          worker.postMessage({ text, code });
        });
      } finally { worker?.terminate(); URL.revokeObjectURL(url); }
    },
  };
}
