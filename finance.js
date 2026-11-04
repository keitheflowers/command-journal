/* Command Journal home finances: transactions, monthly summary, bills, budgets.
   Stored with the journal in data.finance (amounts in cents), so it is
   included in JSON backups. Local to this device only. */
(function(){
'use strict';
const EXPENSE=['Housing','Utilities','Groceries','Dining','Gas','Transportation','Insurance','Health','Kids','Giving','Subscriptions','Shopping','Entertainment','Debt','Savings','Other'];
const INCOME=['Paycheck','Side income','Gift','Refund','Other income'];
const KEYWORDS=[
 [/\b(groceries|grocery|walmart|kroger|h-?e-?b|costco|aldi|sam'?s club|publix|safeway|food lion|trader joe)/i,'Groceries'],
 [/\b(lunch|dinner|breakfast|restaurant|coffee|starbucks|mcdonald|chick-?fil-?a|pizza|takeout|doordash|uber eats|taco|burger|eating out)/i,'Dining'],
 [/\b(gas|fuel|shell|exxon|chevron|valero|qt|quiktrip|buc-?ee)/i,'Gas'],
 [/\b(uber|lyft|parking|toll|car wash|oil change|tires?|mechanic|car repair|bus|train)/i,'Transportation'],
 [/\b(rent|mortgage|hoa)\b/i,'Housing'],
 [/\b(electric|electricity|water|internet|wifi|phone bill|cell|utility|utilities|trash|sewer)/i,'Utilities'],
 [/\b(insurance)\b/i,'Insurance'],
 [/\b(doctor|pharmacy|medicine|prescription|dentist|copay|hospital|cvs|walgreens)/i,'Health'],
 [/\b(kids?|school|daycare|tuition|diapers|babysitter)/i,'Kids'],
 [/\b(church|tithe|offering|donation|charity|giving)/i,'Giving'],
 [/\b(netflix|spotify|hulu|disney|subscription|youtube|prime|icloud|chatgpt|apple music)/i,'Subscriptions'],
 [/\b(amazon|target|clothes|shoes|shopping|best buy|home depot|lowe'?s)/i,'Shopping'],
 [/\b(movie|movies|games?|concert|tickets|bowling|entertainment)/i,'Entertainment'],
 [/\b(credit card|loan|car payment|student loan|debt)/i,'Debt'],
 [/\b(savings|save|investment|ira|401k)/i,'Savings']
];
const INCOME_KEYWORDS=[[/\b(paycheck|salary|work|job|payroll|direct deposit)/i,'Paycheck'],[/\b(refund|return|rebate)/i,'Refund'],[/\b(gift|birthday)/i,'Gift'],[/\b(side|freelance|gig|sold|sale|client)/i,'Side income']];

const money=c=>(c<0?'-':'')+'$'+(Math.abs(c)/100).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
const cents=v=>{const n=parseFloat(String(v).replace(/[$,\s]/g,''));return isFinite(n)&&n>0?Math.round(n*100):0;};
const monthOf=d=>d.slice(0,7);
const ord=n=>n+((n%100>=11&&n%100<=13)?'th':(['th','st','nd','rd'][n%10]||'th'));
function fin(){
 if(!data.finance||typeof data.finance!=='object')data.finance={};
 const f=data.finance;f.txns=Array.isArray(f.txns)?f.txns:[];f.bills=Array.isArray(f.bills)?f.bills:[];f.budgets=f.budgets&&typeof f.budgets==='object'?f.budgets:{};
 return f;
}
function guessCategory(text,type){
 for(const [re,c] of (type==='income'?INCOME_KEYWORDS:KEYWORDS))if(re.test(text))return c;
 return type==='income'?'Other income':'Other';
}
function billDue(b,month){const [y,m]=month.split('-').map(Number);const last=new Date(y,m,0).getDate();return `${month}-${String(Math.min(b.dueDay,last)).padStart(2,'0')}`;}
function addTxn(t){
 const tx={id:uuid(),type:t.type==='income'?'income':'expense',amount:t.amount,category:t.category||guessCategory(t.note||'',t.type),date:t.date||day(),note:(t.note||'').slice(0,140),billId:t.billId||null,created:stamp()};
 fin().txns.push(tx);log('finance_'+tx.type,null,`${money(tx.amount)} · ${tx.category}${tx.note?' · '+tx.note:''}`);
 return tx;
}
function markBillPaid(id,date,amount){
 const b=fin().bills.find(x=>x.id===id);if(!b)return false;
 const month=monthOf(date||day());if(b.paid?.[month])return false;
 const tx=addTxn({type:'expense',amount:amount||b.amount,category:b.category,note:b.name,date:date||day(),billId:b.id});
 b.paid=b.paid||{};b.paid[month]=tx.id;return true;
}
function findBill(text){
 const n=s=>s.toLowerCase().replace(/[^a-z0-9 ]/g,' ').replace(/\b(the|my|bill|payment)\b/g,' ').replace(/\s+/g,' ').trim();
 const q=n(text);if(!q)return null;
 const hits=fin().bills.filter(b=>{const bn=n(b.name);return bn===q||bn.includes(q)||q.includes(bn);});
 return hits.length===1?hits[0]:null;
}
window.Finance={addTxn,markBillPaid,findBill,guessCategory,money,
 billsDueOn:date=>fin().bills.filter(b=>billDue(b,monthOf(date))===date).map(b=>({name:b.name,amount:b.amount,paid:!!b.paid?.[monthOf(date)]}))};

// ---- view -------------------------------------------------------------
let month=monthOf(day()),editBudgets=false,showBillForm=false,entryType='expense';
const section=document.createElement('section');
section.id='finance';section.className='view hidden';
const settings=document.getElementById('settings');settings.parentNode.insertBefore(section,settings);
const tab=document.createElement('button');tab.className='tab';tab.dataset.view='finance';tab.textContent='Money';
const tabs=document.getElementById('tabs');tabs.insertBefore(tab,tabs.querySelector('[data-view="reviews"]'));
const allTab=tabs.querySelector('[data-view="tasks"]');if(allTab)allTab.textContent='Tasks';
tabs.style.gridTemplateColumns=`repeat(${tabs.children.length},1fr)`;
const css=document.createElement('style');
css.textContent=`.tabs .tab{font-size:11px;padding:11px 2px}
.fin-head{display:flex;align-items:center;gap:8px}.fin-head h2{flex:1;margin:0;text-align:center}
.fin-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:14px}.fin-stats .stat{padding:12px 4px}.fin-stats .number{font-size:clamp(13px,4.4vw,19px);white-space:nowrap}
.pos{color:#4be3a4}.neg{color:#ff6b9a}
.seg{display:flex;background:#060b13;border:1px solid #23384e;border-radius:12px;padding:3px;gap:3px}.seg button{flex:1;border:0;background:none;color:#9fb3c6;padding:9px;border-radius:9px;font-weight:700}
.seg button.on{background:linear-gradient(135deg,#46d9f5,#5b7cff);color:#03101a}.seg button.on.inc{background:linear-gradient(135deg,#4be3a4,#2fb9d9)}
.row{display:flex;align-items:center;gap:10px;padding:11px 0;border-bottom:1px solid #18283b}.row:last-child{border-bottom:0}.row .grow{flex:1;min-width:0}.row .t{font-weight:650;font-size:14px}.row .s{font-size:11.5px;color:#8ea3b8;margin-top:2px}
.row .amt{font-weight:750;font-size:14px;white-space:nowrap}.x{background:none;border:0;color:#6d8196;font-size:16px;padding:4px 6px}
.bar{height:7px;background:#14202f;border-radius:6px;overflow:hidden;margin-top:6px}.bar i{display:block;height:100%;background:linear-gradient(90deg,#46d9f5,#5b7cff);border-radius:6px}.bar i.over{background:linear-gradient(90deg,#ff6b9a,#b05bff)}
.tag{font-size:10.5px;padding:3px 7px;border-radius:20px;border:1px solid #2b4a63;color:#9fd9ec;white-space:nowrap}.tag.late{border-color:#7a2d4b;color:#ff9bbb}.tag.paid{border-color:#1f6b52;color:#4be3a4}
.budget-in{width:92px;padding:7px 8px;font-size:13px}`;
document.head.appendChild(css);

function monthLabel(m){const [y,mm]=m.split('-').map(Number);return new Date(y,mm-1,1).toLocaleDateString(undefined,{month:'long',year:'numeric'});}
function shift(m,n){const [y,mm]=m.split('-').map(Number);const d=new Date(y,mm-1+n,1);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;}
const short=d=>{const [y,m,dd]=d.split('-').map(Number);return new Date(y,m-1,dd).toLocaleDateString(undefined,{month:'short',day:'numeric'});};

function renderFinance(){
 const f=fin(),txns=f.txns.filter(t=>monthOf(t.date)===month).sort((a,b)=>b.date.localeCompare(a.date)||b.created.localeCompare(a.created));
 const inc=txns.filter(t=>t.type==='income').reduce((a,t)=>a+t.amount,0),exp=txns.filter(t=>t.type==='expense').reduce((a,t)=>a+t.amount,0);
 const unpaid=f.bills.filter(b=>!b.paid?.[month]).reduce((a,b)=>a+b.amount,0);
 const cats=EXPENSE.map(c=>({c,spent:txns.filter(t=>t.type==='expense'&&t.category===c).reduce((a,t)=>a+t.amount,0),budget:f.budgets[c]||0})).filter(x=>editBudgets||x.spent||x.budget);
 const totalBudget=EXPENSE.reduce((a,c)=>a+(f.budgets[c]||0),0);
 const today=day(),cats4=entryType==='income'?INCOME:EXPENSE;
 section.innerHTML=`
 <div class="panel"><div class="fin-head"><button class="btn alt sm" data-f="prev" aria-label="Previous month">‹</button><h2>${esc(monthLabel(month))}</h2><button class="btn alt sm" data-f="next" aria-label="Next month">›</button>${month!==monthOf(today)?'<button class="btn alt sm" data-f="now">Now</button>':''}</div>
  <div class="fin-stats"><div class="stat"><div class="number pos">${money(inc)}</div><div class="muted small">Income</div></div><div class="stat"><div class="number">${money(exp)}</div><div class="muted small">Spent</div></div><div class="stat"><div class="number ${inc-exp<0?'neg':''}">${money(inc-exp)}</div><div class="muted small">Left</div></div></div>
  ${f.bills.length?`<p class="hint" style="margin:10px 0 0">Unpaid bills this month: <strong>${money(unpaid)}</strong>${totalBudget?` · Budget used: <strong>${Math.round(exp/totalBudget*100)}%</strong> of ${money(totalBudget)}`:''}</p>`:''}
 </div>
 <div class="panel"><h2>Add money in or out</h2>
  <div class="seg"><button data-f="type" data-v="expense" class="${entryType==='expense'?'on':''}">Spent</button><button data-f="type" data-v="income" class="${entryType==='income'?'on inc':''}">Received</button></div>
  <div class="two"><div><label>Amount</label><input id="finAmt" inputmode="decimal" placeholder="0.00"></div><div><label>Category</label><select id="finCat">${cats4.map(c=>`<option>${c}</option>`).join('')}</select></div></div>
  <div class="two"><div><label>Date</label><input id="finDate" type="date" value="${month===monthOf(today)?today:month+'-01'}"></div><div><label>Note</label><input id="finNote" maxlength="140" placeholder="${entryType==='income'?'e.g. paycheck':'e.g. Kroger'}"></div></div>
  <button class="btn full" style="margin-top:12px" data-f="add">${entryType==='income'?'Add income':'Add expense'}</button>
  <p class="hint">Hands-free: “Vector, open Journal, spent 45 on groceries”, “got paid 2,100”, or “paid the electric bill”.</p>
 </div>
 <div class="panel"><div class="header"><h2>Bills</h2><button class="btn sm" data-f="billform">${showBillForm?'Close':'+ Bill'}</button></div>
  ${showBillForm?`<div class="two"><div><label>Bill name</label><input id="billName" maxlength="60" placeholder="e.g. Electric"></div><div><label>Amount</label><input id="billAmt" inputmode="decimal" placeholder="0.00"></div></div><div class="two"><div><label>Due day of month</label><input id="billDay" type="number" min="1" max="31" placeholder="15"></div><div><label>Category</label><select id="billCat">${EXPENSE.map(c=>`<option${c==='Utilities'?' selected':''}>${c}</option>`).join('')}</select></div></div><button class="btn full" style="margin-top:12px" data-f="addbill">Save bill</button>`:''}
  ${f.bills.length?f.bills.slice().sort((a,b)=>a.dueDay-b.dueDay).map(b=>{
   const due=billDue(b,month),paid=b.paid?.[month],diff=Math.round((new Date(due+'T12:00')-new Date(today+'T12:00'))/864e5);
   const tag=paid?'<span class="tag paid">Paid ✓</span>':diff<0?`<span class="tag late">${-diff}d late</span>`:diff===0?'<span class="tag late">Due today</span>':diff<=7?`<span class="tag">Due in ${diff}d</span>`:`<span class="tag">Due ${short(due)}</span>`;
   return `<div class="row"><div class="grow"><div class="t">${esc(b.name)}</div><div class="s">${esc(b.category)} · due the ${ord(b.dueDay)}</div></div><div class="amt">${money(b.amount)}</div>${tag}<button class="btn ${paid?'alt ':''}sm" data-f="${paid?'unpay':'pay'}" data-id="${b.id}">${paid?'Undo':'Paid'}</button><button class="x" data-f="delbill" data-id="${b.id}" aria-label="Delete bill">✕</button></div>`;}).join(''):(showBillForm?'':'<div class="empty">No bills yet. Add rent, utilities, phone, insurance…</div>')}
 </div>
 <div class="panel"><div class="header"><h2>Spending by category</h2><button class="btn alt sm" data-f="budgets">${editBudgets?'Done':'Set budgets'}</button></div>
  ${cats.length?cats.map(x=>{const pct=x.budget?Math.min(100,x.spent/x.budget*100):0;return `<div class="row" style="display:block"><div style="display:flex;gap:10px;align-items:center"><div class="grow t">${x.c}</div><div class="amt">${money(x.spent)}${x.budget&&!editBudgets?` <span class="muted small">/ ${money(x.budget)}</span>`:''}</div>${editBudgets?`<input class="budget-in" data-budget="${x.c}" inputmode="decimal" placeholder="Budget" value="${x.budget?(x.budget/100):''}">`:''}</div>${x.budget&&!editBudgets?`<div class="bar"><i class="${x.spent>x.budget?'over':''}" style="width:${pct}%"></i></div>`:''}</div>`;}).join(''):'<div class="empty">No spending this month yet.</div>'}
 </div>
 <div class="panel"><h2>Transactions · ${txns.length}</h2>
  ${txns.length?txns.map(t=>`<div class="row"><div class="grow"><div class="t">${esc(t.note||t.category)}</div><div class="s">${short(t.date)} · ${esc(t.category)}</div></div><div class="amt ${t.type==='income'?'pos':''}">${t.type==='income'?'+':'−'}${money(t.amount)}</div><button class="x" data-f="deltx" data-id="${t.id}" aria-label="Delete">✕</button></div>`).join(''):'<div class="empty">Nothing recorded for this month.</div>'}
 </div>
 <p class="hint" style="padding:0 4px">Your money data stays on this phone and is included in Settings → Export JSON backup. Voice entries go through Google speech recognition, so avoid saying account numbers.</p>`;
}
section.addEventListener('change',e=>{
 const k=e.target.dataset.budget;if(!k)return;const v=cents(e.target.value);const f=fin();if(v)f.budgets[k]=v;else delete f.budgets[k];localStorage.setItem(KEY,JSON.stringify(data));
});
section.addEventListener('click',e=>{
 const b=e.target.closest('[data-f]');if(!b)return;const a=b.dataset.f,f=fin();
 if(a==='prev'){month=shift(month,-1);}
 else if(a==='next'){month=shift(month,1);}
 else if(a==='now'){month=monthOf(day());}
 else if(a==='type'){const keep={amt:document.getElementById('finAmt').value,date:document.getElementById('finDate').value,note:document.getElementById('finNote').value};entryType=b.dataset.v;persist();document.getElementById('finAmt').value=keep.amt;document.getElementById('finDate').value=keep.date;document.getElementById('finNote').value=keep.note;return;}
 else if(a==='add'){
  const amt=cents(document.getElementById('finAmt').value);if(!amt){toast('Enter an amount.');return;}
  addTxn({type:entryType,amount:amt,category:document.getElementById('finCat').value,date:document.getElementById('finDate').value||day(),note:document.getElementById('finNote').value.trim()});
  toast((entryType==='income'?'Income':'Expense')+' saved.');
 }
 else if(a==='billform'){showBillForm=!showBillForm;}
 else if(a==='addbill'){
  const name=document.getElementById('billName').value.trim(),amt=cents(document.getElementById('billAmt').value),dd=parseInt(document.getElementById('billDay').value,10);
  if(!name||!amt||!(dd>=1&&dd<=31)){toast('Enter a name, amount, and due day (1–31).');return;}
  f.bills.push({id:uuid(),name,amount:amt,dueDay:dd,category:document.getElementById('billCat').value,paid:{}});showBillForm=false;toast('Bill saved.');
 }
 else if(a==='pay'){const bl=f.bills.find(x=>x.id===b.dataset.id);const due=billDue(bl,month);markBillPaid(bl.id,month===monthOf(day())?day():due);toast('Marked paid and recorded as an expense.');}
 else if(a==='unpay'){const bl=f.bills.find(x=>x.id===b.dataset.id);const txId=bl.paid?.[month];f.txns=f.txns.filter(t=>t.id!==txId);delete bl.paid[month];}
 else if(a==='delbill'){if(!confirm('Delete this bill? Past payments stay in your transactions.'))return;f.bills=f.bills.filter(x=>x.id!==b.dataset.id);}
 else if(a==='deltx'){if(!confirm('Delete this transaction?'))return;const tx=f.txns.find(t=>t.id===b.dataset.id);f.txns=f.txns.filter(t=>t.id!==b.dataset.id);if(tx?.billId){const bl=f.bills.find(x=>x.id===tx.billId);if(bl)for(const k in bl.paid)if(bl.paid[k]===tx.id)delete bl.paid[k];}}
 else if(a==='budgets'){editBudgets=!editBudgets;}
 else return;
 persist();
});
const baseRender=window.render;
window.render=function(){baseRender.apply(this,arguments);if(view==='finance')renderFinance();};
})();
