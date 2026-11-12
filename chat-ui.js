/* The Family Save: controls for Vector's private conversation memory.
   Today: what Vector remembers right now, New conversation, History.
   Settings: what is remembered and where, every conversation, export/import,
   Delete my chat history, and each model's context size. */
(function(){
'use strict';
if(!window.VectorChat)return;
const C=window.VectorChat;
const when=iso=>new Date(iso).toLocaleString(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
let viewing=null,msg='';

// ---- Today: a line under the command box ---------------------------------------
const bar=document.createElement('div');bar.id='vcBar';bar.className='hint';bar.style.cssText='display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin:8px 0 0';
document.getElementById('commandPreview').insertAdjacentElement('beforebegin',bar);
async function drawBar(){
 if(!(window.VectorAI&&window.VectorAI.enabled())){bar.innerHTML='';return;}
 let info='New conversation';
 try{const id=await C.activeId();if(id){const c=(await C.convs()).find(x=>x.id===id);if(c)info=c.count+' exchange'+(c.count===1?'':'s')+' remembered';}}catch(_){}
 bar.innerHTML=`<span style="flex:1">💬 ${esc(info)}${C.label().guest?' · guest':''}</span><button class="btn alt sm" data-vc="new">New conversation</button><button class="btn alt sm" data-vc="history">History</button>`;
}

// ---- Settings ------------------------------------------------------------------------
const panel=document.createElement('div');panel.className='panel';panel.id='vcPanel';
async function drawPanel(){
 let list=[],active=null;try{list=await C.convs();active=await C.activeId();}catch(_){}
 const L=C.label(),s=(window.VectorAI&&window.VectorAI.server.get())||{},model=s.model||'qwen3.5',ctx=C.ctxFor(model,false);
 const xs=viewing?await C.exchanges(viewing,C.scope()).catch(()=>[]):[];
 panel.innerHTML=`<h2>💬 Vector memory</h2>
 <p class="hint" style="margin:0 0 8px"><b>What’s remembered:</b> what you type or say to Vector in the update box, Vector’s replies, and whether you confirmed the changes it suggested. Grocery lists, food estimates and weekly recaps aren’t remembered.<br>
 <b>Where:</b> only in this app on this phone. It isn’t part of Family sync, journal backups or restore points, so your family never sees it, and your AI keys are never stored in it or sent with it.<br>
 <b>Whose:</b> <span id="vcWho">${esc(L.who)}</span>. Each account and family has its own history; signing out ends the conversation on screen.${L.guest?' Guest history stays separate and is never added to an account.':''}<br>
 <b>What Vector sees:</b> up to the last 20 exchanges that fit the model’s context, plus earlier ones that relate to your question. When some are left out, Vector is told, and the reply shows how many it saw. Saved conversations are never changed or trimmed.</p>
 ${C.persistent()?'':'<div class="notice" style="margin:0 0 8px">⚠️ This browser won’t let the app save chat history (private browsing?). It lasts until the app closes.</div>'}
 <p class="hint" style="margin:0 0 10px">🔒 Shared phone: anyone who can open this app on this phone while you’re signed in can read your history here. Use the app lock (Settings → Lock) or delete your history before handing the phone over.</p>
 <div class="actions"><button class="btn sm" data-vc="new">New conversation</button><button class="btn alt sm" data-vc="export">Export my chat history</button><button class="btn alt sm" data-vc="import">Import</button><button class="btn danger sm" data-vc="wipe">Delete my chat history</button><input type="file" id="vcFile" accept="application/json,.json" class="hidden"></div>
 ${msg?`<p class="hint" role="status">${esc(msg)}</p>`:''}
 <h2 style="margin-top:14px">Conversations</h2>
 ${list.length?list.map(c=>`<div class="dz-row"><div style="flex:1;min-width:0">${c.id===active?'▶ ':''}${esc(c.title||'Conversation')}<div class="s">${when(c.updated)} · ${c.count} exchange${c.count===1?'':'s'}${c.id===active?' · current':''}</div></div>
  <button class="btn alt sm" data-vc="view" data-id="${c.id}">${viewing===c.id?'Hide':'View'}</button>${c.id===active?'':`<button class="btn alt sm" data-vc="open" data-id="${c.id}">Continue</button>`}<button class="btn alt sm" data-vc="del" data-id="${c.id}">Delete</button></div>
  ${viewing===c.id?`<div style="max-height:320px;overflow:auto;margin:4px 0 10px;padding:8px;font-size:13.5px;border:1px solid #1c2838;border-radius:10px">${xs.map(x=>`<div style="margin:0 0 10px"><div class="s">${when(x.at)}</div><div><b>You:</b> ${esc(x.user)}</div><div><b>Vector:</b> ${esc(x.reply||'')}${x.actions&&x.actions.length?`<div class="s">Suggested: ${esc(x.actions.join('; '))} — ${x.outcome==='confirmed'?'you confirmed':'not confirmed'}</div>`:''}</div></div>`).join('')||'<div class="empty">Empty.</div>'}</div>`:''}`).join(''):'<div class="empty">No saved conversations yet.</div>'}
 <h2 style="margin-top:14px">Context size</h2>
 <p class="hint" style="margin:0 0 6px">How much the model can read at once, in tokens. Room is kept for Vector’s instructions, your app summary and the answer; the rest goes to the conversation. Ollama’s default in Sparkstead is 8192.</p>
 <div class="two"><div><label>Model</label><input value="${esc(model)}" disabled></div><div><label>Tokens</label><input id="vcCtx" type="number" min="2048" step="1024" value="${ctx}"></div></div>
 <div class="actions" style="margin-top:8px"><button class="btn alt sm" data-vc="ctx">Save context size</button></div>`;
}
document.addEventListener('click',async e=>{
 const b=e.target.closest('[data-vc]');if(!b)return;const a=b.dataset.vc,id=b.dataset.id;msg='';
 if(a==='new'){await C.newConversation();msg='Started a new conversation. The old one is kept in the list.';toast('New conversation');}
 else if(a==='history'){openView('settings');setTimeout(()=>panel.scrollIntoView({behavior:'smooth'}),50);}
 else if(a==='open'){await C.open(id);viewing=null;msg='Continuing that conversation.';}
 else if(a==='view'){viewing=viewing===id?null:id;}
 else if(a==='del'){if(!confirm('Delete this conversation from this phone? This can’t be undone.'))return;await C.remove(id);if(viewing===id)viewing=null;msg='Conversation deleted.';}
 else if(a==='wipe'){if(!confirm('Delete all of your Vector chat history on this phone ('+C.label().who+')? Your journal, tasks and money are not affected. This can’t be undone.'))return;await C.removeMine();viewing=null;msg='Your chat history was deleted from this phone.';}
 else if(a==='export'){const f=await C.exportMine();const blob=new Blob([JSON.stringify(f,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),el=document.createElement('a');el.href=url;el.download='vector-chat-history-'+day()+'.json';document.body.appendChild(el);el.click();el.remove();setTimeout(()=>URL.revokeObjectURL(url),2000);msg='Exported '+f.conversations.length+' conversation(s). Keep the file private: it holds your chats.';}
 else if(a==='import'){document.getElementById('vcFile').click();return;}
 else if(a==='ctx'){const v=+document.getElementById('vcCtx').value;const s=(window.VectorAI&&window.VectorAI.server.get())||{};if(!(v>=2048&&v<=1000000)){msg='Enter a number of tokens of at least 2048.';}else{C.setCtx(s.model||'qwen3.5',v);msg='Context size saved.';}}
 drawPanel();drawBar();
});
document.addEventListener('change',async e=>{
 if(e.target.id!=='vcFile')return;const f=e.target.files[0];e.target.value='';if(!f)return;
 try{const n=await C.importMine(JSON.parse(await f.text()));msg='Imported '+n+' exchange(s) into your history.';}catch(err){msg='Import failed: '+err.message;}
 drawPanel();drawBar();
});
const settings=document.getElementById('settings'),after=document.getElementById('vectorServerPanel');
if(after)after.insertAdjacentElement('afterend',panel);else settings.appendChild(panel);
C.onChange(()=>{drawBar();if(view==='settings')drawPanel();});
window.addEventListener('vector-chat-switch',()=>{viewing=null;msg='';drawBar();drawPanel();});
const baseRender=window.render;window.render=function(){baseRender.apply(this,arguments);drawBar();if(view==='settings')drawPanel();};
drawBar();drawPanel();
})();
