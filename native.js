/* The Family Save: Android app extras (Capacitor). Does nothing in a
   browser, except Native.plan(), which lists the reminders it would set.
   In the Android app it:
   - gives the voice assistant the phone's own speech recognizer and voice
     (Android's in-app browser has neither),
   - schedules reminders: bills, tasks, workouts and fasting goals,
   - imports steps, sleep, weight and workouts from Health Connect (where
     Samsung Health and Google Fit share data),
   - listens for "Hey Vector" while the app is closed (WakeWord plugin),
   - makes the Back button go Home, then close the app. */
(function(){
'use strict';
const C=window.Capacitor,native=!!(C&&C.isNativePlatform&&C.isNativePlatform());
const plug=n=>C&&(C.registerPlugin?C.registerPlugin(n):C.Plugins&&C.Plugins[n]);
const ls={get:k=>{try{return localStorage.getItem(k);}catch(_){return null;}},set:(k,v)=>{try{v==null?localStorage.removeItem(k):localStorage.setItem(k,v);}catch(_){}}};
const readJ=(k,d)=>{try{return JSON.parse(ls.get(k))||d;}catch(_){return d;}};

// ---- 1. speech: same browser interfaces, backed by the phone -----------------
if(native){
 const SRP=plug('SpeechRecognition'),TTS=plug('TextToSpeech');
 const code=m=>/permission/i.test(m)?'not-allowed':/audio/i.test(m)?'audio-capture':/network/i.test(m)?'network':/busy|client/i.test(m)?'aborted':'no-speech';
 class PhoneSpeechRecognition{
  constructor(){this.lang='en-US';this.continuous=false;this.interimResults=false;this.maxAlternatives=1;this._run=0;}
  start(){
   const run=++this._run,fire=(n,e)=>{if(run===this._run&&this[n])this[n](e);};
   (async()=>{
    try{
     let p=await SRP.checkPermissions();
     if(p.speechRecognition!=='granted')p=await SRP.requestPermissions();
     if(p.speechRecognition!=='granted'){fire('onerror',{error:'not-allowed'});fire('onend');return;}
     fire('onstart');
     // one phrase per start; the voice code restarts listening on "end"
     const r=await SRP.start({language:this.lang,maxResults:1,partialResults:false,popup:false});
     const t=(r&&r.matches||[])[0];
     if(t){const res=[{transcript:t,confidence:1}];res.isFinal=true;fire('onresult',{results:[res],resultIndex:0});}
     else fire('onerror',{error:'no-speech'});
    }catch(e){fire('onerror',{error:code(String(e&&e.message||e))});}
    fire('onend');
   })();
  }
  stop(){this.abort();}
  abort(){if(!this._run)return;const end=this.onend;this._run++;SRP.stop().catch(()=>{});if(end)setTimeout(end,0);}
 }
 window.SpeechRecognition=PhoneSpeechRecognition;window.webkitSpeechRecognition=PhoneSpeechRecognition;
 window.SpeechSynthesisUtterance=class{constructor(t){this.text=t||'';this.lang='en-US';this.rate=1;this.pitch=1;this.volume=1;}};
 const synth={speaking:false,pending:false,paused:false,getVoices:()=>[],
  cancel(){synth.speaking=false;TTS.stop().catch(()=>{});},
  speak(u){synth.speaking=true;setTimeout(()=>u.onstart&&u.onstart(),0);
   TTS.speak({text:u.text,lang:u.lang||'en-US',rate:Math.min(2,Math.max(0.5,u.rate||1)),pitch:u.pitch||1,volume:u.volume??1,category:'playback'})
    .then(()=>{synth.speaking=false;u.onend&&u.onend({});}).catch(e=>{synth.speaking=false;u.onerror&&u.onerror({error:String(e)});});}};
 try{Object.defineProperty(window,'speechSynthesis',{configurable:true,value:synth});}catch(_){window.speechSynthesis=synth;}
}

// ---- 2. reminders ---------------------------------------------------------------
const NK='fsNotify',NDEF={on:false,bills:true,tasks:true,workouts:true,fasting:true};
const nPref=()=>({...NDEF,...readJ(NK,{})});
const at=(dateStr,h,m=0)=>{const d=new Date(dateStr+'T00:00');d.setHours(h,m,0,0);return d;};
const money=c=>'$'+(c/100).toLocaleString('en-US',{maximumFractionDigits:c%100?2:0});
const idOf=s=>{let h=7;for(const ch of s)h=(h*31+ch.charCodeAt(0))|0;return Math.abs(h)%2000000000+1;};
const wd=d=>new Date(d+'T12:00').toLocaleDateString('en-US',{weekday:'long'});
function plan(now=new Date()){
 const P=nPref(),out=[],today=day(),add=(key,when,title,body)=>{if(when>now)out.push({id:idOf(key),title,body,at:when});};
 if(P.bills&&data.finance)for(const b of data.finance.bills||[]){
  if(!b.dueDay)continue;
  for(let k=0;k<2;k++){
   const base=new Date(now.getFullYear(),now.getMonth()+k,1),month=`${base.getFullYear()}-${String(base.getMonth()+1).padStart(2,'0')}`;
   if(b.paid&&b.paid[month])continue;
   const last=new Date(base.getFullYear(),base.getMonth()+1,0).getDate(),due=`${month}-${String(Math.min(b.dueDay,last)).padStart(2,'0')}`;
   add('bill-soon-'+b.id+month,at(plusDays(due,-2),9),'Bill due '+wd(due),`${b.name} ${money(b.amount)} is due ${wd(due)}.`);
   add('bill-due-'+b.id+month,at(due,9),'Bill due today',`${b.name} ${money(b.amount)} is due today.`);
  }
 }
 if(P.tasks)for(let i=0;i<14;i++){
  const d=plusDays(today,i),list=data.tasks.filter(t=>t.status!=='done'&&((t.due||t.scheduled)===d));
  if(list.length)add('tasks-'+d,at(d,8),list.length===1?'1 task today':list.length+' tasks today',list.slice(0,4).map(t=>t.title).join(', ')+(list.length>4?'…':''));
 }
 if(window.Fitness){const me=window.Fitness.people()[0];
  if(P.workouts&&window.Strength)for(let i=0;i<7;i++){const d=plusDays(today,i),dow=new Date(d+'T12:00').getDay();
   for(const p of window.Strength.plans(me.id))if((p.days||[]).includes(dow))add('lift-'+p.id+d,at(d,7),'Today: '+p.name,p.exercises.slice(0,3).map(e=>e.name).join(', ')+(p.exercises.length>3?'…':''));}
  if(P.fasting&&window.Nutrition){const f=window.Nutrition.activeFast(me.id);if(f&&f.goal)add('fast-'+f.start,new Date(Date.parse(f.start)+f.goal*36e5),'Fast complete 🎉',`You reached your ${f.goal}-hour fast.`);}
 }
 return out.sort((a,b)=>a.at-b.at).slice(0,60);
}
let LN=null,nTimer=null;
async function reschedule(){
 if(!native||!nPref().on)return;
 LN=LN||plug('LocalNotifications');
 try{
  const pend=await LN.getPending();if(pend.notifications&&pend.notifications.length)await LN.cancel({notifications:pend.notifications.map(n=>({id:n.id}))});
  const list=plan();if(list.length)await LN.schedule({notifications:list.map(n=>({id:n.id,title:n.title,body:n.body,schedule:{at:n.at,allowWhileIdle:true},smallIcon:'ic_stat_vector'}))});
 }catch(_){}
}
const soon=()=>{clearTimeout(nTimer);nTimer=setTimeout(reschedule,3000);};

// ---- 3. Health Connect -----------------------------------------------------------
const HK='fsHealth',READ=['steps','weight','sleep','workouts','distance'];
const pretty=t=>String(t||'Workout').replace(/([A-Z])/g,' $1').replace(/^./,c=>c.toUpperCase()).trim();
function upsert(logs,e){const i=logs.findIndex(x=>x.id===e.id);if(i>=0){const same=JSON.stringify({...logs[i],created:0})===JSON.stringify({...e,created:0});if(same)return 0;logs[i]=e;}else logs.push(e);return 1;}
async function importHealth(days=14){
 const H=plug('Health'),f=data.fitness,me=window.Fitness.people()[0],now=new Date(),start=new Date(now.getTime()-days*864e5);
 const rng={startDate:start.toISOString(),endDate:now.toISOString()},mk=(id,date,kind,x)=>({id,personId:me.id,date,kind,...x,source:'Health Connect',created:stamp()});
 f.logs=f.logs||[];let n=0;const local=iso=>{const d=new Date(iso);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
 try{const r=await H.queryAggregated({dataType:'steps',...rng,bucket:'day',aggregation:'sum'});for(const s of r.samples||[])if(s.value>0)n+=upsert(f.logs,mk('hc-steps-'+local(s.startDate),local(s.startDate),'steps',{value:Math.round(s.value)}));}catch(_){}
 try{const r=await H.readSamples({dataType:'weight',...rng,limit:200});const byDay={};for(const s of r.samples||[])byDay[local(s.startDate)]=s;
  for(const [d,s] of Object.entries(byDay))n+=upsert(f.logs,mk('hc-weight-'+d,d,'weight',{value:Math.round((s.unit==='kilogram'?s.value*2.20462:s.value)*10)/10}));}catch(_){}
 try{const r=await H.readSamples({dataType:'sleep',...rng,limit:200});const byDay={};
  for(const s of r.samples||[]){if(s.sleepState==='awake'||s.sleepState==='inBed')continue;const min=s.unit==='minute'?s.value:(Date.parse(s.endDate)-Date.parse(s.startDate))/6e4;const d=local(s.endDate);byDay[d]=(byDay[d]||0)+min;}
  for(const [d,min] of Object.entries(byDay))if(min>60)n+=upsert(f.logs,mk('hc-sleep-'+d,d,'sleep',{value:Math.round(min/6)/10}));}catch(_){}
 try{const r=await H.queryWorkouts({...rng,limit:100});
  for(const w of r.workouts||[]){const x={activity:pretty(w.workoutType),minutes:Math.round((w.duration||0)/60)};if(w.totalDistance)x.miles=Math.round(w.totalDistance/1609.34*100)/100;
   n+=upsert(f.logs,mk('hc-wo-'+(w.platformId||w.startDate),local(w.startDate),'workout',x));}}catch(_){}
 ls.set(HK+'At',String(Date.now()));if(n)persist();return n;
}
async function connectHealth(){
 const H=plug('Health'),a=await H.isAvailable();
 if(!a.available)throw new Error(a.reason||'Health Connect isn’t available. Install “Health Connect” from the Play Store, then try again.');
 const st=await H.requestAuthorization({read:READ});
 if(!(st.readAuthorized||[]).length)throw new Error('No access was given. You can allow it in Health Connect settings.');
 ls.set(HK,'1');return importHealth(30);
}

// ---- 4. "Hey Vector" when the app is closed ---------------------------------------
const WK='fsWakeClosed';
async function wakeStatus(){try{return await plug('WakeWord').status();}catch(_){return {running:false};}}

// ---- Settings panel (Android app only) ----------------------------------------------
if(native){
 const panel=document.createElement('div');panel.className='panel';panel.id='nativePanel';
 const row=(k,label,on)=>`<label style="display:flex;gap:8px;align-items:center;margin:6px 0"><input type="checkbox" data-nt="${k}" ${on?'checked':''} style="width:auto"> ${label}</label>`;
 async function draw(msg){
  const P=nPref(),w=await wakeStatus(),wakeOn=ls.get(WK)==='1',hOn=ls.get(HK)==='1',hAt=+ls.get(HK+'At')||0;
  panel.innerHTML=`<h2>📱 Phone</h2>
  <h3 style="font-size:15px;margin:10px 0 4px">Reminders</h3>
  ${P.on?row('bills','Bills (2 days before and on the day)',P.bills)+row('tasks','Tasks due today (8 AM)',P.tasks)+row('workouts','Planned workouts (7 AM)',P.workouts)+row('fasting','Fasting goal reached',P.fasting)+'<button class="btn alt sm" data-nx="noff">Turn reminders off</button>':'<button class="btn" data-nx="non">Turn on reminders</button>'}
  <h3 style="font-size:15px;margin:14px 0 4px">Samsung Health / Health Connect</h3>
  <p class="hint" style="margin:0 0 6px">Bring in steps, sleep, weight and workouts from Health Connect, where Samsung Health shares its data (turn on Samsung Health → Settings → Health Connect).</p>
  ${hOn?`<div class="actions"><button class="btn alt" data-nx="himport">Import now</button><button class="btn alt sm" data-nx="hset">Health Connect settings</button><button class="btn alt sm" data-nx="hoff">Disconnect</button></div><p class="hint">${hAt?'Last import '+new Date(hAt).toLocaleString([], {month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}):''}</p>`:'<button class="btn" data-nx="hon">Connect Health Connect</button>'}
  <h3 style="font-size:15px;margin:14px 0 4px">“Hey Vector” when the app is closed</h3>
  <p class="hint" style="margin:0 0 6px">Listens on the phone for “Hey Vector” (no audio leaves the phone) and opens the app ready for your instruction. Shows a small notification while on, and uses some battery.</p>
  ${wakeOn?`<div class="actions"><button class="btn alt sm" data-nx="woff">Turn off</button>${w.canOpenFromBackground?'':'<button class="btn alt" data-nx="overlay">Allow opening over other apps</button>'}</div><p class="hint">${w.running?'On.':'Starting…'}${w.canOpenFromBackground?'':' Without “display over other apps”, Vector shows a notification to tap instead of opening.'}</p>`:'<button class="btn" data-nx="won">Turn on “Hey Vector”</button>'}
  ${msg?`<p class="hint" role="status">${esc(msg)}</p>`:''}`;
 }
 panel.addEventListener('click',async e=>{
  const b=e.target.closest('[data-nx]');if(!b)return;const a=b.dataset.nx;b.disabled=true;
  try{
   if(a==='non'){const LNp=plug('LocalNotifications');let p=await LNp.checkPermissions();if(p.display!=='granted')p=await LNp.requestPermissions();if(p.display!=='granted'){draw('Notifications are blocked. Allow them in Android Settings → Apps → The Family Save.');return;}ls.set(NK,JSON.stringify({...nPref(),on:true}));await reschedule();draw(plan().length+' reminders set for the next two weeks.');}
   else if(a==='noff'){ls.set(NK,JSON.stringify({...nPref(),on:false}));const LNp=plug('LocalNotifications');const pend=await LNp.getPending();if(pend.notifications.length)await LNp.cancel({notifications:pend.notifications.map(n=>({id:n.id}))});draw('Reminders off.');}
   else if(a==='hon'){const n=await connectHealth();draw(`Connected. Imported ${n} entr${n===1?'y':'ies'}.`);}
   else if(a==='himport'){const n=await importHealth(14);draw(n?`Imported ${n} new entr${n===1?'y':'ies'}.`:'Already up to date.');}
   else if(a==='hset'){await plug('Health').openHealthConnectSettings();draw();}
   else if(a==='hoff'){ls.set(HK,null);draw('Disconnected. Imported entries stay in your log.');}
   else if(a==='won'){await plug('WakeWord').start();ls.set(WK,'1');setTimeout(()=>draw('“Hey Vector” is on. Close the app and try it.'),400);}
   else if(a==='woff'){await plug('WakeWord').stop();ls.set(WK,null);draw('“Hey Vector” is off.');}
   else if(a==='overlay'){await plug('WakeWord').openOverlaySettings();}
  }catch(err){draw('✗ '+(err.message||err));}
 });
 panel.addEventListener('change',e=>{const k=e.target.dataset.nt;if(!k)return;ls.set(NK,JSON.stringify({...nPref(),[k]:e.target.checked}));soon();});
 const settings=document.getElementById('settings');settings.insertBefore(panel,settings.children[2]||null);
 draw();

 // keep reminders current after every change
 const baseP=window.persist;window.persist=function(){baseP.apply(this,arguments);soon();};
 const App=plug('App');
 App.addListener('appStateChange',s=>{if(s.isActive){draw();if(ls.get(HK)==='1'&&Date.now()-(+ls.get(HK+'At')||0)>36e5)importHealth(3).catch(()=>{});}});
 App.addListener('backButton',()=>{const open=[...document.querySelectorAll('#onboard:not([hidden]),.sheet:not([hidden]),[role="dialog"]:not([hidden])')].pop();
  if(open&&open.id!=='lockScreen'){const x=open.querySelector('[data-close],.close,[data-ob="skipall"]');if(x){x.click();return;}}
  if(typeof view!=='undefined'&&view!=='today')openView('today');else App.minimizeApp();});
 plug('WakeWord').addListener('wake',()=>{openView('today');setTimeout(()=>window.VectorWake&&window.VectorWake.wake(),300);});
 if(ls.get(WK)==='1')plug('WakeWord').start().catch(()=>{});
 setTimeout(reschedule,2000);
 if(ls.get(HK)==='1')setTimeout(()=>importHealth(3).catch(()=>{}),4000);
 document.documentElement.classList.add('native-app');
}

window.Native={native,plan,importHealth,reschedule};
})();
