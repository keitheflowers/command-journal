/* The Family Save savings goals: target, deadline, contributions and
   "needs $X/month" pacing. Stored in data.finance.goals (amounts in cents)
   so they are part of backups. Shown on the Money tab and the Dashboard. */
(function(){
'use strict';
const pd=s=>{const [y,m,d]=s.split('-').map(Number);return new Date(y,m-1,d);};
const money=c=>window.Finance?window.Finance.money(c):'$'+(c/100).toFixed(2);
const whole=c=>'$'+Math.round(c/100).toLocaleString('en-US');
const cents=v=>{const n=parseFloat(String(v).replace(/[$,\s]/g,''));return isFinite(n)&&n>0?Math.round(n*100):0;};
function list(){
 if(!data.finance||typeof data.finance!=='object')data.finance={};
 const f=data.finance;f.goals=Array.isArray(f.goals)?f.goals:[];
 for(const g of f.goals)g.contributions=Array.isArray(g.contributions)?g.contributions:[];
 return f.goals;
}
const saved=g=>g.contributions.reduce((a,c)=>a+c.amount,0);
function status(g){
 const s=saved(g),left=Math.max(0,g.target-s),today=day();
 const out={saved:s,left,pct:g.target?Math.min(1,s/g.target):0,done:s>=g.target,perMonth:null,monthsLeft:null,onTrack:null,expected:null};
 if(g.deadline&&!out.done){
  const t=pd(today),d=pd(g.deadline);
  const months=d>t?Math.max(1,Math.ceil((d-t)/(30.44*864e5))):0; // 0 = deadline passed
  out.monthsLeft=months;out.perMonth=months>0?Math.ceil(left/months/100)*100:left;
  // on track = saved at least the straight-line share from start to deadline
  const start=pd((g.created||today).slice(0,10)),span=Math.max(1,d-start),gone=Math.min(span,Math.max(0,t-start));
  out.expected=Math.round(g.target*gone/span);out.onTrack=s>=out.expected-100;
 }
 return out;
}
function create({name,target,deadline}){
 const g={id:uuid(),name:String(name).trim().slice(0,60),target,deadline:deadline||null,created:stamp(),contributions:[]};
 list().push(g);try{log('goal_created',null,`${g.name} · ${money(target)}${deadline?' by '+deadline:''}`);}catch(_){}
 return g;
}
function contribute(id,amount,date,note,opening){
 const g=list().find(x=>x.id===id);if(!g||!amount)return false;
 g.contributions.push({id:uuid(),date:date||day(),amount,note:note||'',...(opening?{opening:true}:{})});
 try{log('goal_'+(amount>0?'deposit':'withdrawal'),null,`${g.name} · ${money(Math.abs(amount))}`);}catch(_){}
 return true;
}
function find(text){
 const n=s=>String(s).toLowerCase().replace(/[^a-z0-9 ]/g,' ').replace(/\b(the|my|our|a|fund|goal|savings|account)\b/g,' ').replace(/\s+/g,' ').trim();
 const q=n(text);if(!q)return null;const gs=list();
 const hits=gs.filter(g=>{const gn=n(g.name);return gn===q||gn.includes(q)||q.includes(gn);});
 return hits.length===1?hits[0]:null;
}
// money already saved before the goal existed doesn't count as set aside this month
const monthSaved=m=>list().reduce((a,g)=>a+g.contributions.filter(c=>c.date.slice(0,7)===m&&!c.opening).reduce((x,c)=>x+c.amount,0),0);
window.Savings={goals:list,saved,status,create,contribute,find,monthSaved};

// ---- Money tab panel --------------------------------------------------
let showForm=false;
const css=document.createElement('style');css.textContent=`
.sv-goal{padding:12px 0;border-bottom:1px solid #18283b}.sv-goal:last-child{border:0}
.sv-top{display:flex;align-items:baseline;gap:8px}.sv-top .n{flex:1;font-weight:700;font-size:15px}.sv-top .a{font-size:13px;font-variant-numeric:tabular-nums;color:#aebdcc;white-space:nowrap}
.sv-bar{height:10px;border-radius:5px;background:#14263a;margin:8px 0 6px;position:relative;overflow:visible}.sv-bar i{display:block;height:100%;border-radius:5px;background:linear-gradient(90deg,#46d9f5,#5b7cff)}.sv-bar i.done{background:linear-gradient(90deg,#4be3a4,#2fb9d9)}
.sv-bar u{position:absolute;top:-3px;width:2px;height:16px;background:#aebdcc;border-radius:1px}
.sv-meta{font-size:12px;color:#8ea3b8}.sv-meta b{color:#eef6fb}.sv-acts{display:flex;gap:6px;margin-top:9px;flex-wrap:wrap}`;
document.head.appendChild(css);
function panelHtml(){
 const gs=list(),today=day(),m=today.slice(0,7),ms=monthSaved(m);
 const totalLeft=gs.reduce((a,g)=>a+status(g).left,0),needMonth=gs.reduce((a,g)=>{const s=status(g);return a+(s.perMonth||0);},0);
 return `<div class="panel" id="sv-panel"><div class="header"><h2>Savings goals</h2><button class="btn sm" data-sv="form">${showForm?'Close':'+ Goal'}</button></div>
 ${gs.length?`<p class="hint" style="margin:0 0 4px">Set aside this month: <strong>${money(ms)}</strong>${needMonth?` · goals need about <strong>${whole(needMonth)}/mo</strong> to stay on schedule`:''}${totalLeft?` · ${whole(totalLeft)} to go in total`:''}</p>`:''}
 ${showForm?`<div class="two"><div><label>Goal</label><input id="svName" maxlength="60" placeholder="e.g. Vacation"></div><div><label>Target amount</label><input id="svTarget" inputmode="decimal" placeholder="3000"></div></div>
  <div class="two"><div><label>Reach it by (optional)</label><input id="svDate" type="date"></div><div><label>Already saved (optional)</label><input id="svStart" inputmode="decimal" placeholder="0"></div></div>
  <button class="btn full" style="margin-top:12px" data-sv="create">Save goal</button>`:''}
 ${gs.length?gs.map(g=>{const s=status(g);
  const meta=s.done?`<span style="color:#4be3a4">✅ Goal reached</span>`:g.deadline?`${s.onTrack?'<span style="color:#4be3a4">✅ On track</span>':'<span style="color:#fab219">⚠️ Behind</span>'} · by ${pd(g.deadline).toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'})} · <b>${whole(s.perMonth)}/mo</b> needed${s.monthsLeft?` for ${s.monthsLeft} mo`:''}`:`${whole(s.left)} to go · no deadline`;
  return `<div class="sv-goal"><div class="sv-top"><span class="n">${esc(g.name)}</span><span class="a"><b style="color:#eef6fb">${whole(s.saved)}</b> / ${whole(g.target)} · ${Math.round(s.pct*100)}%</span></div>
   <div class="sv-bar"><i class="${s.done?'done':''}" style="width:${s.pct*100}%"></i>${s.expected!=null&&!s.done?`<u style="left:${Math.min(100,s.expected/g.target*100)}%" title="Where you'd be on a steady pace"></u>`:''}</div>
   <div class="sv-meta">${meta}</div>
   <div class="sv-acts"><button class="btn sm" data-sv="add" data-id="${g.id}">+ Add money</button><button class="btn alt sm" data-sv="take" data-id="${g.id}">Withdraw</button><button class="x" data-sv="del" data-id="${g.id}" aria-label="Delete goal">✕</button></div></div>`;}).join('')+'<p class="hint" style="margin:8px 0 0">Tick mark = where you’d be on a steady pace to the deadline. Money set aside here is subtracted from Safe to spend on the Dashboard.</p>'
  :(showForm?'':'<div class="empty">No goals yet. Try a vacation, an emergency fund, or Christmas gifts. Hands-free: “Vector, open Family Save, create a savings goal Vacation 3,000 by June”.</div>')}
 </div>`;
}
function inject(){
 const sec=document.getElementById('finance');if(!sec)return;
 const old=sec.querySelector('#sv-panel');if(old)old.remove();
 const first=sec.querySelector('.panel');if(!first)return;
 first.insertAdjacentHTML('afterend',panelHtml());
}
document.addEventListener('click',e=>{
 const b=e.target.closest('#sv-panel [data-sv]');if(!b)return;const a=b.dataset.sv,gs=list();
 if(a==='form')showForm=!showForm;
 else if(a==='create'){const name=document.getElementById('svName').value.trim(),target=cents(document.getElementById('svTarget').value);
  if(!name||!target){toast('Enter a goal name and target amount.');return;}
  const g=create({name,target,deadline:document.getElementById('svDate').value||null});const st=cents(document.getElementById('svStart').value);if(st)contribute(g.id,st,day(),'Starting balance',true);showForm=false;toast('Goal saved.');}
 else if(a==='add'||a==='take'){const g=gs.find(x=>x.id===b.dataset.id);const v=cents(prompt(`${a==='add'?'Add to':'Withdraw from'} ${g.name}: how much?`)||'');if(!v)return;if(a==='take'&&v>saved(g)){toast('That’s more than is saved in this goal.');return;}contribute(g.id,a==='add'?v:-v,day());toast(a==='add'?'Added to '+g.name+'.':'Withdrawn from '+g.name+'.');}
 else if(a==='del'){const g=gs.find(x=>x.id===b.dataset.id);if(!confirm(`Delete the goal “${g.name}” and its history?`))return;data.finance.goals=gs.filter(x=>x!==g);}
 else return;
 persist();
});
const baseRender=window.render;
window.render=function(){baseRender.apply(this,arguments);if(view==='finance')inject();};
})();
