/* The Family Save backups:
   - asks the browser to keep this app's storage (no automatic clearing)
   - a restore point every day in IndexedDB (last 14 kept)
   - a weekly reminder to save a copy off the phone (share sheet -> Drive/email, or download)
   - backup files hold the journal plus this phone's settings (AI keys only if you tick the box)
   - shows what happened after an update, and a recovery screen if data can't be read */
(function(){
'use strict';
const K_LAST='backupLast',K_SNOOZE='backupSnooze',KEEP=14,DAYS=7;
const ls={get:k=>{try{return localStorage.getItem(k);}catch(_){return null;}},set:(k,v)=>{try{localStorage.setItem(k,v);}catch(_){}}};
const ago=iso=>{if(!iso)return 'never';const d=Math.floor((Date.now()-new Date(iso))/864e5);return d<=0?'today':d===1?'yesterday':d+' days ago';};
const fileName=()=>`family-save-${day()}.json`;
const K_SECRETS='backupWithKeys';
const payload=()=>JSON.stringify(FSStore.exportBundle(data,{includeSecrets:ls.get(K_SECRETS)==='1'}),null,2);
const hasContent=()=>data.tasks.length||(data.finance&&(data.finance.txns||[]).length)||(data.fitness&&(data.fitness.logs||[]).length);

// ---- restore points (IndexedDB) --------------------------------------------
const LABEL={daily:'Daily','before-restore':'Before a restore','before-import':'Before an import','before-update':'Before an app update','before-family-join':'Before joining a family'};
let dbp=null;
function db(){if(dbp)return dbp;dbp=new Promise((res,rej)=>{if(!window.indexedDB)return rej(new Error('No IndexedDB'));const r=indexedDB.open('familysave',1);r.onupgradeneeded=()=>r.result.createObjectStore('snapshots',{keyPath:'id'});r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);});return dbp;}
async function tx(mode,fn){const d=await db();return new Promise((res,rej)=>{const t=d.transaction('snapshots',mode),s=t.objectStore('snapshots');const out=fn(s);t.oncomplete=()=>res(out&&out.result!==undefined?out.result:out);t.onerror=()=>rej(t.error);});}
async function snapshots(){const all=await tx('readonly',s=>s.getAll());return (all||[]).sort((a,b)=>b.at.localeCompare(a.at));}
async function snapshot(reason){
 if(FSStore.blocked())return; // never save the empty stand-in over a good restore point
 const id=reason==='daily'?day():day()+'-'+Date.now();const json=JSON.stringify(data);
 await tx('readwrite',s=>s.put({id,at:stamp(),reason,size:json.length,data:json}));
 const all=await snapshots();for(const old of all.filter(x=>x.reason==='daily').slice(KEEP))await tx('readwrite',s=>s.delete(old.id));
 for(const old of all.filter(x=>x.reason!=='daily'&&x.reason!=='before-update').slice(5))await tx('readwrite',s=>s.delete(old.id));
 for(const old of all.filter(x=>x.reason==='before-update').slice(3))await tx('readwrite',s=>s.delete(old.id));
}
async function daily(){try{const all=await snapshots();if(!all.some(x=>x.id===day()))await snapshot('daily');}catch(_){}}
async function restore(id){
 const s=(await snapshots()).find(x=>x.id===id);if(!s)return false;
 if(!FSStore.blocked())await snapshot('before-restore');
 const parsed=JSON.parse(s.data);FSStore.unblock();data=FSStore.migrate(parsed).data;if(window.setAreas)setAreas(data.areas);persist();refreshNotice();return true;
}

// ---- off-phone backup -------------------------------------------------------
async function backupNow(){
 const blob=new Blob([payload()],{type:'application/json'}),name=fileName();
 try{const file=new File([blob],name,{type:'application/json'});
  if(navigator.canShare&&navigator.canShare({files:[file]})){await navigator.share({files:[file],title:'Family Save backup',text:'Backup of The Family Save ('+day()+')'});ls.set(K_LAST,stamp());toast('Backup shared ✓');refresh();return;}}
 catch(e){if(e&&e.name==='AbortError'){toast('Backup cancelled.');return;}}
 download(blob,name);
}
function download(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name||fileName();document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),2000);ls.set(K_LAST,stamp());toast('Backup saved to Downloads ✓');refresh();}
// the existing Export button counts as a backup too
const origExport=window.exportData;window.exportData=function(){ls.set(K_LAST,stamp());const r=origExport.apply(this,arguments);setTimeout(refresh,50);return r;};

