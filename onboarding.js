/* The Family Save first-run setup: a short guided start for a brand-new app
   (no tasks, money or fitness data yet). Steps: your family, money starting
   point, eating pattern, and protecting your data. Every step can be skipped
   and redone from Settings → "Run setup again". */
(function(){
'use strict';
const K='onboardDone';
const ls={get:k=>{try{return localStorage.getItem(k);}catch(_){return null;}},set:(k,v)=>{try{localStorage.setItem(k,v);}catch(_){}}};
const fresh=()=>!data.tasks.length&&!(data.finance&&(data.finance.txns||[]).length)&&!(data.fitness&&(data.fitness.logs||[]).length);
let step=0,draft={me:'',family:'',checking:'',pattern:'classic'};
const css=document.createElement('style');css.textContent=`
#onboard{position:fixed;inset:0;z-index:900;background:#070a12f2;display:flex;align-items:flex-end;justify-content:center}#onboard[hidden]{display:none}
#onboard .card{width:min(100%,520px);background:#0d141f;border:1px solid #1f3348;border-radius:20px 20px 0 0;padding:20px 18px calc(18px + env(safe-area-inset-bottom));max-height:92vh;overflow:auto}
#onboard .dots{display:flex;gap:6px;margin-bottom:12px}#onboard .dots i{flex:1;height:4px;border-radius:2px;background:#1c2e44}#onboard .dots i.on{background:#46d9f5}
#onboard h2{font-size:21px;margin:0 0 6px}#onboard .opts{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px}#onboard .opts button{text-align:left;border:1px solid #24394f;background:#0e1624;color:#eef6fb;border-radius:12px;padding:10px;font-size:13px}#onboard .opts button.on{border-color:#46d9f5;background:#0f3149}`;
document.head.appendChild(css);
const el=document.createElement('div');el.id='onboard';el.hidden=true;el.setAttribute('role','dialog');el.setAttribute('aria-label','Set up The Family Save');document.body.appendChild(el);
const STEPS=4;
function draw(){
 const pats=window.Nutrition?Object.entries(window.Nutrition.PATTERNS).filter(([k])=>k!=='custom'):[];
 const body=[
  `<h2>Welcome to The Family Save 👋</h2><p class="hint">Tasks, calendar, money, meals and training for your family, with a voice assistant called Vector. Let’s set up the basics. It takes about a minute.</p>
   <label>Your name</label><input id="obMe" value="${esc(draft.me)}" placeholder="Alex" autocomplete="given-name">
   <label>Family members (optional, comma separated)</label><input id="obFam" value="${esc(draft.family)}" placeholder="Sam, Jamie">`,
  `<h2>Money starting point</h2><p class="hint">Your budget starts from what’s in your main account. Add credit cards, loans and savings later in Money → Accounts.</p>
   <label>Checking account balance today</label><input id="obChk" inputmode="decimal" value="${esc(draft.checking)}" placeholder="2,500.00">`,
  `<h2>How do you eat?</h2><p class="hint">Your food log and meal plan follow this. You can change it any time in Health → Meals.</p>
   <div class="opts">${pats.map(([k,P])=>`<button data-ob="pat" data-v="${k}" class="${draft.pattern===k?'on':''}">${P.label}<small style="display:block;color:#7f93a8">${P.slots.length} meal${P.slots.length>1?'s':''}${P.fast?` · ${P.fast}h fast`:''}</small></button>`).join('')}</div>`,
  `<h2>Protect your data</h2><p class="hint">Everything is stored only on this phone. Two quick things keep it safe:</p>
   <div class="actions" style="flex-direction:column;align-items:stretch"><button class="btn" data-ob="lock">🔒 Set up a PIN / fingerprint</button><button class="btn alt" data-ob="backup">💾 Back up now (Google Drive, email…)</button></div>
   <p class="hint" style="margin-top:10px">Say <b>“Vector, open Family Save”</b> any time to talk to the app.</p>`][step];
 el.innerHTML=`<div class="card"><div class="dots">${Array.from({length:STEPS},(_,i)=>`<i class="${i<=step?'on':''}"></i>`).join('')}</div>${body}
  <div class="actions" style="margin-top:16px;justify-content:space-between"><button class="btn alt sm" data-ob="${step?'back':'skipall'}">${step?'Back':'Skip setup'}</button><button class="btn" data-ob="${step<STEPS-1?'next':'finish'}">${step<STEPS-1?'Next':'Start using it'}</button></div></div>`;
}
function capture(){const g=id=>document.getElementById(id);if(g('obMe'))draft.me=g('obMe').value.trim();if(g('obFam'))draft.family=g('obFam').value;if(g('obChk'))draft.checking=g('obChk').value;}
function apply(){
 // people
 if(window.Fitness){const f=data.fitness;const me=window.Fitness.people()[0];if(draft.me)me.name=draft.me.slice(0,30);
  for(const n of draft.family.split(',').map(x=>x.trim()).filter(Boolean).slice(0,8))if(!f.people.some(p=>p.name.toLowerCase()===n.toLowerCase()))f.people.push({id:uuid(),name:n.slice(0,30),goals:{activeMin:150,steps:8000,water:8,sleep:8}});
  if(window.Nutrition){const n=window.Nutrition.N(me.id),P=window.Nutrition.PATTERNS[draft.pattern];if(P){n.pattern=draft.pattern;n.slots=P.slots.map((nm,i)=>({id:'s'+(i+1),name:nm,time:(P.times||[])[i]||''}));if(P.fast)n.fastGoal=P.fast;}}}
 // money
 const c=parseFloat(String(draft.checking).replace(/[$,\s]/g,''));
 if(isFinite(c)&&window.Budget){const acc=window.Budget.accounts()[0];if(acc&&acc.start===0)acc.start=Math.round(c*100);}
 ls.set(K,'1');persist();
}
el.addEventListener('click',e=>{
 const b=e.target.closest('[data-ob]');if(!b)return;const a=b.dataset.ob;capture();
 if(a==='next'){step=Math.min(STEPS-1,step+1);draw();}
 else if(a==='back'){step=Math.max(0,step-1);draw();}
 else if(a==='pat'){draft.pattern=b.dataset.v;draw();}
 else if(a==='skipall'){ls.set(K,'1');el.hidden=true;}
 else if(a==='finish'){apply();el.hidden=true;toast('All set. Welcome! 🎉');}
 else if(a==='lock'){apply();el.hidden=true;openView('settings');setTimeout(()=>document.querySelector('[data-lks="set"]')?.click(),100);}
 else if(a==='backup'){apply();el.hidden=true;window.Backup&&window.Backup.backupNow();}
});
function show(){step=0;draft={me:'',family:'',checking:'',pattern:'classic'};draw();el.hidden=false;setTimeout(()=>document.getElementById('obMe')?.focus(),50);}
window.Onboarding={show};
// Settings: run it again
const panel=document.createElement('div');panel.className='panel';panel.innerHTML=`<h2>👋 Setup</h2><p class="hint" style="margin:0 0 8px">Walk through the first-run setup again (names, starting balance, eating pattern).</p><button class="btn alt sm" id="obAgain">Run setup again</button> <a class="btn alt sm" href="privacy.html" style="text-decoration:none;display:inline-block">Privacy</a> <a class="btn alt sm" href="terms.html" style="text-decoration:none;display:inline-block">Terms</a>`;
document.getElementById('settings').appendChild(panel);panel.querySelector('#obAgain').addEventListener('click',show);
// Settings: task areas (the categories tasks are filed under)
const ar=document.createElement('div');ar.className='panel';
function drawAreas(msg){ar.innerHTML=`<h2>🗂️ Task areas</h2><p class="hint" style="margin:0 0 8px">The categories your tasks are filed under. Rename, add or remove them (comma separated, up to 20).</p><input id="areaList" value="${esc(AREAS.join(', '))}"><div class="actions" style="margin-top:8px"><button class="btn alt sm" id="areaSave">Save areas</button></div>${msg?`<p class="hint" role="status">${esc(msg)}</p>`:''}`;}
ar.addEventListener('click',e=>{if(e.target.id!=='areaSave')return;const list=document.getElementById('areaList').value.split(',').map(x=>x.trim()).filter(Boolean);if(!list.length){drawAreas('Add at least one area.');return;}data.areas=list.slice(0,20);setAreas(data.areas);persist();drawAreas('Saved. Existing tasks keep their area until you edit them.');});
drawAreas();document.getElementById('settings').appendChild(ar);
if(!ls.get(K)&&fresh()&&!(window.AppLock&&window.AppLock.enabled()))setTimeout(show,150);
})();
