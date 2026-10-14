import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { migrate, validateDailyTasks, dailyDone, toggleDaily } from '../model.mjs';
import { createPlanServer } from '../server.mjs';

const daily = {id:'reading',title:'每天阅读',time:'21:00',completedDates:[]};
const plan = {id:'project',title:'项目计划',start:'2026-10-14T09:00',due:'2026-10-20T18:00',done:false};
test('旧计划无损迁移，每日任务按日期完成和撤销，跨日和跨年不继承完成状态',()=>{
  const migrated=migrate({version:3,revision:7,tasks:[plan]});
  assert.deepEqual(migrated.tasks,[plan]);assert.deepEqual(migrated.dailyTasks,[]);assert.equal(migrated.version,4);assert.equal(migrated.revision,7);
  const yesterday=toggleDaily(daily,'2026-12-31');
  assert.equal(dailyDone(yesterday,'2026-12-31'),true);assert.equal(dailyDone(yesterday,'2027-01-01'),false);
  const today=toggleDaily(yesterday,'2027-01-01');
  assert.deepEqual(toggleDaily(today,'2027-01-01').completedDates,['2026-12-31']);
  assert.deepEqual(migrate({...migrated,dailyTasks:[today]}).dailyTasks,[today]);
  assert.throws(()=>validateDailyTasks([{...daily,time:'24:00'}]));
  assert.throws(()=>validateDailyTasks([{...daily,completedDates:['2026-02-30']}]));
  assert.throws(()=>validateDailyTasks([daily,daily]));
});

test('每日任务和普通计划独立保存、冲突保护、重启保留完成记录',async()=>{
  const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'plan-daily-test-'));
  fs.writeFileSync(path.join(dataDir,'tasks.json'),JSON.stringify({version:3,revision:0,tasks:[plan]}));
  let server,url,state;
  const start=async()=>{server=createPlanServer({dataDir,startupAdapter:{get:async()=>false}});await new Promise(r=>server.listen(0,'127.0.0.1',r));url=`http://127.0.0.1:${server.address().port}`;state=await(await fetch(url+'/api/state')).json();};
  const send=(route,body)=>fetch(url+route,{method:'POST',headers:{'Content-Type':'application/json','X-Plan-Token':state.token},body:JSON.stringify(body)});
  try {
    await start();
    const completed=toggleDaily(daily,'2026-10-14');
    assert.equal((await send('/api/daily',{revision:0,dailyTasks:[completed]})).status,200);
    assert.equal((await send('/api/tasks',{revision:0,tasks:[]})).status,409);
    assert.equal((await send('/api/tasks',{revision:1,tasks:[{...plan,done:true}]})).status,200);
    assert.equal((await send('/api/daily',{revision:2,dailyTasks:[{...daily,time:'invalid'}]})).status,400);
    await new Promise(r=>server.close(r));await start();
    assert.deepEqual(state.dailyTasks,[completed]);assert.equal(state.tasks[0].done,true);assert.equal(state.revision,2);
    assert.equal((await send('/api/daily',{revision:2,dailyTasks:[]})).status,200);
    const saved=JSON.parse(fs.readFileSync(path.join(dataDir,'tasks.json')));
    assert.equal(saved.tasks[0].done,true);assert.deepEqual(saved.dailyTasks,[]);
  } finally {
    if(server?.listening)await new Promise(r=>server.close(r));
    // mkdtemp creates this test-owned directory directly inside the system temp folder.
    if(path.dirname(dataDir)===os.tmpdir()&&path.basename(dataDir).startsWith('plan-daily-test-'))fs.rmSync(dataDir,{recursive:true,force:true});
  }
});