let persisted=null;
async function askPersist(){try{if(navigator.storage&&navigator.storage.persist){persisted=await navigator.storage.persisted();if(!persisted)persisted=await navigator.storage.persist();}}catch(_){}}

// ---- reminder banner ----------------------------------------------------------
const nag=document.createElement('div');nag.id='backupNag';nag.className='notice hidden';nag.style.cssText='display:flex;align-items:center;gap:10px;margin:0 0 10px';
document.getElementById('tabs').insertAdjacentElement('beforebegin',nag);
function due(){if(!hasContent())return false;const last=ls.get(K_LAST),sn=ls.get(K_SNOOZE);if(sn&&Date.now()<+sn)return false;return !last||Date.now()-new Date(last)>DAYS*864e5;}
function refresh(){
 const show=due();nag.classList.toggle('hidden',!show);
 if(show)nag.innerHTML=`<span style="flex:1">💾 <b>Back up your data.</b> Last backup: ${ago(ls.get(K_LAST))}. Everything lives only on this phone.</span><button class="btn sm" data-bk="now">Back up</button><button class="btn alt sm" data-bk="later">Later</button>`;
 drawPanel();
}
// ---- Settings panel ------------------------------------------------------------
const panel=document.createElement('div');panel.className='panel';panel.id='bk-panel';
async function drawPanel(){
 let list=[];try{list=await snapshots();}catch(_){}
 const last=ls.get(K_LAST);
 panel.innerHTML=`<h2>💾 Backups</h2>
 <p class="hint" style="margin:0 0 8px">Your data lives only on this phone. Keep a copy somewhere else, like Google Drive or email. <b>Back up now</b> opens your phone’s share menu.</p>
 <div class="dz-tiles"><div class="dz-tile"><div class="l">Last off-phone backup</div><div class="v ${!last||Date.now()-new Date(last)>DAYS*864e5?'dz-warn':''}" style="font-size:18px">${ago(last)}</div></div><div class="dz-tile"><div class="l">Storage protection</div><div class="v" style="font-size:18px">${persisted?'✅ On':persisted===false?'⚠️ Not granted':'—'}</div><div class="d">${persisted?'Chrome won’t clear it automatically':'Install the app to the home screen to help Chrome keep it'}</div></div></div>
 <label style="display:flex;gap:8px;align-items:flex-start;margin:10px 0 0;font-weight:400"><input type="checkbox" id="bkKeys" style="width:auto;margin-top:3px" ${ls.get(K_SECRETS)==='1'?'checked':''}><span>Include my AI keys and passwords in backup files <span class="hint">(off by default; anyone with the file could use them)</span></span></label>
 <div class="actions" style="margin-top:12px"><button class="btn" data-bk="now">Back up now</button><button class="btn alt" data-bk="download">Download file</button><button class="btn alt" data-bk="import">Restore from file</button></div>
 <h2 style="margin-top:16px">Restore points</h2><p class="hint" style="margin:0 0 6px">Saved automatically each day you open the app (last ${KEEP} days). They protect against mistakes, but not against clearing the app’s data. That’s what off-phone backups are for.</p>
 ${list.length?list.slice(0,KEEP+5).map(s=>`<div class="dz-row"><div>${new Date(s.at).toLocaleString(undefined,{weekday:'short',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})}<div class="s">${LABEL[s.reason]||'Manual'} · ${Math.max(1,Math.round(s.size/1024))} KB</div></div><button class="btn alt sm" data-bk="restore" data-id="${s.id}">Restore</button></div>`).join(''):'<div class="empty">The first restore point is made today.</div>'}
 <div class="actions" style="margin-top:8px"><button class="btn alt sm" data-bk="snap">Make a restore point now</button></div>`;
}
document.addEventListener('change',e=>{if(e.target.id==='bkKeys')ls.set(K_SECRETS,e.target.checked?'1':'0');});
document.addEventListener('click',async e=>{
 const b=e.target.closest('[data-bk]');if(!b)return;const a=b.dataset.bk;
 if(a==='now')backupNow();
 else if(a==='download')download(new Blob([payload()],{type:'application/json'}));
 else if(a==='later'){ls.set(K_SNOOZE,String(Date.now()+2*864e5));refresh();}
 else if(a==='import'){document.getElementById('importFile').click();}
 else if(a==='latest'){const list=(await snapshots().catch(()=>[]));if(!list.length){toast('No restore points on this phone. Use Restore from file.');return;}if(!confirm('Restore the newest restore point ('+new Date(list[0].at).toLocaleString()+')?'))return;try{await restore(list[0].id);toast('Restored ✓');drawPanel();}catch(err){toast('Restore failed: '+err.message);}}
 else if(a==='saveBad'){const raw=FSStore.unreadable();if(raw)download(new Blob([raw],{type:'application/json'}),'family-save-unreadable-'+day()+'.json');}
 else if(a==='okNotice'){ls.set('updateNoticeSeen',String(FSStore.SCHEMA));refreshNotice();}
 else if(a==='snap'){try{await snapshot('manual');toast('Restore point saved.');drawPanel();}catch(err){toast('Could not save a restore point.');}}
 else if(a==='restore'){if(!confirm('Go back to this restore point? Everything changed since then is replaced. A restore point of the current state is saved first.'))return;try{await restore(b.dataset.id);toast('Restored ✓');drawPanel();}catch(err){toast('Restore failed: '+err.message);}}
});
const settings=document.getElementById('settings');settings.insertBefore(panel,settings.firstChild);
// ---- update / recovery notice ------------------------------------------------
const note=document.createElement('div');note.id='updateNotice';note.className='notice hidden';note.style.cssText='margin:0 0 10px';
document.getElementById('tabs').insertAdjacentElement('beforebegin',note);
function refreshNotice(){
 const st=FSStore.status();let html='';
 if(FSStore.blocked())html=`<b>⚠️ Your saved data couldn’t be read.</b> Nothing was deleted, and saving is paused so nothing gets overwritten. Restore your newest restore point or a backup file.<div class="actions" style="margin-top:8px"><button class="btn sm" data-bk="latest">Restore newest restore point</button><button class="btn alt sm" data-bk="import">Restore from file</button>${FSStore.unreadable()?'<button class="btn alt sm" data-bk="saveBad">Save the unreadable data</button>':''}</div>`;
 else if(st.lastError)html='⚠️ '+esc(st.lastError);
 else if(st.state==='recovered')html=`<b>Recovered.</b> The app found a problem with your saved data and went back to the copy made before the last update${st.finishing&&st.finishing.at?' ('+new Date(st.finishing.at).toLocaleString()+')':''}. Changes made after that may be missing; the unreadable data was kept and can be saved from here.<div class="actions" style="margin-top:8px">${FSStore.unreadable()?'<button class="btn alt sm" data-bk="saveBad">Save the unreadable data</button>':''}<button class="btn alt sm" data-bk="okNotice">OK</button></div>`;
 else if((st.state==='migrated'||st.state==='resumed')&&ls.get('updateNoticeSeen')!==String(FSStore.SCHEMA))html=`✅ <b>App updated.</b> Your data was upgraded and a restore point of it from before the update was kept (Settings → Backups).${st.report&&st.report.duplicates?' Removed '+st.report.duplicates+' exact duplicate item(s).':''} <button class="btn alt sm" data-bk="okNotice">OK</button>`;
 note.innerHTML=html;note.classList.toggle('hidden',!html);
}
FSStore.onChange(refreshNotice);
window.SafeUpdate={refresh:refreshNotice};
FSStore.settle().then(()=>{refreshNotice();drawPanel();});refreshNotice();
window.Backup={snapshot,snapshots,restore,backupNow,due};
const baseRender=window.render;window.render=function(){baseRender.apply(this,arguments);if(view==='settings')drawPanel();};
askPersist().then(drawPanel);daily().then(drawPanel);refresh();
document.addEventListener('visibilitychange',()=>{if(!document.hidden){daily();refresh();}});
})();
