/* The Family Save fitness: per-person workouts, weight, steps, water, sleep,
   meals vs calorie/protein targets, and a shared weekly meal plan.
   Stored in data.fitness (included in JSON backups). Manual / voice entry:
   web apps cannot read Samsung Health or Google Fit. */
(function(){
'use strict';
const C={s1:'#3987e5',muted:'#6b7a8c',grid:'#1c2838',axis:'#2a3a4f',surface:'#0d141f',ink:'#eef6fb',ink2:'#aebdcc',ink3:'#7f93a8',warn:'#fab219',goodText:'#3fd16b',badText:'#ff8a8a'};
const ACT={run:'🏃 Run',walk:'🚶 Walk',bike:'🚴 Bike',swim:'🏊 Swim',strength:'🏋️ Strength',yoga:'🧘 Yoga',hike:'🥾 Hike',sports:'⚽ Sports',other:'💪 Other'};
const SLOTS=['breakfast','lunch','dinner','snack'];
const DEF_GOALS={activeMin:150,steps:8000,water:8,sleep:8,weight:null,calories:null,protein:null};
const pd=s=>{const [y,m,d]=s.split('-').map(Number);return new Date(y,m-1,d);};
const short=s=>pd(s).toLocaleDateString(undefined,{month:'short',day:'numeric'});
function fit(){
 if(!data.fitness||typeof data.fitness!=='object')data.fitness={};
 const f=data.fitness;f.people=Array.isArray(f.people)?f.people:[];f.logs=Array.isArray(f.logs)?f.logs:[];f.mealPlan=f.mealPlan&&typeof f.mealPlan==='object'?f.mealPlan:{};
 if(!f.people.length)f.people.push({id:uuid(),name:'Me',goals:{...DEF_GOALS}});
 for(const p of f.people)p.goals={...DEF_GOALS,...(p.goals||{})};
 return f;
}
const save=()=>{localStorage.setItem(KEY,JSON.stringify(data));};
function person(nameOrId){
 const f=fit();if(!nameOrId)return f.people[0];
 const q=String(nameOrId).toLowerCase().trim();
 return f.people.find(p=>p.id===nameOrId)||f.people.find(p=>p.name.toLowerCase()===q)||(/^(i|me|my|myself)$/.test(q)?f.people[0]:null);
}
function add(log){
 const f=fit(),p=person(log.personId)||f.people[0];
 const e={id:uuid(),personId:p.id,date:log.date||day(),kind:log.kind,created:stamp()};
 for(const k of ['activity','minutes','miles','value','calories','protein','carbs','fat','slot','note'])if(log[k]!=null&&log[k]!=='')e[k]=log[k];
 if(e.kind==='meal'&&!e.slot&&window.Nutrition)e.slot=window.Nutrition.slotForNow(p.id);
 f.logs.push(e);log_('fitness_'+e.kind,p.name+': '+describe(e));return e;
}
function log_(type,details){try{log(type,null,details);}catch(_){}}
function setMeal(date,slot,text,pid){
 if(window.Nutrition){const P=person(pid)||fit().people[0],slots=window.Nutrition.N(P.id).slots;const want=String(slot||'').toLowerCase();
  const s=slots.find(x=>x.id===slot)||slots.find(x=>x.name.toLowerCase()===want)||slots.find(x=>x.name.toLowerCase().includes(want))||(want==='breakfast'?slots[0]:want==='dinner'?slots[slots.length-1]:want==='lunch'?slots[Math.min(1,slots.length-1)]:slots[0]);
  window.Nutrition.setPlan(P.id,date,s.id,text);return;}
 const f=fit();(f.mealPlan[date]=f.mealPlan[date]||{})[slot]=String(text||'').slice(0,120);if(!text)delete f.mealPlan[date][slot];}
function describe(e){
 if(e.kind==='workout')return `${ACT[e.activity]||ACT.other}${e.minutes?' · '+e.minutes+' min':''}${e.miles?' · '+e.miles+' mi':''}${e.note?' · '+e.note:''}`;
 if(e.kind==='weight')return `⚖️ ${e.value} lb`;
 if(e.kind==='steps')return `👣 ${Number(e.value).toLocaleString()} steps`;
 if(e.kind==='water')return `💧 ${e.value} glass${e.value==1?'':'es'} of water`;
 if(e.kind==='sleep')return `😴 ${e.value} h sleep`;
 if(e.kind==='meal')return `🍽️ ${e.note||'Meal'}${e.calories?' · '+e.calories+' cal':''}${e.protein?' · '+e.protein+' g protein':''}`;
 return e.kind;
}
// per-person summaries used by the tab, the dashboard and the AI
function stats(pid){
 const f=fit(),today=day(),L=f.logs.filter(l=>l.personId===pid);
 const since=d=>day(new Date(pd(today)-d*864e5));
 const sum=(kind,field,from,to=today)=>L.filter(l=>l.kind===kind&&l.date>=from&&l.date<=to).reduce((a,l)=>a+(+l[field]||0),0);
 const minutes7=sum('workout','minutes',since(6));
 const days=[...Array(7)].map((_,i)=>{const d=since(6-i);return {d,min:sum('workout','minutes',d,d)};});
 let streak=0;for(let i=0;i<365;i++){const d=since(i);const has=L.some(l=>l.kind==='workout'&&l.date===d);if(has)streak++;else if(i===0)continue;else break;}
 const weights=L.filter(l=>l.kind==='weight').sort((a,b)=>a.date.localeCompare(b.date));
 const latestW=weights.at(-1),w30=weights.filter(w=>w.date<=since(30)).at(-1)||weights[0];
 const sleepLast=L.filter(l=>l.kind==='sleep').sort((a,b)=>b.date.localeCompare(a.date))[0];
 const sleep7=L.filter(l=>l.kind==='sleep'&&l.date>=since(6));
 return {minutes7,days,streak,weights,latestW,w30,
  stepsToday:sum('steps','value',today),waterToday:sum('water','value',today),
  sleepLast:sleepLast?+sleepLast.value:null,sleepAvg:sleep7.length?sleep7.reduce((a,l)=>a+(+l.value),0)/sleep7.length:null,
  calToday:sum('meal','calories',today),proteinToday:sum('meal','protein',today),workouts7:L.filter(l=>l.kind==='workout'&&l.date>=since(6)).length};
}
window.Fitness={ACT,SLOTS,add,setMeal,describe,person,people:()=>fit().people,stats,mealPlan:()=>fit().mealPlan,
 selected:()=>{const f=fit();if(!sel||!f.people.some(p=>p.id===sel))sel=f.people[0].id;return sel;},select:id=>{sel=id;}};

// ---- view -------------------------------------------------------------
let sel=null,entry='workout',showGoals=false,planWeek=0;
const section=document.createElement('section');section.id='fitness';section.className='view hidden';
const settings=document.getElementById('settings');settings.parentNode.insertBefore(section,settings);
const tabs=document.getElementById('tabs'),tab=document.createElement('button');tab.className='tab';tab.dataset.view='fitness';tab.textContent='Fitness';
tabs.insertBefore(tab,tabs.querySelector('[data-view="reviews"]'));
const css=document.createElement('style');css.textContent=`
#fitness .seg button{padding:9px 2px;font-size:12.5px;min-width:0}
.ft-chips{display:flex;gap:8px;overflow-x:auto;scrollbar-width:none;padding-bottom:2px}.ft-chips::-webkit-scrollbar{display:none}
.ft-chip{flex:none;border:1px solid #24394f;background:#0e1624;color:${C.ink2};border-radius:20px;padding:8px 14px;font-weight:650;font-size:13px}.ft-chip.on{background:#0f3149;border-color:#46d9f5;color:#fff}
.ft-meters{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:12px}.ft-m{background:#0e1826;border:1px solid #1c2e44;border-radius:14px;padding:12px}
.ft-m .l{font-size:11.5px;color:${C.ink3}}.ft-m .v{font-size:21px;font-weight:750;margin-top:3px}.ft-m .v small{font-size:12px;color:${C.ink3};font-weight:600}
.ft-bar{height:8px;border-radius:4px;background:#14263a;margin-top:8px;overflow:hidden}.ft-bar i{display:block;height:100%;border-radius:4px;background:${C.s1}}
.ft-m .acts{display:flex;gap:6px;margin-top:8px}.ft-m .acts button{flex:1;padding:6px;font-size:13px}
.ft-row{display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid ${C.grid};font-size:13.5px}.ft-row:last-child{border:0}.ft-row .g{flex:1;min-width:0}.ft-row .s{font-size:11.5px;color:${C.ink3};margin-top:2px}
.ft-plan{width:100%;border-collapse:separate;border-spacing:4px;table-layout:fixed;font-size:12px}.ft-plan th{font-size:10.5px;color:${C.ink3};font-weight:600;text-align:left;padding:0 2px}
.ft-plan td{background:#0b131f;border:1px solid #18283b;border-radius:8px;padding:6px;vertical-align:top;height:44px;overflow-wrap:anywhere;cursor:pointer;color:${C.ink2}}.ft-plan td.d{background:none;border:0;cursor:default;font-weight:700;color:${C.ink};width:44px;padding:6px 2px}
.ft-plan td.today{border-color:#2d6d8c}.ft-plan td:empty::after{content:'+';color:#3b4a5c}
.ft-tick{font-size:10px;fill:${C.ink3};font-variant-numeric:tabular-nums}.ft-val{font-size:11px;font-weight:700;fill:${C.ink}}
.ft-tip{position:absolute;pointer-events:none;opacity:0;background:#06101aee;border:1px solid #2b4a63;border-radius:10px;padding:7px 10px;font-size:12px;color:${C.ink};white-space:nowrap;z-index:3}`;
document.head.appendChild(css);
const nice=(min,max,n=4)=>{const span=Math.max(1,max-min),raw=span/n,mag=Math.pow(10,Math.floor(Math.log10(raw))),r=raw/mag,step=(r<=1?1:r<=2?2:r<=5?5:10)*mag;return {lo:Math.floor(min/step)*step,hi:Math.ceil(max/step)*step,step};};
function weekBars(days,W,goalPerDay){
 const H=120,L=26,R=6,T=14,B=20,pw=W-L-R,ph=H-T-B,max=Math.max(30,goalPerDay||0,...days.map(d=>d.min)),{hi,step}=nice(0,max,3);
 const band=pw/7,bw=Math.min(22,band-12),y=v=>T+ph-v/hi*ph;
 let s='';for(let v=0;v<=hi;v+=step)s+=`<line x1="${L}" x2="${W-R}" y1="${y(v)}" y2="${y(v)}" stroke="${v?C.grid:C.axis}"/><text x="${L-5}" y="${y(v)+3.5}" text-anchor="end" class="ft-tick">${v}</text>`;
 days.forEach((d,i)=>{const cx=L+band*i+band/2,h=T+ph-y(d.min),r=Math.min(4,h,bw/2);
  if(h>0)s+=`<path d="M${cx-bw/2},${T+ph}V${y(d.min)+r}Q${cx-bw/2},${y(d.min)} ${cx-bw/2+r},${y(d.min)}H${cx+bw/2-r}Q${cx+bw/2},${y(d.min)} ${cx+bw/2},${y(d.min)+r}V${T+ph}Z" fill="${C.s1}"/>`;
  if(d.min&&i===6)s+=`<text x="${cx}" y="${y(d.min)-5}" text-anchor="middle" class="ft-val">${d.min}</text>`;
  s+=`<text x="${cx}" y="${H-5}" text-anchor="middle" class="ft-tick">${i===6?'Today':pd(d.d).toLocaleDateString(undefined,{weekday:'narrow'})}</text><rect x="${L+band*i}" y="${T}" width="${band}" height="${ph+B}" fill="transparent" data-tip="${short(d.d)}: ${d.min} active min"/>`;});
 if(goalPerDay)s+=`<line x1="${L}" x2="${W-R}" y1="${y(goalPerDay)}" y2="${y(goalPerDay)}" stroke="${C.warn}" stroke-opacity=".55"/>`;
 return `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" role="img" aria-label="Active minutes per day, last 7 days">${s}</svg>`;
}
function weightChart(ws,goal,W){
 const H=150,L=36,R=46,T=12,B=20,pw=W-L-R,ph=H-T-B;
 const pts=ws.slice(-60),vals=pts.map(w=>+w.value).concat(goal?[goal]:[]),{lo,hi,step}=nice(Math.min(...vals)-1,Math.max(...vals)+1,3);
 const t0=pd(pts[0].date).getTime(),t1=Math.max(t0+864e5,pd(pts.at(-1).date).getTime());
 const x=d=>L+(pd(d).getTime()-t0)/(t1-t0)*pw,y=v=>T+ph-(v-lo)/(hi-lo)*ph;
 let s='';for(let v=lo;v<=hi+1e-9;v+=step)s+=`<line x1="${L}" x2="${W-R}" y1="${y(v)}" y2="${y(v)}" stroke="${v===lo?C.axis:C.grid}"/><text x="${L-5}" y="${y(v)+3.5}" text-anchor="end" class="ft-tick">${Math.round(v)}</text>`;
 s+=`<text x="${L}" y="${H-5}" class="ft-tick">${short(pts[0].date)}</text><text x="${W-R}" y="${H-5}" text-anchor="end" class="ft-tick">${short(pts.at(-1).date)}</text>`;
 if(goal)s+=`<line x1="${L}" x2="${W-R}" y1="${y(goal)}" y2="${y(goal)}" stroke="${C.warn}" stroke-opacity=".55"/><text x="${W-R+4}" y="${y(goal)+3.5}" class="ft-tick">Goal</text>`;
 s+=`<path d="${pts.map((p,i)=>`${i?'L':'M'}${x(p.date).toFixed(1)},${y(+p.value).toFixed(1)}`).join('')}" fill="none" stroke="${C.s1}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
 const e=pts.at(-1);s+=`<circle cx="${x(e.date)}" cy="${y(+e.value)}" r="4" fill="${C.s1}" stroke="${C.surface}" stroke-width="2"/><text x="${x(e.date)+8}" y="${y(+e.value)-8}" class="ft-val">${e.value}</text>`;
 for(const p of pts)s+=`<circle cx="${x(p.date)}" cy="${y(+p.value)}" r="12" fill="transparent" data-tip="${short(p.date)}: ${p.value} lb"/>`;
 return `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" role="img" aria-label="Weight trend">${s}</svg>`;
}
function meter(label,val,unit,goal,extra=''){const pctv=goal?Math.min(100,val/goal*100):0;
 return `<div class="ft-m"><div class="l">${label}</div><div class="v">${val==null?'—':(typeof val==='number'?(+val.toFixed(1)).toLocaleString():val)}${goal?` <small>/ ${goal.toLocaleString()} ${unit}</small>`:` <small>${unit}</small>`}</div>${goal?`<div class="ft-bar"><i style="width:${pctv}%"></i></div>`:''}${extra}</div>`;}
function form(){
 const today=day(),f=fit(),opts=f.people.map(p=>`<option value="${p.id}"${p.id===sel?' selected':''}>${esc(p.name)}</option>`).join('');
 const kinds=[['workout','Workout'],['weight','Weight'],['steps','Steps'],['sleep','Sleep']];
 const fields={
  workout:`<div class="two"><div><label>Activity</label><select id="ftAct">${Object.entries(ACT).map(([k,v])=>`<option value="${k}">${v}</option>`).join('')}</select></div><div><label>Minutes</label><input id="ftMin" inputmode="numeric" placeholder="30"></div></div><div class="two"><div><label>Distance (miles, optional)</label><input id="ftMi" inputmode="decimal" placeholder="—"></div><div><label>Note</label><input id="ftNote" maxlength="80" placeholder="e.g. legs day"></div></div>`,
  weight:`<label>Weight (lb)</label><input id="ftVal" inputmode="decimal" placeholder="180.5">`,
  steps:`<label>Steps</label><input id="ftVal" inputmode="numeric" placeholder="8000">`,
  sleep:`<label>Hours slept</label><input id="ftVal" inputmode="decimal" placeholder="7.5">`,
  meal:`<label>What you ate</label><input id="ftNote" maxlength="80" placeholder="Chicken salad"><div class="two"><div><label>Calories</label><input id="ftCal" inputmode="numeric" placeholder="450"></div><div><label>Protein (g)</label><input id="ftPro" inputmode="numeric" placeholder="35"></div></div>`};
 return `<div class="panel"><h2>Log it</h2><div class="seg">${kinds.map(([k,l])=>`<button data-ft="kind" data-v="${k}" class="${entry===k?'on':''}">${l}</button>`).join('')}</div>
 <div class="two"><div><label>Who</label><select id="ftWho">${opts}</select></div><div><label>Date</label><input id="ftDate" type="date" value="${today}"></div></div>${fields[entry]}
 <button class="btn full" style="margin-top:12px" data-ft="add">Save</button>
 <p class="hint">Hands-free: “Vector, open Family Save, I ran 3 miles in 30 minutes”, “Amanda walked 20 minutes”, “I weigh 182”, “drank 2 glasses of water”, “slept 7 hours”, “ate a turkey sandwich 450 calories”.</p></div>`;
}
function ringsHtml(P,S){
 const g=P.goals,N=window.Nutrition,nt=N?N.N(P.id):null,tot=N?N.totals(N.mealsOn(P.id,day())):{p:0,cal:0},fast=N?N.activeFast(P.id):null;
 const today=S.days[6]?S.days[6].min:0,moveGoal=g.activeMin?Math.round(g.activeMin/7):30;
 const R=[['Move',today,moveGoal,'min','#46d9f5'],['Protein',tot.p,nt&&nt.targets&&nt.targets.p,'g','#3fd16b'],['Sleep',S.sleepLast||0,g.sleep||8,'h','#9085e9'],['Water',S.waterToday,g.water||8,'gl','#3987e5']];
 const ring=(v,goal,col)=>{const r=26,c=2*Math.PI*r,p=goal?Math.min(1,v/goal):0;return `<svg width="64" height="64" viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="${r}" fill="none" stroke="#14263a" stroke-width="7"/><circle cx="32" cy="32" r="${r}" fill="none" stroke="${col}" stroke-width="7" stroke-linecap="round" stroke-dasharray="${c*p} ${c}" transform="rotate(-90 32 32)"/>${p>=1?'<text x="32" y="37" text-anchor="middle" font-size="15" fill="#fff">✓</text>':''}</svg>`;};
 let next='';if(window.Strength){const pl=window.Strength.plans(P.id).find(x=>(x.days||[]).includes(new Date().getDay()));if(pl)next=`🏋️ <b>${esc(pl.name)}</b> is planned today`;}
 return `<div class="panel"><div class="header"><h2>${esc(P.name)} · today</h2><span class="muted small">${S.streak?`🔥 ${S.streak}-day streak`:''}</span></div>
  <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px;text-align:center;margin-top:8px">${R.map(([l,v,goal,u,col])=>`<div aria-label="${l}: ${Math.round(v)} of ${goal||'—'} ${u}">${ring(v,goal,col)}<div style="font-size:12px;font-weight:700;margin-top:2px">${l}</div><div class="muted small">${Math.round(v*10)/10}${goal?'/'+goal:''} ${u}</div></div>`).join('')}</div>
  <p class="hint" style="margin:10px 0 0">${fast?`⏳ Fasting ${Math.floor((Date.now()-new Date(fast.start))/36e5)}h of ${fast.goal}h`:''}${fast&&next?' · ':''}${next}${!fast&&!next?'Meals, fasting and macros are in <b>Meals</b>. Workouts are in <b>Training</b>.':''}</p></div>`;
}
function renderFitness(){
 const f=fit();if(!sel||!f.people.some(p=>p.id===sel))sel=f.people[0].id;
 const P=f.people.find(p=>p.id===sel),S=stats(P.id),g=P.goals,W=Math.max(280,(section.clientWidth||360)-36),today=day();
 const wDelta=S.latestW&&S.w30&&S.latestW!==S.w30?(+S.latestW.value-+S.w30.value):null;
 const recent=f.logs.filter(l=>l.personId===P.id).sort((a,b)=>b.date.localeCompare(a.date)||b.created.localeCompare(a.created)).slice(0,12);
 // meal plan week (Sun-Sat), this or next
 const ws=pd(today);ws.setDate(ws.getDate()-ws.getDay()+7*planWeek);const wk=[...Array(7)].map((_,i)=>{const d=new Date(ws);d.setDate(d.getDate()+i);return day(d);});
 const fam=f.people.map(p=>({p,s:stats(p.id)}));const famMax=Math.max(1,...fam.map(x=>Math.max(x.s.minutes7,x.p.goals.activeMin||0)));
 section.innerHTML=ringsHtml(P,S)+`
 <div class="panel"><div class="ft-chips">${f.people.map(p=>`<button class="ft-chip${p.id===sel?' on':''}" data-ft="who" data-id="${p.id}">${esc(p.name)}</button>`).join('')}<button class="ft-chip" data-ft="addp">+ Person</button></div>
  <div class="ft-meters">
   ${meter('Active minutes · last 7 days',S.minutes7,'min',g.activeMin,`<div class="l" style="margin-top:6px">${S.streak?`🔥 ${S.streak}-day streak`:'No streak yet'} · ${S.workouts7} workout${S.workouts7===1?'':'s'}</div>`)}
   ${meter('Steps today',S.stepsToday,'steps',g.steps)}
   ${meter('Water today',S.waterToday,'glasses',g.water,`<div class="acts"><button class="btn alt sm" data-ft="water" data-v="-1" aria-label="Remove a glass">−</button><button class="btn sm" data-ft="water" data-v="1">+ 1 glass</button></div>`)}
   ${meter('Sleep last logged',S.sleepLast,'h',g.sleep,S.sleepAvg!=null?`<div class="l" style="margin-top:6px">7-day avg ${S.sleepAvg.toFixed(1)} h</div>`:'')}
  </div>
  <div class="actions" style="margin-top:12px"><button class="btn alt sm" data-ft="goals">${showGoals?'Close goals':'Goals & name'}</button></div>
  ${showGoals?`<div class="two"><div><label>Name</label><input id="gName" value="${esc(P.name)}" maxlength="30"></div><div><label>Active min / week</label><input id="gAct" inputmode="numeric" value="${g.activeMin??''}"></div></div>
  <div class="two"><div><label>Steps / day</label><input id="gSteps" inputmode="numeric" value="${g.steps??''}"></div><div><label>Water glasses / day</label><input id="gWater" inputmode="numeric" value="${g.water??''}"></div></div>
  <div class="two"><div><label>Sleep hours</label><input id="gSleep" inputmode="decimal" value="${g.sleep??''}"></div><div><label>Goal weight (lb)</label><input id="gWeight" inputmode="decimal" value="${g.weight??''}"></div></div>
  <div class="two"><div><label>Calories / day</label><input id="gCal" inputmode="numeric" value="${g.calories??''}" placeholder="optional"></div><div><label>Protein g / day</label><input id="gPro" inputmode="numeric" value="${g.protein??''}" placeholder="optional"></div></div>
  <div class="actions" style="margin-top:12px"><button class="btn" data-ft="savegoals">Save</button>${f.people.length>1?'<button class="btn danger sm" data-ft="delp">Remove person</button>':''}</div>
  <p class="hint">Calorie and protein targets are your own numbers. For a medical or weight-loss plan, check with a doctor or dietitian.</p>`:''}
 </div>
 ${form()}
 <div class="panel" style="position:relative"><h2>${esc(P.name)}’s activity</h2><p class="hint" style="margin:0 0 6px">Active minutes per day${g.activeMin?' · goal line = '+Math.round(g.activeMin/7)+' min/day':''}</p>${weekBars(S.days,W,g.activeMin?Math.round(g.activeMin/7):0)}</div>
 <div class="panel" style="position:relative"><h2>Weight</h2>${S.weights.length>=2?`<p class="hint" style="margin:0 0 6px">${S.latestW.value} lb now${wDelta!=null?` · <span style="color:${wDelta<=0?C.goodText:C.ink2}">${wDelta>0?'+':''}${wDelta.toFixed(1)} lb</span> vs 30 days ago`:''}${g.weight?` · goal ${g.weight} lb`:''}</p>${weightChart(S.weights,g.weight,W)}`:`<div class="empty">${S.weights.length?'One weigh-in so far ('+S.weights[0].value+' lb). Log another to see a trend.':'Log a weigh-in to see the trend.'}</div>`}</div>
 ${f.people.length>1?`<div class="panel"><h2>Family this week</h2><p class="hint" style="margin:0 0 6px">Active minutes, last 7 days · tick = each person’s goal</p>${fam.map(x=>`<div style="padding:7px 0"><div style="display:flex;justify-content:space-between;font-size:13px"><span>${esc(x.p.name)}${x.s.streak>1?` <span style="color:${C.ink3}">🔥${x.s.streak}</span>`:''}</span><span style="font-variant-numeric:tabular-nums">${x.s.minutes7} min</span></div><div class="dz-track" style="position:relative;height:8px;margin-top:5px"><i style="position:absolute;left:0;top:0;height:8px;border-radius:0 4px 4px 0;background:${C.s1};width:${x.s.minutes7/famMax*100}%"></i>${x.p.goals.activeMin?`<u style="position:absolute;top:-3px;width:2px;height:14px;background:${C.ink2};left:${x.p.goals.activeMin/famMax*100}%"></u>`:''}</div></div>`).join('')}</div>`:''}
 <div class="panel"><h2>Recent · ${esc(P.name)}</h2>${recent.length?recent.map(l=>`<div class="ft-row"><div class="g">${esc(describe(l))}<div class="s">${short(l.date)}</div></div><button class="x" data-ft="del" data-id="${l.id}" aria-label="Delete">✕</button></div>`).join(''):'<div class="empty">Nothing logged yet.</div>'}</div>`;
 // tooltips for chart marks
 section.querySelectorAll('[data-tip]').forEach(el=>{const card=el.closest('.panel');const show=()=>{let t=card.querySelector('.ft-tip');if(!t){t=document.createElement('div');t.className='ft-tip';card.appendChild(t);}t.textContent=el.dataset.tip;t.style.opacity=1;const r=el.getBoundingClientRect(),cr=card.getBoundingClientRect();t.style.left=Math.max(6,Math.min(cr.width-t.offsetWidth-6,r.left-cr.left+r.width/2-t.offsetWidth/2))+'px';t.style.top=(r.top-cr.top-t.offsetHeight-6)+'px';};
  el.addEventListener('pointerenter',show);el.addEventListener('click',show);el.addEventListener('pointerleave',()=>{const t=card.querySelector('.ft-tip');if(t)t.style.opacity=0;});});
}
const num=id=>{const v=parseFloat(String(document.getElementById(id)?.value||'').replace(/,/g,''));return isFinite(v)&&v>0?v:null;};
section.addEventListener('click',e=>{
 const b=e.target.closest('[data-ft]');if(!b)return;const a=b.dataset.ft,f=fit();
 if(a==='who'){sel=b.dataset.id;showGoals=false;}
 else if(a==='addp'){const n=(prompt('Family member’s name?')||'').trim().slice(0,30);if(!n)return;if(f.people.some(p=>p.name.toLowerCase()===n.toLowerCase())){toast('That name is already in the family list.');return;}const p={id:uuid(),name:n,goals:{...DEF_GOALS}};f.people.push(p);sel=p.id;toast(n+' added.');}
 else if(a==='kind'){entry=b.dataset.v;}
 else if(a==='water'){const d=+b.dataset.v;if(d>0)add({personId:sel,kind:'water',value:1});else{const L=f.logs.filter(l=>l.personId===sel&&l.kind==='water'&&l.date===day());const last=L.at(-1);if(!last)return;if(+last.value>1)last.value=+last.value-1;else f.logs=f.logs.filter(l=>l!==last);}}
 else if(a==='add'){
  const who=document.getElementById('ftWho').value,date=document.getElementById('ftDate').value||day();let log={personId:who,date,kind:entry};
  if(entry==='workout'){log.activity=document.getElementById('ftAct').value;log.minutes=num('ftMin');log.miles=num('ftMi');log.note=document.getElementById('ftNote').value.trim();if(!log.minutes&&!log.miles){toast('Enter minutes or distance.');return;}}
  else if(entry==='meal'){log.note=document.getElementById('ftNote').value.trim();log.calories=num('ftCal');log.protein=num('ftPro');if(!log.note&&!log.calories){toast('Enter what you ate or calories.');return;}}
  else{log.value=num('ftVal');if(!log.value){toast('Enter a value.');return;}}
  add(log);sel=who;toast('Saved.');
 }
 else if(a==='del'){if(!confirm('Delete this entry?'))return;f.logs=f.logs.filter(l=>l.id!==b.dataset.id);}
 else if(a==='goals'){showGoals=!showGoals;}
 else if(a==='savegoals'){const P=f.people.find(p=>p.id===sel);const n=document.getElementById('gName').value.trim().slice(0,30);if(n)P.name=n;
  P.goals={activeMin:num('gAct'),steps:num('gSteps'),water:num('gWater'),sleep:num('gSleep'),weight:num('gWeight'),calories:num('gCal'),protein:num('gPro')};showGoals=false;toast('Goals saved.');}
 else if(a==='delp'){const P=f.people.find(p=>p.id===sel);if(!confirm(`Remove ${P.name} and all of their fitness entries?`))return;f.people=f.people.filter(p=>p.id!==sel);f.logs=f.logs.filter(l=>l.personId!==sel);sel=null;showGoals=false;}
 else if(a==='plan'){planWeek=+b.dataset.v;}
 else if(a==='meal'){const cur=(f.mealPlan[b.dataset.d]||{})[b.dataset.s]||'';const v=prompt(`${b.dataset.s[0].toUpperCase()+b.dataset.s.slice(1)} on ${pd(b.dataset.d).toLocaleDateString(undefined,{weekday:'long',month:'short',day:'numeric'})}`,cur);if(v===null)return;setMeal(b.dataset.d,b.dataset.s,v.trim());}
 else return;
 persist();
});
const baseRender=window.render;
window.render=function(){baseRender.apply(this,arguments);if(view==='fitness')renderFitness();};
})();
