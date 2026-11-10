import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { startSidecar } from './scripts/json-test-support.mjs';
const sidecar = await startSidecar();
const edgePaths=['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Microsoft/Edge/Application/msedge.exe'];
let executablePath;
for(const name of edgePaths)try{await fs.access(name);executablePath=name;break;}catch{}
const browser=await puppeteer.launch({executablePath,headless:true});
let count=0, saveResult={saved:true}, downloads=[], savedSessions=0;
const settings=new Map();
try {
 const page=await browser.newPage(); await page.setViewport({width:1500,height:950});
 const errors=[]; page.on('pageerror',error=>errors.push(error.message));
 await page.exposeFunction('__testRpc',async(method,params)=>{
   assert.ok(Buffer.byteLength(JSON.stringify(params)) <= 2 * 1024 * 1024, 'real host caps each request at 2MiB');
   const result=await sidecar.invoke(method,params); if(method==='json/session/save')savedSessions++; return result;
 });
 await page.exposeFunction('__testStorage',async(method,key,value)=>{
   if(method==='get')return settings.get(key)??null;
   if(method==='delete'){settings.delete(key);return null;}
   assert.ok(Buffer.byteLength(JSON.stringify(value))<=256*1024); settings.set(key,value); return null;
 });
 await page.exposeFunction('__testSave',async(options,bytes)=>{downloads.push({options,text:Buffer.from(bytes).toString('utf8')});return saveResult;});
 const bridge=`<script>window.__sandboxCheck=[];try{localStorage.getItem('x')}catch(e){window.__sandboxCheck[0]=e.name}try{new Function('return 1')}catch(e){window.__sandboxCheck[1]=e.name}
 window.__closeListeners=[];window.__contextListeners=[];window.dbxPlugin={
   ready:Promise.resolve(),capabilities:{storage:true},
   storage:{get:k=>__testStorage('get',k),set:(k,v)=>__testStorage('set',k,v),delete:k=>__testStorage('delete',k)},
   invoke:(m,p)=>__testRpc(m,p),saveFile:(o,b)=>__testSave(o,Array.from(b)),
   onContext:fn=>window.__contextListeners.push(fn),workbench:{onClose:fn=>window.__closeListeners.push(fn)}
 };</script>`;
 const csp=`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' http://127.0.0.1:5199; style-src 'unsafe-inline' http://127.0.0.1:5199; img-src data: blob: http://127.0.0.1:5199; font-src data: http://127.0.0.1:5199; connect-src 'none'; worker-src 'none'">`;
 await page.setRequestInterception(true);
 page.on('request',async request=>{
   const url=new URL(request.url());
   if(url.origin!=='http://127.0.0.1:5199'){await request.continue();return;}
   try{
     const relative=decodeURIComponent(url.pathname).replace(/^\//,'')||'index.html';
     const root=path.resolve('ui'), file=path.resolve(root,relative);
     if(!file.startsWith(root+path.sep))throw Error('invalid asset path');
     let body=await fs.readFile(file);
     if(relative==='index.html')body=Buffer.from(body.toString('utf8').replace('<head>','<head>'+csp+bridge));
     const mime={'.js':'text/javascript','.html':'text/html','.css':'text/css','.svg':'image/svg+xml'}[path.extname(file)]||'application/octet-stream';
     await request.respond({status:200,headers:{'Content-Type':mime+'; charset=utf-8','Access-Control-Allow-Origin':'*'},body});
   }catch{await request.respond({status:404,body:'not found'});}
 });
 await page.setContent('<iframe sandbox="allow-scripts" style="width:1480px;height:920px" src="http://127.0.0.1:5199/index.html"></iframe>');
 const frame=await (await page.$('iframe')).contentFrame();
 await frame.waitForFunction(()=>document.querySelector('#editor')?.readOnly===false);
 async function check(name,fn){await fn();count++;console.log('PASS '+name);}
 async function load(text){await frame.evaluate(text=>{const e=document.querySelector('#editor');e.value=text;e.dispatchEvent(new Event('input',{bubbles:true}));},text);await frame.waitForFunction(()=>document.querySelector('#editor-hint').textContent!=='待解析');}
 const grid=()=>frame.$eval('#grid',e=>e.textContent);
 await check('opaque sandbox denies localStorage and eval, app still starts',async()=>{
   assert.deepEqual(await frame.evaluate(()=>window.__sandboxCheck),['SecurityError','EvalError']);
   assert.ok(await frame.$('table.jgrid'));
 });
 await check('J01 formatting and compression keep raw numeric tokens',async()=>{
   const text='{"id":9007199254740993,"d":0.1234567890123456789,"e":1e400,"n":-0}';await load(text);
   assert.ok((await grid()).includes('9007199254740993'));
   await frame.click('[data-act="format"]');assert.ok((await frame.$eval('#editor',e=>e.value)).includes('9007199254740993'));
   await frame.click('[data-act="minify"]');assert.equal(await frame.$eval('#editor',e=>e.value),text);
 });
 await check('J03 special and escaped keys select the exact source',async()=>{
   await load('{"a/b":11,"a":{"b":22},"a~b":33,"\\u0061":44,"emoji😀":"中文😀","a#key":55,"":66}');
   for(const [wanted,expected] of [['11','11'],['33','33'],['44','44'],['中文😀','"中文😀"'],['55','55'],['66','66']]){
     assert.equal(await frame.evaluate(wanted=>{[...document.querySelectorAll('#grid td.val')].find(e=>e.textContent===wanted).click();const e=document.querySelector('#editor');return e.value.slice(e.selectionStart,e.selectionEnd)},wanted),expected);
   }
 });
 await check('J02 rapid tab switches keep text and table in sync',async()=>{
   await load('{"old":1}');const first=await frame.$eval('.tab.active',e=>e.dataset.tabId);await frame.click('#tab-add');await load('{"second":2}');const second=await frame.$eval('.tab.active',e=>e.dataset.tabId);
   await frame.evaluate(id=>document.querySelector('[data-tab-id="'+id+'"]').click(),first);
   await frame.evaluate(id=>{const e=document.querySelector('#editor');e.value='{"new":99}';e.dispatchEvent(new Event('input'));document.querySelector('[data-tab-id="'+id+'"]').click()},second);
   await frame.evaluate(id=>document.querySelector('[data-tab-id="'+id+'"]').click(),first);
   assert.equal(await frame.$eval('#editor',e=>e.value),'{"new":99}');assert.ok((await grid()).includes('new99'));assert.ok(!(await grid()).includes('old'));
 });
 await check('J04 sidecar filtering works under CSP and cannot jump to wrong source',async()=>{
   await load('[{"id":1},{"id":2}]');
   await frame.evaluate(()=>{document.querySelector('#filter-code').value='return _.filter(data,x=>x.id===2)';document.querySelector('#filter-apply').click()});
   await frame.waitForFunction(()=>document.querySelector('#grid-hint').textContent.includes('筛选结果'));
   assert.ok(!(await grid()).includes('id11'));
   const selected=await frame.evaluate(()=>{const e=document.querySelector('#editor');e.setSelectionRange(0,0);document.querySelector('#grid td.val[data-kind="value"]').click();return e.value.slice(e.selectionStart,e.selectionEnd)});assert.equal(selected,'2');
 });
 await check('J04 constructed or mutated filter results do not invent source locations',async()=>{
   for(const code of ['return [{...data[1]}]','data[1].id=99;return [data[1]]']){
     await frame.evaluate(code=>{document.querySelector('#filter-code').value=code;document.querySelector('#filter-apply').click()},code);
     await frame.waitForFunction(()=>document.querySelector('#grid-hint').textContent.includes('独立结果'));
     assert.equal(await frame.evaluate(()=>{const e=document.querySelector('#editor');e.setSelectionRange(0,0);document.querySelector('#grid td.val[data-kind="value"]').click();return e.selectionEnd-e.selectionStart}),0);
   }
 });
 await check('J05 invalid text clears filtered result immediately',async()=>{
   await frame.evaluate(()=>{const e=document.querySelector('#editor');e.value='{';e.dispatchEvent(new Event('input'))});
   assert.ok(!(await grid()).includes('id'));await frame.waitForFunction(()=>document.querySelector('#editor-hint').textContent==='解析失败');assert.ok((await grid()).includes('解析失败'));
 });
 await check('J06 primitives including filtered null render and export',async()=>{
   for(const text of ['0','false','null','""']){await load(text);assert.ok(await frame.$('.root-scalar'));await frame.click('[data-act="export"]');await frame.waitForFunction(()=>document.querySelector('#status').textContent==='已导出 CSV');}
   await load('{}');await frame.evaluate(()=>{document.querySelector('#filter-code').value='return null';document.querySelector('#filter-apply').click()});
   await frame.waitForFunction(()=>document.querySelector('#grid-hint').textContent.includes('筛选结果'));assert.equal((await grid()).trim(),'null');
 });
 await check('J07/J08 own fields and nested CSV use host saveFile',async()=>{
   await load('[{"toString":"hello","meta":{"a":1}},{}]');assert.ok(!(await grid()).includes('native code'));
   const before=downloads.length;await frame.click('[data-act="export"]');await frame.waitForFunction(()=>document.querySelector('#status').textContent==='已导出 CSV');
   assert.equal(downloads.length,before+1);assert.ok(downloads.at(-1).text.includes('"{""a"":1}"'));assert.ok(!downloads.at(-1).text.includes('[object Object]'));
   saveResult=null;await frame.click('[data-act="export"]');await frame.waitForFunction(()=>document.querySelector('#status').textContent==='已取消导出');saveResult={saved:true};
 });
 await check('J09 Tab edits are persisted through sidecar, not localStorage',async()=>{
   await load('{"a":1}');await frame.focus('#editor');await frame.evaluate(()=>document.querySelector('#editor').setSelectionRange(1,1));await page.keyboard.press('Tab');
   await frame.waitForFunction(()=>document.querySelector('#editor-hint').textContent==='JSON 合法');
   await frame.evaluate(async()=>{for(const fn of window.__closeListeners)await fn()});
   const session=await sidecar.invoke('json/session/load');assert.equal(session.tabs.find(t=>t.id===session.activeId).text,'{  "a":1}');
 });
 await check('J10 folded data, paging, collapse, nested scrolling and tab restore',async()=>{
   await load(JSON.stringify(Array.from({length:5000},(_,id)=>({id,nested:{items:Array.from({length:30},(_,i)=>i)}}))));
   assert.equal(await frame.$$eval('#grid table',e=>e.length),1);assert.equal(await frame.$$eval('#grid tr.row',e=>e.length),100);
   await frame.click('#grid .tgl');assert.equal(await frame.$$eval('#grid table',e=>e.length),2);
   const childToggle=await frame.$('.nested-box .tgl');await childToggle.click();assert.equal(await frame.$$eval('#grid table',e=>e.length),3);
   await frame.evaluate(()=>{const blocks=[...document.querySelectorAll('.nested-box .table-block')];blocks.at(-1).scrollTop=250});
   const first=await frame.$eval('.tab.active',e=>e.dataset.tabId);await frame.click('#tab-add');await frame.evaluate(id=>document.querySelector('[data-tab-id="'+id+'"]').click(),first);
   await frame.waitForFunction(()=>[...document.querySelectorAll('.nested-box .table-block')].at(-1)?.scrollTop>0);
   assert.equal(await frame.$$eval('#grid table',e=>e.length),3);await frame.click('#grid .tgl');assert.equal(await frame.$$eval('#grid table',e=>e.length),1);
   await frame.click('[data-page-node][data-page="1"]');assert.ok((await grid()).includes('显示 101–200'));
 });
 await check('host settings and large document survive close and restore',async()=>{
   await frame.click('[data-act="theme"]');assert.equal(settings.get('cc-toolbox-theme'),'dark');
   const text=JSON.stringify({name:'中文😀'.repeat(50000)});await load(text);
   await frame.evaluate(async()=>{for(const fn of window.__closeListeners)await fn()});
   const prior=savedSessions;await Promise.all([frame.waitForNavigation({waitUntil:'load'}),frame.evaluate(()=>location.reload())]);await frame.waitForFunction(()=>document.querySelector('#editor')?.readOnly===false);
   assert.equal(await frame.$eval('#editor',e=>e.value.length),text.length);assert.equal(await frame.$eval('#editor',e=>e.value),text);assert.ok(savedSessions>=prior);
 });
 await check('multi-MiB session transfers respect per-request bridge caps',async()=>{
   const original=await sidecar.invoke('json/session/load');
   const length=await frame.evaluate(async()=>{
     const {createHostAdapter}=await import('http://127.0.0.1:5199/js/host-adapter.js');const adapter=await createHostAdapter();
     const text=JSON.stringify({name:'中文😀'.repeat(250000)});
     await adapter.saveTabs({activeId:'tab-transport',tabs:[{id:'tab-transport',text,title:'传输测试'}]});
     const loaded=await adapter.loadTabs();if(loaded.tabs[0].text!==text)throw Error('transfer corruption');return loaded.tabs[0].text.length;
   });assert.equal(length,1000011);await sidecar.invoke('json/session/save',{session:original});
 });
 await check('large exports stream all bytes and handle cancellation or short writes',async()=>{
   const result=await frame.evaluate(async()=>{
     const {createHostAdapter}=await import('http://127.0.0.1:5199/js/host-adapter.js');const adapter=await createHostAdapter();
     let size=0,finished=false,cancelled=false,options;
     window.dbxPlugin.fileTransfer={beginSave:async o=>{options=o;return{handleId:'test',chunkBytes:32768}},write:async(id,offset,bytes)=>{if(offset!==size)throw Error('wrong offset');size+=bytes.length;return{written:bytes.length}},finish:async()=>{finished=true},cancel:async()=>{cancelled=true}};
     const saved=await adapter.saveFile('large.csv','text/csv','a'.repeat(5*1024*1024));
     const successful={saved,size,finished,name:options.name};
     window.dbxPlugin.fileTransfer.beginSave=async()=>null;
     const aborted=await adapter.saveFile('cancel.csv','text/csv','a'.repeat(5*1024*1024));
     window.dbxPlugin.fileTransfer.beginSave=async()=>({handleId:'test'});window.dbxPlugin.fileTransfer.write=async()=>({written:0});
     let error;try{await adapter.saveFile('short.csv','text/csv','a'.repeat(5*1024*1024))}catch(e){error=e.message}
     return{...successful,aborted,cancelled,error};
   });assert.equal(result.saved,true);assert.equal(result.size,5*1024*1024);assert.equal(result.name,'large.csv');assert.equal(result.finished,true);assert.equal(result.aborted,false);assert.equal(result.cancelled,true);assert.match(result.error,/完整/);
 });
 await check('failed recovery does not silently overwrite the previous recovery file',async()=>{
   const original=await sidecar.invoke('json/session/load');const file=path.join(sidecar.directory,'json-workbench','session.json');await fs.writeFile(file,'{broken','utf8');
   const result=await frame.evaluate(async()=>{
     const {createHostAdapter}=await import('http://127.0.0.1:5199/js/host-adapter.js');const adapter=await createHostAdapter();
     const recovered=await adapter.loadTabs();let error;try{await adapter.saveTabs({tabs:[]})}catch(e){error=e.message}return{recovered,error};
   });assert.equal(result.recovered,null);assert.match(result.error,/保留/);assert.equal(await fs.readFile(file,'utf8'),'{broken');await sidecar.invoke('json/session/save',{session:original});
 });
 assert.deepEqual(errors,[]); console.log('ALL '+count+' SANDBOX/HOST GROUPS OK');
}finally{await browser.close();await sidecar.close();}
