import test from 'node:test';
import assert from 'node:assert/strict';
import {insertTaskByStart,reorder} from '../model.mjs';
const task=(id,start)=>({id,start});
test('按时间插入但保持已有手动顺序，相同开始时间稳定排列',()=>{
 const a=task('a','2026-10-01T09:00'),b=task('b','2026-10-03T09:00'),c=task('c','2026-10-05T09:00');
 assert.deepEqual(insertTaskByStart([a,c],b).map(t=>t.id),['a','b','c']);
 const manual=reorder([a,b,c],'c','a');
 const next=insertTaskByStart(manual,task('new','2026-10-02T09:00'));
 assert.deepEqual(next.filter(t=>t.id!=='new'),manual);
 assert.deepEqual(insertTaskByStart([a,b],task('equal',b.start)).map(t=>t.id),['a','b','equal']);
 assert.deepEqual(insertTaskByStart([a,b,c],{...b,start:'2026-10-06T09:00'}).map(t=>t.id),['a','c','b']);
 assert.deepEqual(insertTaskByStart([],a),[a]);
});
