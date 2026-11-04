/* Command Journal calendar: month grid with week rows.
   Tap a day to list that day's tasks; tap a week number to list the week. */
(function(){
'use strict';
const DOW=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
let cursor=null;            // first day of the displayed month (YYYY-MM-01)
let sel={kind:'day',date:day()}; // {kind:'day'|'week', date: day or week start}

const ymd=(y,m,d)=>day(new Date(y,m,d));
const parse=s=>{const [y,m,d]=s.split('-').map(Number);return new Date(y,m-1,d);};
const weekStart=s=>{const d=parse(s);d.setDate(d.getDate()-d.getDay());return day(d);};
function isoWeek(s){
 const d=parse(s);d.setDate(d.getDate()+3-((d.getDay()+6)%7));
 const w1=new Date(d.getFullYear(),0,4);
 return 1+Math.round(((d-w1)/864e5-3+((w1.getDay()+6)%7))/7);
}
function tasksOn(date){
 // A task belongs to a day if it is scheduled or due that day.
 return data.tasks.filter(t=>t.scheduled===date||t.due===date).sort(sortTask);
}
function counts(date){
 const list=tasksOn(date);
 return {open:list.filter(t=>t.status!=='done').length,done:list.filter(t=>t.status==='done').length,
  due:list.some(t=>t.due===date&&t.status!=='done'),high:list.some(t=>t.priority==='High'&&t.status!=='done')};
}
const fmtDay=s=>parse(s).toLocaleDateString(undefined,{weekday:'long',month:'long',day:'numeric'});
const fmtShort=s=>parse(s).toLocaleDateString(undefined,{month:'short',day:'numeric'});

// ---- view -------------------------------------------------------------
const section=document.createElement('section');
section.id='calendar';section.className='view hidden';
section.innerHTML=`<div class="panel"><div class="cal-head">
 <button class="btn alt sm" data-cal="prev" aria-label="Previous month">‹</button>
 <h2 id="calTitle"></h2>
 <button class="btn alt sm" data-cal="next" aria-label="Next month">›</button>
 <button class="btn alt sm" data-cal="today">Today</button></div>
 <div class="cal-grid" id="calGrid" role="grid"></div>
 <p class="hint">Tap a day for its tasks. Tap a week number (W) for the whole week.</p></div>
 <div class="panel"><div class="header"><h2 id="calListTitle"></h2><button class="btn sm" data-cal="add">+ Add</button></div><div id="calList"></div></div>`;
const anchor=document.getElementById('settings');
anchor.parentNode.insertBefore(section,anchor);

const tab=document.createElement('button');
tab.className='tab';tab.dataset.view='calendar';tab.textContent='Calendar';
const tabs=document.getElementById('tabs');
tabs.insertBefore(tab,tabs.querySelector('[data-view="reviews"]'));
tabs.style.gridTemplateColumns='repeat(5,1fr)';

const css=document.createElement('style');
css.textContent=`.cal-head{display:flex;align-items:center;gap:8px;margin-bottom:12px}.cal-head h2{flex:1;margin:0;text-align:center}
.cal-grid{display:grid;grid-template-columns:30px repeat(7,1fr);gap:4px}
.cal-dow{font-size:10px;color:#7f93a8;text-align:center;letter-spacing:.06em;padding:2px 0}
.cal-wk,.cal-day{border-radius:10px;border:1px solid transparent;background:none;color:inherit;padding:0;font:inherit}
.cal-wk{font-size:10px;color:#46d9f5;font-weight:700;background:#0b1a28;border-color:#1c3349}
.cal-day{min-height:50px;background:#0b131f;border-color:#18283b;display:flex;flex-direction:column;align-items:center;justify-content:flex-start;padding:6px 0 4px;gap:4px}
.cal-day .n{font-size:13px;font-weight:600}
.cal-day.other{opacity:.38}
.cal-day.today .n{background:linear-gradient(135deg,#46d9f5,#5b7cff);color:#03101a;border-radius:20px;padding:1px 7px}
.cal-dots{display:flex;gap:3px;flex-wrap:wrap;justify-content:center;max-width:90%}
.cal-dots i{width:6px;height:6px;border-radius:50%;background:#46d9f5;display:block}
.cal-dots i.hi{background:#ff6b9a}.cal-dots i.done{background:#3b4a5c}.cal-dots b{font-size:9px;color:#9fb3c6;font-weight:600}
.cal-row-sel .cal-day,.cal-row-sel.cal-wk{border-color:#2d6d8c;background:#0e2233}
.cal-day.sel{border-color:#46d9f5;box-shadow:0 0 12px #46d9f544}
.cal-wk.sel{background:#0f3149;border-color:#46d9f5;color:#fff}
.cal-daygroup{margin-top:14px}.cal-daygroup h3{font-size:13px;margin:0 0 4px;color:#9fd9ec;font-weight:700}
.cal-daygroup .empty{padding:4px 2px 8px;font-size:12px}`;
document.head.appendChild(css);

function renderCalendar(){
 const today=day();
 if(!cursor){const t=parse(sel.date);cursor=ymd(t.getFullYear(),t.getMonth(),1);}
 const c=parse(cursor),y=c.getFullYear(),m=c.getMonth();
 document.getElementById('calTitle').textContent=c.toLocaleDateString(undefined,{month:'long',year:'numeric'});
 const start=parse(weekStart(cursor)),last=new Date(y,m+1,0);
 let html='<div></div>'+DOW.map(d=>`<div class="cal-dow">${d}</div>`).join('');
 for(let w=new Date(start);w<=last;w.setDate(w.getDate()+7)){
  const ws=day(w),rowSel=sel.kind==='week'&&sel.date===ws;
  // ISO week of the Thursday-ish middle of a Sun–Sat row = Monday's week.
  const mon=new Date(w);mon.setDate(mon.getDate()+1);
  html+=`<button class="cal-wk${rowSel?' sel cal-row-sel':''}" data-week="${ws}" aria-label="Week of ${fmtShort(ws)}">W${isoWeek(day(mon))}</button>`;
  for(let i=0;i<7;i++){
   const d=new Date(w);d.setDate(d.getDate()+i);const ds=day(d),k=counts(ds);
   let dots='';const total=k.open+k.done;
   if(total>4)dots=`<b>${k.open}${k.done?' · '+k.done+'✓':''}</b>`;
   else{dots=('<i class="'+(k.high?'hi':'')+'"></i>').repeat(Math.min(k.open,1))+'<i></i>'.repeat(Math.max(0,k.open-1))+'<i class="done"></i>'.repeat(k.done);}
   const cls=['cal-day',d.getMonth()!==m?'other':'',ds===today?'today':'',sel.kind==='day'&&sel.date===ds?'sel':''].filter(Boolean).join(' ');
   html+=`<button class="${cls}" data-day="${ds}" aria-label="${fmtDay(ds)}, ${k.open} open task${k.open===1?'':'s'}"${rowSel?' style="border-color:#2d6d8c;background:#0e2233"':''}><span class="n">${d.getDate()}</span><span class="cal-dots">${dots}</span></button>`;
  }
 }
 document.getElementById('calGrid').innerHTML=html;
 renderList();
}
function group(date,heading){
 const list=tasksOn(date);
 return `<div class="cal-daygroup">${heading?`<h3>${esc(fmtDay(date))}${date===day()?' · Today':''}</h3>`:''}${list.length?list.map(renderTask).join(''):'<div class="empty">No tasks.</div>'}</div>`;
}
function renderList(){
 const title=document.getElementById('calListTitle'),box=document.getElementById('calList');
 if(sel.kind==='day'){
  title.textContent=fmtDay(sel.date)+(sel.date===day()?' · Today':'');
  box.innerHTML=group(sel.date,false);
 }else{
  const end=parse(sel.date);end.setDate(end.getDate()+6);
  const days=[...Array(7)].map((_,i)=>{const d=parse(sel.date);d.setDate(d.getDate()+i);return day(d);});
  const n=days.reduce((a,d)=>a+tasksOn(d).filter(t=>t.status!=='done').length,0);
  title.textContent=`Week of ${fmtShort(sel.date)} – ${fmtShort(day(end))} · ${n} open`;
  box.innerHTML=days.map(d=>group(d,true)).join('');
 }
}
section.addEventListener('click',e=>{
 const b=e.target.closest('button');if(!b||!section.contains(b))return;
 if(b.dataset.day){sel={kind:'day',date:b.dataset.day};const d=parse(b.dataset.day);cursor=ymd(d.getFullYear(),d.getMonth(),1);renderCalendar();document.getElementById('calListTitle').scrollIntoView({behavior:'smooth',block:'start'});return;}
 if(b.dataset.week){sel={kind:'week',date:b.dataset.week};renderCalendar();document.getElementById('calListTitle').scrollIntoView({behavior:'smooth',block:'start'});return;}
 const a=b.dataset.cal;if(!a)return;
 const c=parse(cursor);
 if(a==='prev'){cursor=ymd(c.getFullYear(),c.getMonth()-1,1);renderCalendar();}
 else if(a==='next'){cursor=ymd(c.getFullYear(),c.getMonth()+1,1);renderCalendar();}
 else if(a==='today'){sel={kind:'day',date:day()};cursor=null;renderCalendar();}
 else if(a==='add'){openTaskForm();document.getElementById('taskDate').value=sel.date;}
});
// Re-draw whenever the app re-renders (task added, completed, moved, edited).
const baseRender=window.render;
window.render=function(){baseRender.apply(this,arguments);if(view==='calendar')renderCalendar();};
})();
