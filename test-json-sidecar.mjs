import assert from 'node:assert/strict';
import { startSidecar } from './scripts/json-test-support.mjs';
const sidecar = await startSidecar(); let count = 0;
async function check(name, fn) { await fn(); count++; console.log('PASS '+name); }
try {
  await check('initialize advertises JSON and original print capabilities',async()=>{
    const result=await sidecar.invoke('plugin/initialize'); assert.ok(result.capabilities.includes('json/filter')); assert.ok(result.capabilities.includes('invoice/print'));
  });
  await check('lodash filter works through JSONL',async()=>{
    const result=await sidecar.invoke('json/filter',{text:'[{"id":1},{"id":2}]',code:'return _.filter(data, x => x.id === 2);'}); assert.equal(result.text,'[{"id":2}]');
  });
  await check('null and safe decimal results',async()=>{
    assert.equal((await sidecar.invoke('json/filter',{text:'0.1',code:'return data;'})).text,'0.1');
    assert.equal((await sidecar.invoke('json/filter',{text:'{}',code:'return null;'})).text,'null');
  });
  await check('non JSON, cyclic and nonfinite outputs are rejected',async()=>{
    for(const code of ['return undefined;','return NaN;','const x={};x.x=x;return x;','return {a:undefined};']) await assert.rejects(sidecar.invoke('json/filter',{text:'{}',code}));
  });
  await check('unsafe numbers and duplicate fields are rejected by sidecar too',async()=>{
    for(const text of ['9007199254740993','0.1234567890123456789','1e400','1e-400','{"a":1,"a":2}']) await assert.rejects(sidecar.invoke('json/filter',{text,code:'return data;'}));
  });
  await check('infinite loops are bounded and next call still works',async()=>{
    await assert.rejects(sidecar.invoke('json/filter',{text:'{}',code:'while(true) {}'}));
    assert.equal((await sidecar.invoke('json/filter',{text:'[1,2]',code:'return data;'})).text,'[1,2]');
  });
  await check('CLR, process and filesystem globals are unavailable',async()=>{
    const result=await sidecar.invoke('json/filter',{text:'{}',code:'return [typeof System,typeof require,typeof process,typeof fetch];'});
    assert.deepEqual(JSON.parse(result.text),['undefined','undefined','undefined','undefined']);
  });
  await check('large sessions exceed host storage value limit and restore exactly',async()=>{
    const session={activeId:'tab-1',tabs:[{id:'tab-1',title:'测试',text:JSON.stringify({id:'9'.repeat(300000)})}]};
    await sidecar.invoke('json/session/save',{session}); assert.deepEqual(await sidecar.invoke('json/session/load'),session);
    await assert.rejects(sidecar.invoke('json/session/save',{session:{tabs:[{text:3}]}})); assert.deepEqual(await sidecar.invoke('json/session/load'),session);
  });
  console.log('ALL '+count+' SIDECAR GROUPS OK');
} finally { await sidecar.close(); }
