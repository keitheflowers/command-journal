/* The Family Save: family accounts and cloud sync (Supabase).
   Off until the app is configured (config.js) and someone signs in.
   Every task, transaction, log, plan... is synced as its own record, so two
   phones can change different things at the same time. Deletes travel as
   tombstones. The server stamps every write, so phone clocks don't matter.
   Conflicts on the same record: a change not yet sent from this phone wins
   over an older one from the server; otherwise the server's copy is used.
   It also lets Vector AI run through the family's server (claude-proxy) so
   nobody needs their own API key. */
(function(){
'use strict';
const KS='fsSync',KH='fsSyncShadow',K_AI='vectorAiServer',SEP='\u0001',PAGE=1000,BATCH=400;
const ls={get:k=>{try{return localStorage.getItem(k);}catch(_){return null;}},set:(k,v)=>{try{v==null?localStorage.removeItem(k):localStorage.setItem(k,v);}catch(_){}}};
const readJ=(k,d)=>{try{return JSON.parse(ls.get(k))||d;}catch(_){return d;}};
let typed={},st=readJ(KS,{}),shadow=readJ(KH,{}),busy=null,timer=null,lastErr='',lastAt=null;
const save=()=>ls.set(KS,JSON.stringify(st)),saveShadow=()=>ls.set(KH,JSON.stringify(shadow));

// ---- server --------------------------------------------------------------
function cfg(){const c=window.FS_CONFIG||{};return {url:String(c.supabaseUrl||st.url||'').trim().replace(/\/+$/,''),anon:String(c.supabaseAnonKey||st.anon||'').trim(),fixed:!!(c.supabaseUrl&&c.supabaseAnonKey)};}
const configured=()=>{const c=cfg();return !!(c.url&&c.anon);};
const signedIn=()=>configured()&&!!st.session;
const ready=()=>signedIn()&&!!st.household;
async function api(path,{method='GET',body,auth=true,headers={}}={}){
 const c=cfg(),h={apikey:c.anon,'content-type':'application/json',...headers};
 if(auth)h.Authorization='Bearer '+await token();
 let r;try{r=await fetch(c.url+path,{method,headers:h,body:body==null?undefined:JSON.stringify(body)});}
 catch(_){const e=new Error('Can’t reach the sync server (offline?).');e.offline=true;throw e;}
 const txt=await r.text();let j=null;try{j=txt?JSON.parse(txt):null;}catch(_){}
 if(!r.ok){let m=j&&(j.msg||j.message||j.error_description||j.error)||('HTTP '+r.status);if(typeof m!=='string')m=JSON.stringify(m);const e=new Error(m);e.status=r.status;throw e;}
 return j;
}
function keep(s){st.session={access_token:s.access_token,refresh_token:s.refresh_token,expires_at:s.expires_at||Math.floor(Date.now()/1000)+(s.expires_in||3600),user:{id:s.user&&s.user.id,email:s.user&&s.user.email}};save();}
async function token(){
 const s=st.session;if(!s)throw new Error('Sign in to Family Save first.');
 if(s.expires_at-60>Date.now()/1000)return s.access_token;
 try{keep(await api('/auth/v1/token?grant_type=refresh_token',{method:'POST',auth:false,body:{refresh_token:s.refresh_token}}));}
 catch(e){if(e.status>=400&&e.status<500){st.session=null;save();draw();throw new Error('Your sign-in expired. Please sign in again.');}throw e;}
 return st.session.access_token;
}
const one=r=>Array.isArray(r)?r[0]||null:r;
function setHH(h){st.household=h&&h.id?{id:h.id,name:h.name,code:h.invite_code}:null;save();}
const resetSync=()=>{shadow={};saveShadow();st.cursor=null;save();};

async function signIn(email,pw){keep(await api('/auth/v1/token?grant_type=password',{method:'POST',auth:false,body:{email,password:pw}}));setHH(one(await api('/rest/v1/rpc/my_household',{method:'POST',body:{}})));if(st.household){resetSync();await syncNow();}}
async function signUp(email,pw){const r=await api('/auth/v1/signup',{method:'POST',auth:false,body:{email,password:pw}});if(!r||!r.access_token)return 'confirm';keep(r);setHH(one(await api('/rest/v1/rpc/my_household',{method:'POST',body:{}})));return 'ok';}
async function createFamily(name){setHH(one(await api('/rest/v1/rpc/create_household',{method:'POST',body:{p_name:name||'Family'}})));resetSync();await syncNow();}
async function joinFamily(code,replace){
 setHH(one(await api('/rest/v1/rpc/join_household',{method:'POST',body:{p_code:String(code).trim().toUpperCase()}})));
 resetSync();if(replace)wipeLocal();await syncNow();
}
async function newCode(){const c=await api('/rest/v1/rpc/new_invite_code',{method:'POST',body:{p_household:st.household.id}});st.household.code=typeof c==='string'?c:one(c);save();}
function signOut(){st.session=null;st.household=null;resetSync();ls.set(K_AI,null);save();}

// ---- local data <-> records ---------------------------------------------
const isColl=a=>Array.isArray(a)&&a.every(x=>x&&typeof x==='object'&&!Array.isArray(x)&&(typeof x.id==='string'||typeof x.id==='number'));
function flatten(){
 const out=new Map(),coll=(c,arr)=>{for(const x of arr)out.set(c+SEP+x.id,{c,id:String(x.id),v:x});},doc=(p,v)=>out.set('_doc'+SEP+p,{c:'_doc',id:p,v});
 for(const [k,v] of Object.entries(data)){
  if(k==='version'||v===undefined)continue;
  if(isColl(v))coll(k,v);
  else if(v&&typeof v==='object'&&!Array.isArray(v)){for(const [k2,v2] of Object.entries(v)){if(v2===undefined)continue;const p=k+'.'+k2;if(isColl(v2))coll(p,v2);else doc(p,v2);}}
  else doc(k,v);
 }
 return out;
}
// stable JSON (sorted keys) so the server's key order doesn't look like a change
const stable=v=>v===null||typeof v!=='object'?JSON.stringify(v)??'null':Array.isArray(v)?'['+v.map(stable).join(',')+']':'{'+Object.keys(v).sort().filter(k=>v[k]!==undefined).map(k=>JSON.stringify(k)+':'+stable(v[k])).join(',')+'}';
function hash(v){const s=stable(v);let h=0x811c9dc5;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,0x01000193);}return (h>>>0).toString(36)+'.'+s.length;}
function arr(c,create){
 const [a,b]=c.split('.');
 if(b==null){if(!Array.isArray(data[a])){if(!create)return null;data[a]=[];}return data[a];}
 if(!data[a]||typeof data[a]!=='object'){if(!create)return null;data[a]={};}
 if(!Array.isArray(data[a][b])){if(!create)return null;data[a][b]=[];}return data[a][b];
}
function getLocal(c,id){if(c==='_doc'){const [a,b]=id.split('.');return b==null?data[a]:data[a]&&typeof data[a]==='object'?data[a][b]:undefined;}const A=arr(c,false);return A?A.find(x=>String(x.id)===id):undefined;}
function setLocal(c,id,v){
 if(c==='_doc'){const [a,b]=id.split('.');if(b==null)data[a]=v;else{if(!data[a]||typeof data[a]!=='object')data[a]={};data[a][b]=v;}return;}
 const A=arr(c,true),i=A.findIndex(x=>String(x.id)===id);if(i>=0)A[i]=v;else A.push(v);
}
function removeLocal(c,id){
 if(c==='_doc'){const [a,b]=id.split('.');if(b==null){if(!['tasks','events','reviews'].includes(a))delete data[a];}else if(data[a])delete data[a][b];return;}
 const A=arr(c,false);if(!A)return;const i=A.findIndex(x=>String(x.id)===id);if(i>=0)A.splice(i,1);
}
function wipeLocal(){for(const k of Object.keys(data))if(k!=='version')delete data[k];data.tasks=[];data.events=[];data.reviews=[];}
function applyRow(r){
 const k=r.collection+SEP+r.id,cur=getLocal(r.collection,r.id),lh=cur===undefined?undefined:hash(cur),sh=shadow[k];
 if(sh!==undefined&&lh!==sh)return false; // changed here and not sent yet: this phone's change wins
 if(r.deleted){delete shadow[k];if(cur===undefined)return false;removeLocal(r.collection,r.id);return true;}
 const rh=hash(r.data);shadow[k]=rh;if(rh===lh)return false;
 setLocal(r.collection,r.id,r.data);return true;
}
async function pull(){
 const H=st.household.id,from=st.cursor?new Date(Date.parse(st.cursor)-60000).toISOString():null;let changed=false;
 for(let off=0;;off+=PAGE){
  let q=`/rest/v1/records?select=collection,id,data,deleted,updated_at&household_id=eq.${H}&order=updated_at.asc,collection.asc,id.asc&limit=${PAGE}&offset=${off}`;
  if(from)q+='&updated_at=gte.'+encodeURIComponent(from);
  const rows=await api(q)||[];
  for(const r of rows){if(applyRow(r))changed=true;if(!st.cursor||r.updated_at>st.cursor)st.cursor=r.updated_at;}
  if(rows.length<PAGE)break;
 }
 if(changed)for(const c of ['events','reviews'])if(Array.isArray(data[c]))data[c].sort((a,b)=>String(b.timestamp||'').localeCompare(String(a.timestamp||'')));
 saveShadow();save();return changed;
}
async function push(){
 const H=st.household.id,cur=flatten(),rows=[];
 for(const [k,r] of cur){const h=hash(r.v);if(shadow[k]!==h)rows.push({k,h,row:{household_id:H,collection:r.c,id:r.id,data:r.v,deleted:false}});}
 for(const k of Object.keys(shadow))if(!cur.has(k)){const i=k.indexOf(SEP);rows.push({k,h:null,row:{household_id:H,collection:k.slice(0,i),id:k.slice(i+1),data:null,deleted:true}});}
 for(let i=0;i<rows.length;i+=BATCH){
  const b=rows.slice(i,i+BATCH);
  await api('/rest/v1/records?on_conflict=household_id,collection,id',{method:'POST',headers:{Prefer:'resolution=merge-duplicates,return=minimal'},body:b.map(x=>x.row)});
  for(const x of b){if(x.h==null)delete shadow[x.k];else shadow[x.k]=x.h;}saveShadow();
 }
 return rows.length;
}
async function syncNow(){
 if(!ready())return {pulled:false,pushed:0};
 if(busy)return busy;
 busy=(async()=>{
  try{
   const pulled=await pull();
   if(pulled)basePersist();
   const pushed=await push();lastErr='';lastAt=new Date();return {pulled,pushed};
  }catch(e){lastErr=e.message;throw e;}
  finally{busy=null;draw();}
 })();
 return busy;
}
const quiet=()=>syncNow().catch(()=>{});

