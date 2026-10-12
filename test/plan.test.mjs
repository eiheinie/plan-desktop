import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate, monthSpan, reorder, validateTasks, localTime } from '../model.mjs';
import { createPlanServer } from '../server.mjs';
const here=path.dirname(fileURLToPath(import.meta.url)), root=path.resolve(here,'..');
const base={id:'task-one',title:'中文任务',start:'2026-10-12T09:30',due:'2026-10-17T18:00',done:false};
test('旧版 .NET 日期和已有完成状态正确迁移',()=>{
 const ms=+new Date('2026-10-17T18:00'); const result=migrate([{Title:'旧任务',Due:`/Date(${ms}+0800)/`,Done:true}],new Date('2026-10-12T10:00'));
 assert.equal(result.tasks[0].due,localTime(new Date(ms)));assert.equal(result.tasks[0].start,'2026-10-12T00:00');assert.equal(result.tasks[0].done,true);
 const overdue=migrate([{Title:'过期任务',Due:'/Date('+ +new Date('2026-10-01T12:00') +')/',Done:false}],new Date('2026-10-12'));assert.equal(overdue.tasks[0].start,'2026-10-01T00:00');
});
test('时间跨度覆盖同日、跨月和闰年边界',()=>{
 assert.deepEqual(monthSpan(base,2026,9),{first:11,last:16,before:false,after:false});
 assert.deepEqual(monthSpan({...base,start:'2026-09-29T10:00',due:'2026-11-02T18:00'},2026,9),{first:0,last:30,before:true,after:true});
 assert.deepEqual(monthSpan({...base,start:'2028-02-29T08:00',due:'2028-02-29T19:00'},2028,1),{first:28,last:28,before:false,after:false});
 assert.equal(monthSpan(base,2026,10),null);
});
test('拖动前后位置、持久顺序及输入校验',()=>{
 const tasks=['a','b','c'].map(id=>({...base,id}));assert.deepEqual(reorder(tasks,'a','c',true).map(t=>t.id),['b','c','a']);assert.deepEqual(reorder(tasks,'c','a').map(t=>t.id),['c','a','b']);assert.deepEqual(tasks.map(t=>t.id),['a','b','c']);
 assert.throws(()=>validateTasks([{...base,start:'2026-10-18T00:00'}]));assert.throws(()=>validateTasks([{...base,due:'2026-02-30T12:00'}]));assert.throws(()=>validateTasks([base,base]));
});
test('HTTP 保存重启、冲突防护、备份恢复及自启动开关',async()=>{
 const dataDir=fs.mkdtempSync(path.join(here,'test-plan-'));let enabled=false;
 const adapter={get:async()=>enabled,set:async value=>enabled=value};
 let server=createPlanServer({root,dataDir,startupAdapter:adapter});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 let url=`http://127.0.0.1:${server.address().port}`;
 const send=(route,data,token,extra={})=>fetch(url+route,{method:'POST',headers:{'Content-Type':'application/json','X-Plan-Token':token,...extra},body:JSON.stringify(data)});
 try {
  let state=await (await fetch(url+'/api/state')).json();assert.equal(state.tasks.length,0);
  let r=await send('/api/tasks',{revision:0,tasks:[base]},state.token);assert.equal(r.status,200);
  r=await send('/api/tasks',{revision:0,tasks:[]},state.token);assert.equal(r.status,409);
  r=await send('/api/tasks',{revision:1,tasks:[]},'bad');assert.equal(r.status,403);
  r=await send('/api/tasks',{revision:1,tasks:[]},state.token,{Origin:'https://untrusted.example'});assert.equal(r.status,403);
  assert.equal((await fetch(url+'/server.mjs')).status,404);
  r=await send('/api/startup',{enabled:true},state.token);assert.equal((await r.json()).autostart,true);r=await send('/api/startup',{enabled:false},state.token);assert.equal((await r.json()).autostart,false);
  r=await send('/api/tasks',{revision:1,tasks:[{...base,done:true}]},state.token);assert.equal(r.status,200);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dataDir,'tasks.json.bak'))).tasks[0].done,false);
  await new Promise(r=>server.close(r));
  server=createPlanServer({root,dataDir,startupAdapter:adapter});await new Promise(r=>server.listen(0,'127.0.0.1',r));url=`http://127.0.0.1:${server.address().port}`;
  state=await (await fetch(url+'/api/state')).json();assert.equal(state.tasks[0].done,true);assert.equal(state.revision,2);
  await new Promise(r=>server.close(r));fs.writeFileSync(path.join(dataDir,'tasks.json'),'broken');
  server=createPlanServer({root,dataDir,startupAdapter:adapter});await new Promise(r=>server.listen(0,'127.0.0.1',r));url=`http://127.0.0.1:${server.address().port}`;
  state=await (await fetch(url+'/api/state')).json();assert.equal(state.tasks[0].done,false);assert.equal(state.readOnly,false);assert.ok(state.warning);assert.ok(fs.readdirSync(dataDir).some(x=>x.includes('.damaged-')));
 } finally { if(server.listening)await new Promise(r=>server.close(r));fs.rmSync(dataDir,{recursive:true,force:true}); }
});
