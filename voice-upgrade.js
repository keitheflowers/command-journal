/* The Family Save multi-action voice interpreter v2 */
(function(){
'use strict';
function norm(s){return String(s||'').toLowerCase().replace(/[^a-z0-9 ]/g,' ').replace(/\b(the|a|an|my|task|to|for|please|i|need|want|me|that|is|as)\b/g,' ').replace(/\s+/g,' ').trim();}
function findTask(q){
  let query=norm(q),open=data.tasks.filter(t=>t.status!=='done');
  if(!query)return {error:'No task name provided'};
  let exact=open.filter(t=>norm(t.title)===query);
  if(exact.length===1)return {task:exact[0]};
  let contains=open.filter(t=>norm(t.title).includes(query));
  if(contains.length===1)return {task:contains[0]};
  let words=query.split(' ').filter(x=>x.length>2);
  let ranked=open.map(t=>{let tw=norm(t.title).split(' ');let hits=words.filter(w=>tw.some(x=>x===w||(w.length>=5&&x.startsWith(w)))).length;return {task:t,hits,score:words.length?hits/words.length:0};}).sort((a,b)=>b.score-a.score);
  if(ranked[0]&&ranked[0].hits>=2&&ranked[0].score>=.7&&(!ranked[1]||ranked[0].score>ranked[1].score+.15))return {task:ranked[0].task};
  return {error:'Task not uniquely identified: '+q};
}
// ---- Spoken dates -----------------------------------------------------
// Finds one date phrase ("Friday", "next Tuesday", "November 12th", "the 20th",
// "in 3 days", "11/12", "due Friday") and returns it with the phrase removed.
const DAYS=['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
const MON='(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
const NUMW={a:1,an:1,one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10,eleven:11,twelve:12};
const PRE='(?:\\b(on|for|by|due(?:\\s+on|\\s+by)?|to|until|till|at)\\s+)?';
const ds=d=>day(d);
function future(y,m,d){let t=new Date(y,m,d);if(ds(t)<day())t=new Date(y+1,m,d);return ds(t);}
function monthIndex(w){return ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'].indexOf(w.slice(0,3).toLowerCase());}
function parseWhen(text){
  const now=new Date(),Y=now.getFullYear(),M=now.getMonth(),D=now.getDate();
  const rules=[
    [/\bthe day after tomorrow\b|\bday after tomorrow\b/,()=>plusDays(day(),2)],
    [/\b(?:tomorrow|tmrw)\b/,()=>plusDays(day(),1)],
    [/\byesterday\b/,()=>plusDays(day(),-1)],
    [/\b(?:today|tonight|this (?:morning|afternoon|evening))\b/,()=>day()],
    [/\bin (\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve) (days?|weeks?)\b/,m=>{let n=/\d/.test(m[1])?+m[1]:NUMW[m[1]];return plusDays(day(),n*(m[2][0]==='w'?7:1));}],
    [/\bnext week\b/,()=>{let d=new Date(Y,M,D);d.setDate(d.getDate()+((8-d.getDay())%7||7));return ds(d);}],
    [/\b(?:this |next )?weekend\b/,m=>{let d=new Date(Y,M,D);let k=(6-d.getDay()+7)%7||7;if(/next/.test(m[0])&&k<7)k+=7;d.setDate(d.getDate()+k);return ds(d);}],
    [new RegExp('\\b'+MON+'\\.? (\\d{1,2})(?:st|nd|rd|th)?(?:,? (\\d{4}))?\\b'),m=>m[3]?ds(new Date(+m[3],monthIndex(m[1]),+m[2])):future(Y,monthIndex(m[1]),+m[2])],
    [new RegExp('\\b(?:the )?(\\d{1,2})(?:st|nd|rd|th)? of '+MON+'\\b'),m=>future(Y,monthIndex(m[2]),+m[1])],
    [/\b(?:the )(\d{1,2})(?:st|nd|rd|th)\b/,m=>{let d=+m[1];let t=new Date(Y,M,d);if(ds(t)<day())t=new Date(Y,M+1,d);return ds(t);}],
    [/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/,m=>m[3]?ds(new Date(m[3].length===2?2000+ +m[3]:+m[3],+m[1]-1,+m[2])):future(Y,+m[1]-1,+m[2])],
    [new RegExp('\\b(this |next |this coming )?('+DAYS.join('|')+')\\b'),m=>{let t=DAYS.indexOf(m[2]),k=(t-now.getDay()+7)%7||7;if(/next/.test(m[1]||'')&&now.getDay()+k<=6)k+=7;return plusDays(day(),k);}]
  ];
  for(const [core,fn] of rules){
    const re=new RegExp(PRE+'(?:'+core.source+')','i');
    const m=text.match(re);if(!m)continue;
    // Re-run the core alone to get its own capture groups.
    const c=m[0].slice(m[1]?m[0].toLowerCase().indexOf(m[1].toLowerCase())+m[1].length:0).trim().toLowerCase().match(new RegExp(core.source,'i'));
    const date=c&&fn(c);if(!date||!/^\d{4}-\d{2}-\d{2}$/.test(date))continue;
    const due=/^(?:by|due)/i.test(m[1]||'');
    let left=text.slice(0,m.index),right=text.slice(m.index+m[0].length);
    // "Friday November 13" / "November 13, Friday": drop the redundant weekday too.
    const wd='(?:'+DAYS.join('|')+')';
    left=left.replace(new RegExp('(?:\\b(?:on|for)\\s+)?\\b'+wd+',?\\s*$','i'),'');
    right=right.replace(new RegExp('^,?\\s*'+wd+'\\b','i'),'');
    const rest=(left+' '+right).replace(/\s+/g,' ').trim();
    return {date,due,text:rest};
  }
  return null;
}
window.parseSpokenDate=parseWhen;
// ---- Spoken money ("spent 45 on groceries", "got paid 2,100", "paid the electric bill")
const AMT=/\$\s?(\d[\d,]*(?:\.\d{1,2})?)|\b(\d[\d,]*(?:\.\d{1,2})?)\s*(?:dollars?|bucks)?(?:\s+and\s+(\d{1,2})\s+cents?)?\b/i;
function takeAmount(text){
  const m=text.match(AMT);if(!m)return null;
  let n=parseFloat((m[1]||m[2]).replace(/,/g,''));if(m[3])n+=(+m[3])/100;
  if(!(n>0)||n>10000000)return null;
  return {cents:Math.round(n*100),text:(text.slice(0,m.index)+' '+text.slice(m.index+m[0].length)).replace(/\s+/g,' ').trim()};
}
const tidyNote=t=>t.replace(/^(?:on|for|at|from|to|in)\s+/i,'').replace(/\s+(?:on|for|at|from|to)$/i,'').replace(/^(?:the|my|a|an)\s+/i,'').replace(/[.,;]+$/,'').trim();
// ---- Spoken fitness ("I ran 3 miles in 30 minutes", "Amanda walked 20 minutes", "I weigh 182")
const WORDN={a:1,an:1,one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10,eleven:11,twelve:12};
const numw=v=>v==null?null:/\d/.test(v)?parseFloat(String(v).replace(/,/g,'')):WORDN[String(v).toLowerCase()]??null;
const ACTS=[[/\b(ran|run|running|jog|jogged|jogging)\b/,'run'],[/\b(walk|walked|walking)\b/,'walk'],[/\b(bike|biked|biking|cycled|cycling|rode|spin)\b/,'bike'],[/\b(swam|swim|swimming)\b/,'swim'],[/\b(lift|lifted|lifting|weights|strength|gym|worked out|workout|work out)\b/,'strength'],[/\b(yoga|stretch|stretched)\b/,'yoga'],[/\b(hike|hiked|hiking)\b/,'hike'],[/\b(played|basketball|soccer|football|tennis|pickleball|golf)\b/,'sports']];
function parseFitness(part){
  if(!window.Fitness)return null;
  let text=part,who=null;
  // leading family member name, or "for Amanda" anywhere
  for(const p of window.Fitness.people()){const n=p.name.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    let m=text.match(new RegExp('^'+n+"(?:'s)?\\s+",'i'));if(m){who=p;text=text.slice(m[0].length);break;}
    m=text.match(new RegExp('\\s+for\\s+'+n+'\\b','i'));if(m){who=p;text=text.replace(m[0],' ');break;}}
  text=text.replace(/^(?:i|we)\s+(?:just\s+)?/i,'').replace(/^(?:log|add|record)\s+(?:a\s+)?/i,'').trim();
  const P=who||window.Fitness.person();
  let date=day(),w=parseWhen(text);if(w&&!w.due){date=w.date;text=w.text;}
  const t=text.toLowerCase(),base={kind:'fit',personId:P.id,who:P.name,date};
  let m;
  if((m=t.match(/^(?:weigh|weighed|weigh in at|weighed in at|weight(?: is| was)?)\s+(\d{2,3}(?:\.\d)?)/)))return {...base,fkind:'weight',value:+m[1]};
  if((m=t.match(/(\d[\d,]*)\s+steps\b/)))return {...base,fkind:'steps',value:numw(m[1])};
  if((m=t.match(/^(?:drank|had|drink)\s+(\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:glass(?:es)?|cups?|bottles?)\s+of\s+water/)))return {...base,fkind:'water',value:numw(m[1])};
  if((m=t.match(/^(?:slept|got)\s+(\d+(?:\.\d+)?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s*(?:and a half\s*)?(?:hours?|hrs?)(?:\s+of\s+sleep)?/)))return {...base,fkind:'sleep',value:numw(m[1])+(/and a half/.test(t)?0.5:0)};
  if((m=t.match(/^(?:ate|had|eaten|eat)\s+(.+?)[,\s]+(\d{2,4})\s*(?:calories|cals?|kcal)\b/))){const pr=t.match(/(\d{1,3})\s*(?:g|grams?)\s+(?:of\s+)?protein/);return {...base,fkind:'meal',note:m[1].replace(/\s+(?:for|at)\s+(?:breakfast|lunch|dinner)$/,'').replace(/^(?:a|an|some|my)\s+/,'').trim(),calories:+m[2],protein:pr?+pr[1]:null};}
  const act=ACTS.find(([re])=>re.test(t));
  const mins=t.match(/(\d+(?:\.\d+)?|an?|one|two|half an?)\s*(hours?|hrs?|minutes?|mins?)\b/),miles=t.match(/(\d+(?:\.\d+)?)\s*(miles?|mi|km|kilometers?|k)\b/);
  if(act&&(mins||miles||/^(?:spent|did|went)/.test(t)||ACTS.some(([re])=>re.test(t.split(' ')[0])))&&(mins||miles)){
    let minutes=null;if(mins){const v=/half/.test(mins[1])?0.5:numw(mins[1]);minutes=Math.round(/^h/.test(mins[2])?v*60:v);}
    let mi=null;if(miles){mi=+miles[1];if(/^k/.test(miles[2]))mi=Math.round(mi*0.621*10)/10;}
    return {...base,fkind:'workout',activity:act[1],minutes,miles:mi};
  }
  return null;
}
// ---- Savings goals & grocery list -------------------------------------
const MONTHS=['january','february','march','april','may','june','july','august','september','october','november','december'];
function monthEnd(text){
  const m=text.match(/\b(?:by|in|before|until|for)\s+(?:the\s+end\s+of\s+)?(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?|christmas|summer|next year|the end of the year)(?:\s+(\d{4}))?\b/i);
  if(!m)return null;const w=m[1].toLowerCase(),now=new Date(),Y=m[2]?+m[2]:now.getFullYear();let d;
  if(w==='christmas')d=new Date(Y,11,25);else if(w==='summer')d=new Date(Y,5,21);else if(w==='next year')d=new Date(now.getFullYear()+1,0,1);else if(w==='the end of the year')d=new Date(Y,11,31);
  else{const i=MONTHS.findIndex(x=>x.startsWith(w.slice(0,3)));d=new Date(Y,i+1,0);}
  if(!m[2]&&day(d)<day())d.setFullYear(d.getFullYear()+1);
  return {date:day(d),text:(text.slice(0,m.index)+' '+text.slice(m.index+m[0].length)).replace(/\s+/g,' ').trim()};
}
// ---- Strength: "plan chest day: flat bench 225 for 15, 315 for 10" / "I did chest day: bench 225 for 10, 315 for 8"
const WD=[['sun'],['mon'],['tue','tues'],['wed'],['thu','thur','thurs'],['fri'],['sat']];
function takeDays(text){
  const days=new Set();const re=/\b(?:on\s+|every\s+)?(sun|mon|tues?|wed(?:nes)?|thu(?:rs?)?|fri|sat(?:ur)?)(?:days?)?\b(?:\s*(?:,|and|&)\s*)?/gi;
  const out=text.replace(re,(m,d)=>{const i=WD.findIndex(a=>a.some(x=>d.toLowerCase().startsWith(x)));if(i>=0)days.add(i);return ' ';});
  return {days:[...days].sort(),text:out.replace(/\s+/g,' ').trim()};
}
function strengthPerson(text){
  let who=null;if(window.Fitness)for(const p of window.Fitness.people()){const n=p.name.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g,'\\$&');const m=text.match(new RegExp('^'+n+"(?:'s)?\\s+",'i'));if(m){who=p;text=text.slice(m[0].length);break;}}
  return {who:who||(window.Fitness&&window.Fitness.person()),text:text.replace(/^(?:i|we)\s+(?:just\s+)?/i,'')};
}
function parseStrength(part){
  if(!window.Strength||!window.Fitness||!/\d|\b(?:one|two|three|four|five|six|seven|eight|nine|ten|twelve|fifteen|twenty)\b/i.test(part))return null;
  let {who,text}=strengthPerson(part);let m;
  if((m=text.match(/^(?:plan|create|make|build|set up|setup|new|design)\s+(?:a\s+|my\s+)?(?:new\s+)?(?:workout\s+)?(?:plan\s+)?(?:for\s+|called\s+|named\s+)?(.+?\b(?:day|workout|routine|session))\b[\s,:-]*(?:with|as|is|:)?\s*(.+)$/i))){
    const d=takeDays(m[2]),exs=window.Strength.parseSets(d.text).filter(e=>e.name);
    if(!exs.length)return {error:'Say the exercises with weight and reps, e.g. “plan chest day: flat bench 225 for 15, 315 for 10”.'};
    return {kind:'liftplan',personId:who.id,who:who.name,title:m[1].replace(/^(?:my|the)\s+/i,''),days:d.days,exercises:exs};
  }
  if((m=text.match(/^(?:did|finished|completed|crushed|hit|knocked out|done with|logged|log)\s+(.+)$/i))){
    let rest=m[1],date=day();const w=parseWhen(rest);if(w&&!w.due){date=w.date;rest=w.text;}
    let plan=null,pm=rest.match(/^(?:my\s+|the\s+|a\s+)?(.+?\b(?:day|workout|routine|session))\b[\s,:-]*(?:and\s+|with\s+)?(.*)$/i);
    if(pm){plan=window.Strength.findPlan(who.id,pm[1]);if(plan||!pm[2])rest=pm[2]||'';}
    const mins=rest.match(/\b(?:in|took|for)\s+(\d{2,3})\s*(?:min|minutes)\b/i);if(mins)rest=rest.replace(mins[0],' ');
    const exs=window.Strength.parseSets(rest);if(!exs.length)return null;
    if(!plan)plan=window.Strength.matchPlan(who.id,exs.filter(e=>e.name));
    const sess=window.Strength.buildSession({personId:who.id,plan,actual:exs,date,minutes:mins?+mins[1]:null,name:pm&&!plan?pm[1].replace(/\b\w/g,c=>c.toUpperCase()):'Workout'});
    if(!sess.exercises.some(e=>e.actual.length&&e.name))return {error:'Say which exercise, e.g. “I did bench 225 for 10, 315 for 8”.'};
    return {kind:'liftsession',personId:who.id,who:who.name,session:sess};
  }
  return null;
}
function parseBudget(part){
  if(!window.Budget)return null;let m;const B=window.Budget;
  if((m=part.match(/^(?:move|shift|transfer)\s+(.+?)\s+from\s+(?:the\s+|my\s+)?(.+?)\s+(?:to|into)\s+(?:the\s+|my\s+)?(.+?)(?:\s+(?:category|budget))?$/i))){
    const a=takeAmount(m[1]),from=B.findCategory(m[2]),to=B.findCategory(m[3]);if(!a||!from||!to)return null;
    return {kind:'budgetmove',from,to,amount:a.cents,month:day().slice(0,7)};}
  if((m=part.match(/^(?:assign|budget|put|allocate)\s+(.+?)\s+(?:to|for|in|into|toward|towards)\s+(?:the\s+|my\s+)?(.+?)(?:\s+(?:category|budget))?$/i))){
    if(/^put/i.test(part)&&window.Savings&&window.Savings.find(m[2]))return null; // a savings goal wins
    const a=takeAmount(m[1]),c=B.findCategory(m[2]);if(!a||!c)return null;
    return {kind:'budgetassign',to:c,amount:a.cents,month:day().slice(0,7)};}
  return null;
}
function parseSavings(part){
  if(!window.Savings)return null;let m;
  if((m=part.match(/^(?:create|add|start|make|set up|setup|open|new)\s+(?:a\s+)?(?:new\s+)?savings?\s+goal\s+(?:for\s+|called\s+|named\s+)?(.+)$/i))){
    let rest=m[1],deadline=null,me=monthEnd(rest);if(me){deadline=me.date;rest=me.text;}else{const w=parseWhen(rest);if(w){deadline=w.date;rest=w.text;}}
    const a=takeAmount(rest);if(!a)return {error:'Say the target, e.g. “create a savings goal Vacation 3,000 by June”'};
    const name=a.text.replace(/\b(?:of|for|to|by|with a target of|target|goal)\b/gi,' ').replace(/\s+/g,' ').trim();
    if(!name)return {error:'Say a name for the goal.'};
    return {kind:'goalnew',title:name[0].toUpperCase()+name.slice(1),amount:a.cents,date:deadline};
  }
  const dep=part.match(/^(?:put|add|save|saved|move|moved|transfer|transferred|deposit|deposited|set aside|stash|stashed)\s+(.+?)\s+(?:to|toward|towards|into|in|for|on)\s+(?:the\s+|my\s+|our\s+)?(.+?)(?:\s+(?:fund|goal|savings))?$/i);
  const wd=part.match(/^(?:take|took|withdraw|withdrew|pull|pulled|use|used|spent|spend)\s+(.+?)\s+(?:out of|from)\s+(?:the\s+|my\s+|our\s+)?(.+?)(?:\s+(?:fund|goal|savings))?$/i);
  const hit=dep||wd;if(!hit)return null;
  let rest=hit[1],date=day(),w=parseWhen(hit[2]);let target=hit[2];if(w&&!w.due){date=w.date;target=w.text;}
  const g=window.Savings.find(target);
  if(!g){const clear=/^(?:put|save|saved|stash|stashed|set aside|deposit|deposited|transfer|transferred|withdraw|withdrew|took|take)\b/i.test(part)&&takeAmount(rest)&&!/\b(?:task|list|calendar|tomorrow|today|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i.test(target);
   return clear?{error:'No savings goal called “'+target+'”. Create it first, e.g. “create a savings goal '+target+' 1,000”.'}:null;}const a=takeAmount(rest);if(!a)return {error:'Say how much, e.g. “put 200 toward '+g.name+'”'};
  if(wd&&a.cents>window.Savings.saved(g))return {error:'Only '+window.Finance.money(window.Savings.saved(g))+' is saved in '+g.name+'.'};
  return {kind:'goaladd',id:g.id,title:g.name,amount:wd?-a.cents:a.cents,date};
}
function parseGrocery(part){
  if(!window.Grocery)return null;
  const m=part.match(/^(?:add|put)\s+(.+?)\s+(?:to|on)\s+(?:the\s+|my\s+|our\s+)?(?:grocery|groceries|shopping)(?:\s+list)?$/i)||part.match(/^(?:we\s+need|we'?re\s+out\s+of|we\s+are\s+out\s+of|we\s+ran\s+out\s+of)\s+(?!to\b)(.+?)$/i);
  if(!m)return null;const items=window.Grocery.splitList(m[1].replace(/\s+(?:from the (?:grocery )?store|at the store)$/i,''));
  return items.length?{kind:'grocery',items}:null;
}
function parseMoney(part){
  if(!window.Finance)return null;
  let m=part.match(/^(?:add|log|record)\s+(?:an?\s+)?(expense|income)\s+(?:of\s+)?(.+)$/i),type,rest,verb='';
  if(m){type=m[1].toLowerCase();rest=m[2];}
  else if((m=part.match(/^(spent|spend|paid|pay|bought|purchased)\s+(.+)$/i))){type='expense';verb=m[1].toLowerCase();rest=m[2];}
  else if((m=part.match(/^(earned|received|got paid|get paid|made|deposited|got)\s+(.+)$/i))){type='income';verb=m[1].toLowerCase();rest=m[2];}
  else return null;
  let date=day(),w=parseWhen(rest);if(w&&!w.due){date=w.date;rest=w.text;}
  const a=takeAmount(rest);
  if(type==='expense'&&/^pa(?:id|y)$/.test(verb)){
    const bill=window.Finance.findBill(tidyNote(a?a.text:rest));
    if(bill)return {kind:'billpaid',id:bill.id,title:bill.name,amount:a?a.cents:bill.amount,date};
  }
  if(!a)return {error:'Say the amount, e.g. “spent 45 on groceries”'};
  const note=tidyNote(a.text);
  let category=window.Finance.guessCategory(note,type);
  if(category==='Other income'&&/paid/.test(verb))category='Paycheck';
  return {kind:'txn',type,amount:a.cents,note,category,date};
}
function parse(raw){
  let line=raw.trim().replace(/[.!?]+$/g,'').replace(/^(?:hey\s+)?command journal[, :]*\s*/i,'').replace(/^(?:okay|ok|please)[, ]+/i,'');
  // Android dictation sometimes hears "add task" as "attest".
  // Confirm the recognized task title before saving.
  line=line.replace(/^(?:attest|a test|at task|add test|a task|atask)\s+/i,'add task ');
  line=line.replace(/([;,]\s*)(?:attest|a test|at task|add test|a task|atask)\s+/gi,'$1add task ');
  line=line.replace(/\b(?:and|then|also)\s+(?:attest|a test|at task|add test|a task|atask)\s+/gi,' and add task ');
  line=line.replace(/\b(?:and|then|also)\s+(?=(?:(?:i|we)\s+)?(?:add|create|make|schedule|complete|completed|finish|finished|mark|move|reschedule|push|spent|paid|bought|earned|received|got paid|deposited|ran|walked|jogged|biked|swam|lifted|worked out|slept|drank|weigh|weighed|ate|put|took|withdrew|transferred|moved|set aside)\b)/gi,'; ');
  line=line.replace(/[,;]\s*(?=(?:(?:i|we)\s+)?(?:add|create|make|schedule|complete|completed|finish|finished|mark|move|reschedule|push|spent|paid|bought|earned|received|got paid|deposited|ran|walked|jogged|biked|swam|lifted|worked out|slept|drank|weigh|weighed|ate|put|took|withdrew|transferred|moved|set aside)\b)/gi,'; ');
  line=line.replace(/\s+(?=(?:add|create|make|schedule|complete|completed|finish|finished|mark|move|reschedule|push)\s+(?:a\s+)?(?:task\b|my\b|the\b))/gi,'; ');
  // "...and Amanda walked 20 minutes": split before a family member's name followed by an activity
  if(window.Fitness){const fam=window.Fitness.people().map(p=>p.name.toLowerCase().replace(/[^a-z ]/g,'').trim()).filter(Boolean).map(n=>n.replace(/\s+/g,'\\s+'));
   if(fam.length)line=line.replace(new RegExp('\\b(?:and|then|also)\\s+(?=(?:'+fam.join('|')+')\\s+(?:ran|walked|jogged|biked|swam|lifted|worked out|did|slept|drank|weighs?|weighed|ate|plan)\\b)','gi'),'; ');}
  let parts=line.split(/\s*;\s*/).map(x=>x.trim()).filter(Boolean),actions=[],errors=[];
  if(parts.length>12)return {actions,errors:['Maximum 12 instructions per update']};
  for(let part of parts){
    part=part.replace(/^(?:i\s+)?(?:have\s+)?(?:just\s+)?(?:please\s+)?/i,'').trim();
    if(/^(?:add|put)\s.+\s(?:to|on)\s(?:the\s|my\s|our\s)?(?:grocery|groceries|shopping)(?:\slist)?$/i.test(part)||/^we/i.test(part)){const gr=parseGrocery(part);if(gr){actions.push(gr);continue;}}
    {const st=parseStrength(part);if(st){if(st.error)errors.push(st.error);else actions.push(st);continue;}}
    {const bm=parseBudget(part);if(bm){actions.push(bm);continue;}}
    {const sv=parseSavings(part);if(sv){if(sv.error)errors.push(sv.error);else actions.push(sv);continue;}}
    const taskish=/^(?:add|create|make|schedule|remind|move|reschedule|push|complete|completed|finish|finished|mark|update)\b/i.test(part)&&!/^(?:add|log|record)\s+(?:a\s+)?(?:workout|run|walk|weigh|meal)/i.test(part);
    let fitA=!taskish&&/\b(minutes?|mins?|hours?|miles?|km|steps|calories|water|slept|weigh|weighed|\d+(?:\.\d+)?\s*k)\b/i.test(part)?parseFitness(part):null;
    if(fitA){actions.push(fitA);continue;}
    let money=parseMoney(part);
    if(money){if(money.error)errors.push(money.error);else actions.push(money);continue;}
    let done=part.match(/^(?:complete|completed|finish|finished|mark(?:\s+(?:as|it))?\s+(?:complete|done))\s+(?:the\s+|my\s+)?(?:task\s+)?(.+)$/i);
    if(!done){let m=part.match(/^update\s+(?:task\s+)?(.+?)\s+(?:as\s+)?(?:complete|completed|done)$/i);if(m)done=[part,m[1]];}
    let move=null,mv=part.match(/^(?:move|reschedule|push)\s+(?:the\s+|my\s+)?(?:task\s+)?(.+)$/i);
    if(mv){let w=parseWhen(mv[1]);if(w)move=[part,w.text.replace(/\s+(?:to|until|till|for|on)$/i,'').trim(),w.date];else{errors.push('Say when to move it, e.g. “move '+mv[1]+' to Friday”');continue;}}
    let add=part.match(/^(?:add|create|make|schedule|remind me to)\s+(?:a\s+|the\s+)?(?:task\s+)?(?:for\s+)?(.+)$/i);
    if(done||move){
      let q=(done||move)[1].replace(/\s+(?:as\s+)?(?:complete|completed|done)$/i,'');
      let found=findTask(q);
      if(found.task)actions.push({kind:done?'complete':'move',id:found.task.id,title:found.task.title,date:move?move[2]:plusDays(day(),1)});
      else errors.push(found.error);
    }else if(add){
      let title=add[1].replace(/^for\s+tomorrow\s+to\s+/i,'').replace(/^tomorrow\s+to\s+/i,'').replace(/^to\s+/i,'');
      let date=day(),due='',w=parseWhen(title);
      if(w){title=w.text;if(w.due)due=w.date;else date=w.date;}
      let p=title.match(/\bpriority\s+(high|medium|low)\b|\b(high|medium|low)\s+priority\b/i);
      let priority=p?(p[1]||p[2]):'Medium';priority=priority[0].toUpperCase()+priority.slice(1).toLowerCase();
      title=title.replace(/\bpriority\s+(?:high|medium|low)\b/ig,'').replace(/\b(?:high|medium|low)\s+priority\b/ig,'').replace(/\s+(?:on|for|to)$/i,'').replace(/\s+/g,' ').trim().replace(/^(?:to\s+|for\s+)/i,'').replace(/[.,;]+$/,'');
      if(!title||title.length>180)errors.push('Invalid task title: '+part);
      else{
        let area=/\b(?:bci|project reports|accountant)\b/i.test(title)?'BCI / Career':/\b(?:family|kids|wife)\b/i.test(title)?'Family / Personal':/\b(?:faith|scripture|prayer)\b/i.test(title)?'Faith / Growth':'Vector AI';
        actions.push({kind:'add',title,date,due,priority,area});
      }
    }else errors.push('Unrecognized instruction: '+part);
  }
  let seen=new Set();actions=actions.filter(a=>{let key=a.kind==='add'||a.kind==='complete'||a.kind==='move'?a.kind+':'+(a.id||norm(a.title)+a.date):JSON.stringify(a);/* drop exact repeats only */if(seen.has(key))return false;seen.add(key);return true;});
  return {actions,errors};
}
let pending=null;
let seq=0;window.lastVectorReply='';
window.interpretCommand=async function(){
  let raw=document.getElementById('command').value.trim();if(!raw)return toast('Speak or type an update.');
  pending=null;window.lastVectorReply='';
  let box=document.getElementById('commandPreview');box.classList.remove('hidden');
  let result=null,usedAI=false,my=++seq;
  if(window.VectorAI&&window.VectorAI.enabled()&&navigator.onLine!==false){
    box.innerHTML='<strong>🧠 Vector is thinking…</strong>';
    var aiErr='';try{result=await window.VectorAI.interpret(raw);usedAI=true;}catch(e){aiErr=e.message;toast(e.message+' Using built-in rules.');}
    if(my!==seq||document.getElementById('command').value.trim()!==raw)return; // superseded or edited meanwhile
  }
  if(!result)result=parse(raw);
  let actions=result.actions,errors=result.errors,reply=result.reply||'';
  if(!actions.length){
    if(reply){window.lastVectorReply=reply;box.innerHTML='<strong>Vector</strong><p class="hint" style="font-size:14px;color:#e3eef6">'+esc(reply)+'</p>'+(errors.length?'<p class="hint">'+errors.map(esc).join('; ')+'</p>':'');return;}
    box.innerHTML='<strong>No changes made.</strong><p class="hint">'+errors.map(esc).join('; ')+'</p>'+(typeof aiErr!=='undefined'&&aiErr?'<p class="hint" style="color:#ff8a8a">Vector AI didn’t answer: '+esc(aiErr)+'</p>':'');return;
  }
  if(errors.length&&!usedAI){box.innerHTML='<strong>No changes made.</strong><p class="hint">'+errors.map(esc).join('; ')+'</p>';if(typeof aiErr!=='undefined'&&aiErr)box.innerHTML+='<p class="hint" style="color:#ff8a8a">Vector AI didn’t answer: '+esc(aiErr)+'</p>';return;}
  let when=d=>{if(d===day())return 'today';if(d===plusDays(day(),1))return 'tomorrow';const [y,m,dd]=d.split('-').map(Number);const t=new Date(y,m-1,dd);return t.toLocaleDateString(undefined,{weekday:'short',month:'short',day:'numeric',year:y===new Date().getFullYear()?undefined:'numeric'});};
  let $=c=>window.Finance?window.Finance.money(c):'$'+(c/100).toFixed(2);
  let FIT=a=>window.Fitness?window.Fitness.describe({kind:a.fkind,activity:a.activity,minutes:a.minutes,miles:a.miles,value:a.value,note:a.note,calories:a.calories,protein:a.protein}):a.fkind;
  const SETS=s=>{const g=[];for(const x of s){const t=(x.w==null?'?':x.w===0?'BW':x.w)+'×'+x.r;const l=g.at(-1);if(l&&l.t===t)l.n++;else g.push({t,n:1});}return g.map(x=>x.n>1?x.t+' ×'+x.n:x.t).join(', ');};
  const DN=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const LIFT=a=>{const R=window.Strength.analyze(a.session);return a.session.name+' for '+a.who+' · '+when(a.session.date)+' — '+R.map(r=>r.actual.length?r.name+' '+SETS(r.actual)+(r.planned.length?' (plan '+SETS(r.planned)+')':'')+' '+r.verdict.i+' '+r.verdict.t+(r.delta!=null?' '+(r.delta>=0?'+':'−')+Math.abs(Math.round(r.delta*100))+'%':'')+(r.pr?' 🏆 PR':''):r.name+' skipped').join('; ');};
  let items=actions.map(a=>a.kind==='budgetmove'?'Budget: move '+$(a.amount)+' from '+a.from+' to '+a.to:a.kind==='budgetassign'?'Budget: assign '+$(a.amount)+' to '+a.to:a.kind==='liftplan'?'Workout plan for '+a.who+': '+a.title+(a.days.length?' ('+a.days.map(d=>DN[d]).join(', ')+')':'')+' — '+a.exercises.map(e=>e.name+' '+SETS(e.sets)).join('; '):a.kind==='liftsession'?LIFT(a):a.kind==='goalnew'?'New savings goal: '+a.title+' · '+$(a.amount)+(a.date?' · by '+when(a.date):''):a.kind==='goaladd'?(a.amount>0?'Savings: +'+$(a.amount)+' → ':'Savings: −'+$(-a.amount)+' from ')+a.title+' · '+when(a.date):a.kind==='grocery'?'Grocery list: '+a.items.map(i=>(i.qty?i.qty+' ':'')+i.name).join(', '):a.kind==='fit'?'Log for '+a.who+': '+FIT(a)+' · '+when(a.date):a.kind==='mealplan'?'Meal plan: '+a.slot+' '+when(a.date)+' · '+a.note:a.kind==='txn'?(a.type==='income'?'Income: ':'Expense: ')+$(a.amount)+' · '+a.category+(a.note?' · '+a.note:'')+' · '+when(a.date):a.kind==='billpaid'?'Bill paid: '+a.title+' · '+$(a.amount)+' · '+when(a.date):a.kind==='add'?'Add: '+a.title+' · '+when(a.date)+(a.due?' · due '+when(a.due):'')+' · '+a.priority+' priority · '+a.area:a.kind==='complete'?'Complete: '+a.title:'Move to '+when(a.date)+': '+a.title);
  box.innerHTML=(typeof aiErr!=='undefined'&&aiErr?'<p class="hint" style="margin:0 0 8px;color:#ff8a8a">Vector AI didn’t answer: '+esc(aiErr)+' Used the built-in rules instead.</p>':'')+(reply?'<p class="hint" style="margin:0 0 8px;color:#cdeefa">🧠 '+esc(reply)+'</p>':'')+(errors.length?'<p class="hint" style="margin:0 0 8px">Skipped: '+errors.map(esc).join('; ')+'</p>':'')+'<strong>Review '+actions.length+' proposed change(s)</strong><ol>'+items.map(x=>'<li>'+esc(x)+'</li>').join('')+'</ol><div class="actions"><button class="btn sm" onclick="applyPreview()">Confirm all changes</button><button class="btn alt sm" onclick="cancelVoicePreview()">Cancel</button></div><p class="hint">No changes occur before confirmation.</p>';
  pending={raw,actions};
};
window.cancelVoicePreview=function(){pending=null;document.getElementById('commandPreview').classList.add('hidden');};
window.applyPreview=function(){
  if(!pending)return;
  let batch=pending;pending=null;
  if(document.getElementById('command').value.trim()!==batch.raw)return toast('Text changed; interpret again.');
  for(let a of batch.actions){if((a.kind==='complete'||a.kind==='move')&&!data.tasks.some(t=>t.id===a.id&&t.status!=='done'))return toast('Task changed; interpret again.');}
  const summaries=[];
  for(let a of batch.actions){
    if(a.kind==='budgetmove'){window.Budget.move(a.month,a.from,a.to,a.amount);}
    else if(a.kind==='budgetassign'){const cur=(data.finance.assign[a.month]||{})[a.to]||0;window.Budget.setAssign(a.month,a.to,cur+a.amount);}
    else if(a.kind==='liftplan'){window.Strength.createPlan({personId:a.personId,name:a.title,days:a.days,exercises:a.exercises});}
    else if(a.kind==='liftsession'){summaries.push(window.Strength.saveSession(a.session));}
    else if(a.kind==='goalnew'){window.Savings.create({name:a.title,target:a.amount,deadline:a.date});}
    else if(a.kind==='goaladd'){window.Savings.contribute(a.id,a.amount,a.date);}
    else if(a.kind==='grocery'){window.Grocery.add(a.items,'voice');}
    else if(a.kind==='fit'){window.Fitness.add({personId:a.personId,date:a.date,kind:a.fkind,activity:a.activity,minutes:a.minutes,miles:a.miles,value:a.value,note:a.note,calories:a.calories,protein:a.protein});}
    else if(a.kind==='mealplan'){window.Fitness.setMeal(a.date,a.slot,a.note);}
    else if(a.kind==='txn'){window.Finance.addTxn({type:a.type,amount:a.amount,category:a.category,note:a.note,date:a.date});}
    else if(a.kind==='billpaid'){window.Finance.markBillPaid(a.id,a.date,a.amount);}
    else if(a.kind==='complete'){let t=data.tasks.find(t=>t.id===a.id);t.status='done';t.completed=stamp();log('task_completed',t.id,t.title);}
    else if(a.kind==='move'){let t=data.tasks.find(t=>t.id===a.id);t.scheduled=a.date;t.rollovers=(t.rollovers||0)+1;log('task_moved',t.id,t.title+' → '+a.date);}
    else{let t={id:uuid(),title:a.title,next:'',area:a.area,priority:a.priority,scheduled:a.date,due:a.due||'',notes:'Voice/text command: '+batch.raw,status:'open',created:stamp(),completed:null,rollovers:0};data.tasks.push(t);log('task_created',t.id,t.title);}
  }
  document.getElementById('command').value='';document.getElementById('commandPreview').classList.add('hidden');persist();window.lastSaveSummary=summaries.join(' ');toast(summaries.length?summaries[0]:batch.actions.length+(batch.actions.length===1?' change':' changes')+' saved.');
};
document.getElementById('command').addEventListener('input',()=>{pending=null;document.getElementById('commandPreview').classList.add('hidden');});
})();