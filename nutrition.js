/* The Family Save meals & fasting.
   Per person: an eating pattern (3 meals, 3 + snacks, 6 small meals, 16:8,
   18:6, one meal a day, or custom slots), calorie/macro targets with a
   Mifflin-St Jeor calculator, a food log per meal slot (recent foods, saved
   meals, a starter food list, USDA FoodData Central search, custom entries,
   Vector AI estimates), a fasting timer with goals, history and streak, and a
   meal plan that follows the pattern.
   Data lives in data.fitness (nutrition per person, logs kind 'meal',
   fasts, plans) so it's in backups. Food values in the starter list are
   rounded from USDA FoodData Central (public domain, CC0). Not medical advice. */
(function(){
'use strict';
const C={s1:'#3987e5',grid:'#1c2838',surface:'#0d141f',ink:'#eef6fb',ink2:'#aebdcc',ink3:'#7f93a8',good:'#3fd16b',warn:'#fab219',bad:'#ff8a8a',cyan:'#46d9f5'};
const PATTERNS={
 classic:{label:'3 meals',slots:['Breakfast','Lunch','Dinner'],times:['08:00','12:30','18:30']},
 snacks:{label:'3 meals + 2 snacks',slots:['Breakfast','Snack','Lunch','Snack','Dinner'],times:['07:30','10:00','12:30','15:30','18:30']},
 six:{label:'6 small meals',slots:['Meal 1','Meal 2','Meal 3','Meal 4','Meal 5','Meal 6'],times:['07:00','09:30','12:00','14:30','17:00','19:30']},
 if168:{label:'16:8 fasting',slots:['First meal','Last meal'],times:['12:00','19:30'],fast:16,window:'12:00–20:00'},
 if186:{label:'18:6 fasting',slots:['First meal','Last meal'],times:['13:00','18:30'],fast:18,window:'13:00–19:00'},
 omad:{label:'One meal a day',slots:['The meal'],times:['18:00'],fast:23,window:'one meal'},
 custom:{label:'Custom',slots:[],times:[]}};
// approximate values per listed serving, rounded from USDA FoodData Central (public domain)
const FOODS=[['Egg, large',1,'egg',72,6,0,5],['Egg whites',1,'cup',126,26,2,0],['Chicken breast, cooked',4,'oz',187,35,0,4],['Ground beef 90/10, cooked',4,'oz',246,30,0,13],['Salmon, cooked',4,'oz',233,25,0,14],['Tuna, canned in water',1,'can (5 oz)',120,26,0,1],['Turkey breast deli',2,'oz',60,12,2,1],['Greek yogurt, plain nonfat',1,'cup',130,23,9,0],['Cottage cheese, low fat',1,'cup',163,28,6,2],['Milk, 2%',1,'cup',122,8,12,5],['Cheddar cheese',1,'oz',114,7,0,9],['Whey protein',1,'scoop (30 g)',120,24,3,1.5],['Oats, dry',0.5,'cup',150,5,27,3],['White rice, cooked',1,'cup',205,4,45,0.4],['Brown rice, cooked',1,'cup',218,5,46,2],['Pasta, cooked',1,'cup',221,8,43,1],['Whole wheat bread',1,'slice',81,4,14,1],['Tortilla, flour',1,'medium',140,4,24,3],['Potato, baked',1,'medium',161,4,37,0],['Sweet potato, baked',1,'medium',103,2,24,0],['Banana',1,'medium',105,1,27,0],['Apple',1,'medium',95,0,25,0],['Blueberries',1,'cup',84,1,21,0],['Broccoli, cooked',1,'cup',55,4,11,1],['Spinach, raw',2,'cups',14,2,2,0],['Mixed salad greens',2,'cups',18,1,3,0],['Avocado',0.5,'fruit',120,1.5,6,11],['Almonds',1,'oz',164,6,6,14],['Peanut butter',2,'tbsp',190,7,7,16],['Olive oil',1,'tbsp',119,0,0,13.5],['Butter',1,'tbsp',102,0,0,11.5],['Black beans, cooked',0.5,'cup',114,8,20,0.5],['Hummus',2,'tbsp',70,2,4,5],['Protein bar (typical)',1,'bar',210,20,22,7]];
const ACTIVITY=[[1.2,'Mostly sitting'],[1.375,'Light (1–3 workouts/wk)'],[1.55,'Moderate (3–5/wk)'],[1.725,'Very active (6–7/wk)'],[1.9,'Athlete / physical job']];
const GOALS=[[-500,'Lose ~1 lb a week'],[-250,'Lose ~½ lb a week'],[0,'Maintain'],[250,'Gain ~½ lb a week'],[500,'Gain ~1 lb a week']];
const pd=s=>{const [y,m,d]=s.split('-').map(Number);return new Date(y,m-1,d);};
const addDays=(s,n)=>{const d=pd(s);d.setDate(d.getDate()+n);return day(d);};
const fmtH=ms=>{const m=Math.max(0,Math.floor(ms/60000));return `${Math.floor(m/60)}:${String(m%60).padStart(2,'0')}`;};
const r0=v=>Math.round(v||0);

// ---- data ---------------------------------------------------------------
function FT(){const f=data.fitness||(data.fitness={});f.people=Array.isArray(f.people)&&f.people.length?f.people:[{id:uuid(),name:'Me',goals:{}}];f.logs=Array.isArray(f.logs)?f.logs:[];f.fasts=Array.isArray(f.fasts)?f.fasts:[];f.myMeals=Array.isArray(f.myMeals)?f.myMeals:[];f.plans2=f.plans2&&typeof f.plans2==='object'?f.plans2:{};return f;}
function N(p){
 if(!p.nutrition){p.nutrition={pattern:'classic',slots:mkSlots('classic'),fastGoal:16,targets:{cal:p.goals?.calories||null,p:p.goals?.protein||null,c:null,f:null},profile:{}};
  // the old shared meal plan (breakfast/lunch/dinner) moves to the first person
  const f=FT();if(p===f.people[0]&&f.mealPlan)for(const [d,m] of Object.entries(f.mealPlan)){const map={breakfast:'s1',lunch:'s2',dinner:'s3'};for(const [k,v] of Object.entries(m))if(map[k]&&v)((f.plans2[p.id]=f.plans2[p.id]||{})[d]=f.plans2[p.id][d]||{})[map[k]]=v;}}
 return p.nutrition;
}
function mkSlots(pat,names){const P=PATTERNS[pat];const list=names||P.slots;return list.map((n,i)=>({id:'s'+(i+1),name:n,time:(P.times||[])[i]||''}));}
const person=pid=>FT().people.find(p=>p.id===pid)||FT().people[0];
const sel=()=>window.Fitness&&window.Fitness.selected?window.Fitness.selected():FT().people[0].id;
function slotForNow(pid){const n=N(person(pid)),now=new Date(),mins=now.getHours()*60+now.getMinutes();let best=n.slots[0],bd=1e9;
 n.slots.forEach((s,i)=>{const t=s.time?(+s.time.slice(0,2))*60+(+s.time.slice(3,5)):(7+i*(12/Math.max(1,n.slots.length)))*60;const d=Math.abs(t-mins);if(d<bd){bd=d;best=s;}});return best?best.id:'s1';}
const mealsOn=(pid,d)=>FT().logs.filter(l=>l.kind==='meal'&&l.personId===pid&&l.date===d);
const totals=L=>L.reduce((a,l)=>({cal:a.cal+(+l.calories||0),p:a.p+(+l.protein||0),c:a.c+(+l.carbs||0),f:a.f+(+l.fat||0)}),{cal:0,p:0,c:0,f:0});
function addFood(pid,item,slot,date){const e=window.Fitness.add({personId:pid,date:date||day(),kind:'meal',note:item.name,calories:r0(item.cal),protein:r0(item.p),carbs:r0(item.c),fat:r0(item.f)});e.slot=slot||slotForNow(pid);if(item.qty)e.qty=item.qty;return e;}
// Mifflin-St Jeor resting energy x activity + goal; protein by body weight, fat 28%, carbs the rest
function calcTargets(pr){
 const kg=pr.weightLb*0.4536,cm=pr.heightIn*2.54,bmr=10*kg+6.25*cm-5*pr.age+(pr.sex==='female'?-161:5);
 let cal=Math.round((bmr*pr.activity+pr.goal)/10)*10;const floor=pr.sex==='female'?1200:1500,low=cal<floor;cal=Math.max(cal,floor);
 const p=Math.round(pr.weightLb*pr.proteinPerLb),f=Math.round(cal*0.28/9),c=Math.max(0,Math.round((cal-p*4-f*9)/4));
 return {cal,p,c,f,bmr:Math.round(bmr),tdee:Math.round(bmr*pr.activity),low};
}
// fasting
const activeFast=pid=>FT().fasts.find(x=>x.personId===pid&&!x.end);
function startFast(pid,goal,at){const f=FT();if(activeFast(pid))return null;const x={id:uuid(),personId:pid,start:at||stamp(),end:null,goal:goal||N(person(pid)).fastGoal||16};f.fasts.push(x);try{log('fast_started',null,person(pid).name+' · '+x.goal+'h goal');}catch(_){}return x;}
function endFast(pid,at){const x=activeFast(pid);if(!x)return null;x.end=at||stamp();try{log('fast_ended',null,person(pid).name+' · '+fmtH(new Date(x.end)-new Date(x.start)));}catch(_){}return x;}
function fastStats(pid){const L=FT().fasts.filter(x=>x.personId===pid&&x.end).sort((a,b)=>b.start.localeCompare(a.start));
 const hit=x=>(new Date(x.end)-new Date(x.start))/36e5>=x.goal;let streak=0;for(const x of L){if(hit(x))streak++;else break;}
 const last7=L.filter(x=>new Date(x.start)>Date.now()-7*864e5);return {list:L,streak,done7:last7.filter(hit).length,count7:last7.length,avg7:last7.length?last7.reduce((a,x)=>a+(new Date(x.end)-new Date(x.start))/36e5,0)/last7.length:null};}
function planFor(pid){return FT().plans2[pid]||(FT().plans2[pid]={});}
function setPlan(pid,date,slot,text){const p=planFor(pid);(p[date]=p[date]||{});if(text)p[date][slot]=String(text).slice(0,120);else delete p[date][slot];}
function plannedMeals(week){const t=new Date(),s=new Date(t);s.setDate(t.getDate()-t.getDay()+7*week);const out=[];for(const pp of FT().people){const pl=FT().plans2[pp.id]||{};for(let i=0;i<7;i++){const d=new Date(s);d.setDate(s.getDate()+i);const k=day(d);for(const [slot,m] of Object.entries(pl[k]||{}))if(m)out.push({who:pp.name,date:k,slot,meal:m});}}return out;}
window.Nutrition={PATTERNS,FOODS,calcTargets,slotForNow,startFast,endFast,activeFast,fastStats,setPlan,plannedMeals,totals,mealsOn,N:pid=>N(person(pid)),addFood};

// ---- view ---------------------------------------------------------------
let dayView=day(),adding=null,addTab='recent',showTargets=false,showPattern=false,planWeek=0,usdaRes=null,estimate=null,tick=null;
const section=document.createElement('section');section.id='meals';section.className='view hidden';
const fit=document.getElementById('fitness');fit.parentNode.insertBefore(section,fit.nextSibling);
const tab=document.createElement('button');tab.className='tab';tab.dataset.view='meals';tab.textContent='Meals';document.getElementById('tabs').appendChild(tab);
const css=document.createElement('style');css.textContent=`
.nu-macros{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-top:12px}.nu-m{background:#0e1826;border:1px solid #1c2e44;border-radius:12px;padding:10px 8px;text-align:center}.nu-m .v{font-size:17px;font-weight:750}.nu-m .l{font-size:10.5px;color:${C.ink3};margin-top:2px}.nu-m .bar{height:6px;border-radius:3px;background:#14263a;margin-top:6px;overflow:hidden}.nu-m .bar i{display:block;height:100%;background:${C.s1}}.nu-m .bar i.over{background:${C.warn}}
.nu-slot{border-top:1px solid ${C.grid};padding:10px 0}.nu-slot:first-of-type{border-top:0}.nu-slot .h{display:flex;align-items:center;gap:8px}.nu-slot .h b{flex:1}.nu-slot .h span{font-size:12px;color:${C.ink3};font-variant-numeric:tabular-nums}
.nu-item{display:flex;gap:8px;align-items:center;padding:6px 0 6px 10px;font-size:13.5px}.nu-item .g{flex:1;min-width:0}.nu-item .s{font-size:11px;color:${C.ink3}}
.nu-sheet{background:#0b131f;border:1px solid #1f3348;border-radius:14px;padding:12px;margin:8px 0}.nu-tabs{display:flex;gap:6px;overflow-x:auto;scrollbar-width:none;margin-bottom:8px}.nu-tabs::-webkit-scrollbar{display:none}.nu-tabs button{flex:none;border:1px solid #24394f;background:none;color:${C.ink2};border-radius:16px;padding:5px 11px;font-size:12px;font-weight:650}.nu-tabs button.on{background:#14304a;border-color:${C.cyan};color:#fff}
.nu-food{display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid ${C.grid};font-size:13.5px}.nu-food .g{flex:1;min-width:0}.nu-food .s{font-size:11px;color:${C.ink3}}
.fa-ring{display:flex;align-items:center;gap:16px}.fa-ring .t{font-size:30px;font-weight:800;font-variant-numeric:tabular-nums;letter-spacing:-.02em}.fa-ring .s{font-size:12px;color:${C.ink2};margin-top:2px}
.fa-goals{display:flex;gap:6px;flex-wrap:wrap;margin-top:10px}.fa-goals button{border:1px solid #24394f;background:#0e1624;color:${C.ink2};border-radius:16px;padding:6px 11px;font-size:12.5px;font-weight:700}.fa-goals button.on{background:#0f3149;border-color:${C.cyan};color:#fff}
.nu-pat{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px}.nu-pat button{text-align:left;border:1px solid #24394f;background:#0e1624;color:${C.ink};border-radius:12px;padding:10px;font-size:13px}.nu-pat button.on{border-color:${C.cyan};background:#0f3149}.nu-pat button small{display:block;color:${C.ink3};font-size:11px;margin-top:2px}
.nu-day{border-top:1px solid ${C.grid};padding:8px 0}.nu-day .d{font-weight:700;font-size:13px}.nu-day .r{display:flex;gap:6px;flex-wrap:wrap;margin-top:6px}.nu-day .r button{border:1px dashed #2b4a63;background:#0b131f;color:${C.ink2};border-radius:10px;padding:6px 9px;font-size:12px;text-align:left;max-width:100%}.nu-day .r button.set{border-style:solid;color:${C.ink}}.nu-day.today .d{color:${C.cyan}}`;
document.head.appendChild(css);
function ring(pct,size=92,stroke=9,label=''){const r=(size-stroke)/2,c=2*Math.PI*r,p=Math.max(0,Math.min(1,pct));
 return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" aria-label="${label}"><circle cx="${size/2}" cy="${size/2}" r="${r}" fill="none" stroke="#14263a" stroke-width="${stroke}"/><circle cx="${size/2}" cy="${size/2}" r="${r}" fill="none" stroke="${p>=1?C.good:C.cyan}" stroke-width="${stroke}" stroke-linecap="round" stroke-dasharray="${c*p} ${c}" transform="rotate(-90 ${size/2} ${size/2})"/></svg>`;}
function fastCard(pid){
 const n=N(person(pid)),a=activeFast(pid),st=fastStats(pid),P=PATTERNS[n.pattern]||{};
 const lastMeal=FT().logs.filter(l=>l.kind==='meal'&&l.personId===pid).sort((x,y)=>(y.created||'').localeCompare(x.created||''))[0];
 if(a){const ms=Date.now()-new Date(a.start),goal=a.goal*36e5,endAt=new Date(new Date(a.start).getTime()+goal);
  return `<div class="panel"><div class="header"><h2>⏳ Fasting</h2><span class="muted small">goal ${a.goal}h</span></div><div class="fa-ring">${ring(ms/goal,96,10,'Fast progress')}<div><div class="t" id="faT">${fmtH(ms)}</div><div class="s" id="faS">${ms>=goal?'🎉 Goal reached! End whenever you’re ready':`${fmtH(goal-ms)} to go · ends ${endAt.toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'})}${endAt.toDateString()!==new Date().toDateString()?' tomorrow':''}`}</div><div class="s">Started ${new Date(a.start).toLocaleString(undefined,{weekday:'short',hour:'numeric',minute:'2-digit'})}</div></div></div>
   <div class="actions" style="margin-top:12px"><button class="btn" data-nu="endfast">End fast</button><button class="btn alt sm" data-nu="editstart">Edit start time</button><button class="btn alt sm" data-nu="cancelfast">Cancel</button></div>${statsLine(st)}</div>`;}
 return `<div class="panel"><div class="header"><h2>⏳ Fasting</h2>${P.window?`<span class="muted small">eating window ${P.window}</span>`:''}</div>
  <p class="hint" style="margin:0">${lastMeal?`Last logged food ${ago(lastMeal.created)}.`:'Start a fast after your last meal.'} Pick a goal:</p>
  <div class="fa-goals">${[...new Set([12,14,16,18,20,24,36,n.fastGoal||16])].sort((x,y)=>x-y).map(h=>`<button data-nu="goal" data-v="${h}" class="${h===(n.fastGoal||16)?'on':''}">${h}h</button>`).join('')}</div>
  <div class="actions" style="margin-top:10px"><button class="btn" data-nu="startfast">Start ${n.fastGoal||16}h fast</button><button class="btn alt sm" data-nu="startearlier">I started earlier…</button></div>${statsLine(st)}</div>`;
}
function statsLine(st){return st.list.length?`<p class="hint" style="margin:10px 0 0">${st.streak?`🔥 ${st.streak} goal${st.streak>1?'s':''} in a row · `:''}last 7 days: ${st.done7}/${st.count7} fasts reached goal${st.avg7?` · avg ${st.avg7.toFixed(1)}h`:''}</p><div style="display:flex;gap:4px;align-items:flex-end;height:44px;margin-top:6px" aria-label="Recent fasts">${st.list.slice(0,10).reverse().map(x=>{const h=(new Date(x.end)-new Date(x.start))/36e5;return `<div title="${h.toFixed(1)}h of ${x.goal}h" style="flex:1;height:${Math.min(100,h/Math.max(x.goal,1)*100)}%;min-height:3px;border-radius:3px 3px 0 0;background:${h>=x.goal?C.good:C.s1}"></div>`;}).join('')}</div>`:'';}
function ago(iso){const m=Math.round((Date.now()-new Date(iso))/60000);return m<60?m+' min ago':m<1440?Math.round(m/60)+' h ago':Math.round(m/1440)+' days ago';}
function macroCard(pid){
 const n=N(person(pid)),t=n.targets||{},tot=totals(mealsOn(pid,dayView));
 const cell=(v,tg,l,u='')=>{const pct=tg?v/tg:0;return `<div class="nu-m"><div class="v">${r0(v)}${u}</div><div class="l">${l}${tg?` / ${tg}${u}`:''}</div>${tg?`<div class="bar"><i class="${pct>1.05?'over':''}" style="width:${Math.min(100,pct*100)}%"></i></div>`:''}</div>`;};
 const left=t.cal?t.cal-tot.cal:null;
 return `<div class="panel"><div class="mn-head"><button class="btn alt sm" data-nu="dprev" aria-label="Previous day">‹</button><h2>${dayView===day()?'Today':pd(dayView).toLocaleDateString(undefined,{weekday:'long',month:'short',day:'numeric'})}</h2><button class="btn alt sm" data-nu="dnext" aria-label="Next day">›</button></div>
  <div class="nu-macros">${cell(tot.cal,t.cal,'Calories')}${cell(tot.p,t.p,'Protein','g')}${cell(tot.c,t.c,'Carbs','g')}${cell(tot.f,t.f,'Fat','g')}</div>
  <p class="hint" style="margin:8px 0 0">${left==null?'Set your targets to see what’s left.':left>=0?`<b>${r0(left)}</b> calories left${t.p&&tot.p<t.p?` · <b>${r0(t.p-tot.p)} g</b> protein to go`:''}`:`<b style="color:${C.warn}">${r0(-left)}</b> calories over target`}</p>
  <div class="actions" style="margin-top:10px"><button class="btn alt sm" data-nu="targets">${showTargets?'Close':'🎯 Targets'}</button><button class="btn alt sm" data-nu="pattern">${showPattern?'Close':'🍽️ Eating pattern: '+(PATTERNS[n.pattern]||PATTERNS.custom).label}</button></div>
  ${showPattern?patternHtml(n):''}${showTargets?targetsHtml(pid,n):''}</div>`;
}
function patternHtml(n){
 return `<div class="nu-sheet"><b>How do you like to eat?</b><div class="nu-pat">${Object.entries(PATTERNS).map(([k,P])=>`<button data-nu="setpat" data-v="${k}" class="${n.pattern===k?'on':''}">${P.label}<small>${k==='custom'?'Name your own meals':P.slots.length+' meal'+(P.slots.length>1?'s':'')+(P.fast?` · ${P.fast}h fast`:'')}</small></button>`).join('')}</div>
  ${n.pattern==='custom'?`<label>Your meals, in order (comma separated)</label><input id="nuCustom" value="${esc(n.slots.map(s=>s.name).join(', '))}" placeholder="Pre-workout, Post-workout, Dinner"><button class="btn sm" style="margin-top:8px" data-nu="savecustom">Save meals</button>`:''}
  <p class="hint" style="margin:8px 0 0">Your food log and meal plan follow this pattern. Fasting patterns also set the fast goal.</p></div>`;
}
function targetsHtml(pid,n){
 const pr=n.profile||{},S=window.Fitness.stats(pid),wt=pr.weightLb||(S.latestW?+S.latestW.value:''),t=n.targets||{};
 return `<div class="nu-sheet"><b>Daily targets</b><div class="two"><div><label>Calories</label><input id="tgCal" inputmode="numeric" value="${t.cal||''}"></div><div><label>Protein (g)</label><input id="tgP" inputmode="numeric" value="${t.p||''}"></div></div><div class="two"><div><label>Carbs (g)</label><input id="tgC" inputmode="numeric" value="${t.c||''}"></div><div><label>Fat (g)</label><input id="tgF" inputmode="numeric" value="${t.f||''}"></div></div>
  <button class="btn sm" style="margin-top:8px" data-nu="savetargets">Save targets</button>
  <b style="display:block;margin-top:14px">…or calculate them</b>
  <div class="two"><div><label>Sex</label><select id="pfSex"><option value="male"${pr.sex!=='female'?' selected':''}>Male</option><option value="female"${pr.sex==='female'?' selected':''}>Female</option></select></div><div><label>Age</label><input id="pfAge" inputmode="numeric" value="${pr.age||''}"></div></div>
  <div class="two"><div><label>Height (ft / in)</label><div style="display:flex;gap:6px"><input id="pfFt" inputmode="numeric" placeholder="5" value="${pr.heightIn?Math.floor(pr.heightIn/12):''}"><input id="pfIn" inputmode="numeric" placeholder="10" value="${pr.heightIn?pr.heightIn%12:''}"></div></div><div><label>Weight (lb)</label><input id="pfWt" inputmode="decimal" value="${wt}"></div></div>
  <label>Activity</label><select id="pfAct">${ACTIVITY.map(([v,l])=>`<option value="${v}"${+pr.activity===v?' selected':''}>${l}</option>`).join('')}</select>
  <div class="two"><div><label>Goal</label><select id="pfGoal">${GOALS.map(([v,l])=>`<option value="${v}"${(pr.goal??0)===v?' selected':''}>${l}</option>`).join('')}</select></div><div><label>Protein per lb</label><select id="pfPro">${[[0.7,'0.7 g (general)'],[0.8,'0.8 g (active)'],[1,'1 g (lifting)']].map(([v,l])=>`<option value="${v}"${(pr.proteinPerLb||0.8)===v?' selected':''}>${l}</option>`).join('')}</select></div></div>
  <button class="btn alt sm" style="margin-top:8px" data-nu="calc">Calculate & use</button>
  <p class="hint" style="margin:8px 0 0">Uses the Mifflin-St Jeor equation for resting energy, times your activity level, plus your goal. It’s a starting estimate, not medical advice. Adjust after 2–3 weeks based on your weight trend, and talk to a doctor or dietitian about big changes.</p></div>`;
}
function logCard(pid){
 const n=N(person(pid)),L=mealsOn(pid,dayView),slots=n.slots.length?n.slots:mkSlots('classic');
 const known=new Set(slots.map(s=>s.id)),other=L.filter(l=>!known.has(l.slot));
 const block=(s,items)=>{const t=totals(items);return `<div class="nu-slot"><div class="h"><b>${esc(s.name)}</b><span>${s.time?s.time+' · ':''}${r0(t.cal)} cal${t.p?` · ${r0(t.p)}g P`:''}</span><button class="btn alt sm" data-nu="add" data-s="${s.id}">+ Add</button></div>
  ${items.map(l=>`<div class="nu-item"><div class="g">${esc(l.note||'Food')}<div class="s">${l.calories?r0(l.calories)+' cal':''}${l.protein?' · '+r0(l.protein)+'g P':''}${l.carbs?' · '+r0(l.carbs)+'g C':''}${l.fat?' · '+r0(l.fat)+'g F':''}</div></div><button class="x" data-nu="delfood" data-id="${l.id}" aria-label="Remove">✕</button></div>`).join('')}
  ${adding===s.id?addSheet(pid,s.id):''}</div>`;};
 return `<div class="panel"><h2>Food log</h2>${slots.map(s=>block(s,L.filter(l=>l.slot===s.id))).join('')}${other.length?block({id:'other',name:'Other'},other):''}
  <p class="hint" style="margin:10px 0 0">Hands-free: “ate a turkey sandwich 450 calories”. With Vector AI on, use ✨ Estimate for anything.</p></div>`;
}
function addSheet(pid,slot){
 const L=FT().logs.filter(l=>l.kind==='meal'&&l.personId===pid&&l.note).sort((a,b)=>(b.created||'').localeCompare(a.created||''));
 const recent=[];for(const l of L){if(!recent.some(r=>r.name.toLowerCase()===l.note.toLowerCase()))recent.push({name:l.note,cal:l.calories,p:l.protein,c:l.carbs,f:l.fat});if(recent.length>=12)break;}
 const tabs=[['recent','Recent'],['mine','My meals'],['foods','Common foods'],['usda','Search USDA'],['custom','Custom'],...(window.VectorAI&&window.VectorAI.enabled()?[['ai','✨ Estimate']]:[])];
 const row=(f,act,extra='')=>`<div class="nu-food"><div class="g">${esc(f.name)}<div class="s">${f.serv?esc(f.serv)+' · ':''}${r0(f.cal)} cal · ${r0(f.p)}P ${r0(f.c)}C ${r0(f.f)}F</div></div>${extra}<button class="btn sm" ${act}>Add</button></div>`;
 let body='';
 if(addTab==='recent')body=recent.length?recent.map((f,i)=>row(f,`data-nu="addrecent" data-i="${i}"`)).join(''):'<div class="empty">Foods you log show up here for one-tap adding.</div>';
 else if(addTab==='mine')body=(FT().myMeals.length?FT().myMeals.map((m,i)=>row(m,`data-nu="addmine" data-i="${i}"`,`<button class="x" data-nu="delmine" data-i="${i}" aria-label="Delete saved meal">✕</button>`)).join(''):'<div class="empty">Save a meal you eat often, like your usual breakfast, and add it in one tap.</div>')+`<div class="two" style="margin-top:8px"><div><input id="mmName" placeholder="Meal name, e.g. Usual breakfast"></div><div><input id="mmMac" placeholder="cal, protein, carbs, fat"></div></div><button class="btn alt sm" style="margin-top:6px" data-nu="savemine">Save meal</button>`;
 else if(addTab==='foods')body=`<input id="nuFq" placeholder="Filter: chicken, rice, egg…" style="margin-bottom:6px">${FOODS.map((f,i)=>row({name:f[0],serv:`${f[1]} ${f[2]}`,cal:f[3],p:f[4],c:f[5],f:f[6]},`data-nu="addcommon" data-i="${i}"`,`<input class="nu-qty" data-i="${i}" inputmode="decimal" value="1" style="width:52px;padding:6px;text-align:center" aria-label="Servings">`)).join('')}<p class="hint" style="margin:6px 0 0">Approximate values from USDA FoodData Central (public domain).</p>`;
 else if(addTab==='usda')body=`<div style="display:flex;gap:6px"><input id="usQ" placeholder="Search foods, e.g. greek yogurt"><button class="btn sm" data-nu="usda">Search</button></div>${usdaRes?usdaRes.error?`<p class="hint" style="color:${C.bad}">${esc(usdaRes.error)}</p>`:usdaRes.items.map((f,i)=>row(f,`data-nu="addusda" data-i="${i}"`,`<input class="nu-g" data-i="${i}" inputmode="decimal" value="100" style="width:60px;padding:6px;text-align:center" aria-label="Grams">`)).join('')+'<p class="hint" style="margin:6px 0 0">Values per 100 g. Set the grams you ate. Source: USDA FoodData Central.</p>':''}`;
 else if(addTab==='custom')body=`<div class="two"><div><label>Food</label><input id="cuName" value="${esc(estimate?.name||'')}"></div><div><label>Calories</label><input id="cuCal" inputmode="numeric" value="${estimate?r0(estimate.cal):''}"></div></div><div class="two"><div><label>Protein g</label><input id="cuP" inputmode="numeric" value="${estimate?r0(estimate.p):''}"></div><div><label>Carbs g · Fat g</label><div style="display:flex;gap:6px"><input id="cuC" inputmode="numeric" value="${estimate?r0(estimate.c):''}"><input id="cuF" inputmode="numeric" value="${estimate?r0(estimate.f):''}"></div></div></div>${estimate?'<p class="hint" style="margin:6px 0">✨ Estimated by Vector. Check and adjust.</p>':''}<button class="btn sm" style="margin-top:8px" data-nu="addcustom">Add</button>`;
 else if(addTab==='ai')body=`<label>Describe what you ate</label><input id="aiFood" placeholder="2 eggs, 2 slices of toast with butter, black coffee"><button class="btn sm" style="margin-top:8px" data-nu="estimate">✨ Estimate</button><p class="hint" style="margin:6px 0 0">Vector estimates the calories and macros. You review them before adding.</p>`;
 return `<div class="nu-sheet"><div class="nu-tabs">${tabs.map(([k,l])=>`<button data-nu="addtab" data-v="${k}" class="${addTab===k?'on':''}">${l}</button>`).join('')}</div>${body}<div class="actions" style="margin-top:8px"><button class="btn alt sm" data-nu="closeadd">Done</button></div></div>`;
}
function planCard(pid){
 const n=N(person(pid)),pl=planFor(pid),t=pd(day());const s=new Date(t);s.setDate(t.getDate()-t.getDay()+7*planWeek);
 const days=[...Array(7)].map((_,i)=>{const d=new Date(s);d.setDate(s.getDate()+i);return day(d);});
 return `<div class="panel" id="nu-plan"><div class="header"><h2>Meal plan</h2><div class="actions"><button class="btn alt sm" data-nu="pweek" data-v="0"${planWeek===0?' disabled':''}>This week</button><button class="btn alt sm" data-nu="pweek" data-v="1"${planWeek===1?' disabled':''}>Next</button></div></div>
  ${days.map(d=>`<div class="nu-day${d===day()?' today':''}"><div class="d">${pd(d).toLocaleDateString(undefined,{weekday:'long',month:'short',day:'numeric'})}</div><div class="r">${n.slots.map(sl=>{const v=(pl[d]||{})[sl.id];return `<button class="${v?'set':''}" data-nu="plan" data-d="${d}" data-s="${sl.id}"><span style="color:${C.ink3}">${esc(sl.name)}:</span> ${v?esc(v):'+'}</button>`;}).join('')}</div></div>`).join('')}
  <div class="actions" style="margin-top:8px"><button class="btn alt sm" data-nu="copyweek">Copy last week</button></div>
  <p class="hint" style="margin:8px 0 0">Tap a slot to plan it. With Vector AI on: “plan high-protein meals for next week”.</p></div>`;
}
function render2(){
 if(!window.Fitness)return;const people=FT().people,pid=sel();
 const chips=`<div class="panel"><div class="ft-chips">${people.map(p=>`<button class="ft-chip${p.id===pid?' on':''}" data-nu="who" data-id="${p.id}">${esc(p.name)}</button>`).join('')}</div></div>`;
 section.innerHTML=chips+macroCard(pid)+fastCard(pid)+logCard(pid)+planCard(pid);
 if(window.Grocery&&window.Grocery.inject)window.Grocery.inject();
 clearInterval(tick);if(activeFast(pid))tick=setInterval(()=>{if(view!=='meals'||document.hidden)return;const a=activeFast(pid);if(!a)return clearInterval(tick);const ms=Date.now()-new Date(a.start),el=document.getElementById('faT');if(el)el.textContent=fmtH(ms);},30000);
}
function num(id){const v=parseFloat(String(document.getElementById(id)?.value||'').replace(/,/g,''));return isFinite(v)&&v>=0?v:null;}
section.addEventListener('input',e=>{if(e.target.id==='nuFq'){const q=e.target.value.toLowerCase();section.querySelectorAll('.nu-food').forEach((el,i)=>{el.style.display=FOODS[i]&&!FOODS[i][0].toLowerCase().includes(q)?'none':'';});}});
section.addEventListener('click',async e=>{
 const b=e.target.closest('[data-nu]');if(!b||b.tagName==='INPUT')return;const a=b.dataset.nu,f=FT(),pid=sel(),P=person(pid),n=N(P);
 if(a==='who'){window.Fitness.select(b.dataset.id);adding=null;}
 else if(a==='dprev'){dayView=addDays(dayView,-1);adding=null;}
 else if(a==='dnext'){dayView=addDays(dayView,1);adding=null;}
 else if(a==='targets'){showTargets=!showTargets;showPattern=false;}
 else if(a==='pattern'){showPattern=!showPattern;showTargets=false;}
 else if(a==='setpat'){const k=b.dataset.v;n.pattern=k;if(k!=='custom')n.slots=mkSlots(k);else if(!n.slots.length)n.slots=mkSlots('classic');if(PATTERNS[k].fast)n.fastGoal=PATTERNS[k].fast;if(k!=='custom')showPattern=false;toast(`${P.name}: ${PATTERNS[k].label}`);}
 else if(a==='savecustom'){const names=document.getElementById('nuCustom').value.split(',').map(s=>s.trim()).filter(Boolean).slice(0,8);if(!names.length){toast('Name at least one meal.');return;}n.slots=names.map((nm,i)=>({id:'s'+(i+1),name:nm.slice(0,24),time:''}));toast('Meals saved.');}
 else if(a==='savetargets'){n.targets={cal:num('tgCal'),p:num('tgP'),c:num('tgC'),f:num('tgF')};P.goals={...P.goals,calories:n.targets.cal,protein:n.targets.p};showTargets=false;toast('Targets saved.');}
 else if(a==='calc'){const pr={sex:document.getElementById('pfSex').value,age:num('pfAge'),heightIn:(num('pfFt')||0)*12+(num('pfIn')||0),weightLb:num('pfWt'),activity:+document.getElementById('pfAct').value,goal:+document.getElementById('pfGoal').value,proteinPerLb:+document.getElementById('pfPro').value};
  if(!pr.age||!pr.heightIn||!pr.weightLb){toast('Enter age, height and weight.');return;}const r=calcTargets(pr);n.profile=pr;n.targets={cal:r.cal,p:r.p,c:r.c,f:r.f};P.goals={...P.goals,calories:r.cal,protein:r.p};showTargets=false;
  toast(`${r.cal} cal · ${r.p}P ${r.c}C ${r.f}F (maintenance ≈ ${r.tdee})${r.low?' · raised to a safe minimum':''}`);}
 else if(a==='goal'){n.fastGoal=+b.dataset.v;}
 else if(a==='startfast'){startFast(pid,n.fastGoal);toast(`${n.fastGoal}h fast started. You’ve got this.`);}
 else if(a==='startearlier'){const v=prompt('When did you stop eating? (e.g. 8:30 pm, or 20:30)');if(!v)return;const t=parseTime(v);if(!t){toast('Couldn’t read that time.');return;}startFast(pid,n.fastGoal,t);toast('Fast started at '+new Date(t).toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'})+'.');}
 else if(a==='endfast'){const x=endFast(pid);const h=(new Date(x.end)-new Date(x.start))/36e5;toast(h>=x.goal?`🎉 ${h.toFixed(1)} h fast. Goal reached!`:`Fast ended at ${h.toFixed(1)} h (goal ${x.goal} h).`);}
 else if(a==='cancelfast'){if(!confirm('Cancel this fast without saving it?'))return;f.fasts=f.fasts.filter(x=>x!==activeFast(pid));}
 else if(a==='editstart'){const x=activeFast(pid);const v=prompt('When did this fast start? (e.g. 8:30 pm)');if(!v)return;const t=parseTime(v);if(!t){toast('Couldn’t read that time.');return;}x.start=t;}
 else if(a==='add'){adding=adding===b.dataset.s?null:b.dataset.s;usdaRes=null;estimate=null;render2();return;}
 else if(a==='closeadd'){adding=null;estimate=null;render2();return;}
 else if(a==='addtab'){addTab=b.dataset.v;if(addTab!=='custom')estimate=null;render2();return;}
 else if(a==='addrecent'||a==='addmine'||a==='addcommon'||a==='addusda'){let item;
  if(a==='addrecent'){const L=f.logs.filter(l=>l.kind==='meal'&&l.personId===pid&&l.note).sort((x,y)=>(y.created||'').localeCompare(x.created||''));const rec=[];for(const l of L){if(!rec.some(r=>r.name.toLowerCase()===l.note.toLowerCase()))rec.push({name:l.note,cal:l.calories,p:l.protein,c:l.carbs,f:l.fat});}item=rec[+b.dataset.i];}
  else if(a==='addmine')item=f.myMeals[+b.dataset.i];
  else if(a==='addcommon'){const x=FOODS[+b.dataset.i],q=parseFloat(section.querySelector(`.nu-qty[data-i="${b.dataset.i}"]`)?.value)||1;item={name:(q!==1?q+' × ':'')+x[0],cal:x[3]*q,p:x[4]*q,c:x[5]*q,f:x[6]*q};}
  else{const x=usdaRes.items[+b.dataset.i],g=parseFloat(section.querySelector(`.nu-g[data-i="${b.dataset.i}"]`)?.value)||100,k=g/100;item={name:`${x.name} (${g} g)`,cal:x.cal*k,p:x.p*k,c:x.c*k,f:x.f*k};}
  addFood(pid,item,adding,dayView);toast('Added '+item.name+'.');}
 else if(a==='addcustom'){const name=document.getElementById('cuName').value.trim(),cal=num('cuCal');if(!name&&!cal){toast('Enter a food or calories.');return;}addFood(pid,{name:name||'Food',cal,p:num('cuP'),c:num('cuC'),f:num('cuF')},adding,dayView);estimate=null;toast('Added.');}
 else if(a==='savemine'){const name=document.getElementById('mmName').value.trim(),m=document.getElementById('mmMac').value.split(/[,\s]+/).map(Number);if(!name||!(m[0]>0)){toast('Enter a name and at least calories.');return;}f.myMeals.push({name,cal:m[0],p:m[1]||0,c:m[2]||0,f:m[3]||0});toast('Meal saved.');}
 else if(a==='delmine'){f.myMeals.splice(+b.dataset.i,1);}
 else if(a==='delfood'){f.logs=f.logs.filter(l=>l.id!==b.dataset.id);}
 else if(a==='usda'){const q=document.getElementById('usQ').value.trim();if(!q)return;usdaRes={items:[]};b.disabled=true;b.textContent='…';usdaRes=await usdaSearch(q);render2();return;}
 else if(a==='estimate'){const q=document.getElementById('aiFood').value.trim();if(!q)return;b.disabled=true;b.textContent='Estimating…';
  try{const r=await window.VectorAI.interpret(`ESTIMATE REQUEST. Estimate the nutrition of this food for ${P.name}: "${q}". Reply with exactly one fitness meal action (fit_type "meal") with note, calories, protein, carbs and fat for the amount described (one typical serving if no amount).`);
   const m=(r.actions||[]).find(x=>x.kind==='fit'&&x.fkind==='meal');if(!m)throw new Error(r.reply||'No estimate came back.');estimate={name:m.note||q,cal:m.calories,p:m.protein,c:m.carbs,f:m.fat};addTab='custom';}
  catch(err){toast(err.message);}render2();return;}
 else if(a==='pweek'){planWeek=+b.dataset.v;render2();return;}
 else if(a==='plan'){const sl=n.slots.find(x=>x.id===b.dataset.s),cur=(planFor(pid)[b.dataset.d]||{})[b.dataset.s]||'';const v=prompt(`${sl?sl.name:'Meal'} on ${pd(b.dataset.d).toLocaleDateString(undefined,{weekday:'long',month:'short',day:'numeric'})}`,cur);if(v===null)return;setPlan(pid,b.dataset.d,b.dataset.s,v.trim());}
 else if(a==='copyweek'){const t=pd(day()),s=new Date(t);s.setDate(t.getDate()-t.getDay()+7*planWeek);let c=0;for(let i=0;i<7;i++){const d=new Date(s);d.setDate(s.getDate()+i);const from=addDays(day(d),-7),src=planFor(pid)[from];if(src){planFor(pid)[day(d)]={...src};c++;}}toast(c?`Copied ${c} day${c>1?'s':''}.`:'Nothing planned last week to copy.');}
 else return;
 persist();
});
function parseTime(v){const m=String(v).trim().toLowerCase().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);if(!m)return null;let h=+m[1],mi=+(m[2]||0);if(m[3]==='pm'&&h<12)h+=12;if(m[3]==='am'&&h===12)h=0;if(h>23||mi>59)return null;const d=new Date();d.setHours(h,mi,0,0);if(d>new Date())d.setDate(d.getDate()-1);return d.toISOString();}
async function usdaSearch(q){
 const key=(()=>{try{return localStorage.getItem('usdaKey')||'DEMO_KEY';}catch(_){return 'DEMO_KEY';}})();
 try{const r=await fetch(`https://api.nal.usda.gov/fdc/v1/foods/search?query=${encodeURIComponent(q)}&pageSize=12&dataType=Foundation,SR%20Legacy,Survey%20(FNDDS)&api_key=${encodeURIComponent(key)}`);
  if(r.status===429)return {error:'The free USDA demo key is busy. Try again later, or add your own free key in Settings.'};if(!r.ok)return {error:'USDA search failed ('+r.status+').'};
  const j=await r.json(),pick=(f,ids)=>{const n=(f.foodNutrients||[]).find(x=>ids.includes(String(x.nutrientNumber))||ids.includes(String(x.nutrientId)));return n?+n.value||0:0;};
  // calories: older entries use 208/1008, Foundation foods often only have Atwater energy (957/958, 2047/2048); always kcal, never kJ
  const kcal=f=>{const L=(f.foodNutrients||[]).filter(x=>/kcal/i.test(x.unitName||'')&&/energy/i.test(x.nutrientName||'energy'));const by=ids=>L.find(x=>ids.includes(String(x.nutrientNumber))||ids.includes(String(x.nutrientId)));const n=by(['208','1008'])||by(['958','2048'])||by(['957','2047'])||L[0];return n?+n.value||0:0;};
  const items=(j.foods||[]).map(f=>({name:f.description.charAt(0)+f.description.slice(1).toLowerCase(),serv:'per 100 g',cal:kcal(f),p:pick(f,['203','1003']),c:pick(f,['205','1005']),f:pick(f,['204','1004'])})).filter(x=>x.cal>0);
  return items.length?{items}:{error:'No matches. Try simpler words.'};}
 catch(e){return {error:'Couldn’t reach USDA (offline?). Common foods and Custom still work.'};}
}
const baseRender=window.render;
window.render=function(){baseRender.apply(this,arguments);if(view==='meals')render2();};
// optional: your own free USDA key (api.data.gov) instead of the shared demo key
const kp=document.createElement('div');kp.className='panel';
kp.innerHTML=`<h2>🥗 Food search</h2><p class="hint" style="margin:0 0 8px">Meals → Search USDA uses USDA FoodData Central (public domain). It works with a shared demo key that can get busy. A free personal key from api.data.gov avoids that.</p><label>USDA API key (optional)</label><input id="usdaKey" autocomplete="off" placeholder="DEMO_KEY"><button class="btn alt sm" style="margin-top:8px" id="usdaSave">Save key</button>`;
document.getElementById('settings').appendChild(kp);
kp.querySelector('#usdaKey').value=(()=>{try{return localStorage.getItem('usdaKey')||'';}catch(_){return '';}})();
kp.querySelector('#usdaSave').addEventListener('click',()=>{const v=kp.querySelector('#usdaKey').value.trim();try{v?localStorage.setItem('usdaKey',v):localStorage.removeItem('usdaKey');}catch(_){}toast(v?'USDA key saved.':'Using the shared demo key.');});
})();