// push shortly after every local change
const basePersist=window.persist;
window.persist=function(){basePersist.apply(this,arguments);if(ready()){clearTimeout(timer);timer=setTimeout(quiet,2000);}};
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')quiet();});
window.addEventListener('online',quiet);
setInterval(()=>{if(document.visibilityState==='visible')quiet();},60000);
setTimeout(quiet,1200);

// ---- Settings panel ---------------------------------------------------------
const panel=document.createElement('div');panel.className='panel';panel.id='syncPanel';
const ago=d=>{if(!d)return 'not yet';const s=Math.round((Date.now()-d)/1000);return s<60?'just now':s<3600?Math.round(s/60)+' min ago':d.toLocaleTimeString([],{hour:'numeric',minute:'2-digit'});};
function draw(msg){
 const c=cfg();let body;
 if(!configured())body=`<p class="hint">Share one family budget, task list, grocery list and meal plan across everyone’s phones. Needs the app’s sync server (Supabase). If you run your own, enter its details:</p>
  <label>Server URL</label><input id="syUrl" placeholder="https://xxxx.supabase.co" value="${esc(st.url||'')}"><label>Public (anon) key</label><input id="syAnon" autocomplete="off" value="${esc(st.anon||'')}">
  <div class="actions" style="margin-top:10px"><button class="btn" data-sy="cfg">Save</button></div>`;
 else if(!st.session)body=`<p class="hint">Sign in to share this phone’s data with your family and use Vector AI without your own key.</p>
  <label>Email</label><input id="syEmail" type="email" autocomplete="email" value="${esc(typed.email||'')}"><label>Password</label><input id="syPw" type="password" autocomplete="current-password" placeholder="At least 8 characters">
  <div class="actions" style="margin-top:10px"><button class="btn" data-sy="in">Sign in</button><button class="btn alt" data-sy="up">Create account</button>${c.fixed?'':'<button class="btn alt sm" data-sy="uncfg">Change server</button>'}</div>`;
 else if(!st.household)body=`<p class="hint">Signed in as <b>${esc(st.session.user.email||'')}</b>. Start a family, or join one with the invite code from a family member’s phone.</p>
  <label>Family name</label><input id="syName" placeholder="The Flowers family"><div class="actions" style="margin-top:8px"><button class="btn" data-sy="create">Start a family</button></div>
  <label style="margin-top:12px">Invite code</label><input id="syCode" placeholder="ABCD1234" autocapitalize="characters" value="${esc(typed.code||'')}"><div class="actions" style="margin-top:8px"><button class="btn alt" data-sy="join">Join family</button><button class="btn alt sm" data-sy="out">Sign out</button></div>`;
 else{const ai=ls.get(K_AI)==='1'&&ls.get('vectorAiOn')==='1';
  body=`<p class="hint" style="margin:0 0 6px"><b>${esc(st.household.name)}</b> · ${esc(st.session.user.email||'')}</p>
  <p style="margin:0 0 6px">Invite code: <b id="syInvite" style="letter-spacing:2px">${esc(st.household.code||'')}</b></p>
  <p class="hint" id="syStatus">${lastErr?'⚠️ '+esc(lastErr):'Synced '+ago(lastAt)}</p>
  <div class="actions"><button class="btn" data-sy="now">Sync now</button><button class="btn alt" data-sy="share">Share invite</button><button class="btn alt sm" data-sy="code">New code</button></div>
  <label class="inline" style="margin-top:12px;display:flex;gap:8px;align-items:center"><input type="checkbox" id="syAi" ${ai?'checked':''} style="width:auto"> Vector AI through Family Save (no API key needed)</label>
  <div class="actions" style="margin-top:10px"><button class="btn alt sm" data-sy="out">Sign out</button></div>`;}
 panel.innerHTML=`<h2>☁️ Family sync</h2>${body}${msg?`<p class="hint" role="status" id="syMsg">${esc(msg)}</p>`:''}`;
}
const val=id=>(document.getElementById(id)||{}).value||'';
panel.addEventListener('click',async e=>{
 const b=e.target.closest('[data-sy]');if(!b)return;const a=b.dataset.sy;
 if(document.getElementById('syEmail'))typed.email=val('syEmail').trim();if(document.getElementById('syCode'))typed.code=val('syCode').trim();
 const run=async(f,ok)=>{b.disabled=true;try{const m=await f();draw(typeof m==='string'?m:ok);}catch(err){draw('✗ '+err.message);}};
 if(a==='cfg'){const u=val('syUrl').trim(),k=val('syAnon').trim();if(!/^https:\/\/\S+$/.test(u)||!k){draw('Enter an https:// server URL and its public key.');return;}st.url=u;st.anon=k;save();draw('Saved. Now sign in or create an account.');}
 else if(a==='uncfg'){st.url='';st.anon='';save();draw();}
 else if(a==='in'||a==='up'){const em=val('syEmail').trim(),pw=val('syPw');if(!/^\S+@\S+\.\S+$/.test(em)||pw.length<8){draw('Enter your email and a password of at least 8 characters.');return;}
  if(a==='in')run(()=>signIn(em,pw),st.household?'Signed in and synced.':'Signed in. Start or join a family.');
  else run(async()=>(await signUp(em,pw))==='confirm'?'Check your email to confirm your account, then sign in.':'Account created. Start or join a family.');}
 else if(a==='create')run(()=>createFamily(val('syName').trim()),'Family created. Share the invite code with your family.');
 else if(a==='join'){const code=val('syCode').trim();if(code.length<4){draw('Enter the invite code.');return;}
  const hasData=data.tasks.length||(data.finance&&(data.finance.txns||[]).length)||(data.fitness&&(data.fitness.logs||[]).length);
  const replace=!hasData||confirm('Use your family’s data on this phone?\n\nOK = replace this phone’s data with the family’s (recommended).\nCancel = merge this phone’s data into the family’s.');
  run(()=>joinFamily(code,replace),'Joined. This phone now shares your family’s data.');}
 else if(a==='now')run(async()=>{await syncNow();},'Synced.');
 else if(a==='code')run(newCode,'New invite code made. The old one no longer works.');
 else if(a==='share'){const t=`Join our family on The Family Save: open the app → Settings → Family sync → Join family, code ${st.household.code}`;try{if(navigator.share)await navigator.share({text:t});else{await navigator.clipboard.writeText(t);toast('Invite copied.');}}catch(_){}}
 else if(a==='out'){if(!confirm('Sign out on this phone? Your data stays on this phone.'))return;signOut();draw('Signed out.');}
});
panel.addEventListener('change',e=>{if(e.target.id==='syAi'){const on=e.target.checked;ls.set(K_AI,on?'1':null);if(on)ls.set('vectorAiOn','1');draw(on?'Vector AI is on, through your family account.':'Family Vector AI turned off.');}});
draw();
const settings=document.getElementById('settings');settings.insertBefore(panel,settings.children[1]||null);

window.Sync={
 configured,signedIn,ready,syncNow,signIn,signUp,createFamily,joinFamily,signOut,token,
 status:()=>({household:st.household,email:st.session&&st.session.user.email,lastAt,lastErr}),
 serverAi:()=>ready()&&ls.get(K_AI)==='1',
 proxyUrl:()=>cfg().url+'/functions/v1/claude-proxy',
 anonKey:()=>cfg().anon,
 _flatten:flatten
};
})();
