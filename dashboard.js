/* The Family Save dashboard: the few numbers that matter for a household.
   Money: safe-to-spend, savings rate, spending pace vs budget, cash flow,
   where the money goes vs normal, bills coming up.
   Tasks: weekly completions, overdue and stuck items.
   All computed locally from data.tasks and data.finance. Charts are inline
   SVG with hover/tap tooltips and a table view for every chart. */
(function(){
'use strict';
// Validated against the dark panel surface (#0d141f): all checks pass.
const C={s1:'#3987e5',s2:'#d95926',muted:'#6b7a8c',grid:'#1c2838',axis:'#2a3a4f',surface:'#0d141f',
 ink:'#eef6fb',ink2:'#aebdcc',ink3:'#7f93a8',good:'#0ca30c',goodText:'#3fd16b',warn:'#fab219',bad:'#d03b3b',badText:'#ff8a8a'};
const DAY=864e5;
const pd=s=>{const [y,m,d]=s.split('-').map(Number);return new Date(y,m-1,d);};
const mkey=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
const addMonths=(k,n)=>{const [y,m]=k.split('-').map(Number);return mkey(new Date(y,m-1+n,1));};
const monthName=(k,o={month:'short'})=>{const [y,m]=k.split('-').map(Number);return new Date(y,m-1,1).toLocaleDateString(undefined,o);};
const daysIn=k=>{const [y,m]=k.split('-').map(Number);return new Date(y,m,0).getDate();};
const $=(c,opt={})=>{const v=c/100,a=Math.abs(v);let s;
 if(opt.compact&&a>=10000)s='$'+(a/1000).toFixed(a>=100000?0:1).replace(/\.0$/,'')+'K';
 else s='$'+a.toLocaleString('en-US',{minimumFractionDigits:opt.cents?2:0,maximumFractionDigits:opt.cents?2:0});
 return (v<0?'−':'')+s;};
const pct=x=>(x>0?'+':x<0?'−':'')+Math.abs(Math.round(x*100))+'%';
function fin(){const f=data.finance||{};return {txns:f.txns||[],bills:f.bills||[],budgets:f.budgets||{}};}

// ---- metrics ----------------------------------------------------------
function metrics(){
 const f=fin(),today=day(),td=pd(today),cur=mkey(td),dom=td.getDate(),N=daysIn(cur);
 const months=[...Array(6)].map((_,i)=>addMonths(cur,i-5));
 const byMonth={};for(const k of months)byMonth[k]={income:0,spend:0};
 const catBy={};
 for(const t of f.txns){const k=t.date.slice(0,7);
  if(byMonth[k])byMonth[k][t.type==='income'?'income':'spend']+=t.amount;
  if(t.type==='expense'){(catBy[k]=catBy[k]||{})[t.category]=((catBy[k]||{})[t.category]||0)+t.amount;}}
 const m=byMonth[cur],prev=[1,2,3].map(i=>addMonths(cur,-i));
 // bills still unpaid this month (due later or already late)
 const unpaid=f.bills.filter(b=>!b.paid?.[cur]);
 const unpaidTotal=unpaid.reduce((a,b)=>a+b.amount,0);
 const setAside=window.Savings?window.Savings.monthSaved(cur):0;
 const safe=m.income?m.income-m.spend-unpaidTotal-setAside:null;
 // savings rate vs average of prior months that had income
 const rate=m.income?(m.income-m.spend)/m.income:null;
 const prevRates=prev.map(k=>byMonth[k]||{income:0,spend:0}).filter(x=>x.income>0).map(x=>(x.income-x.spend)/x.income);
 const rateAvg=prevRates.length?prevRates.reduce((a,b)=>a+b,0)/prevRates.length:null;
 // spending pace: bills count once (paid + still unpaid); only everyday
 // spending is projected forward at its month-to-date daily rate.
 const billNames=new Set(f.bills.map(b=>b.name.toLowerCase()));
 const isBill=t=>!!t.billId||billNames.has(String(t.note||'').toLowerCase());
 const curExp=f.txns.filter(t=>t.type==='expense'&&t.date.slice(0,7)===cur);
 const variable=curExp.filter(t=>!isBill(t)).reduce((a,t)=>a+t.amount,0);
 const projected=dom>=3?Math.round(m.spend+unpaidTotal+variable/dom*(N-dom)):null;
 const B0=window.Budget?window.Budget.budget(cur):null,asg=B0&&B0.totalAssigned?B0.assigned:f.budgets;
 const budget=Object.values(asg).reduce((a,b)=>a+b,0);
 const lastSpend=(byMonth[addMonths(cur,-1)]||{}).spend||0;
 // cumulative daily spend: this month vs last month
 const lm=addMonths(cur,-1),NL=daysIn(lm);
 const daily=(k,n)=>{const arr=Array(n).fill(0);for(const t of f.txns)if(t.type==='expense'&&t.date.slice(0,7)===k){const d=+t.date.slice(8,10);if(d>=1&&d<=n)arr[d-1]+=t.amount;}let s=0;return arr.map(v=>s+=v);};
 const cumThis=daily(cur,N).slice(0,dom),cumLast=daily(lm,NL);
 // categories: this month vs 3-month average
 const cats={};for(const [c,v] of Object.entries(catBy[cur]||{}))cats[c]={now:v,avg:0};
 for(const k of prev)for(const [c,v] of Object.entries(catBy[k]||{})){(cats[c]=cats[c]||{now:0,avg:0}).avg+=v/3;}
 const catRows=Object.entries(cats).map(([c,x])=>({c,now:x.now,avg:Math.round(x.avg),budget:asg[c]||0})).filter(x=>x.now>0).sort((a,b)=>b.now-a.now);
 // bills due in the next 14 days
 const soon=[];for(const b of f.bills)for(const k of [cur,addMonths(cur,1)]){const due=`${k}-${String(Math.min(b.dueDay,daysIn(k))).padStart(2,'0')}`;const diff=Math.round((pd(due)-pd(today))/DAY);
  if(!b.paid?.[k]&&diff<=14&&(diff>=0||k===cur))soon.push({name:b.name,amount:b.amount,due,diff});}
 soon.sort((a,b)=>a.due.localeCompare(b.due));
 // tasks
 const tasks=data.tasks,open=tasks.filter(t=>t.status!=='done');
 const ws=d=>{const x=new Date(d);x.setDate(x.getDate()-x.getDay());return day(x);};
 const thisWeek=ws(td),weeks=[...Array(8)].map((_,i)=>{const d=pd(thisWeek);d.setDate(d.getDate()-7*(7-i));return day(d);});
 const doneBy={};for(const w of weeks)doneBy[w]=0;
 for(const t of tasks)if(t.status==='done'&&t.completed){const w=ws(new Date(t.completed));if(w in doneBy)doneBy[w]++;}
 const overdue=open.filter(t=>(t.due&&t.due<today)||t.scheduled<today);
 const stuck=open.filter(t=>(t.rollovers||0)>=2||t.scheduled<=day(new Date(td-7*DAY))).sort((a,b)=>(b.rollovers||0)-(a.rollovers||0)||a.scheduled.localeCompare(b.scheduled));
 const sched30=tasks.filter(t=>t.scheduled>=day(new Date(td-30*DAY))&&t.scheduled<=today);
 const doneRate=sched30.length?sched30.filter(t=>t.status==='done').length/sched30.length:null;
 return {setAside,cur,dom,N,months,byMonth,m,unpaid,unpaidTotal,safe,rate,rateAvg,projected,budget,lastSpend,cumThis,cumLast,catRows,soon,
  weeks,doneBy,thisWeek,overdue,stuck,doneRate,openCount:open.length,hasMoney:f.txns.length>0,hasTasks:tasks.length>0};
}
function insights(M){
 const out=[];
 if(M.projected!==null&&M.budget){const r=M.projected/M.budget;if(r>1)out.push(['bad',`On pace to spend ${$(M.projected)} this month, ${$(M.projected-M.budget)} over your ${$(M.budget)} budget.`]);else if(r>0.9)out.push(['warn',`Spending is on pace for ${Math.round(r*100)}% of budget. Little room left.`]);}
 else if(M.projected!==null&&M.lastSpend&&M.projected>M.lastSpend*1.1)out.push(['warn',`On pace to spend ${$(M.projected)} this month, ${pct(M.projected/M.lastSpend-1)} vs last month.`]);
 const jump=M.catRows.filter(x=>x.avg>2000&&x.now>x.avg*1.25).sort((a,b)=>(b.now-b.avg)-(a.now-a.avg))[0];
 if(jump)out.push(['warn',`${jump.c} is ${$(jump.now)} so far, ${pct(jump.now/jump.avg-1)} vs your 3-month average.`]);
 const over=M.catRows.filter(x=>x.budget&&x.now>x.budget&&x!==jump);
 for(const x of over.slice(0,2))out.push(['bad',`${x.c} is over budget: ${$(x.now)} of ${$(x.budget)}.`]);
 const late=M.soon.filter(b=>b.diff<0);if(late.length)out.push(['bad',`${late.length} bill${late.length>1?'s are':' is'} past due: ${late.map(b=>b.name).join(', ')}.`]);
 const next=M.soon.filter(b=>b.diff>=0&&b.diff<=7);if(next.length)out.push(['info',`${next.length} bill${next.length>1?'s':''} due this week, totaling ${$(next.reduce((a,b)=>a+b.amount,0))}.`]);
 if(M.rate!==null&&M.rateAvg!==null&&Math.abs(M.rate-M.rateAvg)>=0.05)out.push([M.rate>M.rateAvg?'good':'warn',`Saving ${Math.round(M.rate*100)}% of income this month vs ${Math.round(M.rateAvg*100)}% on average.`]);
 if(M.stuck.length)out.push(['warn',`${M.stuck.length} task${M.stuck.length>1?'s have':' has'} been pushed back repeatedly. Worth deciding or dropping.`]);
 if(window.Savings){const behind=window.Savings.goals().filter(g=>{const st=window.Savings.status(g);return st.onTrack===false;});for(const g of behind.slice(0,2)){const st=window.Savings.status(g);out.push(['warn',`${g.name} is behind schedule: put about ${$(st.perMonth)} a month toward it to reach ${$(g.target)} on time.`]);}}
 if(window.Fitness){const idle=window.Fitness.people().filter(p=>{const st=window.Fitness.stats(p.id);return p.goals.activeMin&&st.minutes7<p.goals.activeMin*0.5&&data.fitness?.logs?.some(l=>l.personId===p.id);});if(idle.length)out.push(['warn',`${idle.map(p=>p.name).join(' and ')} ${idle.length>1?'are':'is'} under half of the weekly activity goal.`]);}
 if(!out.length&&(M.hasMoney||M.hasTasks))out.push(['good','Nothing needs attention right now.']);
 return out.slice(0,5);
}

// ---- chart helpers ----------------------------------------------------
function nice(max){if(max<=0)return {top:100,step:25};const raw=max/4,mag=Math.pow(10,Math.floor(Math.log10(raw))),n=raw/mag,step=(n<=1?1:n<=2?2:n<=2.5?2.5:n<=5?5:10)*mag;return {top:Math.ceil(max/step)*step,step};}
const tick=c=>{const v=c/100;return v>=1000?'$'+(v/1000).toFixed(v%1000?1:0)+'K':'$'+Math.round(v);};
const colPath=(x,y,w,h,r=4)=>{if(h<=0)return '';r=Math.min(r,h,w/2);return `M${x},${y+h}V${y+r}Q${x},${y} ${x+r},${y}H${x+w-r}Q${x+w},${y} ${x+w},${y+r}V${y+h}Z`;};
function tip(card,html,x,y){let t=card.querySelector('.dz-tip');if(!t){t=document.createElement('div');t.className='dz-tip';card.appendChild(t);}
 if(html==null){t.style.opacity=0;return;}t.innerHTML=html;t.style.opacity=1;const cw=card.clientWidth,tw=t.offsetWidth;t.style.left=Math.max(6,Math.min(cw-tw-6,x-tw/2))+'px';t.style.top=Math.max(4,y-t.offsetHeight-10)+'px';}
function wire(card,hits,fmt){
 // pointer + keyboard: each hit area shows the same tooltip
 card.querySelectorAll('[data-i]').forEach(el=>{const i=+el.dataset.i;
  const show=()=>{const r=el.getBoundingClientRect(),cr=card.getBoundingClientRect();tip(card,fmt(i),r.left-cr.left+r.width/2,r.top-cr.top);card.querySelectorAll('[data-i]').forEach(o=>o.classList.toggle('dz-on',o===el));};
  el.addEventListener('pointerenter',show);el.addEventListener('click',show);el.addEventListener('focus',show);
  el.addEventListener('pointerleave',()=>{tip(card,null);el.classList.remove('dz-on');});el.addEventListener('blur',()=>tip(card,null));});
}
function legend(items){return `<div class="dz-legend">${items.map(([c,l,line])=>`<span><i style="background:${c};${line?'height:2px;width:14px;border-radius:2px':''}"></i>${l}</span>`).join('')}</div>`;}
function table(head,rows){return `<table class="dz-table"><thead><tr>${head.map(h=>`<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr>${r.map(c=>`<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`;}

function cashFlowChart(M,W){
 const H=180,L=40,R=8,T=18,B=24,pw=W-L-R,ph=H-T-B;
 const vals=M.months.map(k=>M.byMonth[k]);const {top,step}=nice(Math.max(...vals.map(v=>Math.max(v.income,v.spend))));
 const band=pw/M.months.length,bw=Math.min(20,(band-14)/2),y=v=>T+ph-(v/top)*ph;
 let g='';for(let v=0;v<=top+1;v+=step)g+=`<line x1="${L}" x2="${W-R}" y1="${y(v)}" y2="${y(v)}" stroke="${v?C.grid:C.axis}" stroke-width="1"/><text x="${L-6}" y="${y(v)+3.5}" text-anchor="end" class="dz-tick">${tick(v)}</text>`;
 let bars='',hits='',labels='';
 M.months.forEach((k,i)=>{const cx=L+band*i+band/2,v=vals[i],x1=cx-bw-1,x2=cx+1;
  bars+=`<path d="${colPath(x1,y(v.income),bw,T+ph-y(v.income))}" fill="${C.s1}"/><path d="${colPath(x2,y(v.spend),bw,T+ph-y(v.spend))}" fill="${C.s2}"/>`;
  labels+=`<text x="${cx}" y="${H-7}" text-anchor="middle" class="dz-tick">${monthName(k)}</text>`;
  if(i===M.months.length-1){const net=v.income-v.spend;labels+=`<text x="${cx}" y="${Math.min(y(v.income),y(v.spend))-6}" text-anchor="middle" class="dz-val">${net>=0?'+':''}${$(net,{compact:true})}</text>`;}
  hits+=`<rect data-i="${i}" tabindex="0" x="${L+band*i}" y="${T}" width="${band}" height="${ph+B}" fill="transparent" class="dz-hit"/>`;});
 return {svg:`<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" role="img" aria-label="Income and spending by month, last 6 months">${g}${bars}${labels}${hits}</svg>`,
  fmt:i=>{const k=M.months[i],v=vals[i],n=v.income-v.spend;return `<b>${monthName(k,{month:'long',year:'numeric'})}</b><br><i style="background:${C.s1}"></i>Income ${$(v.income)}<br><i style="background:${C.s2}"></i>Spending ${$(v.spend)}<br>Net ${n>=0?'+':''}${$(n)}`;},
  table:table(['Month','Income','Spending','Net'],M.months.map(k=>{const v=M.byMonth[k];return [monthName(k,{month:'short',year:'numeric'}),$(v.income),$(v.spend),$(v.income-v.spend)];}))};
}
function paceChart(M,W){
 const H=170,L=40,R=46,T=14,B=22,pw=W-L-R,ph=H-T-B,N=Math.max(M.N,M.cumLast.length);
 const max=Math.max(1,...M.cumThis,...M.cumLast,M.budget||0);const {top,step}=nice(max);
 const x=d=>L+(d-1)/(N-1)*pw,y=v=>T+ph-(v/top)*ph;
 let g='';for(let v=0;v<=top+1;v+=step)g+=`<line x1="${L}" x2="${W-R}" y1="${y(v)}" y2="${y(v)}" stroke="${v?C.grid:C.axis}"/><text x="${L-6}" y="${y(v)+3.5}" text-anchor="end" class="dz-tick">${tick(v)}</text>`;
 for(const d of [1,8,15,22,N])g+=`<text x="${x(d)}" y="${H-6}" text-anchor="middle" class="dz-tick">${d}</text>`;
 const line=a=>a.map((v,i)=>`${i?'L':'M'}${x(i+1).toFixed(1)},${y(v).toFixed(1)}`).join('');
 let s='';
 if(M.budget)s+=`<line x1="${L}" x2="${W-R}" y1="${y(M.budget)}" y2="${y(M.budget)}" stroke="${C.warn}" stroke-opacity=".55"/><text x="${W-R+4}" y="${y(M.budget)+3.5}" class="dz-tick">Budget</text>`;
 if(M.cumLast.length)s+=`<path d="${line(M.cumLast)}" fill="none" stroke="${C.muted}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
 if(M.cumThis.length){const a=M.cumThis,last=a.length;s+=`<path d="${line(a)}L${x(last)},${T+ph}L${x(1)},${T+ph}Z" fill="${C.s1}" fill-opacity=".1"/><path d="${line(a)}" fill="none" stroke="${C.s1}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/><circle cx="${x(last)}" cy="${y(a[last-1])}" r="4" fill="${C.s1}" stroke="${C.surface}" stroke-width="2"/><text x="${x(last)+8}" y="${y(a[last-1])+4}" class="dz-val">${$(a[last-1],{compact:true})}</text>`;}
 let hits='';for(let d=1;d<=N;d++)hits+=`<rect data-i="${d}" x="${x(d)-pw/(N-1)/2}" y="${T}" width="${pw/(N-1)}" height="${ph}" fill="transparent" class="dz-hit dz-col"/>`;
 return {svg:`<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" role="img" aria-label="Cumulative spending this month compared with last month">${g}${s}<line class="dz-cross" x1="0" x2="0" y1="${T}" y2="${T+ph}" stroke="${C.ink3}" stroke-opacity="0"/>${hits}</svg>`,
  fmt:d=>{const a=M.cumThis[d-1],b=M.cumLast[d-1];return `<b>Day ${d}</b><br><i style="background:${C.s1}"></i>This month ${a==null?'—':$(a)}<br><i style="background:${C.muted}"></i>Last month ${b==null?'—':$(b)}`;},
  x,table:table(['Day','This month','Last month'],[...Array(N)].map((_,i)=>[i+1,M.cumThis[i]==null?'—':$(M.cumThis[i]),M.cumLast[i]==null?'—':$(M.cumLast[i])]).filter((_,i)=>i%7===0||i===M.cumThis.length-1||i===N-1))};
}
function weeksChart(M,W){
 const H=130,L=24,R=8,T=16,B=22,pw=W-L-R,ph=H-T-B,vals=M.weeks.map(w=>M.doneBy[w]);const {top,step}=nice(Math.max(4,...vals));
 const band=pw/vals.length,bw=Math.min(22,band-10),y=v=>T+ph-(v/top)*ph;
 let g='';for(let v=0;v<=top;v+=step)g+=`<line x1="${L}" x2="${W-R}" y1="${y(v)}" y2="${y(v)}" stroke="${v?C.grid:C.axis}"/><text x="${L-5}" y="${y(v)+3.5}" text-anchor="end" class="dz-tick">${Math.round(v)}</text>`;
 let bars='',hits='';vals.forEach((v,i)=>{const cx=L+band*i+band/2,isNow=i===vals.length-1;
  bars+=`<path d="${colPath(cx-bw/2,y(v),bw,T+ph-y(v))}" fill="${C.s1}" fill-opacity="${isNow?1:.55}"/>`;
  if(isNow)bars+=`<text x="${cx}" y="${y(v)-5}" text-anchor="middle" class="dz-val">${v}</text>`;
  if(i%2===1||isNow)bars+=`<text x="${cx}" y="${H-6}" text-anchor="middle" class="dz-tick">${isNow?'This wk':pd(M.weeks[i]).toLocaleDateString(undefined,{month:'numeric',day:'numeric'})}</text>`;
  hits+=`<rect data-i="${i}" tabindex="0" x="${L+band*i}" y="${T}" width="${band}" height="${ph+B}" fill="transparent" class="dz-hit"/>`;});
 return {svg:`<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" role="img" aria-label="Tasks completed per week, last 8 weeks">${g}${bars}${hits}</svg>`,
  fmt:i=>`<b>Week of ${pd(M.weeks[i]).toLocaleDateString(undefined,{month:'short',day:'numeric'})}</b><br>${vals[i]} task${vals[i]===1?'':'s'} done`,
  table:table(['Week of','Completed'],M.weeks.map((w,i)=>[pd(w).toLocaleDateString(undefined,{month:'short',day:'numeric'}),vals[i]]))};
}

// ---- view -------------------------------------------------------------
const section=document.createElement('section');section.id='dashboard';section.className='view hidden';
const today=document.getElementById('today');today.parentNode.insertBefore(section,today.nextSibling);
const tabs=document.getElementById('tabs'),tab=document.createElement('button');tab.className='tab';tab.dataset.view='dashboard';tab.textContent='Dashboard';
tabs.insertBefore(tab,tabs.querySelector('[data-view="tasks"]'));
const css=document.createElement('style');css.textContent=`
#tabs.tabs{display:flex!important;overflow-x:auto;scrollbar-width:none;-webkit-overflow-scrolling:touch}#tabs.tabs::-webkit-scrollbar{display:none}#tabs .tab{flex:0 0 auto;padding:11px 12px;font-size:12px}
.dz-hero{font-size:52px;font-weight:800;letter-spacing:-.03em;line-height:1;margin:6px 0 4px}.dz-sub{font-size:13px;color:${C.ink2}}
.dz-tiles{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:14px}.dz-tile{background:#0e1826;border:1px solid #1c2e44;border-radius:14px;padding:12px}
.dz-tile .l{font-size:11.5px;color:${C.ink3}}.dz-tile .v{font-size:22px;font-weight:750;margin-top:4px}.dz-tile .d{font-size:11.5px;margin-top:3px;color:${C.ink2}}
.dz-good{color:${C.goodText}}.dz-bad{color:${C.badText}}.dz-warn{color:${C.warn}}
.dz-card{position:relative}.dz-card h2{margin-bottom:4px}.dz-cap{font-size:12px;color:${C.ink3};margin:0 0 8px}
.dz-legend{display:flex;gap:14px;font-size:11.5px;color:${C.ink2};margin:4px 0 6px}.dz-legend i{display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:6px;vertical-align:middle}
.dz-tick{font-size:10px;fill:${C.ink3};font-variant-numeric:tabular-nums}.dz-val{font-size:11px;font-weight:700;fill:${C.ink}}
.dz-hit{cursor:pointer;outline:none}.dz-hit.dz-on:not(.dz-col){fill:#ffffff08}
.dz-tip{position:absolute;pointer-events:none;opacity:0;transition:opacity .12s;background:#06101aee;border:1px solid #2b4a63;border-radius:10px;padding:8px 10px;font-size:12px;line-height:1.55;color:${C.ink};white-space:nowrap;z-index:3}
.dz-tip i{display:inline-block;width:8px;height:8px;border-radius:2px;margin-right:6px}
.dz-tbtn{position:absolute;top:14px;right:14px}.dz-table{width:100%;border-collapse:collapse;font-size:12px;margin-top:8px;font-variant-numeric:tabular-nums}.dz-table th,.dz-table td{text-align:right;padding:6px 4px;border-bottom:1px solid ${C.grid}}.dz-table th:first-child,.dz-table td:first-child{text-align:left}.dz-table th{color:${C.ink3};font-weight:600}
.dz-ins{list-style:none;padding:0;margin:0}.dz-ins li{display:flex;gap:10px;padding:9px 0;border-bottom:1px solid ${C.grid};font-size:13px;line-height:1.45}.dz-ins li:last-child{border:0}.dz-ins b{flex:none;width:20px;text-align:center}
.dz-cat{padding:7px 0}.dz-cat .top{display:flex;justify-content:space-between;font-size:13px;gap:8px}.dz-cat .top span:last-child{font-variant-numeric:tabular-nums;white-space:nowrap}.dz-cat .meta{font-size:11px;color:${C.ink3};margin-top:2px}
.dz-track{position:relative;height:8px;margin-top:5px}.dz-track i{position:absolute;left:0;top:0;height:8px;border-radius:0 4px 4px 0;background:${C.s1}}.dz-track u{position:absolute;top:-3px;width:2px;height:14px;background:${C.ink2};border-radius:1px}
.dz-row{display:flex;justify-content:space-between;gap:10px;padding:8px 0;border-bottom:1px solid ${C.grid};font-size:13px}.dz-row:last-child{border:0}.dz-row .s{font-size:11.5px;color:${C.ink3}}
.dz-empty{color:${C.ink3};font-size:13px;padding:8px 0}`;
document.head.appendChild(css);
const showTable={};
function card(id,title,cap,body,tableHtml){return `<div class="panel dz-card" id="dz-${id}">${tableHtml?`<button class="btn alt sm dz-tbtn" data-dzt="${id}">${showTable[id]?'Chart':'Table'}</button>`:''}<h2>${title}</h2>${cap?`<p class="dz-cap">${cap}</p>`:''}${showTable[id]&&tableHtml?tableHtml:body}</div>`;}
function goalsCard(){
 if(!window.Savings)return '';const gs=window.Savings.goals();
 if(!gs.length)return `<div class="panel"><h2>Savings goals</h2><div class="dz-empty">Add a goal in Money, like a vacation or emergency fund, to track progress here.</div></div>`;
 return `<div class="panel"><h2>Savings goals</h2><p class="dz-cap">Saved vs target · tick = where a steady pace would be today</p>${gs.map(g=>{const s=window.Savings.status(g);
  return `<div class="dz-cat"><div class="top"><span>${esc(g.name)}</span><span>${$(s.saved)} / ${$(g.target)}</span></div><div class="dz-track"><i style="width:${s.pct*100}%"></i>${s.expected!=null&&!s.done?`<u style="left:${Math.min(100,s.expected/g.target*100)}%"></u>`:''}</div><div class="meta">${s.done?'<span class="dz-good">✅ reached</span>':g.deadline?`${s.onTrack?'<span class="dz-good">✅ on track</span>':'<span class="dz-warn">⚠️ behind</span>'} · ${$(s.perMonth)}/mo needed`:`${Math.round(s.pct*100)}% · no deadline`}</div></div>`;}).join('')}</div>`;
}
function fitnessCard(){
 if(!window.Fitness)return '';const people=window.Fitness.people();const rows=people.map(p=>({p,s:window.Fitness.stats(p.id)}));
 if(!rows.some(r=>r.s.minutes7||r.s.latestW||r.s.stepsToday))return `<div class="panel"><h2>Family fitness</h2><div class="dz-empty">Log workouts or weigh-ins in Fitness to see everyone’s week here.</div></div>`;
 const max=Math.max(1,...rows.map(r=>Math.max(r.s.minutes7,r.p.goals.activeMin||0)));
 return `<div class="panel"><h2>Family fitness</h2><p class="dz-cap">Active minutes, last 7 days · tick = goal</p>${rows.map(({p,s})=>{const g=p.goals.activeMin,hit=g&&s.minutes7>=g;const wd=s.latestW&&s.w30&&s.latestW!==s.w30?(+s.latestW.value-+s.w30.value):null;
  return `<div class="dz-cat"><div class="top"><span>${esc(p.name)}</span><span>${s.minutes7} min${g?` / ${g}`:''}</span></div><div class="dz-track"><i style="width:${s.minutes7/max*100}%"></i>${g?`<u style="left:${g/max*100}%"></u>`:''}</div><div class="meta">${hit?'<span class="dz-good">✅ goal met</span> · ':''}${s.streak?`🔥 ${s.streak}-day streak`:`${s.workouts7} workout${s.workouts7===1?'':'s'}`}${s.latestW?` · ${s.latestW.value} lb${wd!=null?` (${wd>0?'+':''}${wd.toFixed(1)} in 30d)`:''}`:''}${s.sleepAvg!=null?` · sleep ${s.sleepAvg.toFixed(1)} h avg`:''}</div></div>`;}).join('')}</div>`;
}
const icon={good:'✅',warn:'⚠️',bad:'⛔',info:'📅'};
function render(){
 const M=metrics(),W=Math.max(280,(section.clientWidth||360)-36);
 const tiles=[];
 if(M.rate!==null){const d=M.rateAvg!==null?M.rate-M.rateAvg:null;tiles.push(['Savings rate',Math.round(M.rate*100)+'%',d===null?'of income kept this month':Math.abs(d)<0.01?'same as 3-mo avg':`<span class="${d>=0?'dz-good':'dz-bad'}">${d>=0?'▲':'▼'} ${Math.abs(Math.round(d*100))} pts</span> vs 3-mo avg`]);}
 else tiles.push(['Savings rate','—','Record income to see it']);
 if(M.projected!==null){const ref=M.budget||M.lastSpend;const r=ref?M.projected/ref:null;
  tiles.push(['Month-end spending pace',$(M.projected,{compact:true}),ref?`<span class="${r>1?'dz-bad':r>.9?'dz-warn':'dz-good'}">${r>1?'⛔ over':r>.9?'⚠️ near':'✅ under'}</span> ${M.budget?'budget '+$(M.budget,{compact:true}):'last month '+$(M.lastSpend,{compact:true})}`:'projected from month to date']);}
 else tiles.push(['Month-end spending pace','—','Shows after day 3 of the month']);
 const due14=M.soon.filter(b=>b.diff>=0);tiles.push(['Bills next 14 days',$(due14.reduce((a,b)=>a+b.amount,0),{compact:true}),due14.length?`${due14.length} bill${due14.length>1?'s':''}${M.soon.some(b=>b.diff<0)?' · <span class="dz-bad">⛔ some late</span>':''}`:'none due']);
 const wkNow=M.doneBy[M.thisWeek]||0,wkPrev=M.doneBy[M.weeks[6]]||0;
 tiles.push(['Tasks done this week',String(wkNow),`${M.overdue.length?`<span class="dz-bad">${M.overdue.length} overdue</span> · `:''}${wkNow>=wkPrev?'<span class="dz-good">▲</span>':'<span class="dz-bad">▼</span>'} vs ${wkPrev} last week`]);
 const ins=insights(M),cf=cashFlowChart(M,W),pace=paceChart(M,W),wk=weeksChart(M,W);
 const maxCat=Math.max(1,...M.catRows.map(x=>Math.max(x.now,x.avg)));
 const catsHtml=M.catRows.length?M.catRows.slice(0,7).map(x=>{const d=x.avg?x.now/x.avg-1:null;return `<div class="dz-cat"><div class="top"><span>${esc(x.c)}</span><span>${$(x.now)}</span></div><div class="dz-track"><i style="width:${x.now/maxCat*100}%"></i>${x.avg?`<u style="left:${x.avg/maxCat*100}%" title="3-month average"></u>`:''}</div><div class="meta">${x.avg?`${d>0.1?'<span class="dz-bad">▲ ':d<-0.1?'<span class="dz-good">▼ ':'<span>≈ '}${pct(d)}</span> vs avg ${$(x.avg)}`:'new this month'}${x.budget?` · budget ${$(x.budget)}${x.now>x.budget?' <span class="dz-bad">⛔ over</span>':''}`:''}</div></div>`;}).join('')+'<p class="dz-cap" style="margin-top:8px">Bar = this month · tick mark = your 3-month average</p>':'<div class="dz-empty">No spending recorded this month yet.</div>';
 const fmtSafe=M.safe===null?'—':$(M.safe);
 section.innerHTML=`
 <div class="panel"><div class="muted small">Safe to spend · ${monthName(M.cur,{month:'long'})}</div>
  <div class="dz-hero ${M.safe!==null&&M.safe<0?'dz-bad':''}">${fmtSafe}</div>
  <div class="dz-sub">${M.safe===null?'Add this month’s income in Money to see what’s left after bills.':`Income ${$(M.m.income)} − spent ${$(M.m.spend)} − unpaid bills ${$(M.unpaidTotal)}${M.setAside?` − saved ${$(M.setAside)}`:''}`}</div>
  <div class="dz-tiles">${tiles.map(t=>`<div class="dz-tile"><div class="l">${t[0]}</div><div class="v">${t[1]}</div><div class="d">${t[2]}</div></div>`).join('')}</div></div>
 ${ins.length?`<div class="panel"><h2>What needs attention</h2><ul class="dz-ins">${ins.map(([k,t])=>`<li><b aria-hidden="true">${icon[k]}</b><span>${esc(t)}</span></li>`).join('')}</ul></div>`:''}
 ${card('pace','Spending pace','Running total this month vs last month'+(M.budget?', with your budget line':''),M.hasMoney?legend([[C.s1,'This month',1],[C.muted,'Last month',1]])+pace.svg:'<div class="dz-empty">Record spending in Money to see your pace.</div>',M.hasMoney&&pace.table)}
 ${card('cash','Cash flow','Income vs spending, last 6 months',M.hasMoney?legend([[C.s1,'Income'],[C.s2,'Spending']])+cf.svg:'<div class="dz-empty">No money recorded yet.</div>',M.hasMoney&&cf.table)}
 ${card('cats','Where the money goes',`${monthName(M.cur,{month:'long'})} so far, compared with your normal`,catsHtml,M.catRows.length&&table(['Category','This month','3-mo avg','Budget'],M.catRows.map(x=>[esc(x.c),$(x.now),x.avg?$(x.avg):'—',x.budget?$(x.budget):'—'])))}
 <div class="panel"><h2>Bills coming up</h2>${M.soon.length?M.soon.map(b=>`<div class="dz-row"><div>${esc(b.name)}<div class="s">${pd(b.due).toLocaleDateString(undefined,{weekday:'short',month:'short',day:'numeric'})} · ${b.diff<0?`<span class="dz-bad">⛔ ${-b.diff}d late</span>`:b.diff===0?'<span class="dz-warn">⚠️ due today</span>':`in ${b.diff}d`}</div></div><div>${$(b.amount,{cents:true})}</div></div>`).join(''):'<div class="dz-empty">No unpaid bills in the next 14 days.</div>'}</div>
 ${card('weeks','Getting things done',`Tasks completed per week${M.doneRate!==null?` · ${Math.round(M.doneRate*100)}% of tasks scheduled in the last 30 days are done`:''}`,M.hasTasks?wk.svg:'<div class="dz-empty">No tasks yet.</div>',M.hasTasks&&wk.table)}
 ${goalsCard()}
 ${fitnessCard()}
 <div class="panel"><h2>Stuck tasks</h2><p class="dz-cap">Pushed back 2+ times, or scheduled over a week ago and still open</p>${M.stuck.length?M.stuck.slice(0,6).map(t=>`<div class="dz-row"><div>${esc(t.title)}<div class="s">${esc(t.area)} · scheduled ${pd(t.scheduled).toLocaleDateString(undefined,{month:'short',day:'numeric'})}${t.rollovers?` · ↪ ${t.rollovers}×`:''}</div></div><button class="btn alt sm" onclick="openTaskForm('${esc(t.id)}')">Edit</button></div>`).join(''):'<div class="dz-empty">Nothing stuck. 👍</div>'}</div>`;
 // interactions
 const pc=section.querySelector('#dz-pace');if(pc&&!showTable.pace&&M.hasMoney){wire(pc,null,pace.fmt);const cross=pc.querySelector('.dz-cross');pc.querySelectorAll('.dz-col').forEach(el=>el.addEventListener('pointerenter',()=>{const X=pace.x(+el.dataset.i);cross.setAttribute('x1',X);cross.setAttribute('x2',X);cross.setAttribute('stroke-opacity','.6');}));pc.querySelector('svg').addEventListener('pointerleave',()=>cross.setAttribute('stroke-opacity','0'));}
 const cc=section.querySelector('#dz-cash');if(cc&&!showTable.cash&&M.hasMoney)wire(cc,null,cf.fmt);
 const wc=section.querySelector('#dz-weeks');if(wc&&!showTable.weeks&&M.hasTasks)wire(wc,null,wk.fmt);
}
section.addEventListener('click',e=>{const b=e.target.closest('[data-dzt]');if(b){showTable[b.dataset.dzt]=!showTable[b.dataset.dzt];render();}});
let rt;window.addEventListener('resize',()=>{clearTimeout(rt);rt=setTimeout(()=>{if(view==='dashboard')render();},150);});
const baseRender=window.render;
window.render=function(){baseRender.apply(this,arguments);if(view==='dashboard')render();};
})();
