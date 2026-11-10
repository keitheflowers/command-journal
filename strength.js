/* The Family Save strength training: workout plans, logged sessions
   (planned vs actual), progress math and a strength dashboard.
   Stored in data.fitness.plans / data.fitness.sessions (in backups).
   Weights are in lb. Estimated 1-rep max uses the Epley formula. */
(function(){
'use strict';
const C={s1:'#3987e5',muted:'#6b7a8c',grid:'#1c2838',axis:'#2a3a4f',surface:'#0d141f',ink:'#eef6fb',ink2:'#aebdcc',ink3:'#7f93a8',good:'#3fd16b',bad:'#ff8a8a',warn:'#fab219'};
const DOW=['S','M','T','W','T','F','S'],DOWN=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const pd=s=>{const [y,m,d]=s.split('-').map(Number);return new Date(y,m-1,d);};
const short=s=>pd(s).toLocaleDateString(undefined,{month:'short',day:'numeric'});
const lb=n=>Math.round(n).toLocaleString('en-US');
const e1rm=(w,r)=>w>0&&r>0?(r===1?w:w*(1+r/30)):0;

// ---- parsing "flat bench 225 for 15, 315 for 10, 405 for 8; incline db 80 3 sets of 12"
const WORDN={one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10,eleven:11,twelve:12,thirteen:13,fourteen:14,fifteen:15,sixteen:16,seventeen:17,eighteen:18,nineteen:19,twenty:20,twenty_five:25,thirty:30};
const KEY=new Set(['for','x','by','times','reps','rep','at','with','of','and','then','sets','set','was','is','plus','next','did','got','hit','made','on','lb','lbs','pounds','pound','after','that','followed','i','me','my','reps.','repetitions','did','do','doing','went','up','to','about']);
const ONES={one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9},TEENS={ten:10,eleven:11,twelve:12,thirteen:13,fourteen:14,fifteen:15,sixteen:16,seventeen:17,eighteen:18,nineteen:19},TENS={twenty:20,thirty:30,forty:40,fifty:50,sixty:60,seventy:70,eighty:80,ninety:90};
function gymNumbers(t){
 return t.replace(/\b(one|two|three|four|five|six|seven|eight|nine)\s+(?:(oh|o)\s+(one|two|three|four|five|six|seven|eight|nine)|(ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen)|(twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)(?:[\s-]+(one|two|three|four|five|six|seven|eight|nine))?)\b/g,
  (m,h,oh,o1,teen,tens,o2)=>String(ONES[h]*100+(oh?ONES[o1]:teen?TEENS[teen]:TENS[tens]+(o2?ONES[o2]:0))))
  .replace(/\b(twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)[\s-]+(one|two|three|four|five|six|seven|eight|nine)\b/g,(m,a,b)=>String(TENS[a]+ONES[b]));
}
function normText(t){
 return gymNumbers(String(t).toLowerCase())
  .replace(/(\d)\s*[x×*]\s*(\d)/g,'$1 x $2').replace(/@/g,' at ')
  .replace(/\b(?:the\s+)?(?:first|second|third|fourth|fifth|sixth|last|final|1st|2nd|3rd|[4-9]th)\s+(?:set|one)\s*(?:was|is|:)?\s*/g,' , ')
  .replace(/\b(?:pounds?|lbs?)\b/g,' ').replace(/\b(?:repetitions?)\b/g,'reps')
  .replace(/\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty)\b/g,w=>WORDN[w])
  .replace(/\b(?:body ?weight|bw)\b/g,' bw ');
}
function setsFrom(str,bw){
 // str: just the numbers/keywords part for one exercise
 const out=[];let m;const re=/(?:(\d+(?:\.\d+)?)\s+)?(\d{1,2})\s+sets?\s+(?:of\s+)?(\d{1,3})(?:\s+reps?)?(?:\s+(?:at|with|of)\s+(\d+(?:\.\d+)?))?|(\d{1,2})\s+x\s+(\d{1,3})(?:\s+reps?)?\s+(?:at|with)\s+(\d+(?:\.\d+)?)|(\d{1,3})\s+reps?\s+(?:at|with|of)\s+(\d+(?:\.\d+)?)|(\d+(?:\.\d+)?)\s+(?:(?:for|x|by|times|with)\s+)?(\d{1,3})(?:\s+reps?)?(?:\s*,?\s*(?:x|for)?\s*(\d{1,2})\s+sets?\b|\s+x\s+(\d{1,2})\b)?|(\d{1,3})\s+reps?|(\d{1,2})\s+sets?\b/g;
 while((m=re.exec(str))){
  if(m[2]){const n=+m[2],r=+m[3],w=m[4]?+m[4]:m[1]?+m[1]:(bw?0:null);for(let i=0;i<Math.min(n,10);i++)out.push({w,r});}
  else if(m[5]){const n=+m[5],r=+m[6],w=+m[7];for(let i=0;i<Math.min(n,10);i++)out.push({w,r});}
  else if(m[8])out.push({w:+m[9],r:+m[8]});
  else if(m[10]){let w=+m[10],r=+m[11];if(w<=30&&r>=45){[w,r]=[r,w];}const n=+(m[12]||m[13]||1);for(let i=0;i<Math.min(n,10);i++)out.push({w,r});}
  else if(m[14])out.push({w:bw?0:null,r:+m[14]});
  else if(m[15]&&out.length){const last=out.at(-1);for(let i=1;i<Math.min(+m[15],10);i++)out.push({...last});}
 }
 return out.filter(s=>s.r>0&&s.r<=100&&(s.w===null||(s.w>=0&&s.w<=2000)));
}
function parseSets(text){
 const toks=normText(text).match(/\d+(?:\.\d+)?|[a-z][a-z'\-]*|[;,\n]/g)||[];
 const chunks=[];let cur=null,name=[];
 const start=()=>{if(name.length){cur={name:name.join(' '),toks:[],bw:false};chunks.push(cur);name=[];}};
 for(const t of toks){
  if(/^\d/.test(t)){start();if(!cur){cur={name:'',toks:[],bw:false};chunks.push(cur);}cur.toks.push(t);}
  else if(t===';'||t==='\n'){start();cur=null;}
  else if(t===','){if(cur&&!name.length)cur.toks.push(',');}
  else if(t==='bw'){start();if(cur)cur.bw=true;}
  else if(KEY.has(t)){if(name.length&&!/^(?:reps?|sets?|x|for|at|lb|lbs)$/.test(t))name.push(t);else if(cur&&!name.length)cur.toks.push(t);}
  else{
   // a new word after numbers starts the next exercise
   name.push(t);
  }
 }
 if(name.length&&!chunks.length)chunks.push({name:name.join(' '),toks:[],bw:false});
 const BW=/\b(pull ?-?ups?|chin ?-?ups?|dips?|push ?-?ups?|sit ?-?ups?|planks?|burpees?|muscle ?-?ups?)\b/i;
 return chunks.map(c=>{const name=tidyName(c.name),sets=setsFrom(c.toks.join(' '),c.bw||BW.test(c.name));if(BW.test(c.name))for(const x of sets)if(x.w==null)x.w=0;return {name,sets};}).filter(c=>c.sets.length&&(c.name||chunks.length===1||c===chunks[0]));
}
function tidyName(n){
 n=n.replace(/^(?:and|then|next|also|plus|did|do|my|the|a|some)\s+/g,'').replace(/\s+(?:and|then|for|at|with|of|did)$/g,'').trim();
 return n?n.replace(/\b\w/g,ch=>ch.toUpperCase()).replace(/\bDb\b/g,'DB').replace(/\bRdl\b/g,'RDL').replace(/\bOhp\b/g,'OHP'):'';
}
const SYN=[[/\bdb\b|\bdumbbells?\b/g,'dumbbell'],[/\bbb\b|\bbarbell\b/g,''],[/\bflat bench(?: press)?\b|\bbench press\b/g,'bench'],[/\bohp\b|\bmilitary press\b|\bshoulder press\b/g,'overhead press'],[/\brdl\b/g,'romanian deadlift'],[/\bpull ?-?ups?\b/g,'pullup'],[/\bchin ?-?ups?\b/g,'chinup'],[/\bpush ?-?ups?\b/g,'pushup'],[/\bsquats?\b/g,'squat'],[/\bcurls?\b/g,'curl'],[/\brows?\b/g,'row'],[/\bdips?\b/g,'dip'],[/\blunges?\b/g,'lunge']];
function key(name){let k=' '+String(name).toLowerCase().replace(/[^a-z ]/g,' ')+' ';for(const [re,v] of SYN)k=k.replace(re,v);return k.replace(/\b(?:the|a|standard|regular|press(?= ))\b/g,' ').split(/\s+/).filter(Boolean).map(w=>w.replace(/s$/,'')).join(' ');}
function sim(a,b){const A=new Set(key(a).split(' ')),B=new Set(key(b).split(' '));if(!A.size||!B.size)return 0;if(key(a)===key(b))return 1;let i=0;for(const x of A)if(B.has(x))i++;const j=i/(A.size+B.size-i);const ka=key(a),kb=key(b);return Math.max(j,(ka.includes(kb)||kb.includes(ka))?0.75:0);}
const MUSCLE=[[/romanian|stiff leg|good morning|hip thrust|squat|lunge|leg press|leg curl|leg extension|calf/,'Legs'],[/bench|chest|fly|flye|pec|pushup|crossover|incline|decline/,'Chest'],[/deadlift|row|pullup|chinup|pulldown|\blat\b|back|shrug/,'Back'],[/squat|leg|lunge|calf|hamstring|quad|romanian|hip thrust|glute|step up/,'Legs'],[/overhead|shoulder|lateral|raise|delt|arnold|face pull/,'Shoulders'],[/curl|tricep|extension|skull|pushdown|hammer|dip/,'Arms'],[/plank|crunch|\bab|sit ?up|core|russian|hollow/,'Core']];
const muscle=n=>{const k=key(n);return (MUSCLE.find(([re])=>re.test(k))||[0,'Other'])[1];};
const lower=n=>['Legs'].includes(muscle(n))||/deadlift/.test(key(n));

// ---- data -------------------------------------------------------------
function F(){const f=window.Fitness?window.Fitness.people()&&data.fitness:null;const x=data.fitness||(data.fitness={});x.plans=Array.isArray(x.plans)?x.plans:[];x.sessions=Array.isArray(x.sessions)?x.sessions:[];return x;}
const plans=pid=>F().plans.filter(p=>p.personId===pid);
const sessions=pid=>F().sessions.filter(s=>s.personId===pid).sort((a,b)=>a.date.localeCompare(b.date)||a.created.localeCompare(b.created));
function findPlan(pid,name){const L=plans(pid);if(!name)return null;let best=null,bs=0;for(const p of L){const s=sim(p.name.replace(/\b(day|workout|routine)\b/gi,''),String(name).replace(/\b(day|workout|routine)\b/gi,''));if(s>bs){bs=s;best=p;}}return bs>=0.5?best:null;}
function matchPlan(pid,exs){let best=null,bs=0;for(const p of plans(pid)){let hit=0;for(const e of exs)if(p.exercises.some(pe=>sim(pe.name,e.name)>=0.6))hit++;const s=hit/Math.max(exs.length,p.exercises.length,1);if(s>bs){bs=s;best=p;}}return bs>=0.5?best:null;}
function createPlan({personId,name,days,exercises}){const p={id:uuid(),personId,name:tidyName(name.replace(/\s+(?:day|workout)$/i,m=>m))||'Workout',days:days||[],exercises:exercises.map(e=>({id:uuid(),name:tidyName(e.name)||e.name,sets:e.sets.map(s=>({w:s.w,r:s.r}))})),created:stamp()};F().plans.push(p);try{log('plan_created',null,p.name);}catch(_){}return p;}
// line up what was done against the plan, exercise by exercise
function buildSession({personId,plan,actual,date,minutes,name}){
 const used=new Set(),ex=[];
 // sets said without an exercise name go to the next plan exercise nobody named
 if(plan){actual=actual.map(a=>({...a}));for(const a of actual)if(!a.name){const free=plan.exercises.find(pe=>!actual.some(x=>x.name&&sim(x.name,pe.name)>=0.5));if(free)a.name=free.name;}}
 for(const pe of (plan?plan.exercises:[])){let m=null,ms=0;actual.forEach((a,i)=>{if(used.has(i))return;const s=sim(pe.name,a.name);if(s>ms){ms=s;m=i;}});
  if(m!=null&&ms>=0.5){used.add(m);ex.push({name:pe.name,planned:pe.sets.map(s=>({...s})),actual:actual[m].sets.map(s=>({w:s.w??(pe.sets[0]?.w??null),r:s.r}))});}
  else ex.push({name:pe.name,planned:pe.sets.map(s=>({...s})),actual:[]});}
 actual.forEach((a,i)=>{if(!used.has(i))ex.push({name:a.name,planned:[],actual:a.sets.map(s=>({...s}))});});
 return {id:uuid(),personId,planId:plan?plan.id:null,name:plan?plan.name:(name||'Workout'),date:date||day(),minutes:minutes||null,exercises:ex,created:stamp()};
}
const vol=sets=>sets.reduce((a,s)=>a+(s.w||0)*s.r,0);
const bwOnly=sets=>sets.length&&sets.every(s=>!s.w);
const best=sets=>bwOnly(sets)?sets.reduce((a,s)=>a+s.r,0):sets.reduce((a,s)=>Math.max(a,e1rm(s.w||0,s.r)),0);
const unit=sets=>bwOnly(sets)?'total reps':'lb est. 1RM';
const top=sets=>sets.reduce((a,s)=>(s.w||0)>a.w||((s.w||0)===a.w&&s.r>a.r)?{w:s.w||0,r:s.r}:a,{w:0,r:0});
function prevFor(pid,name,beforeDate,beforeCreated){const L=sessions(pid).filter(s=>s.date<beforeDate||(s.date===beforeDate&&s.created<beforeCreated));for(let i=L.length-1;i>=0;i--){const e=L[i].exercises.find(x=>x.actual.length&&sim(x.name,name)>=0.75);if(e)return {session:L[i],ex:e};}return null;}
function historyFor(pid,name){return sessions(pid).flatMap(s=>{const e=s.exercises.find(x=>x.actual.length&&sim(x.name,name)>=0.75);return e?[{date:s.date,e1:best(e.actual),bw:bwOnly(e.actual),vol:vol(e.actual),top:top(e.actual),sets:e.actual.length,reps:e.actual.reduce((a,x)=>a+x.r,0)}]:[];});}
function verdict(d){return d==null?{k:'new',t:'First time',i:'✦'}:d>=0.01?{k:'up',t:'Progress',i:'▲'}:d<=-0.02?{k:'down',t:'Decline',i:'▼'}:{k:'hold',t:'Holding',i:'●'};}
// per-exercise comparison for one session
function analyze(sess){
 return sess.exercises.map(e=>{
  const a=e.actual,p=e.planned;
  const plannedReps=p.reduce((x,s)=>x+s.r,0),doneReps=a.reduce((x,s)=>x+s.r,0);
  const hit=p.length?p.filter((s,i)=>a[i]&&a[i].r>=s.r&&(a[i].w??0)>=(s.w??0)).length:null;
  const adherence=p.length?Math.min(1,p.reduce((x,s,i)=>x+Math.min(a[i]?a[i].r:0,s.r),0)/Math.max(1,plannedReps)):null;
  const prev=a.length?prevFor(sess.personId,e.name,sess.date,sess.created):null;
  const e1=best(a),pe1=prev&&bwOnly(prev.ex.actual)===bwOnly(a)?best(prev.ex.actual):null,d=pe1?e1/pe1-1:null;
  const prior=sessions(sess.personId).filter(s=>s.id!==sess.id&&(s.date<sess.date||(s.date===sess.date&&s.created<sess.created))).flatMap(s=>{const x=s.exercises.find(q=>q.actual.length&&sim(q.name,e.name)>=0.75);return x&&bwOnly(x.actual)===bwOnly(a)?[best(x.actual)]:[];});
  const pr=a.length&&prior.length&&e1>Math.max(...prior)+0.5;
  // next-session target: all planned sets hit -> add weight; mostly missed -> hold or back off
  let next=null;
  if(a.length){const inc=lower(e.name)?10:5,base=p.length?p:a;
   if(p.length&&hit===p.length)next={why:`All ${p.length} sets hit, add ${inc} lb`,sets:base.map(s=>({w:s.w?s.w+inc:s.w,r:s.r}))};
   else if(p.length&&adherence<0.8)next={why:'Missed reps, keep the weight and own it',sets:p.map(s=>({...s}))};
   else if(!p.length&&prev&&d!=null&&d>=0)next={why:`Beat last time, try +${inc} lb`,sets:a.map(s=>({w:s.w?s.w+inc:s.w,r:s.r}))};}
  return {unit:unit(a),bw:bwOnly(a),name:e.name,planned:p,actual:a,skipped:!a.length&&p.length>0,hit,adherence,e1,pe1,delta:d,verdict:a.length?verdict(d):null,pr,volume:vol(a),prevVolume:prev?vol(prev.ex.actual):null,top:top(a),next,muscle:muscle(e.name)};
 });
}
function summary(sess){
 const R=analyze(sess),done=R.filter(r=>r.actual.length);
 const parts=done.map(r=>`${r.name} ${r.verdict.k==='new'?'logged':r.verdict.k==='up'?`up ${Math.round(r.delta*100)}%`:r.verdict.k==='down'?`down ${Math.abs(Math.round(r.delta*100))}%`:'holding steady'}${r.pr?', new personal record':''}`);
 const sk=R.filter(r=>r.skipped).map(r=>r.name);
 return `${sess.name} saved. ${parts.join('. ')}${parts.length?'.':''}${sk.length?` Skipped ${sk.join(', ')}.`:''} Total volume ${lb(R.reduce((a,r)=>a+r.volume,0))} pounds.`;
}
function saveSession(sess){
 F().sessions.push(sess);
 if(window.Fitness)window.Fitness.add({personId:sess.personId,date:sess.date,kind:'workout',activity:'strength',minutes:sess.minutes||null,note:sess.name});
 try{log('strength_session',null,sess.name);}catch(_){}
 return summary(sess);
}
function applyNext(planId,sess){const p=F().plans.find(x=>x.id===planId);if(!p)return 0;let n=0;for(const r of analyze(sess)){const pe=p.exercises.find(x=>sim(x.name,r.name)>=0.75);if(pe&&r.next){pe.sets=r.next.sets.map(s=>({...s}));n++;}}return n;}
window.Strength={parseSets,plans,sessions,findPlan,matchPlan,createPlan,buildSession,analyze,summary,saveSession,key,sim,muscle};

// ---- view -------------------------------------------------------------
let sel=null,editing=null,draftText='',draftDays=[],active=null,result=null,openEx=null,showLib=false;
// ---- Program library ---------------------------------------------------
// Weights are set from each person's 1-rep maxes (B bench, S squat, D deadlift,
// P overhead press), rounded to 5 lb. Double progression: when every set hits
// its reps, the app suggests adding weight next time.
const MAXES=[['B','Bench press','bench'],['S','Back squat','back squat'],['D','Deadlift','deadlift'],['P','Overhead press','overhead press']];
const X=(name,sets,reps,pct,of,bw)=>({name,sets,reps,pct,of,bw});
const PY=(name,of,scheme)=>({name,of,scheme,sets:scheme.length,reps:scheme[0][1]}); // pyramid: heavier each set, fewer reps
const PROGRAMS=[
 {id:'bro7',name:'Body-part split · 7 days',tag:'One muscle group a day · pyramid sets',
  about:'Each muscle gets one hard day a week. Main lifts are pyramids: the weight goes up and the reps go down every set. Mon Chest, Tue Back, Wed Shoulders & Shrugs, Thu Legs, Fri Biceps, Sat Triceps & Abs, Sun Active Recovery (core plus 30–40 min of easy cardio). Rest 2–3 min on pyramid lifts and 60–90 s on the rest. Training 7 days straight is a lot, so keep Sunday easy, sleep well, and every 6th week go about 10% lighter.',
  plans:[
   {name:'Chest Day',days:[1],ex:[PY('Flat Bench Press','B',[[.60,12],[.70,10],[.77,8],[.82,6]]),X('Incline Bench Press',3,8,.62,'B'),X('Incline DB Press',3,10,.27,'B'),X('Weighted Dips',3,10,0,null,true),X('Cable Fly',3,15,.12,'B'),X('Push Ups',2,20,0,null,true)]},
   {name:'Back Day',days:[2],ex:[PY('Deadlift','D',[[.60,8],[.70,6],[.78,5],[.83,3]]),X('Pull Up',4,8,0,null,true),X('Barbell Row',4,8,.58,'B'),X('Lat Pulldown',3,10,.50,'B'),X('Seated Cable Row',3,12,.45,'B'),X('Straight Arm Pulldown',3,15,.18,'B')]},
   {name:'Shoulders & Shrugs',days:[3],ex:[PY('Overhead Press','P',[[.65,10],[.72,8],[.78,6],[.83,4]]),X('DB Shoulder Press',3,10,.30,'P'),X('Lateral Raise',4,15,.07,'B'),X('Rear Delt Fly',3,15,.06,'B'),X('Face Pull',3,15,.15,'B'),PY('Barbell Shrug','D',[[.45,15],[.55,12],[.62,10],[.68,8]]),X('DB Shrug',3,15,.20,'D')]},
   {name:'Leg Day',days:[4],ex:[PY('Back Squat','S',[[.60,10],[.70,8],[.77,6],[.82,5]]),X('Leg Press',4,12,1.20,'S'),X('Romanian Deadlift',3,10,.50,'D'),X('Walking Lunge DB',3,12,.12,'S'),X('Leg Extension',3,15,.28,'S'),X('Lying Leg Curl',3,12,.22,'S'),X('Standing Calf Raise',4,15,.40,'S')]},
   {name:'Biceps Day',days:[5],ex:[PY('Barbell Curl','B',[[.20,12],[.23,10],[.26,8],[.28,6]]),X('Incline DB Curl',3,10,.09,'B'),X('Preacher Curl',3,10,.20,'B'),X('Hammer Curl',3,12,.11,'B'),X('Cable Curl',3,15,.15,'B'),X('Reverse Curl',3,15,.13,'B')]},
   {name:'Triceps & Abs',days:[6],ex:[PY('Close Grip Bench','B',[[.55,12],[.62,10],[.68,8],[.72,6]]),X('Skull Crusher',3,10,.25,'B'),X('Tricep Pushdown',3,12,.24,'B'),X('Overhead Cable Extension',3,12,.20,'B'),X('Bench Dips',3,15,0,null,true),X('Hanging Leg Raise',3,15,0,null,true),X('Cable Crunch',3,15,.25,'S')]},
   {name:'Active Recovery',days:[0],ex:[X('Plank (seconds)',3,60,0,null,true),X('Side Plank (seconds)',2,45,0,null,true),X('Ab Wheel',3,12,0,null,true),X('Back Extension',3,15,0,null,true)]}]},
 {id:'ul4',name:'Upper / Lower · 4 days',tag:'Strength + size · intermediate',
  about:'Two heavy days for strength (low reps) and two volume days for muscle (higher reps). Mon Upper A, Tue Lower A, Thu Upper B, Fri Lower B. Rest at least 2–3 min on main lifts and 60–90 s on the rest. Every 6th week, do the same workouts about 10% lighter to recover.',
  plans:[
   {name:'Upper A (Heavy)',days:[1],ex:[X('Bench Press',4,5,.80,'B'),X('Barbell Row',4,6,.62,'B'),X('Overhead Press',3,6,.75,'P'),X('Lat Pulldown',3,8,.50,'B'),X('Barbell Curl',3,10,.25,'B'),X('Tricep Pushdown',3,12,.24,'B')]},
   {name:'Lower A (Heavy)',days:[2],ex:[X('Back Squat',4,5,.80,'S'),X('Romanian Deadlift',3,8,.55,'D'),X('Leg Press',3,10,1.30,'S'),X('Lying Leg Curl',3,12,.22,'S'),X('Standing Calf Raise',4,12,.45,'S'),X('Hanging Leg Raise',3,12,0,null,true)]},
   {name:'Upper B (Volume)',days:[4],ex:[X('Incline DB Press',4,10,.28,'B'),X('Seated Cable Row',4,10,.50,'B'),X('DB Shoulder Press',3,10,.30,'P'),X('Pull Up',3,8,0,null,true),X('Lateral Raise',3,15,.07,'B'),X('Dips',3,12,0,null,true),X('Hammer Curl',3,12,.12,'B')]},
   {name:'Lower B (Volume)',days:[5],ex:[X('Deadlift',3,5,.80,'D'),X('Bulgarian Split Squat DB',3,8,.14,'S'),X('Hip Thrust',3,10,.70,'S'),X('Leg Extension',3,12,.30,'S'),X('Seated Calf Raise',3,15,.30,'S'),X('Cable Crunch',3,15,.25,'S')]}]},
 {id:'fb3',name:'Full Body · 3 days',tag:'Beginner friendly · great for getting started',
  about:'Every major muscle three times a week with moderate weights and clean form. Alternate A and B on Mon, Wed and Fri (A/B/A one week, B/A/B the next). Start lighter than you think. Adding a little weight every week is the goal.',
  plans:[
   {name:'Full Body A',days:[1,5],ex:[X('Back Squat',3,8,.65,'S'),X('Bench Press',3,8,.65,'B'),X('Barbell Row',3,10,.50,'B'),X('DB Shoulder Press',2,12,.22,'P'),X('Plank (seconds)',3,45,0,null,true)]},
   {name:'Full Body B',days:[3],ex:[X('Deadlift',3,5,.70,'D'),X('Overhead Press',3,8,.65,'P'),X('Lat Pulldown',3,10,.45,'B'),X('Goblet Squat',3,12,.15,'S'),X('Hammer Curl',2,12,.10,'B')]}]}];
const r5=v=>Math.max(5,Math.round(v/5)*5);
function guessMaxes(pid){const out={};for(const [k,,n] of MAXES){const h=historyFor(pid,n).filter(x=>!x.bw);if(h.length)out[k]=Math.round(Math.max(...h.slice(-6).map(x=>x.e1)));}return out;}
function installProgram(pid,prog,maxes){
 const names=new Set(prog.plans.map(p=>p.name.toLowerCase()));
 F().plans=F().plans.filter(p=>!(p.personId===pid&&names.has(p.name.toLowerCase())));
 for(const pl of prog.plans)createPlan({personId:pid,name:pl.name,days:pl.days,exercises:pl.ex.map(e=>({name:e.name,sets:e.scheme?e.scheme.map(([pc,r])=>({w:r5(pc*maxes[e.of]),r})):[...Array(e.sets)].map(()=>({w:e.bw?0:r5(e.pct*maxes[e.of]),r:e.reps}))}))});
 return prog.plans.length;
}
window.Strength.PROGRAMS=PROGRAMS;window.Strength.installProgram=installProgram;
function libraryHtml(pid){
 const g=guessMaxes(pid);
 return `<div class="panel" id="st-lib"><div class="header"><h2>📋 Program library</h2><button class="btn alt sm" data-st="lib">Close</button></div>
  <p class="hint" style="margin:0 0 6px">Enter your best single-rep weights (1-rep max). Don’t know one? Take a weight you can lift for 5 clean reps and multiply by 1.15. ${Object.keys(g).length?'Some are filled in from your logged workouts.':''}</p>
  <div class="two">${MAXES.map(([k,l])=>`<div><label>${l} 1RM (lb)</label><input id="stMax${k}" inputmode="numeric" value="${g[k]||''}" placeholder="e.g. ${({B:225,S:275,D:315,P:135})[k]}"></div>`).join('')}</div>
  ${PROGRAMS.map(pr=>`<div class="st-plan" style="margin-top:10px"><div class="t"><b>${pr.name}</b></div><div class="x2"><b style="color:#9fd9ec">${pr.tag}</b><br>${pr.about}</div>
   <div class="x2" style="margin-top:6px">${pr.plans.map(pl=>`<b style="color:${C.ink}">${pl.name}</b> · ${pl.days.map(d=>DOWN[d]).join(', ')}<br>${pl.ex.map(e=>e.scheme?`${e.name} ${e.sets} sets ${e.scheme.map(x=>x[1]).join('→')}`:`${e.name} ${e.sets}×${e.reps}`).join(' · ')}`).join('<br>')}</div>
   <button class="btn sm" style="margin-top:8px" data-st="install" data-id="${pr.id}">Install for ${esc((window.Fitness.people().find(p=>p.id===pid)||{}).name||'me')}</button></div>`).join('')}</div>`;
}
const section=document.createElement('section');section.id='strength';section.className='view hidden';
const settings=document.getElementById('settings');settings.parentNode.insertBefore(section,settings);
const tabs=document.getElementById('tabs'),tab=document.createElement('button');tab.className='tab';tab.dataset.view='strength';tab.textContent='Strength';
tabs.insertBefore(tab,tabs.querySelector('[data-view="reviews"]'));
const css=document.createElement('style');css.textContent=`
.st-hero{font-size:44px;font-weight:800;letter-spacing:-.03em;line-height:1.05;margin:4px 0}.st-sub{font-size:13px;color:${C.ink2}}
.st-tiles{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:14px}.st-tile{background:#0e1826;border:1px solid #1c2e44;border-radius:14px;padding:12px}.st-tile .l{font-size:11.5px;color:${C.ink3}}.st-tile .v{font-size:22px;font-weight:750;margin-top:3px}.st-tile .d{font-size:11.5px;color:${C.ink2};margin-top:2px}
.st-up{color:${C.good}}.st-down{color:${C.bad}}.st-hold{color:${C.ink2}}.st-new{color:#9fd9ec}
.st-ex{background:#0e1826;border:1px solid #1c2e44;border-radius:14px;padding:12px;margin-top:10px;cursor:pointer}.st-ex .h{display:flex;align-items:center;gap:10px}.st-ex .h .n{flex:1;font-weight:700}.st-ex .big{font-size:20px;font-weight:750}.st-ex .s{font-size:11.5px;color:${C.ink3}}
.st-badge{font-size:11px;font-weight:700;padding:3px 8px;border-radius:20px;border:1px solid #2b4a63;white-space:nowrap}.st-badge.up{border-color:#1f6b52}.st-badge.down{border-color:#7a2d4b}.st-pr{font-size:11px;font-weight:800;padding:3px 8px;border-radius:20px;background:linear-gradient(135deg,#f5c84b,#ff9a5a);color:#1a1205}
.st-tick{font-size:10px;fill:${C.ink3};font-variant-numeric:tabular-nums}.st-val{font-size:11px;font-weight:700;fill:${C.ink}}
.st-tip{position:absolute;pointer-events:none;opacity:0;background:#06101aee;border:1px solid #2b4a63;border-radius:10px;padding:7px 10px;font-size:12px;color:${C.ink};white-space:nowrap;z-index:4}
.st-plan{padding:11px 0;border-bottom:1px solid ${C.grid}}.st-plan:last-child{border:0}.st-plan .t{display:flex;gap:8px;align-items:center}.st-plan .t b{flex:1;font-size:15px}.st-plan .x2{font-size:12px;color:${C.ink3};margin-top:4px;line-height:1.5}
.st-days{display:flex;gap:6px;margin-top:8px}.st-days button{width:36px;height:36px;border-radius:50%;border:1px solid #24394f;background:#0e1624;color:${C.ink2};font-weight:700}.st-days button.on{background:#0f3149;border-color:#46d9f5;color:#fff}
.st-prev{margin-top:10px;font-size:12.5px}.st-prev .e{padding:6px 0;border-bottom:1px solid ${C.grid}}.st-prev .e:last-child{border:0}
.st-set{display:grid;grid-template-columns:28px 1fr 1fr 58px 40px;gap:6px;align-items:center;margin-top:6px}.st-set input{padding:9px 8px;text-align:center}.st-set .p{font-size:11px;color:${C.ink3};text-align:center}.st-set .i{font-size:12px;color:${C.ink3}}
.st-done{height:38px;border-radius:10px;border:1px solid #2b4a63;background:#0b131f;color:#fff;font-size:18px;font-weight:800}.st-done.on{background:#1f6b52;border-color:#3fd16b}
.st-plates{font-size:11px;color:#7f93a8;margin:2px 0 0 34px}
#restBar{position:fixed;left:50%;transform:translateX(-50%);bottom:calc(84px + env(safe-area-inset-bottom));z-index:30;background:linear-gradient(135deg,#0f3149,#14304a);border:1px solid #46d9f5;border-radius:16px;padding:10px 12px;display:flex;align-items:center;gap:10px;box-shadow:0 10px 30px #0008;color:#fff;width:min(94vw,420px)}#restBar[hidden]{display:none}#restBar .t{font-size:24px;font-weight:800;font-variant-numeric:tabular-nums;flex:1}#restBar button{border:1px solid #2b4a63;background:#0b131f;color:#fff;border-radius:10px;padding:7px 10px;font-weight:700}
.st-block{padding:10px 0;border-bottom:1px solid ${C.grid}}.st-block:last-child{border:0}.st-block h3{margin:0;font-size:14.5px;display:flex;justify-content:space-between}
.st-res{padding:10px 0;border-bottom:1px solid ${C.grid}}.st-res:last-child{border:0}.st-res .h{display:flex;gap:8px;align-items:center}.st-res .h b{flex:1}.st-res .m{font-size:12px;color:${C.ink2};margin-top:4px;line-height:1.5}
.st-bars .r{padding:6px 0}.st-bars .top{display:flex;justify-content:space-between;font-size:13px}.st-bars .tr{position:relative;height:8px;margin-top:5px;background:#14263a;border-radius:4px}.st-bars .tr i{position:absolute;left:0;top:0;height:8px;border-radius:4px;background:${C.s1}}.st-bars .tr u{position:absolute;top:-3px;width:2px;height:14px;background:${C.ink2}}`;
document.head.appendChild(css);
const fmtSets=sets=>{const g=[];for(const s of sets){const t=`${s.w==null?'?':s.w===0?'BW':s.w}×${s.r}`;const last=g.at(-1);if(last&&last.t===t)last.n++;else g.push({t,n:1});}return g.map(x=>x.n>1?`${x.t} ×${x.n}`:x.t).join(', ');};
const toText=p=>p.exercises.map(e=>`${e.name}: ${e.sets.map(s=>`${s.w===0?'bw':s.w??''}${s.w==null?'':'x'}${s.r}`).join(', ')}`).join('\n');
function spark(vals,W=96,H=28){if(vals.length<2)return '';const mn=Math.min(...vals),mx=Math.max(...vals),r=mx-mn||1;const x=i=>2+i/(vals.length-1)*(W-6),y=v=>H-3-(v-mn)/r*(H-8);return `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" aria-hidden="true"><path d="${vals.map((v,i)=>`${i?'L':'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('')}" fill="none" stroke="${C.s1}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/><circle cx="${x(vals.length-1)}" cy="${y(vals.at(-1))}" r="3.5" fill="${C.s1}" stroke="${C.surface}" stroke-width="2"/></svg>`;}
function nice(min,max,n=4){const span=Math.max(1,max-min),raw=span/n,mag=Math.pow(10,Math.floor(Math.log10(raw))),q=raw/mag,step=(q<=1?1:q<=2?2:q<=2.5?2.5:q<=5?5:10)*mag;return {lo:Math.floor(min/step)*step,hi:Math.ceil(max/step)*step,step};}
const tk=v=>v>=10000?Math.round(v/1000)+'K':v>=1000?(v/1000).toFixed(1).replace(/\.0$/,'')+'K':Math.round(v);
function columns(vals,labels,W,tipFn){const H=140,L=34,R=6,T=16,B=20,pw=W-L-R,ph=H-T-B,{hi,step}=nice(0,Math.max(1,...vals),3),band=pw/vals.length,bw=Math.min(22,band-10),y=v=>T+ph-v/hi*ph;
 let s='';for(let v=0;v<=hi+1e-9;v+=step)s+=`<line x1="${L}" x2="${W-R}" y1="${y(v)}" y2="${y(v)}" stroke="${v?C.grid:C.axis}"/><text x="${L-5}" y="${y(v)+3.5}" text-anchor="end" class="st-tick">${tk(v)}</text>`;
 vals.forEach((v,i)=>{const cx=L+band*i+band/2,h=T+ph-y(v),r=Math.min(4,h,bw/2),isNow=i===vals.length-1;
  if(h>0)s+=`<path d="M${cx-bw/2},${T+ph}V${y(v)+r}Q${cx-bw/2},${y(v)} ${cx-bw/2+r},${y(v)}H${cx+bw/2-r}Q${cx+bw/2},${y(v)} ${cx+bw/2},${y(v)+r}V${T+ph}Z" fill="${C.s1}" fill-opacity="${isNow?1:.6}"/>`;
  if(isNow&&v)s+=`<text x="${cx}" y="${y(v)-5}" text-anchor="middle" class="st-val">${tk(v)}</text>`;
  if(i%2===1||isNow)s+=`<text x="${cx}" y="${H-5}" text-anchor="middle" class="st-tick">${labels[i]}</text>`;
  s+=`<rect x="${L+band*i}" y="${T}" width="${band}" height="${ph+B}" fill="transparent" data-tip="${esc(tipFn(i))}"/>`;});
 return `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" role="img" aria-label="Weekly training volume">${s}</svg>`;}
function lineChart(hist,W){const H=150,L=38,R=40,T=14,B=20,pw=W-L-R,ph=H-T-B,vals=hist.map(h=>h.e1),{lo,hi,step}=nice(Math.min(...vals)*0.97,Math.max(...vals)*1.02,3);
 const x=i=>L+(hist.length<2?pw/2:i/(hist.length-1)*pw),y=v=>T+ph-(v-lo)/(hi-lo||1)*ph;let s='';
 for(let v=lo;v<=hi+1e-9;v+=step)s+=`<line x1="${L}" x2="${W-R}" y1="${y(v)}" y2="${y(v)}" stroke="${v===lo?C.axis:C.grid}"/><text x="${L-5}" y="${y(v)+3.5}" text-anchor="end" class="st-tick">${Math.round(v)}</text>`;
 s+=`<text x="${L}" y="${H-5}" class="st-tick">${short(hist[0].date)}</text><text x="${W-R}" y="${H-5}" text-anchor="end" class="st-tick">${short(hist.at(-1).date)}</text>`;
 s+=`<path d="${hist.map((h,i)=>`${i?'L':'M'}${x(i).toFixed(1)},${y(h.e1).toFixed(1)}`).join('')}" fill="none" stroke="${C.s1}" stroke-width="2" stroke-linejoin="round"/>`;
 hist.forEach((h,i)=>{s+=`<circle cx="${x(i)}" cy="${y(h.e1)}" r="${i===hist.length-1?4:3}" fill="${C.s1}" stroke="${C.surface}" stroke-width="2"/><circle cx="${x(i)}" cy="${y(h.e1)}" r="13" fill="transparent" data-tip="${short(h.date)}: est. 1RM ${lb(h.e1)} · top ${h.top.w}×${h.top.r} · vol ${lb(h.vol)}"/>`;});
 s+=`<text x="${x(hist.length-1)+8}" y="${y(vals.at(-1))+4}" class="st-val">${lb(vals.at(-1))}</text>`;
 return `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" role="img" aria-label="Estimated one-rep max over time">${s}</svg>`;}
function weekStart(d){const x=pd(d);x.setDate(x.getDate()-x.getDay());return day(x);}
function dashboard(pid,W){
 const S=sessions(pid),today=day(),ws=weekStart(today);
 if(!S.length)return `<div class="panel"><h2>Strength dashboard</h2><div class="empty">Log your first workout to light this up: weekly volume, progress per lift, PRs and muscle balance.</div></div>`;
 const weeks=[...Array(8)].map((_,i)=>{const d=pd(ws);d.setDate(d.getDate()-7*(7-i));return day(d);});
 const wVol=weeks.map(w=>S.filter(s=>weekStart(s.date)===w).reduce((a,s)=>a+s.exercises.reduce((x,e)=>x+vol(e.actual),0),0));
 const thisW=wVol[7],lastW=wVol[6],dW=lastW?thisW/lastW-1:null;
 const sessW=S.filter(s=>weekStart(s.date)===ws).length,planned=plans(pid).reduce((a,p)=>a+(p.days||[]).length,0);
 const last30=S.filter(s=>s.date>=day(new Date(pd(today)-30*864e5)));
 const adh=last30.flatMap(s=>analyze(s).filter(r=>r.adherence!=null));const adhPct=adh.length?adh.reduce((a,r)=>a+r.adherence,0)/adh.length:null;
 const month=today.slice(0,7);let prs=0;for(const s of S.filter(s=>s.date.slice(0,7)===month))prs+=analyze(s).filter(r=>r.pr).length;
 // per-lift trend: latest vs previous session of that lift
 const names=[];for(const s of S)for(const e of s.exercises)if(e.actual.length&&!names.some(n=>sim(n,e.name)>=0.75))names.push(e.name);
 const lifts=names.map(n=>{const h=historyFor(pid,n);const last=h.at(-1),prev=h.at(-2),d=prev&&prev.e1&&prev.bw===last.bw?last.e1/prev.e1-1:null;return {n,h,last,d,v:verdict(d),pr:h.length>1&&last.e1>Math.max(...h.slice(0,-1).map(x=>x.e1))+0.5,freq:h.length};}).sort((a,b)=>b.last.date.localeCompare(a.last.date)||b.freq-a.freq);
 const up=lifts.filter(l=>l.v.k==='up').length,down=lifts.filter(l=>l.v.k==='down').length;
 // sets per muscle group: this week vs 4-week average
 const mus={};const add=(m,k,n)=>{(mus[m]=mus[m]||{now:0,avg:0})[k]+=n;};
 for(const s of S){const w=weekStart(s.date);for(const e of s.exercises){if(!e.actual.length)continue;const m=muscle(e.name);if(w===ws)add(m,'now',e.actual.length);else if(weeks.slice(3,7).includes(w))add(m,'avg',e.actual.length/4);}}
 const musRows=Object.entries(mus).sort((a,b)=>b[1].now-a[1].now||b[1].avg-a[1].avg);const mMax=Math.max(1,...musRows.map(([,v])=>Math.max(v.now,v.avg)));
 return `<div class="panel"><div class="muted small">Training volume · this week</div><div class="st-hero">${lb(thisW)} <span style="font-size:18px;color:${C.ink3};font-weight:700">lb</span></div>
  <div class="st-sub">${dW==null?'Total weight × reps lifted this week':`<span class="${dW>=0?'st-up':'st-down'}">${dW>=0?'▲':'▼'} ${Math.abs(Math.round(dW*100))}%</span> vs last week (${lb(lastW)} lb)`}</div>
  <div class="st-tiles">
   <div class="st-tile"><div class="l">Workouts this week</div><div class="v">${sessW}${planned?` <span style="font-size:13px;color:${C.ink3}">/ ${planned} planned</span>`:''}</div><div class="d">${S.length} logged in total</div></div>
   <div class="st-tile"><div class="l">Plan completion · 30 days</div><div class="v">${adhPct==null?'—':Math.round(adhPct*100)+'%'}</div><div class="d">reps done vs planned</div></div>
   <div class="st-tile"><div class="l">Personal records · ${pd(today).toLocaleDateString(undefined,{month:'long'})}</div><div class="v">${prs?'🏆 '+prs:'0'}</div><div class="d">by estimated 1-rep max</div></div>
   <div class="st-tile"><div class="l">Lift trends</div><div class="v"><span class="st-up">▲${up}</span> <span class="st-down">▼${down}</span></div><div class="d">${lifts.length} lifts vs their last session</div></div>
  </div></div>
 <div class="panel" style="position:relative"><h2>Weekly volume</h2><p class="hint" style="margin:0 0 6px">Total lb lifted per week (weight × reps), last 8 weeks</p>${columns(wVol,weeks.map((w,i)=>i===7?'This wk':pd(w).toLocaleDateString(undefined,{month:'numeric',day:'numeric'})),W,i=>`Week of ${short(weeks[i])}: ${lb(wVol[i])} lb`)}</div>
 <div class="panel" style="position:relative"><h2>Lifts</h2><p class="hint" style="margin:0">Estimated 1-rep max (total reps for bodyweight moves), latest vs previous session. Tap a lift for its full history.</p>
  ${lifts.slice(0,10).map(l=>`<div class="st-ex" data-st="ex" data-n="${esc(l.n)}"><div class="h"><span class="n">${esc(l.n)}</span>${l.pr?'<span class="st-pr">🏆 PR</span>':''}<span class="st-badge ${l.v.k} st-${l.v.k}">${l.v.i} ${l.v.t}${l.d!=null?' '+(l.d>=0?'+':'−')+Math.abs(Math.round(l.d*1000)/10)+'%':''}</span></div>
   <div class="h" style="margin-top:6px"><span><span class="big">${lb(l.last.e1)}</span> <span class="s">${l.last.bw?`total reps · best set ${l.last.top.r}`:`lb est. 1RM · top set ${l.last.top.w}×${l.last.top.r}`} · ${short(l.last.date)}</span></span>${spark(l.h.slice(-8).map(x=>x.e1))}</div>
   ${openEx===l.n&&l.h.length>=2?`<div style="margin-top:8px">${lineChart(l.h.slice(-16),W-26)}</div><table class="dz-table"><thead><tr><th>Date</th><th>Top set</th><th>Est. 1RM</th><th>Volume</th></tr></thead><tbody>${l.h.slice(-8).reverse().map(h=>`<tr><td>${short(h.date)}</td><td>${h.top.w}×${h.top.r}</td><td>${lb(h.e1)}</td><td>${lb(h.vol)}</td></tr>`).join('')}</tbody></table>`:''}</div>`).join('')}</div>
 ${musRows.length?`<div class="panel"><h2>Muscle balance</h2><p class="hint" style="margin:0 0 4px">Working sets this week · tick = your 4-week average</p><div class="st-bars">${musRows.map(([m,v])=>`<div class="r"><div class="top"><span>${m}</span><span style="font-variant-numeric:tabular-nums">${v.now} set${v.now===1?'':'s'}</span></div><div class="tr"><i style="width:${v.now/mMax*100}%"></i>${v.avg?`<u style="left:${v.avg/mMax*100}%"></u>`:''}</div></div>`).join('')}</div></div>`:''}`;
}
function planEditor(pid){
 const parsed=parseSets(draftText);
 return `<div class="panel" id="st-editor"><h2>${editing==='new'?'New workout plan':'Edit plan'}</h2>
  <label>Plan name</label><input id="stName" maxlength="40" placeholder="Chest day" value="${esc(editing&&editing!=='new'?(F().plans.find(p=>p.id===editing)||{}).name||'':'')}">
  <label>Days (optional)</label><div class="st-days">${DOW.map((d,i)=>`<button type="button" class="${draftDays.includes(i)?'on':''}" data-st="day" data-v="${i}" aria-label="${DOWN[i]}">${d}</button>`).join('')}</div>
  <label>Exercises: one per line, type it the way you'd say it</label>
  <textarea id="stText" rows="5" placeholder="Flat bench 225 for 15, 315 for 10, 405 for 8&#10;Incline DB 80 3 sets of 12&#10;Cable fly 50 x 15 x3&#10;Dips bodyweight 3 sets of 12">${esc(draftText)}</textarea>
  <div class="st-prev" id="stPrev">${parsed.length?parsed.map(e=>`<div class="e"><b>${esc(e.name)}</b> · ${e.sets.length} set${e.sets.length===1?'':'s'}: ${fmtSets(e.sets)}</div>`).join(''):'<span class="hint">Preview appears as you type.</span>'}</div>
  <div class="actions" style="margin-top:12px"><button class="btn" data-st="saveplan">Save plan</button><button class="btn alt" data-st="cancel">Cancel</button></div></div>`;
}
const isBarbell=n=>{const k=String(n).toLowerCase();return !/(dumbbell|\bdb\b|cable|machine|smith|kettlebell|band|ez)/.test(k)&&/(bench|squat|deadlift|overhead press|military|barbell|row|close grip|shrug|hip thrust|rdl|romanian|good morning)/.test(k);};
// plates per side for a 45 lb bar
function plates(w,bar=45){let side=(w-bar)/2;if(side<=0)return 'just the bar';const out=[];for(const p of [45,35,25,10,5,2.5]){while(side>=p-1e-9){out.push(p);side-=p;}}return 'per side: '+out.join(' + ')+(side>0.01?` (+${side.toFixed(1)} short)`:'');}
// rest timer: starts when a set is ticked, buzzes at zero
const restBar=document.createElement('div');restBar.id='restBar';restBar.hidden=true;restBar.setAttribute('role','timer');document.body.appendChild(restBar);
let restEnd=0,restIv=null;
function restFor(reps){return reps<=6?150:reps<=10?90:60;}
function startRest(sec){restEnd=Date.now()+sec*1000;restBar.hidden=false;clearInterval(restIv);drawRest();restIv=setInterval(drawRest,250);}
function stopRest(){clearInterval(restIv);restBar.hidden=true;restEnd=0;}
function drawRest(){const left=Math.max(0,Math.round((restEnd-Date.now())/1000));
 restBar.innerHTML=`<span style="font-size:13px;color:#9fd9ec">Rest</span><span class="t">${Math.floor(left/60)}:${String(left%60).padStart(2,'0')}</span><button data-rest="-30">−30</button><button data-rest="30">+30</button><button data-rest="skip">Skip</button>`;
 if(left<=0){stopRest();try{navigator.vibrate&&navigator.vibrate([250,120,250]);}catch(_){}toast('Rest over: next set! 💪');}}
restBar.addEventListener('click',e=>{const b=e.target.closest('[data-rest]');if(!b)return;const v=b.dataset.rest;if(v==='skip')return stopRest();restEnd=Math.max(Date.now()+5000,restEnd+(+v)*1000);drawRest();});
window.Strength=Object.assign(window.Strength||{},{plates,isBarbell,restFor});
function sessionEditor(){
 const s=active;return `<div class="panel" id="st-session"><div class="header"><h2>🏋️ ${esc(s.name)}</h2><span class="muted small">${short(s.date)}</span></div>
  <p class="hint" style="margin:0 0 6px">Planned sets are filled in. Change what was different, then Finish. Or just say it: “Vector, open Family Save, I did ${esc(s.name.toLowerCase())}: ${esc(s.exercises[0]?.name.toLowerCase()||'bench')} 225 for 10, 315 for 8…”</p>
  ${s.exercises.map((e,ei)=>`<div class="st-block"><h3><span>${esc(e.name)}</span><button class="x" data-st="rmex" data-i="${ei}" aria-label="Remove exercise">✕</button></h3>
   <div class="st-set" style="margin-top:4px"><span class="i"></span><span class="p">lb</span><span class="p">reps</span><span class="p">planned</span><span class="p">done</span></div>
   ${e.actual.map((a,si)=>`<div class="st-set"><span class="i">#${si+1}</span><input inputmode="decimal" data-st="w" data-e="${ei}" data-s="${si}" value="${a.w??''}" aria-label="Set ${si+1} weight"><input inputmode="numeric" data-st="r" data-e="${ei}" data-s="${si}" value="${a.r??''}" aria-label="Set ${si+1} reps"><span class="p">${e.planned[si]?`${e.planned[si].w??'?'}×${e.planned[si].r}`:'extra'}</span><button class="st-done${a.done?' on':''}" data-st="done" data-e="${ei}" data-s="${si}" aria-label="Set ${si+1} done">${a.done?'✓':''}</button></div>${isBarbell(e.name)&&a.w>=45?`<div class="st-plates">${plates(a.w)}</div>`:''}`).join('')}
   <div class="actions" style="margin-top:8px"><button class="btn alt sm" data-st="addset" data-e="${ei}">+ Set</button>${e.actual.length?`<button class="btn alt sm" data-st="rmset" data-e="${ei}">− Set</button>`:''}</div></div>`).join('')}
  <label>Add an exercise</label><input id="stAddEx" placeholder="e.g. Tricep pushdown 60 3 sets of 12">
  <div class="two"><div><label>Duration (min, optional)</label><input id="stMin" inputmode="numeric" value="${s.minutes||''}"></div><div></div></div>
  <div class="actions" style="margin-top:12px"><button class="btn" data-st="finish">Finish & save</button><button class="btn alt" data-st="discard">Discard</button></div></div>`;
}
function resultCard(){
 const {sess,R,text}=result;return `<div class="panel" id="st-result"><h2>✅ ${esc(sess.name)} saved</h2><p class="hint" style="margin:0 0 4px">${esc(text)}</p>
  ${R.map(r=>`<div class="st-res"><div class="h"><b>${esc(r.name)}</b>${r.pr?'<span class="st-pr">🏆 PR</span>':''}${r.verdict?`<span class="st-badge ${r.verdict.k} st-${r.verdict.k}">${r.verdict.i} ${r.verdict.t}</span>`:'<span class="st-badge st-down">Skipped</span>'}</div>
   <div class="m">${r.actual.length?`Did ${fmtSets(r.actual)}`:'Not done'}${r.planned.length?` · planned ${fmtSets(r.planned)}`:''}<br>${r.hit!=null?`${r.hit}/${r.planned.length} sets hit · ${Math.round(r.adherence*100)}% of planned reps · `:''}${r.actual.length?(r.bw?`${lb(r.e1)} total reps${r.pe1?` (was ${lb(r.pe1)})`:''}`:`est. 1RM ${lb(r.e1)}${r.pe1?` (was ${lb(r.pe1)})`:''} · volume ${lb(r.volume)}${r.prevVolume?` (was ${lb(r.prevVolume)})`:''}`):''}
   ${r.next?`<br><b style="color:#9fd9ec">Next time:</b> ${fmtSets(r.next.sets)} <span style="color:${C.ink3}">· ${esc(r.next.why)}</span>`:''}</div></div>`).join('')}
  <div class="actions" style="margin-top:12px">${sess.planId&&R.some(r=>r.next)?'<button class="btn" data-st="applynext">Update plan with next targets</button>':''}<button class="btn alt" data-st="closeres">Done</button></div></div>`;
}
function render2(){
 if(!window.Fitness)return;const people=window.Fitness.people();if(!sel||!people.some(p=>p.id===sel))sel=people[0].id;
 const W=Math.max(280,(section.clientWidth||360)-36),P=plans(sel),todayDow=new Date().getDay();
 const todays=P.filter(p=>(p.days||[]).includes(todayDow));
 section.innerHTML=`<div class="panel"><div class="ft-chips">${people.map(p=>`<button class="ft-chip${p.id===sel?' on':''}" data-st="who" data-id="${p.id}">${esc(p.name)}</button>`).join('')}</div>
  ${!active?`<div style="margin-top:12px">${todays.length?todays.map(p=>`<div class="notice" style="margin:0 0 8px;display:flex;align-items:center;gap:10px"><span style="flex:1">📅 <b>${esc(p.name)}</b> is planned for today</span><button class="btn sm" data-st="start" data-id="${p.id}">Start</button></div>`).join(''):''}
   <div class="actions"><select id="stPick" style="flex:1;min-width:0">${P.map(p=>`<option value="${p.id}">${esc(p.name)}</option>`).join('')}<option value="">Empty workout</option></select><button class="btn" data-st="startpick">Start workout</button></div></div>`:''}</div>
  ${result?resultCard():''}${active?sessionEditor():''}
  ${showLib?libraryHtml(sel):''}
  ${editing?planEditor(sel):`<div class="panel"><div class="header"><h2>Workout plans</h2><div class="actions"><button class="btn alt sm" data-st="lib">📋 Programs</button><button class="btn sm" data-st="newplan">+ Plan</button></div></div>
   ${P.length?P.map(p=>`<div class="st-plan"><div class="t"><b>${esc(p.name)}</b>${(p.days||[]).length?`<span class="muted small">${p.days.map(d=>DOWN[d]).join(' · ')}</span>`:''}</div><div class="x2">${p.exercises.map(e=>`${esc(e.name)} <span style="color:${C.ink2}">${fmtSets(e.sets)}</span>`).join('<br>')}</div>
    <div class="actions" style="margin-top:8px"><button class="btn sm" data-st="start" data-id="${p.id}">Start</button><button class="btn alt sm" data-st="edit" data-id="${p.id}">Edit</button><button class="x" data-st="delplan" data-id="${p.id}" aria-label="Delete plan">✕</button></div></div>`).join('')
   :'<div class="empty">No plans yet. Tap + Plan, or say “Vector, open Family Save, plan chest day: flat bench 225 for 15, 315 for 10, 405 for 8”.</div>'}</div>`}
  ${dashboard(sel,W)}
  <div class="panel"><h2>History</h2>${sessions(sel).slice(-10).reverse().map(s=>{const R=analyze(s);const v=R.reduce((a,r)=>a+r.volume,0);return `<div class="ft-row"><div class="g"><b>${esc(s.name)}</b> <span class="muted small">${short(s.date)}</span><div class="s">${R.filter(r=>r.actual.length).map(r=>`${esc(r.name)} ${r.verdict?r.verdict.i:''}`).join(' · ')} · ${lb(v)} lb</div></div><button class="x" data-st="delsess" data-id="${s.id}" aria-label="Delete workout">✕</button></div>`;}).join('')||'<div class="empty">No workouts logged yet.</div>'}</div>`;
 section.querySelectorAll('[data-tip]').forEach(el=>{const card=el.closest('.panel');const show=ev=>{ev.stopPropagation();let t=card.querySelector('.st-tip');if(!t){t=document.createElement('div');t.className='st-tip';card.appendChild(t);}t.textContent=el.dataset.tip;t.style.opacity=1;const r=el.getBoundingClientRect(),cr=card.getBoundingClientRect();t.style.left=Math.max(6,Math.min(cr.width-t.offsetWidth-6,r.left-cr.left+r.width/2-t.offsetWidth/2))+'px';t.style.top=(r.top-cr.top-t.offsetHeight-6)+'px';};
  el.addEventListener('pointerenter',show);el.addEventListener('click',show);el.addEventListener('pointerleave',()=>{const t=card.querySelector('.st-tip');if(t)t.style.opacity=0;});});
}
function startSession(plan){active=buildSession({personId:sel,plan,actual:[],name:'Workout'});for(const e of active.exercises)e.actual=e.planned.map(s=>({...s}));result=null;}
section.addEventListener('input',e=>{
 if(e.target.id==='stText'){draftText=e.target.value;const pv=document.getElementById('stPrev');const parsed=parseSets(draftText);pv.innerHTML=parsed.length?parsed.map(x=>`<div class="e"><b>${esc(x.name)}</b> · ${x.sets.length} set${x.sets.length===1?'':'s'}: ${fmtSets(x.sets)}</div>`).join(''):'<span class="hint">Preview appears as you type.</span>';}
 const t=e.target.dataset.st;if(active&&(t==='w'||t==='r')){const s=active.exercises[+e.target.dataset.e].actual[+e.target.dataset.s];const v=parseFloat(e.target.value);s[t]=isFinite(v)?v:null;}
});
section.addEventListener('click',e=>{
 const b=e.target.closest('[data-st]');if(!b||b.tagName==='INPUT')return;const a=b.dataset.st,f=F();
 if(a==='who'){sel=b.dataset.id;active=null;result=null;editing=null;}
 else if(a==='newplan'){editing='new';draftText='';draftDays=[];}
 else if(a==='lib'){showLib=!showLib;}
 else if(a==='install'){const pr=PROGRAMS.find(x=>x.id===b.dataset.id),mx={};
  for(const [k,l] of MAXES){const v=parseFloat(document.getElementById('stMax'+k).value);if(pr.plans.some(pl=>pl.ex.some(e=>e.of===k))&&!(v>0)){toast('Enter your '+l+' 1-rep max (or an estimate).');return;}mx[k]=v;}
  const clash=plans(sel).filter(p=>pr.plans.some(pl=>pl.name.toLowerCase()===p.name.toLowerCase()));
  if(clash.length&&!confirm(`Replace your existing ${clash.map(p=>p.name).join(', ')} plan${clash.length>1?'s':''}?`))return;
  const n=installProgram(sel,pr,mx);showLib=false;toast(`Installed ${n} workouts: ${pr.name}.`);}
 else if(a==='edit'){const p=f.plans.find(x=>x.id===b.dataset.id);editing=p.id;draftText=toText(p);draftDays=[...(p.days||[])];}
 else if(a==='day'){const v=+b.dataset.v;draftDays=draftDays.includes(v)?draftDays.filter(x=>x!==v):[...draftDays,v].sort();b.classList.toggle('on');return;}
 else if(a==='cancel'){editing=null;}
 else if(a==='saveplan'){const name=document.getElementById('stName').value.trim(),exs=parseSets(document.getElementById('stText').value);
  if(!name||!exs.length){toast('Give the plan a name and at least one exercise with sets.');return;}
  if(editing==='new')createPlan({personId:sel,name,days:draftDays,exercises:exs});else{const p=f.plans.find(x=>x.id===editing);p.name=name;p.days=draftDays;p.exercises=exs.map(x=>({id:uuid(),name:x.name,sets:x.sets}));}
  editing=null;toast('Plan saved.');}
 else if(a==='delplan'){if(!confirm('Delete this plan? Logged workouts stay.'))return;f.plans=f.plans.filter(p=>p.id!==b.dataset.id);}
 else if(a==='start'){startSession(f.plans.find(p=>p.id===b.dataset.id));}
 else if(a==='startpick'){const id=document.getElementById('stPick').value;startSession(id?f.plans.find(p=>p.id===id):null);}
 else if(a==='done'){const ex=active.exercises[+b.dataset.e],st=ex.actual[+b.dataset.s];st.done=!st.done;if(st.done){const more=ex.actual.some(x=>!x.done)||active.exercises.some(x=>x.actual.some(y=>!y.done));if(more)startRest(restFor(st.r||10));else{stopRest();toast('All sets done. Tap Finish & save.');}}render2();return;}
 else if(a==='addset'){const ex=active.exercises[+b.dataset.e];const last=ex.actual.at(-1)||ex.planned[ex.actual.length]||{w:null,r:null};ex.actual.push({...last});render2();return;}
 else if(a==='rmset'){active.exercises[+b.dataset.e].actual.pop();render2();return;}
 else if(a==='rmex'){active.exercises.splice(+b.dataset.i,1);render2();return;}
 else if(a==='finish'){stopRest();
  const extra=parseSets(document.getElementById('stAddEx').value);for(const x of extra)active.exercises.push({name:x.name,planned:[],actual:x.sets});
  for(const ex of active.exercises)ex.actual=ex.actual.filter(s=>s.r>0);
  if(!active.exercises.some(x=>x.actual.length)){toast('Enter at least one set.');return;}
  active.minutes=parseFloat(document.getElementById('stMin').value)||null;
  const text=saveSession(active);result={sess:active,R:analyze(active),text};active=null;toast('Workout saved.');}
 else if(a==='discard'){if(!confirm('Discard this workout?'))return;active=null;stopRest();}
 else if(a==='applynext'){const n=applyNext(result.sess.planId,result.sess);toast(`Updated ${n} exercise${n===1?'':'s'} in ${result.sess.name}.`);result=null;}
 else if(a==='closeres'){result=null;}
 else if(a==='delsess'){if(!confirm('Delete this workout?'))return;f.sessions=f.sessions.filter(s=>s.id!==b.dataset.id);}
 else if(a==='ex'){openEx=openEx===b.dataset.n?null:b.dataset.n;render2();return;}
 else return;
 persist();
});
const baseRender=window.render;
window.render=function(){baseRender.apply(this,arguments);if(view==='strength')render2();};
})();
