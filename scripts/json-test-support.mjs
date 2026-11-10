import { spawn } from 'node:child_process';
import readline from 'node:readline';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
export async function startSidecar() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cc-json-test-'));
  const dll = fileURLToPath(new URL('../sidecar/InvoiceSidecarNoWf/bin/Release/net10.0-windows/win-x64/cc-invoice-sidecar.dll', import.meta.url));
  const binary = globalThis.process.env.CC_JSON_SIDECAR_EXE;
  const process = spawn(binary || 'dotnet', binary ? [] : [dll], { windowsHide: true, env: { ...globalThis.process.env, DBX_PLUGIN_DATA_DIR: directory }, stdio: ['pipe','pipe','pipe'] });
  let sequence = 0, stderr = ''; const pending = new Map();
  process.stderr.on('data', chunk => { stderr += chunk; });
  const exit = new Promise(resolve => process.once('exit', resolve));
  const lines = readline.createInterface({ input: process.stdout });
  lines.on('line', line => {
    const result = JSON.parse(line), task = pending.get(result.id);
    if (!task) return; pending.delete(result.id); clearTimeout(task.timer);
    if (result.error) task.reject(new Error(result.error.message)); else task.resolve(result.result);
  });
  return { directory, async invoke(method, params = {}) {
    const id = ++sequence;
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(new Error('sidecar timeout: '+method+' '+stderr)); }, 15000);
      pending.set(id,{resolve,reject,timer}); process.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n');
    });
  }, async close() {
    process.stdin.end(); await exit; lines.close();
    const resolved = await fs.realpath(directory), temporaryRoot = await fs.realpath(os.tmpdir());
    if (path.dirname(resolved).toLowerCase() !== temporaryRoot.toLowerCase() || !path.basename(resolved).startsWith('cc-json-test-')) throw Error('Unexpected test cleanup directory');
    await fs.rm(resolved,{recursive:true,force:true});
  } };
}
