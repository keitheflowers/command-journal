/* The Family Save money, rebuilt: zero-based budgeting (YNAB-style) plus
   accounts, net worth, transactions with rules/splits/CSV import, recurring
   detection and cash-flow reports (Monarch-style). Takes over the Money tab.
   Data lives in data.finance (cents everywhere), so it is in backups:
   accounts, txns (+accountId, payee, memo, splits, reviewed, transfers),
   assign {YYYY-MM:{cat:cents}}, targets {cat:{type,amount,date}}, rules. */
(function(){
'use strict';
const C={s1:'#3987e5',s3:'#199e70',muted:'#6b7a8c',grid:'#1c2838',axis:'#2a3a4f',surface:'#0d141f',ink:'#eef6fb',ink2:'#aebdcc',ink3:'#7f93a8',good:'#3fd16b',bad:'#ff8a8a',warn:'#fab219'};
const GROUPS=[['Bills & fixed',['Housing','Utilities','Insurance','Debt','Subscriptions']],['Everyday',['Groceries','Dining','Gas','Transportation','Health','Kids','Shopping','Entertainment']],['Giving & savings',['Giving','Savings','Other']]];
const TYPES={checking:['Checking',true,true],savings:['Savings',true,true],cash:['Cash',true,true],credit:['Credit card',true,false],loan:['Loan / mortgage',false,false],investment:['Investment',false,true],property:['Property / vehicle',false,true]}; // [label, on-budget default, is asset]
const $=(c,o={})=>{const v=(c||0)/100,a=Math.abs(v);const s=o.compact&&a>=10000?'$'+(a/1000).toFixed(a>=100000?0:1).replace(/\.0$/,'')+'K':'$'+a.toLocaleString('en-US',{minimumFractionDigits:o.whole?0:2,maximumFractionDigits:o.whole?0:2});return (v<0?'−':'')+s;};
const cents=v=>{let s=String(v??'').trim();const neg=/^\(.*\)$/.test(s)||/^-/.test(s)||/-$/.test(s);s=s.replace(/[^0-9.]/g,'');const n=parseFloat(s);return isFinite(n)?Math.round(n*100)*(neg?-1:1):null;};
const pd=s=>{const [y,m,d]=s.split('-').map(Number);return new Date(y,m-1,d);};
const mkey=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
const addM=(k,n)=>{const [y,m]=k.split('-').map(Number);return mkey(new Date(y,m-1+n,1));};
const mName=(k,o={month:'long',year:'numeric'})=>{const [y,m]=k.split('-').map(Number);return new Date(y,m-1,1).toLocaleDateString(undefined,o);};
const short=s=>pd(s).toLocaleDateString(undefined,{month:'short',day:'numeric'});
const normP=s=>String(s||'').toLowerCase().replace(/#?\d{3,}/g,' ').replace(/[^a-z ]/g,' ').replace(/\b(pos|debit|purchase|card|ach|online|payment|recurring|pmt|www|com|inc|llc|co)\b/g,' ').replace(/\s+/g,' ').trim();

// ---- data + migration ------------------------------------------------------
function F(){
 if(!data.finance||typeof data.finance!=='object')data.finance={};
 const f=data.finance;
 f.txns=Array.isArray(f.txns)?f.txns:[];f.bills=Array.isArray(f.bills)?f.bills:[];f.budgets=f.budgets||{};
 f.assign=f.assign&&typeof f.assign==='object'?f.assign:{};f.targets=f.targets&&typeof f.targets==='object'?f.targets:{};f.rules=Array.isArray(f.rules)?f.rules:[];
 if(!Array.isArray(f.accounts)||!f.accounts.length){
  f.accounts=[{id:uuid(),name:'Checking',type:'checking',onBudget:true,start:0,created:stamp()}];
  // old monthly category budgets become monthly targets
  for(const [c,v] of Object.entries(f.budgets))if(v&&!f.targets[c])f.targets[c]={type:'monthly',amount:v};
 }
 const def=f.accounts.find(a=>!a.closed&&a.onBudget)||f.accounts[0];
 for(const t of f.txns){if(!t.accountId)t.accountId=def.id;if(t.payee==null)t.payee=t.note||'';if(t.reviewed==null)t.reviewed=true;}
 return f;
}
const acct=id=>F().accounts.find(a=>a.id===id);
const onBudget=t=>{const a=acct(t.accountId);return !a||a.onBudget;};
const signed=t=>t.type==='income'?t.amount:t.type==='expense'?-t.amount:t.type==='transfer'?(t.dir==='in'?t.amount:-t.amount):t.type==='adjust'?t.amount:0;
function balance(a,upTo){return (a.start||0)+F().txns.filter(t=>t.accountId===a.id&&(!upTo||t.date<=upTo)).reduce((s,t)=>s+signed(t),0);}
const isAsset=a=>(TYPES[a.type]||TYPES.checking)[2];
// expense amount per category, honoring splits
function catSpend(t){if(t.type!=='expense')return [];if(Array.isArray(t.splits)&&t.splits.length)return t.splits.map(s=>[s.category,s.amount]);return [[t.category||'Other',t.amount]];}
function categories(){const f=F(),set=new Set(GROUPS.flatMap(g=>g[1]));for(const t of f.txns)for(const [c] of catSpend(t))set.add(c);for(const k in f.assign)for(const c in f.assign[k])set.add(c);for(const c in f.targets)set.add(c);return [...set];}
function groups(){const known=new Set(GROUPS.flatMap(g=>g[1])),extra=categories().filter(c=>!known.has(c));return extra.length?[...GROUPS.slice(0,2),[GROUPS[2][0],[...GROUPS[2][1],...extra]]]:GROUPS;}

// ---- zero-based budget math (carry positive balances; overspending comes out of next month's Ready to Assign)
function budget(M){
 const f=F(),cats=categories(),txM=f.txns.map(t=>t.date.slice(0,7)),aM=Object.keys(f.assign);
 let first=[...txM,...aM,M].sort()[0];const last=[...aM,M].sort().at(-1);
 const startCash=f.accounts.filter(a=>a.onBudget).reduce((s,a)=>s+(a.start||0),0);
 let carry={},overspentBefore=0,inflowTo=0,res=null;
 for(let k=first;k<=last;k=addM(k,1)){
  // income, plus balance adjustments from reconciling (a corrected balance changes what there is to budget)
  const spent={},inflow=f.txns.filter(t=>(t.type==='income'||t.type==='adjust')&&t.date.slice(0,7)===k&&onBudget(t)).reduce((s,t)=>s+t.amount,0);
  for(const t of f.txns)if(t.date.slice(0,7)===k&&onBudget(t))for(const [c,v] of catSpend(t))spent[c]=(spent[c]||0)+v;
  const asg=f.assign[k]||{},avail={};
  for(const c of cats){const prev=carry[c]||0;avail[c]=(prev>0?prev:0)+(asg[c]||0)-(spent[c]||0);}
  if(k<=M)inflowTo+=inflow;
  if(k===M){
   const assignedAll=Object.values(f.assign).reduce((s,m)=>s+Object.values(m).reduce((x,v)=>x+v,0),0);
   res={month:M,cats,avail,spent,assigned:asg,inflow,rta:startCash+inflowTo-assignedAll-overspentBefore,carryIn:{...carry},
    totalAssigned:Object.values(asg).reduce((s,v)=>s+v,0),totalSpent:Object.values(spent).reduce((s,v)=>s+v,0)};
  }
  if(k<M)overspentBefore+=Object.values(avail).filter(v=>v<0).reduce((s,v)=>s-v,0);
  carry=avail;
 }
 return res;
}
function needed(c,B){
 const t=F().targets[c];if(!t||!t.amount)return null;const asg=B.assigned[c]||0;
 if(t.type==='bydate'&&t.date){const prev=Math.max(0,B.carryIn[c]||0);const months=Math.max(1,(pd(t.date).getFullYear()-pd(B.month+'-01').getFullYear())*12+pd(t.date).getMonth()-pd(B.month+'-01').getMonth()+1);
  const per=Math.ceil(Math.max(0,t.amount-prev)/months);return {need:Math.max(0,per-asg),per,label:`${$(t.amount,{whole:true})} by ${pd(t.date).toLocaleDateString(undefined,{month:'short',year:'numeric'})}`};}
 return {need:Math.max(0,t.amount-asg),per:t.amount,label:`${$(t.amount,{whole:true})}/month`};
}
function setAssign(M,c,v){const f=F();(f.assign[M]=f.assign[M]||{});if(v)f.assign[M][c]=v;else delete f.assign[M][c];}
function move(M,from,to,amt){const f=F(),a=f.assign[M]||{};setAssign(M,from,(a[from]||0)-amt);setAssign(M,to,((f.assign[M]||{})[to]||0)+amt);try{log('budget_move',null,`${$(amt)} ${from} → ${to}`);}catch(_){}}
// Age of money: first-in-first-out from inflows to outflows on budget accounts
function ageOfMoney(){
 const f=F(),ev=[];for(const a of f.accounts.filter(a=>a.onBudget))if(a.start>0)ev.push({d:(a.created||stamp()).slice(0,10),v:a.start,in:1});
 for(const t of f.txns)if(onBudget(t)){if(t.type==='income')ev.push({d:t.date,v:t.amount,in:1});else if(t.type==='expense')ev.push({d:t.date,v:t.amount,in:0});}
 ev.sort((a,b)=>a.d.localeCompare(b.d)||b.in-a.in);const q=[],ages=[];
 for(const e of ev){if(e.in){q.push({d:e.d,v:e.v});continue;}let left=e.v,wsum=0,amt=0;while(left>0&&q.length){const b=q[0],use=Math.min(b.v,left);wsum+=use*(pd(e.d)-pd(b.d))/864e5;amt+=use;b.v-=use;left-=use;if(b.v<=0)q.shift();}if(amt)ages.push(wsum/amt);}
 const lastN=ages.slice(-10);return lastN.length?Math.round(lastN.reduce((a,b)=>a+b,0)/lastN.length):null;
}

// ---- categorizing: rules, then this payee's last category, then keyword guess
function categorize(payee,type){
 const p=normP(payee),f=F();
 for(const r of f.rules)if(r.match&&p.includes(r.match))return r.category;
 const prev=f.txns.slice().reverse().find(t=>t.reviewed&&t.type===type&&normP(t.payee)===p&&p);
 if(prev&&prev.category)return prev.category;
 return window.Finance?window.Finance.guessCategory(payee||'',type):'Other';
}
function addRule(payee,category){const m=normP(payee).split(' ').slice(0,2).join(' ');if(!m)return;const f=F();const ex=f.rules.find(r=>r.match===m);if(ex)ex.category=category;else f.rules.push({id:uuid(),match:m,category});for(const t of f.txns)if(!t.reviewed&&t.type==='expense'&&normP(t.payee).includes(m))t.category=category;}
function transfer(from,to,amount,date,memo){const id=uuid(),d=date||day();F().txns.push({id:uuid(),type:'transfer',dir:'out',accountId:from,amount,date:d,payee:'Transfer to '+acct(to).name,memo:memo||'',transferId:id,reviewed:true,created:stamp()},{id:uuid(),type:'transfer',dir:'in',accountId:to,amount,date:d,payee:'Transfer from '+acct(from).name,memo:memo||'',transferId:id,reviewed:true,created:stamp()});}
function reconcile(a,actual){const diff=actual-balance(a);if(diff)F().txns.push({id:uuid(),type:'adjust',accountId:a.id,amount:diff,date:day(),payee:isAsset(a)&&!a.onBudget?'Value update':'Balance adjustment',reviewed:true,created:stamp()});return diff;}

// ---- CSV import -------------------------------------------------------------
function parseCSV(text){const rows=[];let row=[],cell='',q=false;for(let i=0;i<text.length;i++){const ch=text[i];if(q){if(ch==='"'){if(text[i+1]==='"'){cell+='"';i++;}else q=false;}else cell+=ch;}else if(ch==='"')q=true;else if(ch===','){row.push(cell);cell='';}else if(ch==='\n'||ch==='\r'){if(ch==='\r'&&text[i+1]==='\n')i++;row.push(cell);cell='';if(row.some(c=>c.trim()))rows.push(row);row=[];}else cell+=ch;}row.push(cell);if(row.some(c=>c.trim()))rows.push(row);return rows;}
function parseDate(s){s=String(s).trim();let m;if((m=s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)))return `${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`;
 if((m=s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/))){const y=m[3].length===2?'20'+m[3]:m[3];return `${y}-${m[1].padStart(2,'0')}-${m[2].padStart(2,'0')}`;}
 const t=Date.parse(s);return isFinite(t)?day(new Date(t)):null;}
function detect(rows){
 const hdr=rows[0].map(h=>h.toLowerCase()),has=re=>hdr.findIndex(h=>re.test(h));
 const map={date:has(/date|posted/),payee:has(/desc|payee|merchant|name|details|memo|narrative/),amount:has(/^amount|amount$|^amt/),debit:has(/debit|withdraw|money out|outflow/),credit:has(/credit|deposit|money in|inflow/)};
 if(map.date<0)map.date=rows[1]?rows[1].findIndex(c=>parseDate(c)):-1;
 if(map.payee<0&&rows[1])map.payee=rows[1].findIndex((c,i)=>i!==map.date&&/[a-z]{3}/i.test(c));
 if(map.amount<0&&map.debit<0&&rows[1])map.amount=rows[1].findIndex((c,i)=>i!==map.date&&cents(c)!==null&&/\d/.test(c));
 return map;
}
function importRows(rows,map,accountId,flip){
 const f=F(),seen=new Set(f.txns.filter(t=>t.accountId===accountId).map(t=>`${t.date}|${Math.abs(signed(t))}|${normP(t.payee).slice(0,10)}`));
 let added=0,dup=0,bad=0;
 for(const r of rows.slice(1)){
  const date=parseDate(r[map.date]||'');let amt=null;
  if(map.amount>=0)amt=cents(r[map.amount]);else{const d=cents(r[map.debit]),c=cents(r[map.credit]);amt=(c?Math.abs(c):0)-(d?Math.abs(d):0);}
  if(!date||amt===null||amt===0){bad++;continue;}if(flip)amt=-amt;
  const payee=String(r[map.payee]||'').trim().slice(0,80),k=`${date}|${Math.abs(amt)}|${normP(payee).slice(0,10)}`;
  if(seen.has(k)){dup++;continue;}seen.add(k);
  const type=amt>0?'income':'expense';
  f.txns.push({id:uuid(),type,amount:Math.abs(amt),category:categorize(payee,type),date,payee,note:payee,memo:'',accountId,reviewed:false,imported:true,created:stamp()});added++;
 }
 return {added,dup,bad};
}

// ---- recurring detection ---------------------------------------------------
function recurring(){
 const f=F(),since=addM(day().slice(0,7),-6),by={};
 for(const t of f.txns)if(t.type==='expense'&&t.date.slice(0,7)>=since){const k=normP(t.payee)||normP(t.note);if(k)(by[k]=by[k]||[]).push(t);}
 const out=[];
 for(const [k,L] of Object.entries(by)){
  const months=new Set(L.map(t=>t.date.slice(0,7)));if(months.size<2)continue;
  const amts=L.map(t=>t.amount).sort((a,b)=>a-b),med=amts[Math.floor(amts.length/2)];
  if(amts[amts.length-1]>med*1.35||amts[0]<med*0.65)continue; // amounts vary too much to be a bill
  if(L.length>months.size*1.5)continue; // several times a month = shopping, not a bill
  const lastT=L.slice().sort((a,b)=>b.date.localeCompare(a.date))[0],dd=+lastT.date.slice(8,10);
  const nx=pd(lastT.date);nx.setMonth(nx.getMonth()+1);
  const bill=f.bills.find(b=>normP(b.name)&&(k.includes(normP(b.name))||normP(b.name).includes(k)));
  out.push({key:k,name:lastT.payee||lastT.note||k,amount:med,acct:lastT.accountId,months:months.size,day:dd,next:day(nx),category:lastT.category,bill:!!bill,sub:lastT.category==='Subscriptions'||/netflix|spotify|hulu|disney|prime|apple|google|youtube|icloud|adobe|max|paramount|peacock|chatgpt|claude|gym|fitness/i.test(k)});
 }
 return out.sort((a,b)=>b.amount-a.amount);
}


// ---- who spent it ----------------------------------------------------------------
const people=()=>window.Fitness?window.Fitness.people():[];
const whoName=id=>{const p=people().find(x=>x.id===id);return p?p.name:'';};
const me=()=>window.Finance&&window.Finance.me?window.Finance.me():null;
function byPerson(M){
 const out={};for(const t of F().txns)if(t.type==='expense'&&t.date.slice(0,7)===M&&onBudget(t)){const k=t.who&&whoName(t.who)?t.who:'';const o=out[k]=out[k]||{total:0,cats:{}};o.total+=t.amount;for(const [c,v] of catSpend(t))o.cats[c]=(o.cats[c]||0)+v;}
 return out;
}

// ---- cash-flow forecast ---------------------------------------------------------
// Starts from today's cash (on-budget checking, savings and cash accounts) and
// walks forward day by day: known bills and recurring charges on their dates,
// paychecks on their usual rhythm, and everyday spending at the recent
// average rate. An estimate: the more history, the better it gets.
const ddiff=(a,b)=>Math.round((pd(b)-pd(a))/864e5);
function forecast(days=60){
 const f=F(),today=day(),end=plusDays(today,days),cash=f.accounts.filter(a=>!a.closed&&a.onBudget&&isAsset(a)),ids=new Set(cash.map(a=>a.id));
 const start=cash.reduce((s,a)=>s+balance(a,today),0),events=[];
 const add=(date,amount,label,kind)=>{if(date>today&&date<=end)events.push({date,amount,label,kind});};
 // bills
 const billKeys=new Set();
 for(const b of f.bills){if(!b.dueDay||!(b.amount>0))continue;billKeys.add(normP(b.name));
  for(let k=0;k<=Math.ceil(days/28)+1;k++){const M=addM(today.slice(0,7),k),last=new Date(+M.slice(0,4),+M.slice(5,7),0).getDate(),due=`${M}-${String(Math.min(b.dueDay,last)).padStart(2,'0')}`;
   if(!(b.paid&&b.paid[M]))add(due,-b.amount,b.name,'bill');}}
 // recurring charges paid from cash that aren't already bills
 const recKeys=new Set();
 for(const r of recurring()){recKeys.add(r.key);if(r.bill||!ids.has(r.acct))continue;let d=r.next;while(d<=today){const x=pd(d);x.setMonth(x.getMonth()+1);d=day(x);}
  for(let i=0;i<4&&d<=end;i++){add(d,-r.amount,r.name,'recurring');const x=pd(d);x.setMonth(x.getMonth()+1);d=day(x);}}
 // paychecks and other regular income
 const since=plusDays(today,-120),inc={};
 for(const t of f.txns)if(t.type==='income'&&ids.has(t.accountId)&&t.date>=since&&t.date<=today){const k=normP(t.payee)||normP(t.note)||t.category||'income';(inc[k]=inc[k]||[]).push(t);}
 const income=[];
 for(const L of Object.values(inc)){if(L.length<2)continue;L.sort((a,b)=>a.date.localeCompare(b.date));
  const gaps=L.slice(1).map((t,i)=>ddiff(L[i].date,t.date)).sort((a,b)=>a-b),g=gaps[Math.floor(gaps.length/2)];
  const step=g>=6&&g<=8?7:g>=12&&g<=17?(g<=14?14:15):g>=26&&g<=35?'m':null;if(!step)continue;
  const amts=L.map(t=>t.amount).sort((a,b)=>a-b),amt=amts[Math.floor(amts.length/2)],last=L.at(-1),name=last.payee||last.note||last.category||'Income';
  income.push({name,amount:amt,every:step==='m'?'monthly':step===7?'weekly':'every 2 weeks'});
  let d=last.date;const next=x=>{if(step==='m'){const y=pd(x);y.setMonth(y.getMonth()+1);return day(y);}return plusDays(x,step);};
  for(d=next(d);d<=end;d=next(d))add(d,amt,name,'income');}
 // everyday spending: recent average of everything else leaving the cash accounts
 const first=f.txns.filter(t=>ids.has(t.accountId)).reduce((m,t)=>t.date<m?t.date:m,today),hist=Math.max(1,Math.min(90,ddiff(first,today)+1)),from=plusDays(today,-hist+1);
 let spent=0;for(const t of f.txns){if(!ids.has(t.accountId)||t.date<from||t.date>today)continue;
  if(t.type==='expense'){const k=normP(t.payee)||normP(t.note);if(t.billId||recKeys.has(k)||billKeys.has(k))continue;spent+=t.amount;}
  else if(t.type==='transfer'&&t.dir==='out'){const peer=t.transferId&&f.txns.find(x=>x.transferId===t.transferId&&x.id!==t.id);if(!peer||!ids.has(peer.accountId))spent+=t.amount;}}
 const rate=Math.round(spent/hist);
 events.sort((a,b)=>a.date.localeCompare(b.date));
 const series=[{date:today,bal:start}];let bal=start,low={date:today,bal:start},i=0;
 for(let n=1;n<=days;n++){const d=plusDays(today,n);bal-=rate;while(i<events.length&&events[i].date===d)bal+=events[i++].amount;series.push({date:d,bal});if(bal<low.bal)low={date:d,bal};}
 return {start,series,events,low,rate,hist,income,days,floor:f.floor!=null?f.floor:20000,accounts:cash.length,at:d=>(series.find(x=>x.date===d)||series.at(-1)).bal};
}
function forecastText(){
 const r=forecast(30);if(!r.accounts)return 'Add a checking account in Money to see a cash forecast.';
 const d=x=>pd(x).toLocaleDateString(undefined,{weekday:'long',month:'short',day:'numeric'});
 const lowTxt=r.low.date===day()?'It stays at or above today’s level':`Your lowest point looks like ${$(r.low.bal,{whole:true})} on ${d(r.low.date)}`;
 return `You have ${$(r.start,{whole:true})} in cash today. ${lowTxt}, and about ${$(r.series.at(-1).bal,{whole:true})} in 30 days.${r.low.bal<0?' Heads up: that’s below zero.':r.low.bal<r.floor?' That’s below your '+$(r.floor,{whole:true})+' cushion.':''}`;
}

window.Budget={forecast,forecastText,byPerson,budget,categories,categorize,addRule,move,setAssign,balance,recurring,ageOfMoney,accounts:()=>F().accounts,defaultAccount:()=>{const f=F();return (f.accounts.find(a=>!a.closed&&a.onBudget)||f.accounts[0]).id;},
 netWorth:()=>F().accounts.filter(a=>!a.closed).reduce((s,a)=>s+balance(a),0),findCategory:name=>{const q=String(name||'').toLowerCase().replace(/[^a-z ]/g,'').trim();if(!q)return null;const cs=categories();return cs.find(c=>c.toLowerCase()===q)||cs.find(c=>c.toLowerCase().startsWith(q)||q.startsWith(c.toLowerCase()))||cs.find(c=>q.includes(c.toLowerCase()))||null;}};

// ---- view ------------------------------------------------------------------
let sub=(()=>{try{return localStorage.getItem('moneySub')||'budget';}catch(_){return 'budget';}})();
let month=day().slice(0,7),openCat=null,openTx=null,q='',fAcct='',fCat='',fReview=false,fWho='',form=null,csv=null;
const css=document.createElement('style');css.textContent=`
.mn-tabs{display:flex;gap:6px;overflow-x:auto;scrollbar-width:none;margin-top:14px}.mn-tabs::-webkit-scrollbar{display:none}.mn-tabs button{flex:none;border:1px solid #24394f;background:#0e1624;color:${C.ink2};border-radius:20px;padding:8px 13px;font-weight:650;font-size:13px}.mn-tabs button.on{background:#0f3149;border-color:#46d9f5;color:#fff}
.mn-head{display:flex;align-items:center;gap:8px}.mn-head h2{flex:1;margin:0;text-align:center}
.rta{margin-top:12px;border-radius:14px;padding:14px;text-align:center;border:1px solid #1f6b52;background:linear-gradient(135deg,#0d2a22,#0b1d2b)}.rta.neg{border-color:#7a2d4b;background:linear-gradient(135deg,#2a0f1a,#1a0f20)}.rta.zero{border-color:#2b4a63;background:#0e1826}
.rta .v{font-size:34px;font-weight:800;letter-spacing:-.02em}.rta .l{font-size:12px;color:${C.ink2};margin-top:2px}
.bg-grp{font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:${C.ink3};font-weight:700;margin:16px 0 4px;display:flex;justify-content:space-between}
.bg-row{display:grid;grid-template-columns:1fr 88px 92px;gap:8px;align-items:center;padding:8px 0;border-bottom:1px solid ${C.grid}}.bg-row .n{font-weight:650;font-size:14px;cursor:pointer;min-width:0}.bg-row .n small{display:block;font-weight:500;font-size:11px;color:${C.ink3};margin-top:2px}
.bg-row input{padding:7px 6px;text-align:right;font-size:13px;font-variant-numeric:tabular-nums}
.pill{justify-self:end;font-size:12.5px;font-weight:750;border-radius:20px;padding:5px 9px;font-variant-numeric:tabular-nums;white-space:nowrap}.pill.ok{background:#0f3a2c;color:#6ff0b4}.pill.under{background:#3a2c08;color:#ffd166}.pill.neg{background:#3d1222;color:#ff9bbb}.pill.zero{background:#162131;color:${C.ink3}}
.bg-hdr{display:grid;grid-template-columns:1fr 88px 92px;gap:8px;font-size:10.5px;color:${C.ink3};text-transform:uppercase;letter-spacing:.06em;margin-top:8px}.bg-hdr span:nth-child(n+2){text-align:right}
.bg-det{background:#0b131f;border:1px solid #18283b;border-radius:12px;padding:10px 12px;margin:6px 0 10px;font-size:13px}
.tx{display:flex;gap:10px;align-items:center;padding:10px 0;border-bottom:1px solid ${C.grid};cursor:pointer}.tx .g{flex:1;min-width:0}.tx .p{font-weight:650;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.tx .s{font-size:11.5px;color:${C.ink3};margin-top:2px}.tx .a{font-weight:750;font-variant-numeric:tabular-nums;white-space:nowrap}
.chip{display:inline-block;font-size:10.5px;padding:2px 7px;border-radius:10px;background:#14263a;color:#9fd9ec;margin-right:4px}.chip.rev{background:#3a2c08;color:#ffd166}.chip.who{background:#1d2547;color:#c9d3ff}
.tx-date{font-size:11px;color:${C.ink3};font-weight:700;letter-spacing:.06em;text-transform:uppercase;margin-top:12px}
.ac{display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid ${C.grid}}.ac .g{flex:1}.ac .t{font-weight:650}.ac .s{font-size:11.5px;color:${C.ink3}}.ac .b{font-weight:750;font-variant-numeric:tabular-nums}
.mn-tip{position:absolute;pointer-events:none;opacity:0;background:#06101aee;border:1px solid #2b4a63;border-radius:10px;padding:7px 10px;font-size:12px;color:${C.ink};white-space:nowrap;z-index:4}
.tk{font-size:10px;fill:${C.ink3};font-variant-numeric:tabular-nums}.tv{font-size:11px;font-weight:700;fill:${C.ink}}.sk{font-size:11px;fill:${C.ink2}}`;
document.head.appendChild(css);
const sel=(id,opts,v,extra='')=>`<select id="${id}" ${extra}>${opts.map(([val,l])=>`<option value="${esc(val)}"${val===v?' selected':''}>${esc(l)}</option>`).join('')}</select>`;
const catOpts=(type)=>type==='income'?(window.Finance?window.Finance.INCOME:['Other income']).map(c=>[c,c]):groups().flatMap(g=>g[1]).map(c=>[c,c]);
const acctOpts=()=>F().accounts.filter(a=>!a.closed).map(a=>[a.id,a.name]);
function monthNav(){return `<div class="mn-head"><button class="btn alt sm" data-m="prev" aria-label="Previous month">‹</button><h2>${mName(month)}</h2><button class="btn alt sm" data-m="next" aria-label="Next month">›</button>${month!==day().slice(0,7)?'<button class="btn alt sm" data-m="now">Now</button>':''}</div>`;}

function budgetView(){
 const B=budget(month),age=ageOfMoney(),f=F();
 const under=B.cats.reduce((s,c)=>{const n=needed(c,B);return s+(n?n.need:0);},0);
 const over=B.cats.filter(c=>B.avail[c]<0);
 let html=`<div class="panel">${monthNav()}
  <div class="rta ${B.rta<0?'neg':B.rta===0?'zero':''}"><div class="v">${$(B.rta)}</div><div class="l">${B.rta>0?'Ready to Assign: give every dollar a job':B.rta<0?'Assigned more than you have. Take it back from a category.':'All money assigned 🎯'}</div></div>
  <div class="dz-tiles" style="margin-top:10px"><div class="dz-tile"><div class="l">Assigned this month</div><div class="v">${$(B.totalAssigned,{whole:true})}</div></div><div class="dz-tile"><div class="l">Spent this month</div><div class="v">${$(B.totalSpent,{whole:true})}</div></div>
  <div class="dz-tile"><div class="l">Targets still need</div><div class="v ${under?'dz-warn':''}">${$(under,{whole:true})}</div></div><div class="dz-tile"><div class="l">Age of Money</div><div class="v">${age==null?'—':age+' days'}</div><div class="d">how long money sits before you spend it</div></div></div>
  <div class="actions" style="margin-top:12px"><button class="btn sm" data-b="income">+ Add income</button><button class="btn alt sm" data-b="spend">+ Add spending</button></div>
  <div class="actions" style="margin-top:8px"><button class="btn sm" data-b="fund">Fund targets</button><button class="btn alt sm" data-b="last">Assign last month’s spending</button><button class="btn alt sm" data-b="clear">Clear month</button></div>
  ${over.length?`<p class="hint" style="color:${C.bad};margin:10px 0 0">⛔ Overspent: ${over.map(esc).join(', ')}. Move money in to cover it, or it comes out of next month.</p>`:''}</div>
 <div class="panel"><h2>Categories</h2><div class="bg-hdr"><span>Category</span><span>Assigned</span><span>Available</span></div>`;
 for(const [g,cs] of groups()){
  const ga=cs.reduce((s,c)=>s+(B.assigned[c]||0),0),gv=cs.reduce((s,c)=>s+(B.avail[c]||0),0);
  html+=`<div class="bg-grp"><span>${g}</span><span>${$(ga,{whole:true})} · ${$(gv,{whole:true})}</span></div>`;
  for(const c of cs){
   const av=B.avail[c]||0,n=needed(c,B),cls=av<0?'neg':n&&n.need>0?'under':av>0?'ok':'zero';
   const spentC=B.spent[c]||0;
   html+=`<div class="bg-row"><div class="n" data-b="cat" data-c="${esc(c)}">${esc(c)}<small>${spentC?`spent ${$(spentC,{whole:true})}`:''}${n?`${spentC?' · ':''}${n.need>0?'needs '+$(n.need,{whole:true}):'✓ '+n.label}`:''}</small></div>
    <input inputmode="decimal" data-asg="${esc(c)}" value="${B.assigned[c]?(B.assigned[c]/100):''}" placeholder="0" aria-label="Assigned to ${esc(c)}"><span class="pill ${cls}">${$(av)}</span></div>`;
   if(openCat===c){const t=f.targets[c]||{};const txs=f.txns.filter(x=>x.date.slice(0,7)===month&&catSpend(x).some(([cc])=>cc===c)).slice(-6).reverse();
    html+=`<div class="bg-det"><b>Target</b><div class="two"><div>${sel('tgType',[['','No target'],['monthly','Monthly amount'],['bydate','Save by a date']],t.type||'')}</div><div><input id="tgAmt" inputmode="decimal" placeholder="Amount" value="${t.amount?t.amount/100:''}"></div></div>
     <div class="two"><div><input id="tgDate" type="date" value="${t.date||''}"></div><div><button class="btn sm full" data-b="savetarget" data-c="${esc(c)}">Save target</button></div></div>
     <b style="display:block;margin-top:10px">Move money</b><div class="two"><div>${sel('mvFrom',[['','From Ready to Assign'],...B.cats.filter(x=>x!==c&&(B.avail[x]||0)>0).map(x=>[x,`${x} (${$(B.avail[x])})`])],'')}</div><div><input id="mvAmt" inputmode="decimal" placeholder="${av<0?(-av/100).toFixed(2):'Amount'}"></div></div>
     <button class="btn alt sm" style="margin-top:6px" data-b="move" data-c="${esc(c)}">Move into ${esc(c)}</button>
     ${txs.length?`<div style="margin-top:10px">${txs.map(x=>`<div class="dz-row"><span>${esc(x.payee||x.note||'')}<div class="s">${short(x.date)}</div></span><span>${$(catSpend(x).filter(([cc])=>cc===c).reduce((s,[,v])=>s+v,0))}</span></div>`).join('')}</div>`:''}</div>`;}
  }
 }
 html+=`<p class="hint" style="margin-top:12px">Assign money until Ready to Assign hits $0. Leftover in a category rolls into next month. Tap a category to set a target or move money. Hands-free: “move 50 from dining to groceries”.</p></div>`;
 return html+billsHtml();
}
let billForm=false,editBill=null;
// next occurrence of a monthly due day, as a date for the picker
const nextDue=dd=>{const t=pd(day());let y=t.getFullYear(),m=t.getMonth();const at=(y,m)=>new Date(y,m,Math.min(dd,new Date(y,m+1,0).getDate()));let d=at(y,m);if(d<t)d=at(y,m+1);return day(d);};
function billsHtml(){
 const f=F(),k=month,today=day(),ord=n=>n+((n%100>=11&&n%100<=13)?'th':(['th','st','nd','rd'][n%10]||'th'));
 return `<div class="panel"><div class="header"><h2>Bills</h2><button class="btn sm" data-bl="form">${billForm?'Close':'+ Bill'}</button></div>
 ${billForm?`<div class="two"><div><label>Bill name</label><input id="blName" maxlength="40" placeholder="Electric"></div><div><label>Amount</label><input id="blAmt" inputmode="decimal"></div></div><div class="two"><div><label>Due date (repeats monthly)</label><input id="blDate" type="date" value="${day()}"></div><div><label>Category</label>${sel('blCat',catOpts('expense'),'Utilities')}</div></div><button class="btn sm" style="margin-top:10px" data-bl="save">Save bill</button>`:''}
 ${f.bills.length?f.bills.slice().sort((a,b)=>a.dueDay-b.dueDay).map(b=>{const due=`${k}-${String(Math.min(b.dueDay,new Date(+k.slice(0,4),+k.slice(5),0).getDate())).padStart(2,'0')}`,paid=b.paid?.[k],diff=Math.round((pd(due)-pd(today))/864e5);
  if(editBill===b.id)return `<div class="bg-det"><div class="two"><div><label>Bill name</label><input id="beName" maxlength="40" value="${esc(b.name)}"></div><div><label>Amount</label><input id="beAmt" inputmode="decimal" value="${(b.amount/100).toFixed(2)}"></div></div><div class="two"><div><label>Next due date (repeats monthly)</label><input id="beDate" type="date" value="${nextDue(b.dueDay)}"></div><div><label>Category</label>${sel('beCat',catOpts('expense'),b.category)}</div></div><div class="actions" style="margin-top:10px"><button class="btn sm" data-bl="saveedit" data-id="${b.id}">Save</button><button class="btn alt sm" data-bl="canceledit">Cancel</button></div></div>`;
  return `<div class="ac"><div class="g" data-bl="edit" data-id="${b.id}" style="cursor:pointer"><div class="t">${esc(b.name)} <span style="font-size:12px;color:#7f93a8">✎</span></div><div class="s">${esc(b.category)} · due the ${ord(b.dueDay)} · ${paid?'<span class="dz-good">paid ✓</span>':diff<0?`<span class="dz-bad">${-diff}d late</span>`:diff===0?'<span class="dz-warn">due today</span>':`in ${diff}d`}</div></div><div class="b">${$(b.amount)}</div><button class="btn ${paid?'alt ':''}sm" data-bl="${paid?'unpay':'pay'}" data-id="${b.id}">${paid?'Undo':'Paid'}</button><button class="x" data-bl="del" data-id="${b.id}" aria-label="Delete bill">✕</button></div>`;}).join(''):(billForm?'':'<div class="empty">No bills yet. Recurring finds them in your transactions.</div>')}</div>`;
}
function txView(){
 const f=F(),acc=Object.fromEntries(f.accounts.map(a=>[a.id,a]));
 let L=f.txns.slice().sort((a,b)=>b.date.localeCompare(a.date)||String(b.created).localeCompare(String(a.created)));
 if(fAcct)L=L.filter(t=>t.accountId===fAcct);if(fCat)L=L.filter(t=>catSpend(t).some(([c])=>c===fCat)||t.category===fCat);if(fReview)L=L.filter(t=>!t.reviewed);if(fWho)L=L.filter(t=>fWho==='none'?!(t.who&&whoName(t.who)):t.who===fWho);
 if(q){const qq=q.toLowerCase();L=L.filter(t=>(t.payee||'').toLowerCase().includes(qq)||(t.memo||'').toLowerCase().includes(qq)||(t.category||'').toLowerCase().includes(qq)||String(t.amount/100).includes(qq)||(t.tags||[]).some(x=>x.includes(qq)));}
 const unrev=f.txns.filter(t=>!t.reviewed).length;
 let html=`<div class="panel"><div class="actions"><button class="btn sm" data-t="new">+ Transaction</button><button class="btn alt sm" data-t="xfer">⇄ Transfer</button><button class="btn alt sm" data-t="import">⬆ Import CSV</button></div>
  ${(form&&typeof form==='object')||form==='xfer'?formHtml():''}${csv?csvHtml():''}
  <input id="txQ" placeholder="Search payee, memo, category, amount…" value="${esc(q)}" style="margin-top:12px">
  <div class="two" style="margin-top:8px"><div>${sel('txAcct',[['','All accounts'],...acctOpts()],fAcct)}</div><div>${sel('txCat',[['','All categories'],...catOpts('expense'),...catOpts('income')],fCat)}</div></div>${people().length>1?`<div style="margin-top:8px">${sel('txWho',[['','Everyone'],...people().map(p=>[p.id,p.name]),['none','Not assigned']],fWho)}</div>`:''}
  <label style="display:flex;gap:8px;align-items:center;margin-top:8px"><input type="checkbox" class="check" id="txRev" ${fReview?'checked':''}> Needs review only${unrev?` <span class="chip rev">${unrev}</span>`:''}</label>
  ${unrev&&!fReview?`<p class="hint" style="margin:6px 0 0">${unrev} imported transaction${unrev>1?'s':''} to review. <button class="btn alt sm" data-t="approveall">Approve all</button></p>`:''}</div>
  <div class="panel">${L.length?'':'<div class="empty">No transactions match.</div>'}`;
 let lastD='';
 for(const t of L.slice(0,200)){
  if(t.date!==lastD){html+=`<div class="tx-date">${pd(t.date).toLocaleDateString(undefined,{weekday:'short',month:'short',day:'numeric',year:t.date.slice(0,4)===day().slice(0,4)?undefined:'numeric'})}</div>`;lastD=t.date;}
  const sg=signed(t),cat=t.type==='transfer'?'Transfer':t.type==='adjust'?'Adjustment':t.splits&&t.splits.length?'Split':t.category;
  html+=`<div class="tx" data-t="open" data-id="${t.id}"><div class="g"><div class="p">${esc(t.payee||t.note||'—')}</div><div class="s">${!t.reviewed?'<span class="chip rev">review</span>':''}<span class="chip">${esc(cat||'Uncategorized')}</span>${t.who&&whoName(t.who)&&people().length>1?`<span class="chip who">👤 ${esc(whoName(t.who))}</span>`:''}${esc((acc[t.accountId]||{}).name||'')}${t.memo?' · '+esc(t.memo):''}</div></div><div class="a" style="color:${sg>0?C.good:C.ink}">${sg>0?'+':''}${$(sg)}</div></div>`;
  if(openTx===t.id)html+=editHtml(t);
 }
 if(L.length>200)html+=`<p class="hint">Showing the latest 200. Use search or filters to find older ones.</p>`;
 return html+'</div>';
}
function formHtml(){
 const today=day();
 if(form==='xfer')return `<div class="bg-det" style="margin-top:12px"><b>Transfer between accounts</b><div class="two"><div><label>From</label>${sel('xfFrom',acctOpts(),'')}</div><div><label>To</label>${sel('xfTo',acctOpts(),(acctOpts()[1]||[])[0])}</div></div><div class="two"><div><label>Amount</label><input id="xfAmt" inputmode="decimal"></div><div><label>Date</label><input id="xfDate" type="date" value="${today}"></div></div><p class="hint" style="margin:6px 0">Paying a credit card is a transfer from checking to the card.</p><button class="btn sm" data-t="savexfer">Save transfer</button></div>`;
 const payees=[...new Set(F().txns.map(t=>t.payee).filter(Boolean))].slice(-200);
 return `<div class="bg-det" style="margin-top:12px"><b>New transaction</b><div class="seg" style="margin-top:8px"><button data-t="dir" data-v="expense" class="${(form.dir||'expense')==='expense'?'on':''}">Money out</button><button data-t="dir" data-v="income" class="${form.dir==='income'?'on inc':''}">Money in</button></div>
  <div class="two"><div><label>Payee</label><input id="ntPayee" list="payeeList" placeholder="Kroger"><datalist id="payeeList">${payees.map(p=>`<option value="${esc(p)}">`).join('')}</datalist></div><div><label>Amount</label><input id="ntAmt" inputmode="decimal" placeholder="0.00"></div></div>
  <div class="two"><div><label>Category</label>${sel('ntCat',[['','Auto'],...catOpts(form.dir||'expense')],'')}</div><div><label>Account</label>${sel('ntAcct',acctOpts(),window.Budget.defaultAccount())}</div></div>
  <div class="two"><div><label>Date</label><input id="ntDate" type="date" value="${today}"></div><div><label>Memo</label><input id="ntMemo" maxlength="80"></div></div>${people().length>1?`<label>Who</label>${sel('ntWho',[['','Shared / not set'],...people().map(p=>[p.id,p.name])],me()||'')}`:''}
  <button class="btn sm" style="margin-top:10px" data-t="savenew">Save</button></div>`;
}
function editHtml(t){
 if(t.type==='transfer'||t.type==='adjust')return `<div class="bg-det">${t.type==='transfer'?'Transfer (both sides are linked)':'Balance adjustment'} · ${$(signed(t))}<div class="actions" style="margin-top:8px"><button class="btn danger sm" data-t="del" data-id="${t.id}">Delete</button></div></div>`;
 const sp=t.splits&&t.splits.length?t.splits:null;
 return `<div class="bg-det"><div class="two"><div><label>Payee</label><input id="edPayee" value="${esc(t.payee||'')}"></div><div><label>Amount</label><input id="edAmt" inputmode="decimal" value="${t.amount/100}"></div></div>
  <div class="two"><div><label>Category</label>${sp?'<div class="hint">Split, see below</div>':sel('edCat',catOpts(t.type),t.category)}</div><div><label>Account</label>${sel('edAcct',acctOpts(),t.accountId)}</div></div>
  <div class="two"><div><label>Date</label><input id="edDate" type="date" value="${t.date}"></div><div><label>Memo</label><input id="edMemo" value="${esc(t.memo||'')}"></div></div>
  ${people().length>1&&t.type!=='transfer'?`<label>Who</label>${sel('edWho',[['','Shared / not set'],...people().map(p=>[p.id,p.name])],t.who||'')}`:''}<label>Tags (comma separated)</label><input id="edTags" value="${esc((t.tags||[]).join(', '))}" placeholder="vacation, reimbursable">
  ${t.type==='expense'?`<label>Split across categories (optional, one per line: “Groceries 60” / “Household 25.50”)</label><textarea id="edSplit" rows="2" placeholder="Groceries 60&#10;Shopping 25.50">${sp?sp.map(s=>`${s.category} ${(s.amount/100).toFixed(2)}`).join('\n'):''}</textarea>`:''}
  <label style="display:flex;gap:8px;align-items:center;margin-top:8px"><input type="checkbox" class="check" id="edRule"> Always categorize “${esc(normP(t.payee).split(' ').slice(0,2).join(' ')||'this payee')}” this way</label>
  <div class="actions" style="margin-top:10px"><button class="btn sm" data-t="saveedit" data-id="${t.id}">Save${t.reviewed?'':' & approve'}</button><button class="btn danger sm" data-t="del" data-id="${t.id}">Delete</button></div></div>`;
}
function csvHtml(){
 if(!csv.rows)return `<div class="bg-det" style="margin-top:12px"><b>Import from your bank</b><p class="hint" style="margin:6px 0">In your bank’s website or app, export transactions as <b>CSV</b>, then pick the file here. Duplicates are skipped, and rules and past choices fill in categories.</p><input type="file" id="csvFile" accept=".csv,text/csv"><button class="btn alt sm" style="margin-top:8px" data-t="csvcancel">Cancel</button></div>`;
 const h=csv.rows[0],opt=[['-1','—'],...h.map((c,i)=>[String(i),c||'Column '+(i+1)])],m=csv.map;
 const prev=csv.rows.slice(1,4).map(r=>{const d=parseDate(r[m.date]||'');let a=m.amount>=0?cents(r[m.amount]):((cents(r[m.credit])?Math.abs(cents(r[m.credit])):0)-(cents(r[m.debit])?Math.abs(cents(r[m.debit])):0));if(csv.flip&&a!=null)a=-a;return `${d||'?'} · ${esc(String(r[m.payee]||'').slice(0,30))} · ${a==null?'?':$(a)}`;}).join('<br>');
 return `<div class="bg-det" style="margin-top:12px"><b>Import ${csv.rows.length-1} rows</b><div class="two"><div><label>Date column</label>${sel('cvDate',opt,String(m.date))}</div><div><label>Payee column</label>${sel('cvPayee',opt,String(m.payee))}</div></div>
  <div class="two"><div><label>Amount column</label>${sel('cvAmt',opt,String(m.amount))}</div><div><label>…or Debit / Credit</label><div style="display:flex;gap:4px">${sel('cvDeb',opt,String(m.debit))}${sel('cvCred',opt,String(m.credit))}</div></div></div>
  <div class="two"><div><label>Into account</label>${sel('cvAcct',acctOpts(),csv.acct||window.Budget.defaultAccount())}</div><div><label style="display:flex;gap:6px;align-items:center;margin-top:30px"><input type="checkbox" class="check" id="cvFlip" ${csv.flip?'checked':''}> Positive = money out</label></div></div>
  <p class="hint" style="margin:8px 0">Preview:<br>${prev}</p><div class="actions"><button class="btn sm" data-t="csvgo">Import</button><button class="btn alt sm" data-t="csvcancel">Cancel</button></div></div>`;
}
function accountsView(){
 const f=F(),now=day().slice(0,7),open=f.accounts.filter(a=>!a.closed);
 const nw=open.reduce((s,a)=>s+balance(a),0),assets=open.filter(a=>balance(a)>0).reduce((s,a)=>s+balance(a),0),liab=open.filter(a=>balance(a)<0).reduce((s,a)=>s+balance(a),0);
 const months=[...Array(12)].map((_,i)=>addM(now,i-11)),end=k=>{const [y,m]=k.split('-').map(Number);return day(new Date(y,m,0));};
 const hist=months.map(k=>({k,v:open.reduce((s,a)=>s+balance(a,k===now?null:end(k)),0)})),prevNW=hist[10].v;
 const W=Math.max(280,(document.getElementById('finance').clientWidth||360)-36),H=150,L=46,R=10,T=14,B=20,pw=W-L-R,ph=H-T-B;
 const lo=Math.min(0,...hist.map(h=>h.v)),hi=Math.max(1,...hist.map(h=>h.v)),span=hi-lo||1,x=i=>L+i/11*pw,y=v=>T+ph-(v-lo)/span*ph;
 let svg=`<line x1="${L}" x2="${W-R}" y1="${y(0)}" y2="${y(0)}" stroke="${C.axis}"/>`;for(const v of [lo,(lo+hi)/2,hi])svg+=`<text x="${L-5}" y="${y(v)+3.5}" text-anchor="end" class="tk">${$(v,{compact:true,whole:true})}</text>`;
 svg+=`<path d="${hist.map((h,i)=>`${i?'L':'M'}${x(i).toFixed(1)},${y(h.v).toFixed(1)}`).join('')}L${x(11)},${y(lo)}L${x(0)},${y(lo)}Z" fill="${C.s1}" fill-opacity=".1"/><path d="${hist.map((h,i)=>`${i?'L':'M'}${x(i).toFixed(1)},${y(h.v).toFixed(1)}`).join('')}" fill="none" stroke="${C.s1}" stroke-width="2" stroke-linejoin="round"/><circle cx="${x(11)}" cy="${y(nw)}" r="4" fill="${C.s1}" stroke="${C.surface}" stroke-width="2"/>`;
 hist.forEach((h,i)=>{if(i%3===2||i===11)svg+=`<text x="${x(i)}" y="${H-5}" text-anchor="middle" class="tk">${mName(h.k,{month:'short'})}</text>`;svg+=`<rect x="${x(i)-pw/22}" y="${T}" width="${pw/11}" height="${ph}" fill="transparent" data-tip="${mName(h.k,{month:'short',year:'numeric'})}: ${$(h.v,{whole:true})}"/>`;});
 let html=`<div class="panel" style="position:relative"><div class="muted small">Net worth</div><div class="dz-hero">${$(nw,{whole:true})}</div><div class="dz-sub">${nw-prevNW>=0?'<span class="dz-good">▲':'<span class="dz-bad">▼'} ${$(Math.abs(nw-prevNW),{whole:true})}</span> vs end of last month · assets ${$(assets,{whole:true})} · debts ${$(-liab,{whole:true})}</div>
  <svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" role="img" aria-label="Net worth, last 12 months" style="margin-top:10px">${svg}</svg></div><div class="panel"><div class="header"><h2>Accounts</h2><button class="btn sm" data-a="new">+ Account</button></div>`;
 if(form==='acct')html+=`<div class="bg-det"><div class="two"><div><label>Name</label><input id="anName" placeholder="Chase checking"></div><div><label>Type</label>${sel('anType',Object.entries(TYPES).map(([k,v])=>[k,v[0]]),'checking')}</div></div><div class="two"><div><label>Current balance (debts as positive)</label><input id="anBal" inputmode="decimal" placeholder="0.00"></div><div><label style="display:flex;gap:6px;align-items:center;margin-top:30px"><input type="checkbox" class="check" id="anOn" checked> In the budget</label></div></div><p class="hint" style="margin:6px 0">Budget accounts (checking, savings, cash, credit cards) hold money you assign. Loans, investments and property are tracked for net worth.</p><button class="btn sm" data-a="save">Save account</button></div>`;
 for(const [label,types] of [['Cash',['checking','savings','cash']],['Credit cards',['credit']],['Loans',['loan']],['Investments & property',['investment','property']]]){
  const L=open.filter(a=>types.includes(a.type));if(!L.length)continue;
  html+=`<div class="bg-grp"><span>${label}</span><span>${$(L.reduce((s,a)=>s+balance(a),0),{whole:true})}</span></div>`+L.map(a=>{const b=balance(a);return `<div class="ac"><div class="g"><div class="t">${esc(a.name)}</div><div class="s">${TYPES[a.type][0]}${a.onBudget?' · in budget':' · tracking'}</div></div><div class="b" style="color:${b<0?C.bad:C.ink}">${$(b)}</div><button class="btn alt sm" data-a="rec" data-id="${a.id}">${a.onBudget?'Reconcile':'Update'}</button><button class="x" data-a="close" data-id="${a.id}" aria-label="Close account">✕</button></div>`;}).join('');
 }
 return html+`<p class="hint" style="margin-top:10px">Reconcile: enter the balance your bank shows and Family Save adds an adjustment if they differ. Live bank syncing (like Monarch or YNAB) needs a paid bank-data service and a server, which this phone-only app doesn’t have. Use ⬆ Import CSV in Transactions instead.</p></div>`;
}
function reportsView(){
 const f=F(),inM=f.txns.filter(t=>t.date.slice(0,7)===month&&onBudget(t));
 const inc={},exp={};for(const t of inM){if(t.type==='income')inc[t.category||'Income']=(inc[t.category||'Income']||0)+t.amount;for(const [c,v] of catSpend(t))exp[c]=(exp[c]||0)+v;}
 const I=Object.entries(inc).sort((a,b)=>b[1]-a[1]),E=Object.entries(exp).sort((a,b)=>b[1]-a[1]),ti=I.reduce((s,x)=>s+x[1],0),te=E.reduce((s,x)=>s+x[1],0);
 let html=`<div class="panel" style="position:relative">${monthNav()}<div class="dz-tiles" style="margin-top:12px"><div class="dz-tile"><div class="l">Income</div><div class="v dz-good">${$(ti,{whole:true})}</div></div><div class="dz-tile"><div class="l">Spending</div><div class="v">${$(te,{whole:true})}</div></div><div class="dz-tile"><div class="l">Saved</div><div class="v ${ti-te<0?'dz-bad':''}">${$(ti-te,{whole:true})}</div></div><div class="dz-tile"><div class="l">Savings rate</div><div class="v">${ti?Math.round((ti-te)/ti*100)+'%':'—'}</div></div></div>`;
 if(ti||te){
  // Sankey: income sources -> spending categories (+ saved)
  const right=E.slice(0,7).map(([c,v])=>({n:c,v}));const rest=E.slice(7).reduce((s,x)=>s+x[1],0);if(rest)right.push({n:'Everything else',v:rest});if(ti>te)right.push({n:'Saved',v:ti-te,saved:true});
  const left=I.slice(0,4).map(([c,v])=>({n:c,v}));const ir=I.slice(4).reduce((s,x)=>s+x[1],0);if(ir)left.push({n:'Other income',v:ir});if(te>ti)left.push({n:'From savings',v:te-ti,deficit:true});
  const tot=Math.max(ti,te),W=Math.max(300,(document.getElementById('finance').clientWidth||360)-36),gap=6,nw=10,lx=120,rx=W-150,LBL=28,scale=200/tot;
  // every node gets at least a label's height of room so names never overlap
  const place=L=>{let y=0;for(const n of L){n.h=Math.max(2,n.v*scale);n.slot=Math.max(n.h,LBL);n.y=y+(n.slot-n.h)/2;y+=n.slot+gap;n.o=0;}return y-gap;};
  const H=Math.max(place(left),place(right));
  const centre=L=>{const used=L.reduce((s,n)=>s+n.slot+gap,0)-gap,off=(H-used)/2;for(const n of L)n.y+=off;};centre(left);centre(right);
  let s='';
  // each flow is a filled band between the two nodes (thick strokes bulge on curves)
  for(const a of left)for(const b of right){const v=a.v*b.v/tot;if(v<=0)continue;const h=Math.max(1,v*scale),t0=a.y+a.o,t1=b.y+b.o;a.o+=h;b.o+=h;const x0=lx+nw,x1=rx,mx=(x0+x1)/2;
   s+=`<path d="M${x0},${t0}C${mx},${t0} ${mx},${t1} ${x1},${t1}L${x1},${t1+h}C${mx},${t1+h} ${mx},${t0+h} ${x0},${t0+h}Z" fill="${b.saved?C.s3:C.s1}" fill-opacity="${b.saved?.45:.28}" data-tip="${esc(a.n)} → ${esc(b.n)}: ${$(v,{whole:true})}"/>`;}
  for(const a of left)s+=`<rect x="${lx}" y="${a.y}" width="${nw}" height="${a.h}" rx="2" fill="${a.deficit?C.bad:C.good}"/><text x="${lx-6}" y="${a.y+a.h/2-2}" text-anchor="end" class="sk">${esc(a.n.slice(0,16))}</text><text x="${lx-6}" y="${a.y+a.h/2+11}" text-anchor="end" class="tk">${$(a.v,{whole:true})}</text>`;
  for(const b of right)s+=`<rect x="${rx}" y="${b.y}" width="${nw}" height="${b.h}" rx="2" fill="${b.saved?C.s3:C.s1}"/><text x="${rx+nw+6}" y="${b.y+b.h/2-1}" class="sk">${esc(b.n.slice(0,18))}</text><text x="${rx+nw+6}" y="${b.y+b.h/2+11}" class="tk">${$(b.v,{whole:true})} · ${Math.round(b.v/(ti||te)*100)}%</text>`;
  html+=`<h2 style="margin-top:16px">Cash flow</h2><p class="hint" style="margin:0 0 8px">Where this month’s income went. Tap a flow for the amount.</p><svg viewBox="0 0 ${W} ${H+4}" width="100%" height="${H+4}" role="img" aria-label="Cash flow from income to spending categories">${s}</svg>`;
 }else html+=`<div class="empty">No income or spending in ${mName(month)}.</div>`;
 html+='</div>';
 // trends: each category over 6 months
 const ms=[...Array(6)].map((_,i)=>addM(month,i-5)),tr={};
 for(const t of f.txns)if(onBudget(t)&&ms.includes(t.date.slice(0,7)))for(const [c,v] of catSpend(t)){(tr[c]=tr[c]||Array(6).fill(0))[ms.indexOf(t.date.slice(0,7))]+=v;}
 // only average months since your first transaction, so new data isn't compared against $0
 const firstM=f.txns.reduce((m,t)=>t.date.slice(0,7)<m?t.date.slice(0,7):m,month),prevIdx=[0,1,2,3,4].filter(i=>ms[i]>=firstM);
 const rows=Object.entries(tr).sort((a,b)=>b[1][5]-a[1][5]||b[1].reduce((x,y)=>x+y)-a[1].reduce((x,y)=>x+y)).slice(0,10);
 const sp=v=>{const mx=Math.max(...v,1),W=90,H=26;return `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" aria-hidden="true"><path d="${v.map((x,i)=>`${i?'L':'M'}${(2+i/5*(W-6)).toFixed(1)},${(H-3-x/mx*(H-8)).toFixed(1)}`).join('')}" fill="none" stroke="${C.s1}" stroke-width="2" stroke-linejoin="round"/><circle cx="${W-4}" cy="${H-3-v[5]/mx*(H-8)}" r="3" fill="${C.s1}"/></svg>`;};
 html+=`<div class="panel"><h2>Spending trends</h2><p class="hint" style="margin:0 0 6px">Last 6 months by category · ${mName(month,{month:'short'})} vs your average before it</p>${rows.length?rows.map(([c,v])=>{const avg=prevIdx.length?prevIdx.reduce((a,i)=>a+v[i],0)/prevIdx.length:0,d=avg?v[5]/avg-1:null;return `<div class="ac"><div class="g"><div class="t">${esc(c)}</div><div class="s">${$(v[5],{whole:true})} · ${d==null?'new':`<span class="${d>0.1?'dz-bad':d<-0.1?'dz-good':''}">${d>0?'▲':'▼'} ${Math.abs(Math.round(d*100))}%</span> vs avg ${$(avg,{whole:true})}`}</div></div>${sp(v)}</div>`;}).join(''):'<div class="empty">Not enough history yet.</div>'}</div>`;
 if(people().length>1){const bp=byPerson(month),rows=[...people().map(p=>[p.name,bp[p.id]]),['Shared / not set',bp['']]].filter(x=>x[1]),top=Math.max(1,...rows.map(x=>x[1].total));
  html+=`<div class="panel"><h2>Who spent it</h2><p class="hint" style="margin:0 0 8px">${mName(month)} spending by family member. Set “Who” on a transaction, or say “Sam spent 40 at Target”.</p>${rows.length?`<div class="st-bars">${rows.map(([n,o])=>`<div class="r"><div class="top"><span>${esc(n)}</span><span style="font-variant-numeric:tabular-nums">${$(o.total,{whole:true})}</span></div><div class="tr"><i style="width:${o.total/top*100}%"></i></div><div class="hint" style="margin:2px 0 6px">${Object.entries(o.cats).sort((a,b)=>b[1]-a[1]).slice(0,3).map(([c,v])=>esc(c)+' '+$(v,{whole:true})).join(' · ')}</div></div>`).join('')}</div>`:'<div class="empty">No spending this month.</div>'}
  <label style="margin-top:8px">This phone belongs to</label>${sel('meSel',[['','No one (leave unassigned)'],...people().map(p=>[p.id,p.name])],me()||'')}<p class="hint" style="margin:4px 0 0">New entries made on this phone are marked as theirs.</p></div>`;}
 const pay={};for(const t of inM)if(t.type==='expense'){const k=t.payee||t.note||'—';pay[k]=(pay[k]||0)+t.amount;}
 const P=Object.entries(pay).sort((a,b)=>b[1]-a[1]).slice(0,8),pm=Math.max(1,...P.map(p=>p[1]));
 html+=`<div class="panel"><h2>Top payees</h2>${P.length?`<div class="st-bars">${P.map(([n,v])=>`<div class="r"><div class="top"><span>${esc(n)}</span><span style="font-variant-numeric:tabular-nums">${$(v,{whole:true})}</span></div><div class="tr"><i style="width:${v/pm*100}%"></i></div></div>`).join('')}</div>`:'<div class="empty">No spending this month.</div>'}</div>`;
 return html;
}

// ---- forecast view ------------------------------------------------------------
let fcDays=60;
function forecastView(){
 const r=forecast(fcDays),f=F();
 if(!r.accounts)return `<div class="panel"><h2>Cash forecast</h2><div class="empty">Add a checking or savings account in Accounts to see where your cash is headed.</div></div>`;
 const short2=x=>pd(x).toLocaleDateString(undefined,{month:'short',day:'numeric'}),endBal=r.series.at(-1).bal,danger=r.low.bal<0,warn=!danger&&r.low.bal<r.floor;
 const W=Math.max(300,(document.getElementById('finance').clientWidth||360)-36),H=170,pl=46,pr=8,pt=10,pb=22;
 const vals=r.series.map(x=>x.bal),mn=Math.min(r.floor,...vals),mx=Math.max(r.floor,...vals,1),pad=(mx-mn)*.08||100;
 const lo=mn-pad,hi=mx+pad,X=i=>pl+i/(r.series.length-1)*(W-pl-pr),Y=v=>pt+(hi-v)/(hi-lo)*(H-pt-pb);
 const path=r.series.map((x,i)=>`${i?'L':'M'}${X(i).toFixed(1)},${Y(x.bal).toFixed(1)}`).join('');
 const ticks=[lo+pad,(lo+hi)/2,hi-pad].map(v=>Math.round(v/100)*100);
 let svg=ticks.map(v=>`<line x1="${pl}" x2="${W-pr}" y1="${Y(v)}" y2="${Y(v)}" stroke="${C.grid}"/><text x="${pl-6}" y="${Y(v)+4}" text-anchor="end" class="tk">${$(v,{whole:true,compact:true})}</text>`).join('');
 if(lo<0)svg+=`<line x1="${pl}" x2="${W-pr}" y1="${Y(0)}" y2="${Y(0)}" stroke="${C.axis}" stroke-width="1.5"/>`;
 svg+=`<line x1="${pl}" x2="${W-pr}" y1="${Y(r.floor)}" y2="${Y(r.floor)}" stroke="${C.warn}" stroke-dasharray="4 4" opacity=".8"/><text x="${W-pr}" y="${Y(r.floor)-4}" text-anchor="end" class="tk" fill="${C.warn}">cushion ${$(r.floor,{whole:true})}</text>`;
 svg+=`<path d="${path}" fill="none" stroke="${C.s1}" stroke-width="2.5" stroke-linejoin="round"/>`;
 const stepX=fcDays<=30?7:fcDays<=60?14:21;for(let k=0;k<r.series.length-stepX/2;k+=stepX)svg+=`<text x="${X(k)}" y="${H-6}" text-anchor="middle" class="tk">${k?short2(r.series[k].date):'Today'}</text>`;
 const byDay={};for(const e of r.events)(byDay[e.date]=byDay[e.date]||[]).push(e);
 for(const [d,L] of Object.entries(byDay)){const i=ddiff(day(),d),v=r.series[i].bal;svg+=`<circle cx="${X(i)}" cy="${Y(v)}" r="4" fill="${L.some(e=>e.amount>0)?C.good:C.surface}" stroke="${L.some(e=>e.amount>0)?C.good:C.s1}" stroke-width="2" data-tip="${esc(short2(d)+': '+L.map(e=>e.label+' '+(e.amount>0?'+':'−')+$(Math.abs(e.amount),{whole:true})).join(', ')+' → '+$(v,{whole:true}))}"/>`;}
 const li=ddiff(day(),r.low.date);svg+=`<circle cx="${X(li)}" cy="${Y(r.low.bal)}" r="5.5" fill="${danger?C.bad:warn?C.warn:C.s1}" data-tip="Lowest: ${$(r.low.bal,{whole:true})} on ${short2(r.low.date)}"/>`;
 const tone=danger?'dz-bad':warn?'dz-warn':'dz-good';
 let html=`<div class="panel" style="position:relative"><h2>Cash forecast</h2><p class="hint" style="margin:0 0 6px">Checking, savings and cash over the next ${fcDays} days, from your bills, paychecks, recurring charges and usual spending.</p>
  <div class="seg" style="margin:8px 0">${[30,60,90].map(n=>`<button data-fc="days" data-v="${n}" class="${fcDays===n?'on':''}">${n} days</button>`).join('')}</div>
  ${danger||warn?`<div class="notice" style="border-color:${danger?C.bad:C.warn}">${danger?'⛔':'⚠️'} Your cash could drop to <b>${$(r.low.bal,{whole:true})}</b> around <b>${pd(r.low.date).toLocaleDateString(undefined,{weekday:'short',month:'short',day:'numeric'})}</b>${danger?', below zero':`, under your ${$(r.floor,{whole:true})} cushion`}. Moving money in, or paying something a few days later, would cover it.</div>`:''}
  <div class="dz-tiles"><div class="dz-tile"><div class="l">Today</div><div class="v">${$(r.start,{whole:true})}</div><div class="d">${r.accounts} account${r.accounts>1?'s':''}</div></div><div class="dz-tile"><div class="l">Lowest point</div><div class="v ${tone}">${$(r.low.bal,{whole:true})}</div><div class="d">${r.low.date===day()?'today':short2(r.low.date)}</div></div><div class="dz-tile"><div class="l">In ${fcDays} days</div><div class="v">${$(endBal,{whole:true})}</div><div class="d">${endBal>=r.start?'▲':'▼'} ${$(Math.abs(endBal-r.start),{whole:true})}</div></div><div class="dz-tile"><div class="l">Everyday spending</div><div class="v">${$(r.rate,{whole:true})}<span style="font-size:13px;font-weight:500">/day</span></div><div class="d">average of last ${r.hist} day${r.hist>1?'s':''}</div></div></div>
  <svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" role="img" aria-label="Forecast cash balance over the next ${fcDays} days" style="margin-top:12px">${svg}</svg>
  <p class="hint" style="margin:4px 0 0">Tap a dot to see what happens that day.${r.hist<21?' The everyday spending estimate gets better after a few weeks of transactions.':''}</p></div>`;
 const up=r.events.slice(0,14);
 html+=`<div class="panel"><h2>Coming up</h2>${up.length?up.map(e=>`<div class="dz-row"><div>${esc(e.label)}<div class="s">${pd(e.date).toLocaleDateString(undefined,{weekday:'short',month:'short',day:'numeric'})} · ${e.kind==='bill'?'bill':e.kind==='income'?'income':'recurring'}</div></div><b style="color:${e.amount>0?C.good:C.ink}">${e.amount>0?'+':'−'}${$(Math.abs(e.amount))}</b></div>`).join(''):'<div class="empty">No bills, paychecks or recurring charges found yet. Add bills in Budget, and the forecast learns your paychecks after two of them.</div>'}
  ${r.income.length?`<p class="hint" style="margin-top:10px">Paychecks found: ${r.income.map(x=>`${esc(x.name)} ${$(x.amount,{whole:true})} ${x.every}`).join(' · ')}</p>`:'<p class="hint" style="margin-top:10px">No regular paycheck found yet. It needs two deposits from the same source into checking or savings.</p>'}
  <label style="margin-top:10px">Warn me if cash may drop below</label><input id="fcFloor" inputmode="decimal" value="${(r.floor/100).toFixed(0)}" style="max-width:160px"></div>`;
 return html;
}
// ---- debt payoff: snowball (smallest balance first) vs avalanche (highest rate first)
let extraPay=null;
function simulate(debts,extra,strategy,rollover=true){
 let D=debts.map(d=>({...d})),month=0,interest=0;const order=[],series=[D.reduce((a,d)=>a+d.bal,0)];
 while(D.some(d=>d.bal>0.5)&&month<600){
  month++;let pool=extra;
  for(const d of D)if(d.bal>0){const i=d.bal*d.apr/100/12;d.bal+=i;interest+=i;}
  for(const d of D){if(d.bal>0){const p=Math.min(d.bal,d.min);d.bal-=p;}else if(rollover)pool+=d.min;} // paid-off minimums roll into the pool
  const live=D.filter(d=>d.bal>0.5).sort(strategy==='avalanche'?(a,b)=>b.apr-a.apr||a.bal-b.bal:(a,b)=>a.bal-b.bal||b.apr-a.apr);
  for(const d of live){if(pool<=0)break;const p=Math.min(d.bal,pool);d.bal-=p;pool-=p;}
  for(const d of D)if(d.bal<=0.5&&!order.some(o=>o.id===d.id)){d.bal=0;order.push({id:d.id,name:d.name,month});}
  series.push(D.reduce((a,d)=>a+Math.max(0,d.bal),0));
 }
 return {months:D.some(d=>d.bal>0.5)?null:month,interest:Math.round(interest),order,series};
}
function debtList(){const f=F();return f.accounts.filter(a=>!a.closed&&balance(a)<0).map(a=>({id:a.id,name:a.name,bal:-balance(a)/100,apr:a.apr!=null?a.apr:(a.type==='credit'?22:7),min:a.minPay!=null?a.minPay/100:Math.max(25,Math.round(-balance(a)/100*(a.type==='credit'?0.02:0.015)))}));}
function debtView(){
 const debts=debtList();
 if(!debts.length)return `<div class="panel"><h2>Debt payoff</h2><div class="empty">No debts. 🎉 Add credit cards or loans in Accounts, with what you owe, and they’ll show up here.</div></div>`;
 const extra=extraPay!=null?extraPay:200,base=simulate(debts,0,'avalanche',false),sb=simulate(debts,extra,'snowball'),av=simulate(debts,extra,'avalanche');
 const when=m=>{if(m==null)return 'never at this rate';const d=new Date();d.setMonth(d.getMonth()+m);return d.toLocaleDateString(undefined,{month:'short',year:'numeric'});};
 const yrs=m=>m==null?'':m<12?`${m} mo`:`${Math.floor(m/12)} yr ${m%12} mo`;
 const total=debts.reduce((a,d)=>a+d.bal,0),minSum=debts.reduce((a,d)=>a+d.min,0),bad=debts.filter(d=>d.min<=d.bal*d.apr/100/12);
 const best=av.interest<=sb.interest?'avalanche':'snowball',plan=best==='avalanche'?av:sb;
 const W=Math.max(280,(document.getElementById('finance').clientWidth||360)-36),H=160,L=46,R=10,T=12,B=20,pw=W-L-R,ph=H-T-B;
 const n=Math.max(sb.series.length,av.series.length),y=v=>T+ph-Math.min(v,total)/total*ph,x=i=>L+i/Math.max(1,n-1)*pw;
 const line=(arr,col,w,dash)=>`<path d="${arr.slice(0,n).map((v,i)=>`${i?'L':'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('')}" fill="none" stroke="${col}" stroke-width="${w}" ${dash?`stroke-dasharray="${dash}"`:''} stroke-linejoin="round"/>`;
 let svg=`<line x1="${L}" x2="${W-R}" y1="${y(0)}" y2="${y(0)}" stroke="${C.axis}"/><text x="${L-5}" y="${y(total)+4}" text-anchor="end" class="tk">${$(total*100,{compact:true,whole:true})}</text><text x="${L-5}" y="${y(0)+4}" text-anchor="end" class="tk">$0</text><text x="${L}" y="${H-4}" class="tk">now</text><text x="${W-R}" y="${H-4}" text-anchor="end" class="tk">${yrs(n-1)}</text>`;
 svg+=line(base.series,C.muted,1.5,'4 4')+line(sb.series,'#d95926',2)+line(av.series,C.s1,2);
 const saved=base.months!=null?Math.max(0,base.interest-plan.interest):null;
 return `<div class="panel" style="position:relative"><h2>Debt payoff</h2><p class="hint" style="margin:0 0 8px">${$(total*100,{whole:true})} across ${debts.length} debt${debts.length>1?'s':''} · minimums ${$(minSum*100,{whole:true})}/mo</p>
  <label>Extra you can pay each month, on top of minimums</label><input id="dbExtra" inputmode="decimal" value="${extra}">
  <div class="dz-tiles" style="margin-top:10px">
   <div class="dz-tile"><div class="l">🏔️ Avalanche · highest rate first</div><div class="v" style="font-size:18px">${when(av.months)}</div><div class="d">${yrs(av.months)} · interest ${$(av.interest*100,{whole:true})}</div></div>
   <div class="dz-tile"><div class="l">⛄ Snowball · smallest balance first</div><div class="v" style="font-size:18px">${when(sb.months)}</div><div class="d">${yrs(sb.months)} · interest ${$(sb.interest*100,{whole:true})}</div></div></div>
  <p class="hint" style="margin:10px 0 0">${base.months!=null?`Minimums only: debt-free ${when(base.months)}, ${$(base.interest*100,{whole:true})} in interest. Paying ${$(extra*100,{whole:true})} extra saves <b>${$(saved*100,{whole:true})}</b> and <b>${yrs(base.months-(plan.months||0))}</b>. `:'Minimums alone never pay this off. '}${best==='avalanche'?(sb.interest>av.interest?`Avalanche saves ${$((sb.interest-av.interest)*100,{whole:true})} more. Snowball gives quicker wins if motivation matters more.`:'Both strategies cost the same here.'):'Snowball comes out ahead here.'}</p>
  ${bad.length?`<p class="hint" style="color:${C.bad}">⛔ ${bad.map(d=>esc(d.name)).join(', ')}: the minimum doesn’t cover the monthly interest, so the balance grows. Raise the payment.</p>`:''}
  <div class="dz-legend" style="margin-top:10px"><span><i style="background:${C.s1};height:2px;width:14px"></i>Avalanche</span><span><i style="background:#d95926;height:2px;width:14px"></i>Snowball</span><span><i style="background:${C.muted};height:2px;width:14px"></i>Minimums only</span></div>
  <svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" role="img" aria-label="Total debt over time by strategy">${svg}</svg></div>
 <div class="panel"><h2>Payoff order · ${best}</h2>${plan.order.map((o,i)=>`<div class="ac"><div class="g"><div class="t">${i+1}. ${esc(o.name)}</div><div class="s">paid off ${when(o.month)}</div></div></div>`).join('')}</div>
 <div class="panel"><h2>Your debts</h2><p class="hint" style="margin:0 0 6px">Set each debt’s interest rate and minimum payment from your statement.</p>
  ${debts.map(d=>`<div class="ac" style="flex-wrap:wrap"><div class="g"><div class="t">${esc(d.name)}</div><div class="s">${$(d.bal*100)} owed</div></div><label style="margin:0;font-size:11px">APR %<input class="db-apr" data-id="${d.id}" inputmode="decimal" value="${d.apr}" style="width:70px;padding:6px"></label><label style="margin:0;font-size:11px">Min $<input class="db-min" data-id="${d.id}" inputmode="decimal" value="${d.min}" style="width:80px;padding:6px"></label></div>`).join('')}</div>`;
}
window.Budget.debtPlan=(extra,strategy,rollover=true)=>simulate(debtList(),extra,strategy,rollover);

function recurringView(){
 const R=recurring(),f=F(),subs=R.filter(r=>r.sub),mo=R.reduce((s,r)=>s+r.amount,0);
 const today=day(),in30=day(new Date(pd(today).getTime()+30*864e5));
 const up=[...f.bills.map(b=>{const k=today.slice(0,7);const d=`${k}-${String(Math.min(b.dueDay,28)).padStart(2,'0')}`;const nx=d<today||b.paid?.[k]?(()=>{const n=addM(k,1);return `${n}-${String(Math.min(b.dueDay,28)).padStart(2,'0')}`;})():d;return {name:b.name,amount:b.amount,date:nx,kind:'Bill'};}),...R.filter(r=>!r.bill).map(r=>({name:r.name,amount:r.amount,date:r.next,kind:r.sub?'Subscription':'Recurring'}))].filter(x=>x.date>=today&&x.date<=in30).sort((a,b)=>a.date.localeCompare(b.date));
 return `<div class="panel"><h2>Recurring</h2><div class="dz-tiles"><div class="dz-tile"><div class="l">Recurring charges / month</div><div class="v">${$(mo,{whole:true})}</div><div class="d">${$(mo*12,{whole:true})} a year</div></div><div class="dz-tile"><div class="l">Subscriptions</div><div class="v">${subs.length}</div><div class="d">${$(subs.reduce((s,r)=>s+r.amount,0)*12,{whole:true})} a year</div></div></div>
  <h2 style="margin-top:16px">Next 30 days</h2>${up.length?up.map(u=>`<div class="ac"><div class="g"><div class="t">${esc(u.name)}</div><div class="s">${u.kind} · ${pd(u.date).toLocaleDateString(undefined,{weekday:'short',month:'short',day:'numeric'})}</div></div><div class="b">${$(u.amount)}</div></div>`).join(''):'<div class="empty">Nothing expected.</div>'}
  <h2 style="margin-top:16px">Detected from your transactions</h2><p class="hint" style="margin:0 0 4px">Charges that repeat month to month at a similar amount.</p>
  ${R.length?R.map(r=>`<div class="ac"><div class="g"><div class="t">${esc(r.name)}${r.sub?' <span class="chip">subscription</span>':''}</div><div class="s">~${$(r.amount)} · around the ${r.day}${[,'st','nd','rd'][r.day%10]&&![11,12,13].includes(r.day)?[,'st','nd','rd'][r.day%10]:'th'} · seen ${r.months} months · ${$(r.amount*12,{whole:true})}/yr</div></div>${r.bill?'<span class="chip">bill ✓</span>':`<button class="btn alt sm" data-r="bill" data-k="${esc(r.key)}">Track as bill</button>`}</div>`).join(''):'<div class="empty">Nothing yet. Detection needs at least two months of transactions. Importing a bank CSV is the fastest way to get there.</div>'}</div>`;
}
function renderMoney(){
 const sec=document.getElementById('finance');if(!sec)return;F();
 const tabs=[['budget','Budget'],['tx','Transactions'],['forecast','Forecast'],['accounts','Accounts'],['debt','Debt'],['reports','Reports'],['recurring','Recurring']];
 const nav=`<div class="mn-tabs">${tabs.map(([k,l])=>`<button data-sub="${k}" class="${sub===k?'on':''}">${l}</button>`).join('')}</div>`;
 sec.dataset.sub=sub;
 sec.innerHTML=nav+(sub==='budget'?budgetView():sub==='tx'?txView():sub==='accounts'?accountsView():sub==='debt'?debtView():sub==='forecast'?forecastView():sub==='reports'?reportsView():recurringView());
 if(sub==='budget'&&window.Savings&&window.Savings.inject)window.Savings.inject(); // savings goals sit under Ready to Assign
 sec.querySelectorAll('[data-tip]').forEach(el=>{const card=el.closest('.panel');const show=()=>{let t=card.querySelector('.mn-tip');if(!t){t=document.createElement('div');t.className='mn-tip';card.appendChild(t);}t.textContent=el.dataset.tip;t.style.opacity=1;const r=el.getBoundingClientRect(),cr=card.getBoundingClientRect();t.style.left=Math.max(6,Math.min(cr.width-t.offsetWidth-6,r.left-cr.left+r.width/2-t.offsetWidth/2))+'px';t.style.top=Math.max(4,r.top-cr.top-t.offsetHeight-6)+'px';};el.addEventListener('pointerenter',show);el.addEventListener('click',show);el.addEventListener('pointerleave',()=>{const t=card.querySelector('.mn-tip');if(t)t.style.opacity=0;});});
}
// ---- events -------------------------------------------------------------------
const sec=()=>document.getElementById('finance');
document.addEventListener('change',e=>{
 if(!e.target.closest('#finance'))return;const id=e.target.id,c=e.target.dataset.asg;
 if(c!=null){const v=cents(e.target.value)||0;setAssign(month,c,Math.max(0,v));persist();return;}
 if(id==='txAcct'){fAcct=e.target.value;renderMoney();}else if(id==='txCat'){fCat=e.target.value;renderMoney();}else if(id==='txRev'){fReview=e.target.checked;renderMoney();}
 else if(id==='csvFile'){const file=e.target.files[0];if(!file)return;file.text().then(t=>{const rows=parseCSV(t);if(rows.length<2){toast('That file has no rows.');return;}csv={rows,map:detect(rows),flip:false};renderMoney();});}
 else if(['cvDate','cvPayee','cvAmt','cvDeb','cvCred','cvAcct','cvFlip'].includes(id)&&csv){csv.map={date:+document.getElementById('cvDate').value,payee:+document.getElementById('cvPayee').value,amount:+document.getElementById('cvAmt').value,debit:+document.getElementById('cvDeb').value,credit:+document.getElementById('cvCred').value};csv.acct=document.getElementById('cvAcct').value;csv.flip=document.getElementById('cvFlip').checked;renderMoney();}
 else if(id==='fcFloor'){const v=cents(e.target.value);if(v!=null&&v>=0){F().floor=v;persist();}}
 else if(id==='txWho'){fWho=e.target.value;renderMoney();}
 else if(id==='meSel'){window.Finance.setMe(e.target.value);toast(e.target.value?'New entries on this phone go to '+whoName(e.target.value)+'.':'New entries won’t be assigned to anyone.');renderMoney();}
 else if(id==='dbExtra'){extraPay=Math.max(0,parseFloat(e.target.value)||0);renderMoney();}
 else if(e.target.classList.contains('db-apr')||e.target.classList.contains('db-min')){const a=acct(e.target.dataset.id),v=parseFloat(e.target.value);if(!(v>=0))return;if(e.target.classList.contains('db-apr'))a.apr=v;else a.minPay=Math.round(v*100);persist();}
 else if(id==='anType'){const t=TYPES[e.target.value];const on=document.getElementById('anOn');if(on)on.checked=t[1];}
});
document.addEventListener('input',e=>{if(e.target.id==='txQ'){q=e.target.value;clearTimeout(window.__txq);window.__txq=setTimeout(()=>{const pos=e.target.selectionStart;renderMoney();const el=document.getElementById('txQ');if(el){el.focus();el.setSelectionRange(pos,pos);}},250);}});
document.addEventListener('click',e=>{
 const s=sec();if(!s||!s.contains(e.target))return;const b=e.target.closest('.mn-tabs [data-sub],[data-m],[data-b],[data-t],[data-a],[data-r],[data-bl],[data-fc]');if(!b)return;const f=F();
 if(b.dataset.fc==='days'){fcDays=+b.dataset.v;renderMoney();return;}
 if(b.dataset.sub){sub=b.dataset.sub;try{localStorage.setItem('moneySub',sub);}catch(_){}form=null;csv=null;openTx=null;renderMoney();window.scrollTo({top:0});return;}
 if(b.dataset.m){month=b.dataset.m==='prev'?addM(month,-1):b.dataset.m==='next'?addM(month,1):day().slice(0,7);openCat=null;renderMoney();return;}
 const B=b.dataset.b,T=b.dataset.t,A=b.dataset.a,R=b.dataset.r;
 if(B==='income'||B==='spend'){sub='tx';try{localStorage.setItem('moneySub',sub);}catch(_){}form={dir:B==='income'?'income':'expense'};csv=null;openTx=null;renderMoney();window.scrollTo({top:0});setTimeout(()=>document.getElementById('ntPayee')?.focus(),50);return;}
 if(B==='cat'){openCat=openCat===b.dataset.c?null:b.dataset.c;renderMoney();return;}
 if(B==='savetarget'){const type=document.getElementById('tgType').value,amt=cents(document.getElementById('tgAmt').value),date=document.getElementById('tgDate').value;const c=b.dataset.c;
  if(!type)delete f.targets[c];else{if(!(amt>0)){toast('Enter a target amount.');return;}if(type==='bydate'&&!date){toast('Pick the date to reach it by.');return;}f.targets[c]={type,amount:amt,date:type==='bydate'?date:null};}toast('Target saved.');}
 else if(B==='move'){const c=b.dataset.c,from=document.getElementById('mvFrom').value,amt=cents(document.getElementById('mvAmt').value)||cents(document.getElementById('mvAmt').placeholder);if(!(amt>0)){toast('Enter an amount.');return;}
  if(from)move(month,from,c,amt);else setAssign(month,c,((f.assign[month]||{})[c]||0)+amt);toast(`Moved ${$(amt)} into ${c}.`);}
 else if(B==='fund'){const Bd=budget(month);let left=Math.max(0,Bd.rta),n=0;for(const [,cs] of groups())for(const c of cs){const nd=needed(c,Bd);if(nd&&nd.need>0&&left>0){const g=Math.min(nd.need,left);setAssign(month,c,(Bd.assigned[c]||0)+g);left-=g;n++;}}
  toast(n?`Funded ${n} target${n>1?'s':''}.`:Bd.rta<=0?'Nothing left to assign.':'No underfunded targets.');}
 else if(B==='last'){const pm=budget(addM(month,-1));for(const c of pm.cats)if(pm.spent[c])setAssign(month,c,pm.spent[c]);toast('Assigned what you spent last month.');}
 else if(B==='clear'){if(!confirm('Clear all assignments for '+mName(month)+'?'))return;delete f.assign[month];}
 else if(T==='new'){form=form==='new'?null:'new';if(form)form={dir:'expense'};renderMoney();return;}
 else if(T==='dir'){form={dir:b.dataset.v};const keep=['ntPayee','ntAmt','ntDate','ntMemo'].map(i=>document.getElementById(i)?.value);renderMoney();['ntPayee','ntAmt','ntDate','ntMemo'].forEach((i,j)=>{const el=document.getElementById(i);if(el&&keep[j]!=null)el.value=keep[j];});return;}
 else if(T==='savenew'){const payee=document.getElementById('ntPayee').value.trim(),amt=cents(document.getElementById('ntAmt').value);if(!(amt>0)){toast('Enter an amount.');return;}
  const type=form.dir||'expense',cat=document.getElementById('ntCat').value||categorize(payee,type);
  f.txns.push({id:uuid(),type,amount:amt,category:cat,date:document.getElementById('ntDate').value||day(),payee,note:payee,memo:document.getElementById('ntMemo').value.trim(),accountId:document.getElementById('ntAcct').value,who:document.getElementById('ntWho')?document.getElementById('ntWho').value||null:me(),reviewed:true,created:stamp()});form=null;toast('Saved.');}
 else if(T==='xfer'){form=form==='xfer'?null:'xfer';renderMoney();return;}
 else if(T==='savexfer'){const a=document.getElementById('xfFrom').value,c=document.getElementById('xfTo').value,amt=cents(document.getElementById('xfAmt').value);if(a===c){toast('Pick two different accounts.');return;}if(!(amt>0)){toast('Enter an amount.');return;}transfer(a,c,amt,document.getElementById('xfDate').value);form=null;toast('Transfer saved.');}
 else if(T==='import'){csv=csv?null:{};renderMoney();return;}
 else if(T==='csvcancel'){csv=null;renderMoney();return;}
 else if(T==='csvgo'){const r=importRows(csv.rows,csv.map,csv.acct||window.Budget.defaultAccount(),csv.flip);csv=null;fReview=r.added>0;toast(`Imported ${r.added}${r.dup?`, skipped ${r.dup} duplicate${r.dup>1?'s':''}`:''}${r.bad?`, ${r.bad} unreadable`:''}.`);}
 else if(T==='open'){openTx=openTx===b.dataset.id?null:b.dataset.id;renderMoney();return;}
 else if(T==='approveall'){for(const t of f.txns)t.reviewed=true;toast('All approved.');}
 else if(T==='saveedit'){const t=f.txns.find(x=>x.id===b.dataset.id),amt=cents(document.getElementById('edAmt').value);if(!(amt>0)){toast('Enter an amount.');return;}
  t.payee=document.getElementById('edPayee').value.trim();t.note=t.payee;t.amount=amt;t.accountId=document.getElementById('edAcct').value;t.date=document.getElementById('edDate').value||t.date;t.memo=document.getElementById('edMemo').value.trim();
  {const w=document.getElementById('edWho');if(w)t.who=w.value||null;}t.tags=document.getElementById('edTags').value.split(',').map(x=>x.trim().toLowerCase()).filter(Boolean);
  const spEl=document.getElementById('edSplit');if(spEl&&spEl.value.trim()){const sp=spEl.value.split('\n').map(l=>{const m=l.trim().match(/^(.+?)\s+\$?([\d,.]+)$/);return m?{category:window.Budget.findCategory(m[1])||m[1].trim(),amount:cents(m[2])}:null;}).filter(x=>x&&x.amount>0);
   const sum=sp.reduce((a,x)=>a+x.amount,0);if(sum!==t.amount){toast(`Splits add up to ${$(sum)}, not ${$(t.amount)}.`);return;}t.splits=sp;t.category=sp[0].category;}
  else{t.splits=null;const ce=document.getElementById('edCat');if(ce)t.category=ce.value;}
  if(document.getElementById('edRule')?.checked&&!t.splits)addRule(t.payee,t.category);
  t.reviewed=true;openTx=null;toast('Saved.');}
 else if(T==='del'){const t=f.txns.find(x=>x.id===b.dataset.id);if(!confirm('Delete this transaction?'))return;data.finance.txns=f.txns.filter(x=>x!==t&&!(t.transferId&&x.transferId===t.transferId));openTx=null;}
 else if(A==='new'){form=form==='acct'?null:'acct';renderMoney();return;}
 else if(A==='save'){const name=document.getElementById('anName').value.trim(),type=document.getElementById('anType').value;let bal=cents(document.getElementById('anBal').value)||0;if(!name){toast('Name the account.');return;}
  if(!TYPES[type][2])bal=-Math.abs(bal);f.accounts.push({id:uuid(),name,type,onBudget:document.getElementById('anOn').checked,start:bal,created:stamp()});form=null;toast('Account added.');}
 else if(A==='rec'){const a=acct(b.dataset.id);const v=prompt(`${a.name}: what balance does your ${a.onBudget?'bank':'statement'} show now?${isAsset(a)?'':' (enter what you owe as a positive number)'}`,(Math.abs(balance(a))/100).toFixed(2));if(v===null)return;let c=cents(v);if(c===null){toast('Enter a number.');return;}if(!isAsset(a))c=-Math.abs(c);const d=reconcile(a,c);toast(d?`Adjusted by ${$(d)}.`:'Balance matches ✓');}
 else if(A==='close'){const a=acct(b.dataset.id);if(f.accounts.filter(x=>!x.closed).length<2){toast('Keep at least one account.');return;}if(!confirm(`Close ${a.name}? Its history stays.`))return;a.closed=true;}
 else if(b.dataset.bl){const k=b.dataset.bl;
  if(k==='form'){billForm=!billForm;renderMoney();return;}
  if(k==='save'){const name=document.getElementById('blName').value.trim(),amt=cents(document.getElementById('blAmt').value),dv=document.getElementById('blDate').value,dd=dv?+dv.slice(8,10):0;if(!name||!(amt>0)||!dd){toast('Enter a name, amount and due date.');return;}f.bills.push({id:uuid(),name,amount:amt,dueDay:dd,category:document.getElementById('blCat').value,paid:{}});billForm=false;toast('Bill saved.');}
  else if(k==='edit'){editBill=b.dataset.id;billForm=false;renderMoney();return;}
  else if(k==='canceledit'){editBill=null;renderMoney();return;}
  else if(k==='saveedit'){const bl=f.bills.find(x=>x.id===b.dataset.id),name=document.getElementById('beName').value.trim(),amt=cents(document.getElementById('beAmt').value),dv=document.getElementById('beDate').value;if(!name||!(amt>0)||!dv){toast('Enter a name, amount and due date.');return;}bl.name=name;bl.amount=amt;bl.dueDay=+dv.slice(8,10);bl.category=document.getElementById('beCat').value;editBill=null;toast(`${name} is now due on the ${bl.dueDay}${(bl.dueDay%100>=11&&bl.dueDay%100<=13)?'th':(['th','st','nd','rd'][bl.dueDay%10]||'th')} each month.`);}
  else if(k==='pay'){const bl=f.bills.find(x=>x.id===b.dataset.id);window.Finance.markBillPaid(bl.id,month===day().slice(0,7)?day():`${month}-${String(Math.min(bl.dueDay,28)).padStart(2,'0')}`);toast('Paid and recorded.');}
  else if(k==='unpay'){const bl=f.bills.find(x=>x.id===b.dataset.id),tx=bl.paid?.[month];data.finance.txns=f.txns.filter(t=>t.id!==tx);delete bl.paid[month];}
  else if(k==='del'){if(!confirm('Delete this bill?'))return;data.finance.bills=f.bills.filter(x=>x.id!==b.dataset.id);}
  else return;}
 else if(R==='bill'){const r=recurring().find(x=>x.key===b.dataset.k);f.bills.push({id:uuid(),name:r.name.slice(0,40),amount:r.amount,dueDay:r.day,category:r.category||'Utilities',paid:{}});toast(`${r.name} is now tracked as a bill.`);}
 else return;
 persist();
});
const baseRender=window.render;
window.render=function(){baseRender.apply(this,arguments);if(view==='finance')renderMoney();};
})();
