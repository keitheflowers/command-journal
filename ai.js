/* Vector AI: optional Claude-powered understanding for The Family Save.
   Turns free-form speech/text into the same proposed changes the built-in
   rules produce (they still need "confirm"), and answers questions about
   your tasks and money. Uses the person's own Anthropic API key, kept in
   this browser only (not in JSON backups). Off by default. */
(function(){
'use strict';
const MODEL='claude-opus-5-5';
const SDK_URL='./vendor/anthropic-sdk-0.137.0.js';
const K_KEY='vectorAiKey',K_ON='vectorAiOn',K_PLAIN='vectorAiPlain';let lastNote='';
const store={get:k=>{try{return localStorage.getItem(k)||'';}catch(_){return '';}},set:(k,v)=>{try{v?localStorage.setItem(k,v):localStorage.removeItem(k);}catch(_){}}};
let sdk=null,proxied=false;
const inflight=new Set();
const cancelled=()=>{const e=new Error('Cancelled because the account changed.');e.cancelled=true;return e;};
// the account or family changed: stop every request that is still waiting
window.addEventListener('vector-chat-switch',()=>{for(const c of inflight)c.abort('switch');inflight.clear();});

const SYSTEM=`You are Vector, the assistant inside The Family Save, a family task and home-finance app.
The user speaks or types requests. Turn each request into a list of proposed changes, and/or a short spoken reply.

Rules:
- Only propose changes the user actually asked for. Never invent tasks, amounts, or dates.
- One request can contain several changes ("add X and Y, and I spent 20 on lunch" = three actions).
- Dates are YYYY-MM-DD, resolved against TODAY in the context. "Friday" means the next Friday after today; "next Friday" means the Friday of next week. Tasks default to today when no date is given; money entries default to today.
- To complete or move an existing task, use its exact task_id from OPEN TASKS. If no task clearly matches, do not guess: leave it out and ask in "reply" which one they meant.
- To mark a bill paid, use its bill_id from BILLS. For other spending use kind "txn". For txn and bill_paid, set person to the family member (from PEOPLE) who spent or earned it when the user names someone ("Sam spent 40 at Target"); otherwise null.
- Amounts are dollars as numbers (e.g. 45.5). Pick category and area only from the allowed lists.
- Keep task titles short and in the user's words, without dates or priority words.
- "reply" is read aloud: one or two short, plain sentences. If you proposed changes, reply can be empty. If the user asked a question (what's due, how much did I spend), answer it from the context in "reply" and propose no actions.
- Fitness: use kind "fitness" with person (a name from PEOPLE; null means the first person, the phone's owner), fit_type, and the matching fields: workout -> activity + minutes and/or miles; weight -> value in lb; steps -> value; water -> value in glasses; sleep -> value in hours; meal -> note (what was eaten) + calories, protein, carbs and fat grams if the user said them. Never estimate nutrition the user didn't give, except when the request starts with ESTIMATE REQUEST: then give realistic estimates for all four.
- Fasting: "fast_start" (person, value = goal hours or null for their usual goal) and "fast_end" (person). Questions about fasting are answered from PEOPLE[].fasting.
- Meal planning: use kind "meal_plan" with person, date, meal_slot (a slot id from that person's PEOPLE[].meal_slots, e.g. "s2") and note (the meal, short). Follow each person's eating pattern (e.g. 6 small meals, or one meal a day). When asked to plan meals, propose one action per slot asked for, family-friendly and varied, and consider each person's calorie/protein goals if set. Keep it general healthy eating, not medical advice.
- Savings goals: "goal_create" with title (goal name), amount (target dollars) and date (deadline or null). "goal_contribution" with goal_id from SAVINGS_GOALS, amount in dollars (positive to add money, negative to withdraw) and date. Never withdraw more than a goal has saved.
- Grocery list: "grocery_add", one action per item, with title (item name, short), note (quantity like "2 lb" or null) and aisle. When building a list from meals, combine duplicates and skip pantry basics unless asked.
- Strength training: "lift_plan" creates a workout plan: title (e.g. "Chest day"), person, weekdays (0=Sun..6=Sat, or null) and exercises [{name, sets:[{weight, reps}]}], one entry per set in the order given (expand "3 sets of 12 at 80" into three sets). "lift_session" logs what was actually lifted: title = the plan name from STRENGTH_PLANS if it matches (else a short name), person, date, minutes if said, and exercises with the actual sets. Bodyweight exercises use weight 0. Use the plan's exercise names when the user clearly means them. Never invent sets that weren't said.
- Fields that don't apply to an action's kind must be null.`;

const nul=t=>({anyOf:[{type:t},{type:'null'}]});
function schema(){
 const F=window.Finance;
 return {type:'object',additionalProperties:false,required:['actions','reply'],properties:{
  reply:{type:'string'},
  actions:{type:'array',items:{type:'object',additionalProperties:false,
   required:['kind','title','task_id','date','due','priority','area','money_type','amount','category','note','bill_id','person','fit_type','activity','minutes','miles','value','calories','protein','meal_slot','carbs','fat','goal_id','aisle','weekdays','exercises'],
   properties:{
    kind:{type:'string',enum:['add_task','complete_task','move_task','txn','bill_paid','fitness','meal_plan','fast_start','fast_end','goal_create','goal_contribution','grocery_add','lift_plan','lift_session']},
    title:nul('string'),task_id:nul('string'),date:nul('string'),due:nul('string'),
    priority:{anyOf:[{type:'string',enum:['High','Medium','Low']},{type:'null'}]},
    area:{anyOf:[{type:'string',enum:AREAS},{type:'null'}]},
    money_type:{anyOf:[{type:'string',enum:['expense','income']},{type:'null'}]},
    amount:nul('number'),
    category:{anyOf:[{type:'string',enum:F?[...F.EXPENSE,...F.INCOME]:['Other']},{type:'null'}]},
    note:nul('string'),bill_id:nul('string'),
    person:nul('string'),fit_type:{anyOf:[{type:'string',enum:['workout','weight','steps','water','sleep','meal']},{type:'null'}]},
    activity:{anyOf:[{type:'string',enum:['run','walk','bike','swim','strength','yoga','hike','sports','other']},{type:'null'}]},
    minutes:nul('number'),miles:nul('number'),value:nul('number'),calories:nul('number'),protein:nul('number'),
    meal_slot:nul('string'),carbs:nul('number'),fat:nul('number'),
    weekdays:{anyOf:[{type:'array',items:{type:'integer',enum:[0,1,2,3,4,5,6]}},{type:'null'}]},
    exercises:{anyOf:[{type:'array',items:{type:'object',additionalProperties:false,required:['name','sets'],properties:{name:{type:'string'},sets:{type:'array',items:{type:'object',additionalProperties:false,required:['weight','reps'],properties:{weight:nul('number'),reps:{type:'number'}}}}}}},{type:'null'}]},
    goal_id:nul('string'),aisle:{anyOf:[{type:'string',enum:window.Grocery?window.Grocery.AISLES:['Other']},{type:'null'}]}}}}}};
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
 if(window.Savings){const $=c=>Math.round(c)/100;ctx.SAVINGS_GOALS=window.Savings.goals().map(g=>{const st=window.Savings.status(g);return {goal_id:g.id,name:g.name,target:$(g.target),saved:$(st.saved),deadline:g.deadline,needed_per_month:st.perMonth!=null?$(st.perMonth):null,on_track:st.onTrack};});}
 if(window.Strength&&window.Fitness){ctx.STRENGTH_PLANS=window.Fitness.people().flatMap(p=>window.Strength.plans(p.id).map(pl=>({person:p.name,name:pl.name,weekdays:pl.days,exercises:pl.exercises.map(e=>({name:e.name,sets:e.sets.map(x=>({weight:x.w,reps:x.r}))}))})));
  ctx.RECENT_LIFTS=window.Fitness.people().flatMap(p=>window.Strength.sessions(p.id).slice(-5).map(se=>({person:p.name,date:se.date,name:se.name,exercises:se.exercises.filter(e=>e.actual.length).map(e=>({name:e.name,sets:e.actual.map(x=>[x.w,x.r])}))})));}
 if(window.Budget){const B=window.Budget.budget(today.slice(0,7)),$=c=>Math.round(c)/100;ctx.BUDGET_THIS_MONTH={ready_to_assign:$(B.rta),categories:Object.fromEntries(B.cats.filter(c=>B.assigned[c]||B.spent[c]||B.avail[c]).map(c=>[c,{assigned:$(B.assigned[c]||0),spent:$(B.spent[c]||0),available:$(B.avail[c]||0)}]))};
  try{const fc=window.Budget.forecast(30);if(fc.accounts)ctx.CASH_FORECAST_30_DAYS={cash_today:$(fc.start),lowest:$(fc.low.bal),lowest_date:fc.low.date,in_30_days:$(fc.series.at(-1).bal),everyday_spending_per_day:$(fc.rate),upcoming:fc.events.slice(0,8).map(e=>({date:e.date,what:e.label,amount:$(e.amount)}))};}catch(_){}
  ctx.ACCOUNTS=window.Budget.accounts().filter(a=>!a.closed).map(a=>({name:a.name,type:a.type,balance:$(window.Budget.balance(a))}));ctx.NET_WORTH=$(window.Budget.netWorth());}
 if(window.Grocery)ctx.GROCERY_LIST=window.Grocery.items().map(i=>({name:i.name,qty:i.qty||null,aisle:i.aisle,checked:i.checked}));
 if(window.Fitness){
  ctx.PEOPLE=window.Fitness.people().map(p=>{const s=window.Fitness.stats(p.id),Nu=window.Nutrition,nt=Nu?Nu.N(p.id):null,fa=Nu?Nu.activeFast(p.id):null,tt=Nu?Nu.totals(Nu.mealsOn(p.id,today)):null;return {eating_pattern:nt?nt.pattern:null,meal_slots:nt?nt.slots.map(x=>({id:x.id,name:x.name})):null,macro_targets:nt?nt.targets:null,eaten_today:tt,fasting:fa?{active:true,hours_so_far:Math.round((Date.now()-new Date(fa.start))/36e5*10)/10,goal_hours:fa.goal}:{active:false,usual_goal_hours:nt?nt.fastGoal:null},name:p.name,goals:p.goals,active_min_last_7_days:s.minutes7,workout_streak_days:s.streak,steps_today:s.stepsToday,water_today:s.waterToday,last_sleep_h:s.sleepLast,latest_weight_lb:s.latestW?+s.latestW.value:null,calories_today:s.calToday,protein_today:s.proteinToday};});
  const mp=window.Fitness.mealPlan(),plan={};for(let i=-1;i<14;i++){const d=plusDays(today,i);if(mp[d])plan[d]=mp[d];}ctx.MEAL_PLAN_NEXT_2_WEEKS=plan;
 }
 return ctx;
}
async function client(){
 const S=window.Sync,viaServer=!!(S&&S.serverAi());
 const key=store.get(K_KEY);if(!key&&!viaServer)throw new Error('No API key saved.');
 if(!sdk)sdk=(await import(SDK_URL)).default;
 proxied=viaServer;
 // Family account: the request goes to the family's server, which adds the key.
 if(viaServer)return new sdk({apiKey:'family-save-proxy',baseURL:S.proxyUrl(),defaultHeaders:{Authorization:'Bearer '+await S.token(),apikey:S.anonKey()},dangerouslyAllowBrowser:true,maxRetries:1,timeout:45000});
 return new sdk({apiKey:key,dangerouslyAllowBrowser:true,maxRetries:1,timeout:45000});
}
function explain(e){
 if(!sdk)return e.message||String(e);
 if(proxied&&e instanceof sdk.APIError&&e.error&&e.error.error&&e.error.error.message)return e.error.error.message;
 if(e instanceof sdk.AuthenticationError)return 'API key was rejected. Check it in Settings.';
 if(e instanceof sdk.PermissionDeniedError)return 'This API key is not allowed to use '+MODEL+'.';
 if(e instanceof sdk.RateLimitError)return 'Rate limited by the API. Try again in a moment.';
 if(e instanceof sdk.APIConnectionError)return 'Could not reach the AI service (offline?).';
 if(e instanceof sdk.BadRequestError)return 'The AI service rejected the request (400): '+(e.message||'')+'. Tap Test in Settings and send me this message.';
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
   const P=a.person&&window.Fitness?window.Fitness.person(a.person):null;
   actions.push({kind:'txn',type,amount:cents,note,category:cats.includes(a.category)?a.category:F.guessCategory(note,type),date:isDate(a.date)?a.date:day(),...(P?{who:P.id,whoName:P.name}:{})});
  }else if(a.kind==='fitness'&&window.Fitness){
   const P=window.Fitness.person(a.person)||(a.person?null:window.Fitness.person());if(!P){errors.push('No family member named “'+a.person+'” in Fitness.');continue;}
   const k=a.fit_type,pos=v=>Number(v)>0?Number(v):null,base={kind:'fit',personId:P.id,who:P.name,date:isDate(a.date)?a.date:day(),fkind:k};
   if(k==='workout'){const minutes=pos(a.minutes),miles=pos(a.miles);if(!minutes&&!miles){errors.push('A workout had no minutes or distance.');continue;}actions.push({...base,activity:window.Fitness.ACT[a.activity]?a.activity:'other',minutes:minutes&&Math.round(minutes),miles,note:a.note?String(a.note).slice(0,80):null});}
   else if(k==='meal'){if(!a.note&&!pos(a.calories)){errors.push('A meal had no description.');continue;}actions.push({...base,note:String(a.note||'Meal').slice(0,80),calories:pos(a.calories)&&Math.round(a.calories),protein:pos(a.protein)&&Math.round(a.protein),carbs:pos(a.carbs)&&Math.round(a.carbs),fat:pos(a.fat)&&Math.round(a.fat)});}
   else if(['weight','steps','water','sleep'].includes(k)){const v=pos(a.value);if(!v){errors.push('A '+k+' entry had no number.');continue;}actions.push({...base,value:k==='steps'||k==='water'?Math.round(v):Math.round(v*10)/10});}
   else errors.push('Unknown fitness entry.');
  }else if(a.kind==='goal_create'&&window.Savings){
   const target=Math.round(Number(a.amount)*100),name=String(a.title||'').trim().slice(0,60);if(!name||!(target>0)){errors.push('A savings goal needs a name and a target.');continue;}
   actions.push({kind:'goalnew',title:name,amount:target,date:isDate(a.date)?a.date:null});
  }else if(a.kind==='goal_contribution'&&window.Savings){
   const g0=window.Savings.goals().find(x=>x.id===a.goal_id),amt=Math.round(Number(a.amount)*100);if(!g0){errors.push('Could not find that savings goal.');continue;}
   if(!amt){errors.push('No amount for '+g0.name+'.');continue;}if(amt<0&&-amt>window.Savings.saved(g0)){errors.push('Not enough saved in '+g0.name+'.');continue;}
   actions.push({kind:'goaladd',id:g0.id,title:g0.name,amount:amt,date:isDate(a.date)?a.date:day()});
  }else if((a.kind==='lift_plan'||a.kind==='lift_session')&&window.Strength&&window.Fitness){
   const P=window.Fitness.person(a.person)||(a.person?null:window.Fitness.person());if(!P){errors.push('No family member named “'+a.person+'”.');continue;}
   const exs=(a.exercises||[]).map(e=>({name:String(e.name||'').trim().slice(0,40),sets:(e.sets||[]).filter(x=>Number(x.reps)>0).slice(0,20).map(x=>({w:x.weight==null?null:Math.max(0,Number(x.weight)),r:Math.round(Number(x.reps))}))})).filter(e=>e.name&&e.sets.length);
   if(!exs.length){errors.push('No exercises with sets were given.');continue;}
   if(a.kind==='lift_plan'){const name=String(a.title||'Workout').slice(0,40);actions.push({kind:'liftplan',personId:P.id,who:P.name,title:name,days:Array.isArray(a.weekdays)?[...new Set(a.weekdays.filter(d=>d>=0&&d<=6))].sort():[],exercises:exs});}
   else{const plan=(a.title&&window.Strength.findPlan(P.id,a.title))||window.Strength.matchPlan(P.id,exs);
    actions.push({kind:'liftsession',personId:P.id,who:P.name,session:window.Strength.buildSession({personId:P.id,plan,actual:exs,date:isDate(a.date)?a.date:day(),minutes:Number(a.minutes)>0?Math.round(a.minutes):null,name:a.title||'Workout'})});}
  }else if(a.kind==='grocery_add'&&window.Grocery){
   const name=String(a.title||'').trim();if(!name)continue;const it={name,qty:a.note?String(a.note).slice(0,30):'',aisle:a.aisle};
   const prev=actions.find(x=>x.kind==='grocery');if(prev)prev.items.push(it);else actions.push({kind:'grocery',items:[it]});
  }else if((a.kind==='fast_start'||a.kind==='fast_end')&&window.Nutrition&&window.Fitness){
   const P=window.Fitness.person(a.person)||(a.person?null:window.Fitness.person());if(!P){errors.push('No family member named “'+a.person+'”.');continue;}
   if(a.kind==='fast_start')actions.push({kind:'faststart',personId:P.id,who:P.name,goal:Number(a.value)>0&&Number(a.value)<=72?Math.round(a.value):window.Nutrition.N(P.id).fastGoal||16});
   else{if(!window.Nutrition.activeFast(P.id)){errors.push(P.name+' isn’t fasting right now.');continue;}actions.push({kind:'fastend',personId:P.id,who:P.name});}
  }else if(a.kind==='meal_plan'&&window.Fitness){
   const P=window.Fitness.person(a.person)||window.Fitness.person(),slots=window.Nutrition?window.Nutrition.N(P.id).slots:[{id:'s1',name:'Meal'}];
   const sl=slots.find(x=>x.id===a.meal_slot)||slots.find(x=>x.name.toLowerCase()===String(a.meal_slot||'').toLowerCase());
   if(!isDate(a.date)||!sl||!a.note){errors.push('A meal plan entry was incomplete.');continue;}
   actions.push({kind:'mealplan',personId:P.id,date:a.date,slot:sl.id,slotName:sl.name,note:String(a.note).slice(0,120)});
  }else if(a.kind==='bill_paid'&&F){
   const b=F.summary(day().slice(0,7)).bills.find(x=>x.id===a.bill_id);if(!b){errors.push('Could not find that bill.');continue;}
   const cents=Math.round(Number(a.amount)*100);
   const P=a.person&&window.Fitness?window.Fitness.person(a.person):null;
   actions.push({kind:'billpaid',id:b.id,title:b.name,amount:cents>0?cents:b.amount,date:isDate(a.date)?a.date:day(),...(P?{who:P.id,whoName:P.name}:{})});
  }
 }
 return {actions,errors,reply:String(out.reply||'').trim()};
}
// ---- the "brains": your Vector home server first, then Claude ---------------------
const K_SRV='vectorServer';
const srv=()=>{try{return JSON.parse(localStorage.getItem(K_SRV))||{};}catch(_){return {};}};
const srvReady=()=>{const s=srv();return !!(s.on&&s.url);};
const claudeReady=()=>store.get(K_ON)==='1'&&(!!store.get(K_KEY)||!!(window.Sync&&window.Sync.serverAi()));
const JSON_RULE='\n\nRespond with ONLY one JSON object (no markdown, no prose) that matches this JSON Schema:\n';
function readJSON(txt,who){
 // local models may think out loud first (<think>…</think>) or wrap JSON in ``` fences
 txt=String(txt||'').replace(/<think>[\s\S]*?<\/think>/gi,'').replace(/```(?:json)?/gi,'').trim();
 try{return JSON.parse(txt);}catch(_){const i=txt.indexOf('{'),j=txt.lastIndexOf('}');try{return JSON.parse(txt.slice(i,j+1));}catch(__){throw new Error(who+' returned an unreadable answer.');}}
}
function srvBase(){return String(srv().url||'').trim().replace(/\/+$/,'');}
function mixedContent(u,proto=location.protocol){return proto==='https:'&&/^http:\/\//i.test(u)&&!/^http:\/\/(?:localhost|127\.0\.0\.1)(?::|\/|$)/i.test(u);}
async function srvFetch(url,body,method='POST'){
 const s=srv(),h={'content-type':'application/json'};if(s.key)h.Authorization='Bearer '+s.key;
 if(mixedContent(url))throw new Error('This app runs on a secure (https) address, so the phone blocks plain http:// servers. Give Vector an https address, for example with “tailscale serve” or a Cloudflare Tunnel (see the setup guide).');
 const ctl=new AbortController(),tm=setTimeout(()=>ctl.abort('timeout'),90000);inflight.add(ctl);
 let r;try{r=await fetch(url,{method,headers:h,body:body==null?undefined:JSON.stringify(body),signal:ctl.signal});}
 catch(e){if(ctl.signal.reason==='switch')throw cancelled();throw new Error(e.name==='AbortError'||ctl.signal.aborted?'Vector took too long to answer (90 s).':'Can’t reach Vector at '+srvBase()+'. Is the server on and reachable from this phone (same Wi-Fi or Tailscale)? It must also allow this app’s address (CORS).');}
 finally{clearTimeout(tm);inflight.delete(ctl);}
 if(r.status===401||r.status===403)throw new Error('Vector rejected the key (HTTP '+r.status+'). Check the key in Settings → Vector home server.');
 if(r.status===404)throw new Error('Nothing answered at '+url+' (404). Check the address and the server type.');
 return r;
}
const oaiUrl=p=>{const b=srvBase();return (/\/v1$/.test(b)?b:b+'/v1')+p;};
async function askServer(text,user,items=[]){
 const s=srv();let out;
 if(s.mode==='vector'){
  // Vector API: your own endpoint gets the request and context, answers {actions, reply}
  const r=await srvFetch(srvBase(),{app:'family-save',version:1,text,context:context(),history:items.flatMap(x=>[{role:'user',text:x.text},{role:'vector',text:x.reply}]),system:SYSTEM,schema:schema()});
  if(!r.ok)throw new Error('Vector answered HTTP '+r.status+'.');
  const j=await r.json().catch(()=>{throw new Error('Vector didn’t return JSON.');});
  out=typeof j.content==='string'?readJSON(j.content,'Vector'):j;
 }else{
  // OpenAI-compatible chat (Ollama, LM Studio, llama.cpp, vLLM…)
  const msgs=[{role:'system',content:SYSTEM+JSON_RULE+JSON.stringify(schema())},{role:'user',content:user}];
  const body={model:s.model||'qwen3.5',messages:msgs,temperature:0.2,stream:false,response_format:{type:'json_schema',json_schema:{name:'vector_actions',strict:true,schema:schema()}}};
  let r=await srvFetch(oaiUrl('/chat/completions'),body);
  if(r.status===400||r.status===422){body.response_format={type:'json_object'};r=await srvFetch(oaiUrl('/chat/completions'),body);}
  if(r.status===400||r.status===422){delete body.response_format;r=await srvFetch(oaiUrl('/chat/completions'),body);}
  if(!r.ok){let m='';try{const j=await r.json();m=(j.error&&(j.error.message||j.error))||j.message||'';}catch(_){}throw new Error('Vector answered HTTP '+r.status+(m?': '+m:'')+'.');}
  const j=await r.json(),msg=j.choices&&j.choices[0]&&j.choices[0].message;
  if(!msg)throw new Error('Vector’s answer had no message.');
  out=readJSON(msg.content,'Vector');
 }
 return toActions(out);
}
async function askClaude(user){
 const c=await client();
 // Structured output first; if the API rejects the schema (400), retry once
 // with the schema in the instructions and remember to skip it next time.
 const base={model:MODEL,max_tokens:16000,betas:['server-side-fallback-2026-07-01'],fallbacks:'default',messages:[{role:'user',content:user}]};
 const plain=()=>c.beta.messages.create({...base,output_config:{effort:'low'},system:SYSTEM+JSON_RULE+JSON.stringify(schema())});
 let res;
 if(store.get(K_PLAIN)==='1')res=await plain();
 else{try{res=await c.beta.messages.create({...base,output_config:{effort:'low',format:{type:'json_schema',schema:schema()}},system:SYSTEM});}
  catch(e){if(!(sdk&&e instanceof sdk.BadRequestError))throw e;store.set(K_PLAIN,'1');lastNote='Structured output was rejected ('+(e.message||'400')+'); using plain JSON instead.';res=await plain();}}
 if(res.stop_reason==='refusal')throw new Error('The AI declined this request.');
 if(res.stop_reason==='max_tokens')throw new Error('The AI response was cut off.');
 return toActions(readJSON(res.content.filter(b=>b.type==='text').map(b=>b.text).join(''),'The AI'));
}
async function interpret(text,only,opts={}){
 lastNote='';
 // chat requests use this person's saved conversation; tool requests (grocery, nutrition, recap) don't
 const chat=!!(opts.chat&&window.VectorChat),ticket=chat?window.VectorChat.begin():null;
 const req=chat?window.VectorChat.redact(text):text;
 const ctxJSON=JSON.stringify(context()),useSrv=only!=='claude'&&(only==='server'||srvReady());
 let mem={text:'',items:[],included:0,total:0,omitted:0};
 if(chat){
  const used=(SYSTEM+JSON_RULE+JSON.stringify(schema())).length+ctxJSON.length+req.length;
  mem=await window.VectorChat.context(ticket,req,window.VectorChat.historyBudget(useSrv?(srv().model||'qwen3.5'):MODEL,!useSrv,used));
  if(!window.VectorChat.valid(ticket))throw cancelled();
 }
 const user=`CONTEXT:\n${ctxJSON}\n\n${mem.text?mem.text+'\n\n':''}REQUEST:\n${req}`;
 let r=null;
 if(useSrv){
  try{r=await askServer(req,user,mem.items);r.brain='🏠 Vector (home server)';}
  catch(e){if(e.cancelled||only==='server'||!claudeReady())throw e;lastNote='Vector home server didn’t answer ('+e.message+') Claude answered instead.';}
 }
 if(chat&&!window.VectorChat.valid(ticket))throw cancelled();
 if(!r){try{r=await askClaude(user);}catch(e){throw new Error(explain(e));}r.brain='✨ Claude'+(lastNote&&lastNote.startsWith('Vector')?' (Vector didn’t answer)':'');}
 r.note=lastNote;
 if(chat){
  if(!window.VectorChat.valid(ticket))throw cancelled(); // a late reply for someone who has signed out or switched
  r.memory={included:mem.included,total:mem.total,omitted:mem.omitted};
  r.turn=await window.VectorChat.record(ticket,req,r);
  if(!r.turn&&!window.VectorChat.valid(ticket))throw cancelled();
 }
 return r;
}
window.VectorAI={
 enabled:()=>srvReady()||claudeReady(),
 interpret:t=>interpret(t),
 chat:t=>interpret(t,undefined,{chat:true}),
 server:{get:srv,ready:srvReady,blocked:mixedContent,set:v=>{try{localStorage.setItem(K_SRV,JSON.stringify(v));}catch(_){}},test:t=>interpret(t||'What is on my list for today?','server'),
  models:async()=>{const r=await srvFetch(oaiUrl('/models'),null,'GET');if(!r.ok)return [];const j=await r.json().catch(()=>({}));return (j.data||j.models||[]).map(m=>m.id||m.name).filter(Boolean);}},
 reset:()=>{} // tests and tool prompts are not remembered, so there is nothing to clear
};

// ---- Settings panel ---------------------------------------------------
const panel=document.createElement('div');panel.className='panel';
function draw(msg){
 const on=store.get(K_ON)==='1',has=!!store.get(K_KEY);
 panel.innerHTML=`<h2>Vector AI (Claude)</h2>
 <p class="hint">When on, Family Save sends what you say, plus your open tasks, bills, this month's money summary, savings goals, grocery list and family fitness summary, to Anthropic's Claude to understand free-form requests and answer questions like “what's due this week?” or “how much have I spent on dining?”. You still confirm every change. Built-in rules take over when it's off or you're offline.</p>
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
 else if(a==='test'){draw('Testing…');try{const r=await interpret('What is on my list for today?','claude');window.VectorAI.reset();draw('✓ Working. Vector says: “'+(r.reply||'OK')+'”'+(lastNote?' ('+lastNote+')':''));}catch(err){draw('✗ '+err.message);}}
});
draw();
const settings=document.getElementById('settings');settings.insertBefore(panel,settings.firstChild);

