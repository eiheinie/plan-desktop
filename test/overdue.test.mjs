import test from 'node:test';
import assert from 'node:assert/strict';
import {isOverdue,isDailyOverdue} from '../model.mjs';
test('逾期只标记超时未完成任务，每日完成只影响当天',()=>{
 const now=new Date('2026-10-15T18:00:01');
 assert.equal(isOverdue({due:'2026-10-15T18:00',done:false},now),true);
 assert.equal(isOverdue({due:'2026-10-15T18:01',done:false},now),false);
 assert.equal(isOverdue({due:'2026-10-14T18:00',done:true},now),false);
 const daily={time:'18:00',completedDates:['2026-10-14']};
 assert.equal(isDailyOverdue(daily,now),true);
 assert.equal(isDailyOverdue({...daily,completedDates:['2026-10-15']},now),false);
 assert.equal(isDailyOverdue({...daily,time:''},now),false);
 assert.equal(isDailyOverdue(daily,new Date('2026-10-16T09:00')),false);
});
