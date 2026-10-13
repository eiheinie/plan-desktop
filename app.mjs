import { localDate, localTime, monthSpan, reorder, validateTasks } from './model.mjs';
const $ = id => document.getElementById(id);
const palette = [['#7360b0','#f0edf9'],['#327e78','#eaf5f2'],['#936d3c','#faf2e8'],['#477ba5','#edf4fa'],['#915b7d','#f7edf4'],['#627f43','#f2f5eb']];
let state = { tasks: [], revision: 0, token: '', readOnly: false }, month = new Date(new Date().getFullYear(), new Date().getMonth(), 1), selected = null, editing = null, filter = 'all', busy = false, dragId = null, toastTimer, pointerDrag = null, suppressClickUntil = 0;
let rowHeight = Number(localStorage.getItem('plan-density') || 64);
if (![42,64].includes(rowHeight)) rowHeight = 64;
$('density').value = String(rowHeight);
function make(tag, className, text) { const e = document.createElement(tag); if (className) e.className = className; if (text !== undefined) e.textContent = text; return e; }
function paintTask(e, index) { const [c,b] = palette[index % palette.length]; e.style.setProperty('--task-color', c); e.style.setProperty('--task-bg', b); }
function notify(message, error = false) { $('status').textContent = message; $('status').classList.toggle('error',error); $('toast').textContent = message; $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(()=>$('toast').hidden = true, 4000); }
async function request(url, body) {
  const response = await fetch(url, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Plan-Token': state.token }, body: JSON.stringify(body) });
  const value = await response.json(); if (!response.ok) { const e = new Error(value.error || '操作未完成。'); e.status = response.status; throw e; } return value;
}
function setBusy(value) { busy = value; document.body.classList.toggle('saving',value); $('save-task').disabled = value; $('startup').disabled = value || !!state.startupError; $('add').disabled = value || state.readOnly; }
async function commit(next) {
  if (busy || state.readOnly) return false;
  setBusy(true);
  try { validateTasks(next); const result = await request('/api/tasks', { revision: state.revision, tasks: next }); state.tasks = next; state.revision = result.revision; $('status').classList.remove('error'); $('status').textContent = `已保存到本机 · ${new Date().toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'})}`; return true; }
  catch (e) { notify(e.message, true); if (e.status === 409) { try { state = await request('/api/state'); render(); } catch (refreshError) { notify(refreshError.message,true); } } return false; }
  finally { setBusy(false); }
}
const dateLabel = s => `${s.slice(5,7)}.${s.slice(8,10)}`;
function filteredTasks() { return state.tasks.filter(t => filter === 'all' || (filter === 'done' ? t.done : !t.done)); }
function choose(id, reveal = false) {
  if (busy) return;
  selected = id;
  if (reveal) { const t = state.tasks.find(t=>t.id===id); if (t && !monthSpan(t,month.getFullYear(),month.getMonth())) { const [y,m]=t.start.slice(0,7).split('-').map(Number); month = new Date(y,m-1,1); } }
  document.querySelectorAll('.task-card').forEach(c=>c.classList.toggle('selected',c.dataset.id===id));
  renderTimeline();
  if (reveal) { const t = state.tasks.find(t=>t.id===id); const span = t && monthSpan(t,month.getFullYear(),month.getMonth()); if (span) $('timeline-scroll').scrollTo({ top: Math.max(0,span.first-1)*rowHeight, left: Math.max(0,filteredTasks().filter(t=>monthSpan(t,month.getFullYear(),month.getMonth())).findIndex(t=>t.id===id))*180, behavior:'smooth' }); }
}
function showEditor(id = null) {
  if (busy || state.readOnly) return;
  editing = id; const t = state.tasks.find(t=>t.id===id), now = new Date(); now.setSeconds(0,0);
  const due = new Date(); due.setDate(due.getDate()+2); due.setHours(18,0,0,0);
  $('editor-title').textContent = t ? '编辑任务' : '新建任务'; $('title').value = t?.title || ''; $('start').value = t?.start || localTime(now); $('due').value = t?.due || localTime(due); $('form-error').textContent = '';
  $('editor').showModal(); $('title').focus();
}
function renderList() {
  const tasks = filteredTasks(), container = $('task-list'); const scrollTop = container.scrollTop;
  container.replaceChildren(); $('task-count').textContent=state.tasks.length; $('empty-list').hidden = tasks.length > 0;
  $('empty-list').querySelector('h3').textContent = state.tasks.length ? '这里暂时没有任务' : '从一件小事开始';
  container.style.display = tasks.length ? '' : 'none';
  for (const t of tasks) {
    const card = make('article', 'task-card' + (selected===t.id?' selected':'') + (t.done?' completed':''));
    card.dataset.id = t.id; card.tabIndex = 0; card.draggable = false; card.setAttribute('role','listitem'); card.setAttribute('aria-label',t.title); paintTask(card,state.tasks.indexOf(t));
    const top=make('div','task-card-top'); const status=t.done?'已完成':t.due<localTime()?'已逾期':t.start>localTime()?'未开始':'进行中'; top.append(make('span','task-tag',status),make('span','grip','⠿')); card.append(top,make('h3','task-title',t.title),make('p','task-date',`${dateLabel(t.start)} ${t.start.slice(11)}  →  ${dateLabel(t.due)} ${t.due.slice(11)}`));
    const actions = make('div','card-actions'); const complete=make('button','complete',t.done?'↶ 恢复任务':'○ 标记完成'),edit=make('button','','编辑'),remove=make('button','','删除');
    complete.type=edit.type=remove.type='button'; complete.setAttribute('aria-label',(t.done?'恢复 ':'完成 ')+t.title); edit.setAttribute('aria-label','编辑 '+t.title);remove.setAttribute('aria-label','删除 '+t.title);
    complete.disabled=edit.disabled=remove.disabled=state.readOnly;
    complete.onclick=async e=>{e.stopPropagation();if(await commit(state.tasks.map(x=>x.id===t.id?{...x,done:!x.done}:x)))render();}; edit.onclick=e=>{e.stopPropagation();showEditor(t.id);};remove.onclick=e=>{e.stopPropagation();if(busy)return;$('delete-title').textContent=t.title;$('delete-dialog').dataset.id=t.id;$('delete-dialog').showModal();};
    actions.append(complete,edit,remove);card.append(actions);
    card.onclick=e=>{if(Date.now()<suppressClickUntil)return;if(!e.target.closest('button'))choose(t.id,true);}; card.ondblclick=e=>{if(!e.target.closest('button'))showEditor(t.id);};
    card.onpointerdown=e=>{if(e.button!==0||e.target.closest('button')||busy||state.readOnly)return;pointerDrag={id:t.id,x:e.clientX,y:e.clientY,active:false,pointerId:e.pointerId};};
    card.onkeydown=e=>{if(e.target!==card)return;if(e.key==='Enter'){showEditor(t.id);e.preventDefault();}if(e.altKey&&(e.key==='ArrowUp'||e.key==='ArrowDown')){e.preventDefault();const i=state.tasks.indexOf(t),target=state.tasks[i+(e.key==='ArrowUp'?-1:1)];if(target)commit(reorder(state.tasks,t.id,target.id,e.key==='ArrowDown')).then(ok=>{if(ok){render();[...container.children].find(c=>c.dataset.id===t.id)?.focus();}});}};
    card.ondragstart=e=>{if(busy){e.preventDefault();return;}dragId=t.id;e.dataTransfer.setData('text/plain',t.id);e.dataTransfer.effectAllowed='move';card.classList.add('dragging');};
    card.ondragend=()=>{dragId=null;container.querySelectorAll('.drop-before,.drop-after,.dragging').forEach(c=>c.classList.remove('drop-before','drop-after','dragging'));};
    card.ondragover=e=>{if(!dragId||dragId===t.id)return;e.preventDefault();e.dataTransfer.dropEffect='move';const after=e.clientY>card.getBoundingClientRect().top+card.offsetHeight/2;container.querySelectorAll('.drop-before,.drop-after').forEach(c=>c.classList.remove('drop-before','drop-after'));card.classList.add(after?'drop-after':'drop-before');};
    card.ondrop=async e=>{e.preventDefault();e.stopPropagation();const id=dragId;if(!id)return;const after=e.clientY>card.getBoundingClientRect().top+card.offsetHeight/2;dragId=null;if(await commit(reorder(state.tasks,id,t.id,after))){selected=id;render();}};
    container.append(card);
  }
  container.scrollTop=scrollTop;
}
function renderTimeline() {
  const timeline=$('timeline'),year=month.getFullYear(),m=month.getMonth(),days=new Date(year,m+1,0).getDate();
  const visible=filteredTasks().filter(t=>monthSpan(t,year,m));
  $('month-label').textContent=`${year} 年 ${m+1} 月`;$('month-count').textContent=`本月 ${visible.length} 项任务`;
  timeline.replaceChildren();timeline.style.height=`${days*rowHeight}px`;timeline.style.width=`${Math.max(510,110+visible.length*180)}px`;timeline.classList.toggle('compact',rowHeight===42);
  for(let i=0;i<days;i++){
    const date=new Date(year,m,i+1),today=localDate(date)===localDate(),weekend=[0,6].includes(date.getDay());
    const row=make('div','date-row'+(today?' today':'')+(weekend?' weekend':''));row.style.top=`${i*rowHeight}px`;row.style.height=`${rowHeight}px`;
    const cell=make('div','date-cell');cell.append(make('div','date-num',String(i+1).padStart(2,'0')),make('div','date-week',today?'今天':date.toLocaleDateString('zh-CN',{weekday:'short'})));row.append(cell);timeline.append(row);
  }
  if(!visible.length)timeline.append(make('div','timeline-empty',state.tasks.length?'本月没有符合筛选条件的任务。\n可以切换月份，或添加新的计划。':'把任务写下来，时间就有了形状。\n添加第一个任务，在这里看见它的跨度。'));
  visible.forEach((t,i)=>{
    const span=monthSpan(t,year,m),height=(span.last-span.first+1)*rowHeight-10;
    const card=make('button','span-card'+(selected===t.id?' selected':'')+(t.done?' completed':'')+(height<90?' short':'')+(span.before?' continues-before':'')+(span.after?' continues-after':''));
    card.type='button';card.dataset.taskId=t.id;paintTask(card,state.tasks.indexOf(t));card.style.left=`${101+i*180}px`;card.style.top=`${span.first*rowHeight+5}px`;card.style.height=`${height}px`;card.style.width='165px';card.title=`${t.title}\n开始：${t.start.replace('T',' ')}\n截止：${t.due.replace('T',' ')}`;card.setAttribute('aria-label',`${t.title}，${t.start.slice(0,10)} 至 ${t.due.slice(0,10)}`);
    card.append(make('span','span-title',t.title));if(height>80)card.append(make('span','span-dates',`${span.before?'↑ ':''}${dateLabel(t.start)} — ${dateLabel(t.due)}${span.after?' ↓':''}`));if(height>150)card.append(make('span','span-time',t.done?'✓ 已完成':`截止 ${t.due.slice(11)}`));
    card.onclick=()=>{selected=t.id;renderList();timeline.querySelectorAll('.span-card').forEach(e=>e.classList.toggle('selected',e.dataset.taskId===t.id));const row=[...$('task-list').children].find(e=>e.dataset.id===t.id);row?.scrollIntoView({block:'nearest',behavior:'smooth'});};card.ondblclick=()=>showEditor(t.id);timeline.append(card);
  });
}
function render() { $('summary').textContent=`${new Date().toLocaleDateString('zh-CN',{month:'long',day:'numeric',weekday:'long'})}  ·  ${state.tasks.filter(t=>!t.done).length} 项待办 / ${state.tasks.filter(t=>t.done).length} 项完成`;renderList();renderTimeline(); }
function jumpToday(){month=new Date(new Date().getFullYear(),new Date().getMonth(),1);renderTimeline();$('timeline-scroll').scrollTo({top:Math.max(0,new Date().getDate()-2)*rowHeight,left:0});}
$('add').onclick=$('empty-add').onclick=()=>showEditor();
$('close-editor').onclick=$('cancel-editor').onclick=()=>{if(!busy)$('editor').close();};
$('editor').addEventListener('cancel',e=>{if(busy)e.preventDefault();});
$('task-form').onsubmit=async e=>{
  e.preventDefault();if(busy)return;
  const old=state.tasks.find(t=>t.id===editing),task={id:old?.id||crypto.randomUUID(),title:$('title').value.trim(),start:$('start').value,due:$('due').value,done:old?.done||false};
  try{validateTasks([task]);}catch(e){$('form-error').textContent=e.message;return;}
  const next=old?state.tasks.map(t=>t.id===old.id?task:t):[...state.tasks,task];
  if(await commit(next)){selected=task.id;$('editor').close();const [year,m]=task.start.split('-').map(Number);month=new Date(year,m-1,1);filter='all';document.querySelectorAll('[data-filter]').forEach(b=>b.classList.toggle('active',b.dataset.filter===filter));render();const span=monthSpan(task,month.getFullYear(),month.getMonth());$('timeline-scroll').scrollTo({top:Math.max(0,span.first-1)*rowHeight,left:Math.max(0,next.filter(t=>monthSpan(t,month.getFullYear(),month.getMonth())).findIndex(t=>t.id===task.id))*180});}
  else $('form-error').textContent='尚未保存，请检查下方提示后重试。';
};
$('delete-dialog').addEventListener('close',async()=>{if($('delete-dialog').returnValue!=='delete')return;const id=$('delete-dialog').dataset.id;if(await commit(state.tasks.filter(t=>t.id!==id))){if(selected===id)selected=null;render();}});
document.querySelectorAll('[data-filter]').forEach(b=>b.onclick=()=>{filter=b.dataset.filter;document.querySelectorAll('[data-filter]').forEach(x=>x.classList.toggle('active',x===b));render();});
$('prev').onclick=()=>{if(month.getFullYear()<=1900&&month.getMonth()===0)return;month.setMonth(month.getMonth()-1);renderTimeline();$('timeline-scroll').scrollTop=0;};
$('next').onclick=()=>{if(month.getFullYear()>=9998&&month.getMonth()===11)return;month.setMonth(month.getMonth()+1);renderTimeline();$('timeline-scroll').scrollTop=0;};$('today').onclick=jumpToday;
$('density').onchange=()=>{const day=$('timeline-scroll').scrollTop/rowHeight;rowHeight=Number($('density').value);localStorage.setItem('plan-density',rowHeight);renderTimeline();$('timeline-scroll').scrollTop=day*rowHeight;};
$('startup').onchange=async()=>{if(busy)return;const desired=$('startup').checked;setBusy(true);try{const r=await request('/api/startup',{enabled:desired});state.autostart=r.autostart;$('startup').checked=r.autostart;notify(r.autostart?'已开启开机自启动':'已关闭开机自启动');}catch(e){$('startup').checked=state.autostart;notify(e.message,true);}finally{setBusy(false);}};
$('export').onclick=()=>{const blob=new Blob([JSON.stringify({version:3,revision:state.revision,tasks:state.tasks},null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=make('a');a.href=url;a.download=`计划备份-${localDate()}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);notify('已导出任务备份。');};
$('task-list').ondragover=e=>{if(!dragId)return;e.preventDefault();const box=$('task-list').getBoundingClientRect();if(e.clientY<box.top+45)$('task-list').scrollTop-=12;if(e.clientY>box.bottom-45)$('task-list').scrollTop+=12;};
$('task-list').ondrop=async e=>{e.preventDefault();if(dragId&&!e.target.closest('.task-card')){const id=dragId;dragId=null;if(await commit(reorder(state.tasks,id,null))){selected=id;render();}}};
document.addEventListener('pointermove',e=>{
  if(!pointerDrag)return;const container=$('task-list');
  if(!pointerDrag.active&&Math.hypot(e.clientX-pointerDrag.x,e.clientY-pointerDrag.y)>6){pointerDrag.active=true;container.setPointerCapture(e.pointerId);container.querySelector(`[data-id="${pointerDrag.id}"]`)?.classList.add('dragging');}
  if(!pointerDrag.active)return;e.preventDefault();
  const target=document.elementFromPoint(e.clientX,e.clientY)?.closest('.task-card');container.querySelectorAll('.drop-before,.drop-after').forEach(c=>c.classList.remove('drop-before','drop-after'));
  if(target&&target.dataset.id!==pointerDrag.id){const rect=target.getBoundingClientRect();target.classList.add(e.clientY>rect.top+rect.height/2?'drop-after':'drop-before');}
  const bounds=container.getBoundingClientRect();if(e.clientY<bounds.top+40)container.scrollTop-=10;if(e.clientY>bounds.bottom-40)container.scrollTop+=10;
},{passive:false});
document.addEventListener('pointerup',async e=>{
  if(!pointerDrag)return;const drag=pointerDrag;pointerDrag=null;const container=$('task-list');
  if(container.hasPointerCapture(e.pointerId))container.releasePointerCapture(e.pointerId);
  if(!drag.active)return;suppressClickUntil=Date.now()+400;
  const target=document.elementFromPoint(e.clientX,e.clientY)?.closest('.task-card'),bounds=container.getBoundingClientRect();
  container.querySelectorAll('.drop-before,.drop-after,.dragging').forEach(c=>c.classList.remove('drop-before','drop-after','dragging'));
  if(e.clientX<bounds.left||e.clientX>bounds.right||e.clientY<bounds.top||e.clientY>bounds.bottom)return;
  const rect=target?.getBoundingClientRect();if(await commit(reorder(state.tasks,drag.id,target?.dataset.id,!!rect&&e.clientY>rect.top+rect.height/2))){selected=drag.id;render();}
});
document.addEventListener('pointercancel',()=>{pointerDrag=null;$('task-list').querySelectorAll('.drop-before,.drop-after,.dragging').forEach(c=>c.classList.remove('drop-before','drop-after','dragging'));});
window.addEventListener('keydown',e=>{if(e.ctrlKey&&e.key.toLowerCase()==='n'){e.preventDefault();if(!$('editor').open)showEditor();}});
try {
  state=await request('/api/state');$('startup').checked=state.autostart;$('startup').disabled=!!state.startupError;
  $('warning').hidden=!(state.warning||state.startupError);$('warning').textContent=[state.warning,state.startupError].filter(Boolean).join(' ');
  $('add').disabled=state.readOnly;$('status').textContent=state.readOnly?'只读模式 · 原始数据已保留':'已连接 · 任务保存在 ' + state.dataPath;render();jumpToday();
} catch(e) { $('warning').hidden=false;$('warning').textContent='无法连接本地服务，请重新双击桌面上的「计划」。';$('status').textContent=e.message;$('add').disabled=true;$('startup').disabled=true; }