// ---- Settings: Vector home server ---------------------------------------------
const vp=document.createElement('div');vp.className='panel';vp.id='vectorServerPanel';
function drawV(msg,models){
 const s=srv(),on=srvReady();
 vp.innerHTML=`<h2>🏠 Vector home server</h2>
 <p class="hint">Use your own AI server (for example Qwen through Ollama or LM Studio) as Vector’s brain. Your request and the same summary Claude gets go to <b>your</b> server only. When it can’t be reached, Claude answers if it’s on, then the built-in rules.</p>
 <label>Server address</label><input id="vsUrl" placeholder="https://vector.your-tailnet.ts.net" value="${esc(s.url||'')}" autocomplete="off">
 <div class="two"><div><label>Server type</label><select id="vsMode"><option value="openai"${s.mode!=='vector'?' selected':''}>OpenAI-compatible (Ollama, LM Studio, llama.cpp, vLLM)</option><option value="vector"${s.mode==='vector'?' selected':''}>Vector API (my own endpoint)</option></select></div>
 <div><label>Model</label><input id="vsModel" list="vsModels" value="${esc(s.model||'qwen3.5')}" autocomplete="off"><datalist id="vsModels">${(models||[]).map(m=>`<option value="${esc(m)}">`).join('')}</datalist></div></div>
 <label>Key (optional)</label><input id="vsKey" type="password" autocomplete="off" placeholder="${s.key?'Saved — type a new one to replace':'Only if your server asks for one'}">
 <div class="actions" style="margin-top:10px"><button class="btn" data-vs="save">${on?'Save':'Save and turn on'}</button><button class="btn alt" data-vs="test"${s.url?'':' disabled'}>Test</button>${on?'<button class="btn alt sm" data-vs="off">Turn off</button>':''}</div>
 <p class="hint" id="vsStatus" role="status">${msg?esc(msg):on?'On: Vector answers first.':s.url?'Off.':'Not set up. See the setup guide: docs/vector-server.md in the app’s GitHub repo.'}</p>`;
}
vp.addEventListener('click',async e=>{
 const b=e.target.closest('[data-vs]');if(!b)return;const a=b.dataset.vs,s=srv();
 if(a==='save'){const url=document.getElementById('vsUrl').value.trim(),k=document.getElementById('vsKey').value.trim();
  if(!/^https?:\/\/\S+$/i.test(url)){drawV('Enter the full address, starting with https://');return;}
  const v={...s,url,mode:document.getElementById('vsMode').value,model:document.getElementById('vsModel').value.trim()||'qwen3.5',on:true};if(k)v.key=k;window.VectorAI.server.set(v);
  drawV(mixedContent(url)?'Saved, but this is an http:// address: phones block those from a secure app. Use an https address (see the guide).':'Saved and turned on. Tap Test.');}
 else if(a==='off'){window.VectorAI.server.set({...s,on:false});drawV('Turned off. Claude or the built-in rules answer instead.');}
 else if(a==='test'){drawV('Testing… (a local model can take a while the first time)');let models=[];
  try{if(s.mode!=='vector')models=await window.VectorAI.server.models().catch(()=>[]);const t0=Date.now(),r=await window.VectorAI.server.test();window.VectorAI.reset();
   drawV(`✓ Working (${((Date.now()-t0)/1000).toFixed(1)} s). Vector says: “${r.reply||'OK'}”`+(models.length&&s.mode!=='vector'&&!models.includes(s.model||'qwen3.5')?` Note: “${s.model||'qwen3.5'}” isn’t in the server’s model list (${models.slice(0,5).join(', ')}).`:''),models);}
  catch(err){drawV('✗ '+err.message,models);}}
});
drawV();settings.insertBefore(vp,panel.nextSibling);
})();
