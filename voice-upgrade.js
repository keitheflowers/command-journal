/* Command Journal multi-action voice interpreter v2 */
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
function parse(raw){
  let line=raw.trim().replace(/[.!?]+$/g,'').replace(/^(?:hey\s+)?command journal[, :]*\s*/i,'').replace(/^(?:okay|ok|please)[, ]+/i,'');
  line=line.replace(/\b(?:and|then|also)\s+(?=(?:add|create|make|schedule|complete|completed|finish|finished|mark|move|reschedule|push)\b)/gi,'; ');
  line=line.replace(/[,;]\s*(?=(?:add|create|make|schedule|complete|completed|finish|finished|mark|move|reschedule|push)\b)/gi,'; ');
  line=line.replace(/\s+(?=(?:add|create|make|schedule|complete|completed|finish|finished|mark|move|reschedule|push)\s+(?:a\s+)?(?:task\b|my\b|the\b))/gi,'; ');
  let parts=line.split(/\s*;\s*/).map(x=>x.trim()).filter(Boolean),actions=[],errors=[];
  if(parts.length>12)return {actions,errors:['Maximum 12 instructions per update']};
  for(let part of parts){
    part=part.replace(/^(?:i\s+)?(?:have\s+)?(?:just\s+)?(?:please\s+)?/i,'').trim();
    let done=part.match(/^(?:complete|completed|finish|finished|mark(?:\s+(?:as|it))?\s+(?:complete|done))\s+(?:the\s+|my\s+)?(?:task\s+)?(.+)$/i);
    if(!done){let m=part.match(/^update\s+(?:task\s+)?(.+?)\s+(?:as\s+)?(?:complete|completed|done)$/i);if(m)done=[part,m[1]];}
    let move=part.match(/^(?:move|reschedule|push)\s+(?:the\s+|my\s+)?(?:task\s+)?(.+?)\s+(?:to\s+)?tomorrow$/i);
    let add=part.match(/^(?:add|create|make|schedule|remind me to)\s+(?:a\s+|the\s+)?(?:task\s+)?(?:for\s+)?(.+)$/i);
    if(done||move){
      let q=(done||move)[1].replace(/\s+(?:as\s+)?(?:complete|completed|done)$/i,'');
      let found=findTask(q);
      if(found.task)actions.push({kind:done?'complete':'move',id:found.task.id,title:found.task.title,date:plusDays(day(),1)});
      else errors.push(found.error);
    }else if(add){
      let title=add[1].replace(/^for\s+tomorrow\s+to\s+/i,'').replace(/^tomorrow\s+to\s+/i,'').replace(/^to\s+/i,'');
      let date=/\btomorrow\b/i.test(title)?plusDays(day(),1):day();
      let p=title.match(/\bpriority\s+(high|medium|low)\b|\b(high|medium|low)\s+priority\b/i);
      let priority=p?(p[1]||p[2]):'Medium';priority=priority[0].toUpperCase()+priority.slice(1).toLowerCase();
      title=title.replace(/\bpriority\s+(?:high|medium|low)\b/ig,'').replace(/\b(?:high|medium|low)\s+priority\b/ig,'').replace(/\b(?:for\s+)?(?:tomorrow|today)\b/ig,'').replace(/\s+/g,' ').trim().replace(/^(?:to\s+|for\s+)/i,'').replace(/[.,;]+$/,'');
      if(!title||title.length>180)errors.push('Invalid task title: '+part);
      else{
        let area=/\b(?:bci|project reports|accountant)\b/i.test(title)?'BCI / Career':/\b(?:family|kids|wife)\b/i.test(title)?'Family / Personal':/\b(?:faith|scripture|prayer)\b/i.test(title)?'Faith / Growth':'Vector AI';
        actions.push({kind:'add',title,date,priority,area});
      }
    }else errors.push('Unrecognized instruction: '+part);
  }
  let seen=new Set();actions=actions.filter(a=>{let key=a.kind+':'+(a.id||norm(a.title)+a.date);if(seen.has(key))return false;seen.add(key);return true;});
  return {actions,errors};
}
let pending=null;
window.interpretCommand=function(){
  let raw=document.getElementById('command').value.trim();if(!raw)return toast('Speak or type an update.');
  let result=parse(raw),actions=result.actions,errors=result.errors;pending=null;
  let box=document.getElementById('commandPreview');box.classList.remove('hidden');
  if(errors.length||!actions.length){box.innerHTML='<strong>No changes made.</strong><p class="hint">'+errors.map(esc).join('; ')+'</p>';return;}
  let items=actions.map(a=>a.kind==='add'?'Add: '+a.title+' · '+a.date+' · '+a.priority+' · '+a.area:a.kind==='complete'?'Complete: '+a.title:'Move to tomorrow: '+a.title);
  box.innerHTML='<strong>Review '+actions.length+' proposed change(s)</strong><ol>'+items.map(x=>'<li>'+esc(x)+'</li>').join('')+'</ol><div class="actions"><button class="btn sm" onclick="applyPreview()">Confirm all changes</button><button class="btn alt sm" onclick="cancelVoicePreview()">Cancel</button></div><p class="hint">No changes occur before confirmation.</p>';
  pending={raw,actions};
};
window.cancelVoicePreview=function(){pending=null;document.getElementById('commandPreview').classList.add('hidden');};
window.applyPreview=function(){
  if(!pending)return;
  let batch=pending;pending=null;
  if(document.getElementById('command').value.trim()!==batch.raw)return toast('Text changed; interpret again.');
  for(let a of batch.actions){if(a.kind!=='add'&&!data.tasks.some(t=>t.id===a.id&&t.status!=='done'))return toast('Task changed; interpret again.');}
  for(let a of batch.actions){
    if(a.kind==='complete'){let t=data.tasks.find(t=>t.id===a.id);t.status='done';t.completed=stamp();log('task_completed',t.id,t.title);}
    else if(a.kind==='move'){let t=data.tasks.find(t=>t.id===a.id);t.scheduled=a.date;t.rollovers=(t.rollovers||0)+1;log('task_moved',t.id,t.title+' → '+a.date);}
    else{let t={id:uuid(),title:a.title,next:'',area:a.area,priority:a.priority,scheduled:a.date,due:'',notes:'Voice/text command: '+batch.raw,status:'open',created:stamp(),completed:null,rollovers:0};data.tasks.push(t);log('task_created',t.id,t.title);}
  }
  document.getElementById('command').value='';document.getElementById('commandPreview').classList.add('hidden');persist();toast(batch.actions.length+' changes saved.');
};
document.getElementById('command').addEventListener('input',()=>{pending=null;document.getElementById('commandPreview').classList.add('hidden');});
})();