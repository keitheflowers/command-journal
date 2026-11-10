/* The Family Save weekly recap: one summary of the last 7 days across money,
   tasks, training, fitness and nutrition, plus what's coming next week and a
   focus for the week. Shown on Home on Sundays and Mondays (dismissible), on
   the Dashboard any time, spoken on request ("how was my week"), and Vector
   can add coaching when AI is on. Built only from local data. */
(function(){
'use strict';
const pd=s=>{const [y,m,d]=s.split('-').map(Number);return new Date(y,m-1,d);};
const addDays=(s,n)=>{const d=pd(s);d.setDate(d.getDate()+n);return day(d);};
const $=c=>'$'+Math.round((c||0)/100).toLocaleString('en-US');
const list=a=>a.length<=1?a.join(''):a.slice(0,-1).join(', ')+' and '+a[a.length-1];
const weekKey=()=>{const d=pd(day());d.setDate(d.getDate()-d.getDay());return day(d);};

function build(){
 const today=day(),from=addDays(today,-6),prevFrom=addDays(today,-13),prevTo=addDays(today,-7),next=addDays(today,7);
 const inWeek=d=>d>=from&&d<=today,S=[],focus=[];
 // money
 const f=data.finance||{},tx=(f.txns||[]).filter(t=>t.type==='expense');
 const spent=tx.filter(t=>inWeek(t.date)).reduce((a,t)=>a+t.amount,0),prev=tx.filter(t=>t.date>=prevFrom&&t.date<=prevTo).reduce((a,t)=>a+t.amount,0);
 if(spent||prev){const by={};for(const t of tx.filter(t=>inWeek(t.date)))by[t.category||'Other']=(by[t.category||'Other']||0)+t.amount;
  const top=Object.entries(by).sort((a,b)=>b[1]-a[1]).slice(0,3).map(([c,v])=>`${c} ${$(v)}`);
  let line=`You spent ${$(spent)}${prev?` (${spent>prev?'up':'down'} ${Math.abs(Math.round((spent/prev-1)*100))}% from the week before)`:''}${top.length?`, mostly ${list(top)}`:''}.`;
  if(window.Budget){const B=window.Budget.budget(today.slice(0,7)),over=B.cats.filter(c=>B.avail[c]<0);
   if(B.rta>0)line+=` ${$(B.rta)} is still waiting to be assigned.`;if(over.length){line+=` Overspent: ${list(over)}.`;focus.push(`Cover ${over[0]} by moving money from another category`);}}
  const goals=window.Savings?window.Savings.goals():[],saved=goals.reduce((a,g)=>a+g.contributions.filter(c=>inWeek(c.date)&&!c.opening).reduce((x,c)=>x+c.amount,0),0);
  if(saved>0)line+=` You put ${$(saved)} toward savings goals.`;
  const behind=goals.filter(g=>window.Savings.status(g).onTrack===false);if(behind.length)focus.push(`Put ${$(window.Savings.status(behind[0]).perMonth/4)} toward ${behind[0].name} to get back on track`);
  S.push(['💵','Money',line]);}
 // tasks
 const tasks=data.tasks||[],done=tasks.filter(t=>t.status==='done'&&t.completed&&inWeek(t.completed.slice(0,10))).length,overdue=tasks.filter(t=>t.status!=='done'&&((t.due&&t.due<today)||t.scheduled<today)).length;
 if(tasks.length)S.push(['✅','Tasks',`${done} task${done===1?'':'s'} done.${overdue?` ${overdue} overdue.`:' Nothing overdue.'}`]);
 if(overdue>2)focus.push(`Clear the ${overdue} overdue tasks, or reschedule the ones that don't matter`);
 // training + fitness + nutrition (first person = the phone's owner)
 const people=window.Fitness?window.Fitness.people():[];const me=people[0];
 if(me&&window.Strength){const ses=window.Strength.sessions(me.id).filter(s=>inWeek(s.date));
  if(ses.length){let prs=[],down=[],vol=0;for(const s of ses)for(const r of window.Strength.analyze(s)){vol+=r.volume;if(r.pr)prs.push(r.name);if(r.verdict&&r.verdict.k==='down')down.push(r.name);}
   S.push(['🏋️','Training',`${ses.length} workout${ses.length>1?'s':''}, ${Math.round(vol).toLocaleString()} lb lifted.${prs.length?` New PRs: ${list([...new Set(prs)])}! 🏆`:''}${down.length?` Slipping: ${list([...new Set(down)])}.`:''}`]);
   if(down.length)focus.push(`Hold the weight on ${[...new Set(down)][0]} and own every rep`);}
  const planned=window.Strength.plans(me.id).reduce((a,p)=>a+(p.days||[]).length,0);if(planned&&ses.length<planned)focus.push(`Hit all ${planned} planned workouts (you did ${ses.length})`);}
 if(me&&window.Fitness){const st=window.Fitness.stats(me.id),logs=(data.fitness.logs||[]).filter(l=>l.personId===me.id);
  const w=logs.filter(l=>l.kind==='weight'&&inWeek(l.date)).sort((a,b)=>a.date.localeCompare(b.date));
  const bits=[];if(st.minutes7)bits.push(`${st.minutes7} active minutes${me.goals.activeMin?` (goal ${me.goals.activeMin})`:''}`);
  if(w.length>=2){const ch=+w[w.length-1].value-+w[0].value;bits.push(`weight ${ch>0?'up':'down'} ${Math.abs(ch).toFixed(1)} lb`);}
  if(st.sleepAvg)bits.push(`${st.sleepAvg.toFixed(1)} h average sleep`);
  if(bits.length)S.push(['💪','Fitness',bits.join(', ').replace(/^./,c=>c.toUpperCase())+'.']);
  if(me.goals.activeMin&&st.minutes7<me.goals.activeMin*0.7)focus.push(`Add ${me.goals.activeMin-st.minutes7} more active minutes`);
  if(st.sleepAvg&&me.goals.sleep&&st.sleepAvg<me.goals.sleep-0.75)focus.push(`Get to bed earlier: aim for ${me.goals.sleep} h`);}
 if(me&&window.Nutrition){const n=window.Nutrition.N(me.id),days=[];for(let d=from;d<=today;d=addDays(d,1)){const t=window.Nutrition.totals(window.Nutrition.mealsOn(me.id,d));if(t.cal>=800)days.push(t);}
  const fs=window.Nutrition.fastStats(me.id);
  if(days.length||fs.count7){const ac=days.length?Math.round(days.reduce((a,t)=>a+t.cal,0)/days.length):0,ap=days.length?Math.round(days.reduce((a,t)=>a+t.p,0)/days.length):0,t=n.targets||{};
   let line=days.length?`Averaged ${ac.toLocaleString()} calories${t.cal?` (target ${t.cal.toLocaleString()})`:''} and ${ap} g protein${t.p?` (target ${t.p})`:''} on ${days.length} logged day${days.length>1?'s':''}.`:'';
   if(fs.count7)line+=` ${fs.done7} of ${fs.count7} fasts hit their goal.`;S.push(['🍽️','Nutrition',line.trim()]);
   if(t.p&&ap&&ap<t.p*0.9)focus.push(`Hit protein: ${t.p} g a day (you averaged ${ap})`);
   if(days.length<4)focus.push('Log food on more days so your adaptive targets can learn');}
  const ci=window.Nutrition.checkIn(me.id);if(ci.ready&&ci.due)focus.push('Your weekly calorie check-in is ready in Meals');}
 // coming up
 const up=[];const bills=(f.bills||[]);for(const b of bills){for(const k of [today.slice(0,7),addDays(today,28).slice(0,7)]){const [y,m]=k.split('-').map(Number);const d=`${k}-${String(Math.min(b.dueDay,new Date(y,m,0).getDate())).padStart(2,'0')}`;if(d>today&&d<=next&&!b.paid?.[k])up.push(`${b.name} ${$(b.amount)}`);}}
 const dueT=tasks.filter(t=>t.status!=='done'&&t.scheduled>today&&t.scheduled<=next).map(t=>t.title);
 const nextBits=[];if(up.length)nextBits.push(`bills: ${list(up.slice(0,4))}`);if(dueT.length)nextBits.push(`${dueT.length} task${dueT.length>1?'s':''} scheduled${dueT.length<=3?` (${list(dueT)})`:''}`);
 if(nextBits.length)S.push(['📅','Next week',nextBits.join('; ').replace(/^./,c=>c.toUpperCase())+'.']);
 if(!focus.length&&S.length)focus.push('Keep doing what you’re doing. It’s working');
 return {sections:S,focus:focus.slice(0,3)};
}
function text(){const r=build();if(!r.sections.length)return 'There isn’t enough this week for a recap yet. Log some spending, tasks or workouts and check back Sunday.';
 return 'Here’s your week. '+r.sections.map(([,t,l])=>`${t}: ${l}`).join(' ')+(r.focus.length?' Focus for next week: '+r.focus.join('; ')+'.':'');}
function html(withClose){const r=build();
 if(!r.sections.length)return `<div class="panel" id="recapCard"><h2>📋 Your week</h2><div class="empty">Not enough this week yet. Log spending, tasks or workouts and check back Sunday.</div></div>`;
 return `<div class="panel" id="recapCard"><div class="header"><h2>📋 Your week</h2>${withClose?'<button class="x" data-rc="close" aria-label="Dismiss">✕</button>':''}</div>
  ${r.sections.map(([i,t,l])=>`<div class="dz-row" style="display:block"><b>${i} ${t}</b><div class="hint" style="margin:2px 0 0;color:#cfdbe6">${esc(l)}</div></div>`).join('')}
  ${r.focus.length?`<div class="notice" style="margin-top:10px"><b>🎯 Focus for next week</b><ol style="margin:6px 0 0 18px;padding:0">${r.focus.map(x=>`<li>${esc(x)}</li>`).join('')}</ol></div>`:''}
  <div id="recapCoach"></div>
  <div class="actions" style="margin-top:10px"><button class="btn sm" data-rc="speak">🔊 Read it to me</button>${window.VectorAI&&window.VectorAI.enabled()?'<button class="btn alt sm" data-rc="coach">✨ Coach me</button>':''}</div></div>`;}
window.Recap={build,text,html};

// Home: Sundays and Mondays, until dismissed for the week
function dismissed(){try{return localStorage.getItem('recapDismissed')===weekKey();}catch(_){return false;}}
function inject(){
 document.getElementById('recapCard')?.remove();
 if(view==='today'){const dow=new Date().getDay();if((dow===0||dow===1)&&!dismissed()&&build().sections.length)document.getElementById('today').insertAdjacentHTML('afterbegin',html(true));}
 else if(view==='dashboard'){const d=document.getElementById('dashboard');if(d&&!d.querySelector('#recapBtn'))d.insertAdjacentHTML('afterbegin','<div class="actions" style="margin:12px 0 0"><button class="btn alt sm" id="recapBtn" data-rc="open">📋 Weekly recap</button></div>');}
}
document.addEventListener('click',async e=>{
 const b=e.target.closest('[data-rc]');if(!b)return;const a=b.dataset.rc;
 if(a==='close'){try{localStorage.setItem('recapDismissed',weekKey());}catch(_){}document.getElementById('recapCard')?.remove();}
 else if(a==='open'){document.getElementById('recapCard')?.remove();b.closest('.actions').insertAdjacentHTML('afterend',html(true));}
 else if(a==='speak'){try{speechSynthesis.cancel();const u=new SpeechSynthesisUtterance(text());u.rate=1.05;speechSynthesis.speak(u);}catch(_){toast('Speech isn’t available here.');}}
 else if(a==='coach'){const box=document.getElementById('recapCoach');box.innerHTML='<p class="hint">✨ Vector is thinking…</p>';
  try{const r=await window.VectorAI.interpret('Here is my week. Reply with no actions and, in "reply", three short, specific, encouraging coaching tips for next week based on it (money, training, nutrition). '+text());box.innerHTML=`<div class="notice" style="margin-top:10px">✨ ${esc(r.reply||'No tips this time.')}</div>`;}
  catch(err){box.innerHTML=`<p class="hint" style="color:#ff8a8a">${esc(err.message)}</p>`;}}
});
const baseRender=window.render;
window.render=function(){baseRender.apply(this,arguments);inject();};
inject();
})();
