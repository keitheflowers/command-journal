/* Vector AI: optional Claude-powered understanding for Command Journal.
   Turns free-form speech/text into the same proposed changes the built-in
   rules produce (they still need "confirm"), and answers questions about
   your tasks and money. Uses the person's own Anthropic API key, kept in
   this browser only (not in JSON backups). Off by default. */
(function(){
'use strict';
const MODEL='claude-opus-5-5';
const SDK_URL='./vendor/anthropic-sdk-0.137.0.js';
const K_KEY='vectorAiKey',K_ON='vectorAiOn';
const store={get:k=>{try{return localStorage.getItem(k)||'';}catch(_){return '';}},set:(k,v)=>{try{v?localStorage.setItem(k,v):localStorage.removeItem(k);}catch(_){}}};
let sdk=null,history=[];

const SYSTEM=`You are Vector, the assistant inside Command Journal, a personal task and home-finance app.
The user speaks or types requests. Turn each request into a list of proposed changes, and/or a short spoken reply.

Rules:
- Only propose changes the user actually asked for. Never invent tasks, amounts, or dates.
- One request can contain several changes ("add X and Y, and I spent 20 on lunch" = three actions).
- Dates are YYYY-MM-DD, resolved against TODAY in the context. "Friday" means the next Friday after today; "next Friday" means the Friday of next week. Tasks default to today when no date is given; money entries default to today.
- To complete or move an existing task, use its exact task_id from OPEN TASKS. If no task clearly matches, do not guess: leave it out and ask in "reply" which one they meant.
- To mark a bill paid, use its bill_id from BILLS. For other spending use kind "txn".
- Amounts are dollars as numbers (e.g. 45.5). Pick category and area only from the allowed lists.
- Keep task titles short and in the user's words, without dates or priority words.
- "reply" is read aloud: one or two short, plain sentences. If you proposed changes, reply can be empty. If the user asked a question (what's due, how much did I spend), answer it from the context in "reply" and propose no actions.
- Fields that don't apply to an action's kind must be null.`;

const nul=t=>({anyOf:[{type:t},{type:'null'}]});
function schema(){
 const F=window.Finance;
 return {type:'object',additionalProperties:false,required:['actions','reply'],properties:{
  reply:{type:'string'},
  actions:{type:'array',items:{type:'object',additionalProperties:false,
   required:['kind','title','task_id','date','due','priority','area','money_type','amount','category','note','bill_id'],
   properties:{
    kind:{type:'string',enum:['add_task','complete_task','move_task','txn','bill_paid']},
    title:nul('string'),task_id:nul('string'),date:nul('string'),due:nul('string'),
    priority:{anyOf:[{type:'string',enum:['High','Medium','Low']},{type:'null'}]},
    area:{anyOf:[{type:'string',enum:AREAS},{type:'null'}]},
    money_type:{anyOf:[{type:'string',enum:['expense','income']},{type:'null'}]},
    amount:nul('number'),
    category:{anyOf:[{type:'string',enum:F?[...F.EXPENSE,...F.INCOME]:['Other']},{type:'null'}]},
    note:nul('string'),bill_id:nul('string')}}}}};
}
function context(){
 const today=day(),d=new Date();
 const open=data.tasks.filter(t=>t.status!=='done').slice(0,150).map(t=>({task_id:t.id,title:t.title,scheduled:t.scheduled,due:t.due||null,priority:t.priority,area:t.area}));
 const recentDone=data.tasks.filter(t=>t.status==='done'&&t.completed&&t.completed.slice(0,10)>=plusDays(today,-7)).slice(-30).map(t=>({title:t.title,completed:t.completed.slice(0,10)}));
 const ctx={TODAY:today,WEEKDAY:d.toLocaleDateString('en-US',{weekday:'long'}),AREAS,OPEN_TASKS:open,DONE_LAST_7_DAYS:recentDone};
 if(window.Finance){const s=window.Finance.summary(today.slice(0,7));const $=c=>Math.round(c)/100;
  ctx.MONEY_THIS_MONTH={income:$(s.income),spent:$(s.spent),by_category:Object.fromEntries(Object.entries(s.byCategory).map(([k,v])=>[k,$(v)])),budgets:Object.fromEntries(Object.entries(s.budgets).map(([k,v])=>[k,$(v)])),recent:s.recent.map(t=>({...t,amount:$(t.amount)}))};
  ctx.BILLS=s.bills.map(b=>({bill_id:b.id,name:b.name,amount:$(b.amount),due_day:b.dueDay,paid_this_month:b.paidThisMonth}));
  ctx.EXPENSE_CATEGORIES=window.Finance.EXPENSE;ctx.INCOME_CATEGORIES=window.Finance.INCOME;}
 return ctx;
}
async function client(){
 const key=store.get(K_KEY);if(!key)throw new Error('No API key saved.');
 if(!sdk)sdk=(await import(SDK_URL)).default;
 return new sdk({apiKey:key,dangerouslyAllowBrowser:true,maxRetries:1,timeout:45000});
}
function explain(e){
 if(!sdk)return e.message||String(e);
 if(e instanceof sdk.AuthenticationError)return 'API key was rejected. Check it in Settings.';
 if(e instanceof sdk.PermissionDeniedError)return 'This API key is not allowed to use '+MODEL+'.';
 if(e instanceof sdk.RateLimitError)return 'Rate limited by the API. Try again in a moment.';
 if(e instanceof sdk.APIConnectionError)return 'Could not reach the AI service (offline?).';
 if(e instanceof sdk.APIError)return 'AI service error'+(e.status?' ('+e.status+')':'')+': '+(e.message||'');
 return e.message||String(e);
}
const isDate=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&!isNaN(new Date(s+'T12:00'));
function toActions(out){
 // Map Claude's output onto the app's own action shapes, keeping only valid ones.
 const actions=[],errors=[],F=window.Finance;
 for(const a of out.actions||[]){
  if(a.kind==='add_task'){
   const title=String(a.title||'').trim().slice(0,180);if(!title){errors.push('A task had no title.');continue;}
   actions.push({kind:'add',title,date:isDate(a.date)?a.date:day(),due:isDate(a.due)?a.due:'',priority:['High','Medium','Low'].includes(a.priority)?a.priority:'Medium',area:AREAS.includes(a.area)?a.area:'Vector AI'});
  }else if(a.kind==='complete_task'||a.kind==='move_task'){
   const t=data.tasks.find(x=>x.id===a.task_id&&x.status!=='done');if(!t){errors.push('Could not find that task.');continue;}
   if(a.kind==='move_task'&&!isDate(a.date)){errors.push('No date to move “'+t.title+'” to.');continue;}
   actions.push({kind:a.kind==='complete_task'?'complete':'move',id:t.id,title:t.title,date:a.kind==='move_task'?a.date:plusDays(day(),1)});
  }else if(a.kind==='txn'&&F){
   const cents=Math.round(Number(a.amount)*100);if(!(cents>0)){errors.push('A money entry had no amount.');continue;}
   const type=a.money_type==='income'?'income':'expense',cats=type==='income'?F.INCOME:F.EXPENSE;
   const note=String(a.note||'').slice(0,140);
   actions.push({kind:'txn',type,amount:cents,note,category:cats.includes(a.category)?a.category:F.guessCategory(note,type),date:isDate(a.date)?a.date:day()});
  }else if(a.kind==='bill_paid'&&F){
   const b=F.summary(day().slice(0,7)).bills.find(x=>x.id===a.bill_id);if(!b){errors.push('Could not find that bill.');continue;}
   const cents=Math.round(Number(a.amount)*100);
   actions.push({kind:'billpaid',id:b.id,title:b.name,amount:cents>0?cents:b.amount,date:isDate(a.date)?a.date:day()});
  }
 }
 return {actions,errors,reply:String(out.reply||'').trim()};
}
async function interpret(text){
 const c=await client();
 const recent=history.slice(-6).map(h=>`${h.role}: ${h.text}`).join('\n');
 const user=`CONTEXT:\n${JSON.stringify(context())}\n\n${recent?'RECENT CONVERSATION:\n'+recent+'\n\n':''}REQUEST:\n${text}`;
 const res=await c.beta.messages.create({
  model:MODEL,max_tokens:16000,
  betas:['server-side-fallback-2026-07-01'],fallbacks:'default',
  output_config:{effort:'low',format:{type:'json_schema',schema:schema()}},
  system:SYSTEM,messages:[{role:'user',content:user}]
 });
 if(res.stop_reason==='refusal')throw new Error('The AI declined this request.');
 if(res.stop_reason==='max_tokens')throw new Error('The AI response was cut off.');
 const txt=res.content.filter(b=>b.type==='text').map(b=>b.text).join('');
 let out;try{out=JSON.parse(txt);}catch(_){throw new Error('The AI returned an unreadable answer.');}
 const r=toActions(out);
 history.push({role:'user',text},{role:'vector',text:r.reply||r.actions.map(a=>a.kind+' '+(a.title||a.note||'')).join('; ')});
 if(history.length>12)history=history.slice(-12);
 return r;
}
window.VectorAI={
 enabled:()=>store.get(K_ON)==='1'&&!!store.get(K_KEY),
 interpret:async t=>{try{return await interpret(t);}catch(e){const err=new Error(explain(e));err.cause=e;throw err;}},
 reset:()=>{history=[];}
};

// ---- Settings panel ---------------------------------------------------
const panel=document.createElement('div');panel.className='panel';
function draw(msg){
 const on=store.get(K_ON)==='1',has=!!store.get(K_KEY);
 panel.innerHTML=`<h2>Vector AI (Claude)</h2>
 <p class="hint">When on, Journal sends what you say, plus your open tasks, bills and this month's money summary, to Anthropic's Claude to understand free-form requests and answer questions like “what's due this week?” or “how much have I spent on dining?”. You still confirm every change. Built-in rules take over when it's off or you're offline.</p>
 <label>Anthropic API key</label><input id="aiKey" type="password" autocomplete="off" placeholder="${has?'Saved — paste a new key to replace':'sk-ant-…'}">
 <div class="actions" style="margin-top:10px"><button class="btn" data-ai="save">Save key</button><button class="btn alt" data-ai="toggle"${has?'':' disabled'}>${on?'Turn AI off':'Turn AI on'}</button><button class="btn alt" data-ai="test"${has?'':' disabled'}>Test</button>${has?'<button class="btn danger sm" data-ai="forget">Forget key</button>':''}</div>
 <p class="hint" id="aiStatus" role="status">${msg||(on&&has?'AI is on.':has?'AI is off.':'Get a key at console.anthropic.com → API keys. It stays in this browser only and is not included in backups.')}</p>
 <p class="hint">Model: ${MODEL}. Each request typically costs about a cent or two, billed to your Anthropic account.</p>`;
}
panel.addEventListener('click',async e=>{
 const b=e.target.closest('[data-ai]');if(!b)return;const a=b.dataset.ai;
 if(a==='save'){const v=document.getElementById('aiKey').value.trim();if(!/^sk-ant-/.test(v)){draw('That doesn’t look like an Anthropic API key (it should start with sk-ant-).');return;}store.set(K_KEY,v);store.set(K_ON,'1');draw('Key saved and AI turned on. Tap Test to check it.');}
 else if(a==='toggle'){store.set(K_ON,store.get(K_ON)==='1'?'':'1');draw();}
 else if(a==='forget'){if(!confirm('Remove the saved API key from this phone?'))return;store.set(K_KEY,'');store.set(K_ON,'');draw('Key removed.');}
 else if(a==='test'){draw('Testing…');try{const r=await window.VectorAI.interpret('What is on my list for today?');window.VectorAI.reset();draw('✓ Working. Vector says: “'+(r.reply||'OK')+'”');}catch(err){draw('✗ '+err.message);}}
});
draw();
const settings=document.getElementById('settings');settings.insertBefore(panel,settings.firstChild);
})();
