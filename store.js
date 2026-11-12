/* The Family Save: safe storage, versioned data migrations and backup files.
   Loaded before the app's main script. Everything stays on this device:
   nothing here sends data anywhere.

   Rules this file enforces:
   - The journal key never changes ('command_journal_v1'); data is upgraded in place.
   - Before an upgrade writes anything, the original is saved ('fsUpdateBackup').
     If the app is closed halfway, the next start begins again from that copy.
   - Data that can't be read is never replaced with an empty journal. It's kept
     aside and saving is paused until the person restores a backup.
   - Migrations only add or repair. Unknown fields are kept. Only exact
     duplicates (same id AND same content) are removed.
   - Backup files carry the journal plus this device's settings. Keys and
     passwords are left out unless the person ticks the box to include them. */
(function(){
'use strict';
const KEY='command_journal_v1',UPD='fsUpdateBackup',BAD='command_journal_v1__unreadable',SCHEMA=2;
const SETTINGS=['onboardDone','navLast','moneySub','fsMe','recapDismissed','wakeAuto','vectorAiOn','vectorAiPlain','backupLast','backupSnooze','lockAfter','vectorCtx'];
const SECRETS=['vectorAiKey','usdaKey']; // vectorServer.key is split out below
const get=k=>{try{return localStorage.getItem(k);}catch(_){return null;}};
const parse=s=>{if(s==null)return undefined;try{return JSON.parse(s);}catch(_){return undefined;}};
const isObj=v=>!!v&&typeof v==='object'&&!Array.isArray(v);
const schemaOf=d=>Number.isInteger(d&&d.schemaVersion)?d.schemaVersion:1;
const stamp=()=>new Date().toISOString();
let status={state:'starting'},blocked=false,hold=null,listeners=[];

// ---- migrations: index = the version they produce. Must be pure and safe to re-run.
function fnv(s){let h=0x811c9dc5;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,0x01000193);}return (h>>>0).toString(36);}
function tidy(list,tag,report){
 // gives id-less records a stable id and removes exact duplicates only
 const seen=new Map(),out=[];
 for(const item of list){
  if(!isObj(item)){out.push(item);continue;}
  if(item.id==null||item.id==='')item.id='m-'+tag+'-'+fnv(JSON.stringify(item));
  const k=String(item.id),body=JSON.stringify(item);
  if(seen.has(k)){if(seen.get(k).has(body)){report.duplicates++;continue;}seen.get(k).add(body);report.conflicts++;}
  else seen.set(k,new Set([body]));
  out.push(item);
 }
 return out;
}
function tidyDeep(obj,tag,report,depth){
 if(depth>2||!isObj(obj))return;
 for(const [k,v] of Object.entries(obj)){
  if(Array.isArray(v)&&v.some(isObj))obj[k]=tidy(v,tag+'.'+k,report);
  else if(isObj(v))tidyDeep(v,tag+'.'+k,report,depth+1);
 }
}
const MIGRATIONS={
 2(d,report){
  // v1 -> v2: make sure the core lists exist, repair ids, drop exact duplicates
  for(const k of ['tasks','events','reviews'])d[k]=Array.isArray(d[k])?tidy(d[k],k,report):[];
  for(const k of ['finance','fitness','grocery'])if(isObj(d[k]))tidyDeep(d[k],k,report,0);
  if(d.version==null)d.version=1; // older code reads this field; keep it
  return d;
 }
};
function migrate(input){
 const from=schemaOf(input),report={from,to:Math.max(from,SCHEMA),duplicates:0,conflicts:0};
 let d=JSON.parse(JSON.stringify(input));
 for(let v=from+1;v<=SCHEMA;v++){d=MIGRATIONS[v](d,report)||d;d.schemaVersion=v;}
 return {data:d,report};
}
const fresh=()=>({version:1,schemaVersion:SCHEMA,tasks:[],events:[],reviews:[]});
const valid=d=>isObj(d)&&Array.isArray(d.tasks)&&Array.isArray(d.events)&&Array.isArray(d.reviews);

// ---- writing -----------------------------------------------------------------
function write(key,value){try{localStorage.setItem(key,value);return true;}catch(e){return e;}}
function fail(msg){status={...status,lastError:msg};listeners.forEach(f=>{try{f(status);}catch(_){}});if(window.toast)try{window.toast(msg);}catch(_){}}
function save(d){
 if(blocked){fail('Saving is paused until your data is restored (see the notice at the top).');return false;}
 if(hold){hold.data=d;return true;} // waiting for the pre-update copy to be stored safely
 const r=write(KEY,JSON.stringify(d));
 if(r!==true){fail(/quota/i.test(String(r&&r.name)+String(r&&r.message))?'Phone storage is full. That change was NOT saved. Back up and remove old items, or free space.':'That change could not be saved: '+(r&&r.message||r));return false;}
 return true;
}

// ---- loading -----------------------------------------------------------------
function load(){
 const raw=get(KEY),pending=parse(get(UPD));
 let d=parse(raw),source='stored';
 if(isObj(pending)&&typeof pending.raw==='string'){
  if(isObj(d)&&schemaOf(d)>=pending.to&&valid(d)){status={state:'ok',finishing:pending};return d;}
  // the last update didn't finish (or left unreadable data): start again from the saved original
  const orig=parse(pending.raw);
  if(isObj(orig)){
   if(raw!=null&&!isObj(d)&&get(BAD)==null)write(BAD,raw); // keep whatever was there, readable or not
   source=isObj(d)?'interrupted':'recovered';d=orig;
  }
 }
 if(raw==null&&source==='stored'){status={state:'fresh'};return fresh();}
 if(!isObj(d)){
  if(raw!=null&&get(BAD)==null)write(BAD,raw); // keep the unreadable copy; never overwrite it
  blocked=true;status={state:'blocked',message:'Your saved data could not be read. Nothing was deleted.'};
  return fresh();
 }
 const from=schemaOf(d);
 if(from>SCHEMA){status={state:'newer',from};return valid(d)?d:migrate(d).data;} // a newer version wrote this; keep all of it
 if(from===SCHEMA&&valid(d)&&source==='stored'){status={state:'ok'};return d;}
 if(from===SCHEMA&&valid(d)){write(KEY,JSON.stringify(d));status={state:source==='interrupted'?'resumed':'recovered'};return d;}
 const {data:m,report}=migrate(d);
 if(!(isObj(pending)&&typeof pending.raw==='string')){
  const r=write(UPD,JSON.stringify({from,to:SCHEMA,at:stamp(),raw}));
  if(r!==true){hold={data:m,raw};status={state:'migrating',report,held:true};return m;}
 }
 const w=write(KEY,JSON.stringify(m));
 const check=parse(get(KEY));
 if(w!==true||!isObj(check)||schemaOf(check)!==SCHEMA){status={state:'migrating',report,error:'The upgraded data could not be saved yet. Your original is kept.'};return m;}
 status={state:source==='stored'?'migrated':source==='interrupted'?'resumed':'recovered',report,finishing:parse(get(UPD))};
 return m;
}

// ---- after start: move the pre-update copy into restore points --------------
function idb(){return new Promise((res,rej)=>{if(!window.indexedDB)return rej(new Error('No IndexedDB'));const r=indexedDB.open('familysave',1);r.onupgradeneeded=()=>r.result.createObjectStore('snapshots',{keyPath:'id'});r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);});}
async function putSnapshot(rec){const db=await idb();await new Promise((res,rej)=>{const t=db.transaction('snapshots','readwrite');t.objectStore('snapshots').put(rec);t.oncomplete=res;t.onerror=()=>rej(t.error);t.onabort=()=>rej(t.error);});db.close();}
async function settle(){
 try{
  if(hold){ // storage was too full to keep a quick copy: keep it in IndexedDB first, then save
   await putSnapshot({id:'before-update-v'+schemaOf(parse(hold.raw))+'-'+Date.now(),at:stamp(),reason:'before-update',size:hold.raw.length,data:hold.raw});
   const pendingData=hold.data;hold=null;
   if(save(pendingData))status={...status,state:'migrated',held:false};
  }
  const p=parse(get(UPD)),cur=parse(get(KEY));
  if(isObj(p)&&isObj(cur)&&schemaOf(cur)>=p.to){
   await putSnapshot({id:'before-update-v'+p.from+'-'+p.at.slice(0,10),at:p.at,reason:'before-update',size:p.raw.length,data:p.raw});
   localStorage.removeItem(UPD); // only after the copy is safely in restore points
  }
 }catch(_){/* keep fsUpdateBackup; try again next start */}
}

// ---- backup files --------------------------------------------------------------
function settingsNow(includeSecrets){
 const settings={},secrets={};
 for(const k of SETTINGS){const v=get(k);if(v!=null)settings[k]=v;}
 const srv=parse(get('vectorServer'));
 if(isObj(srv)){const {key,...rest}=srv;settings.vectorServer=JSON.stringify(rest);if(key)secrets.vectorServerKey=key;}
 for(const k of SECRETS){const v=get(k);if(v!=null)secrets[k]=v;}
 return includeSecrets&&Object.keys(secrets).length?{settings,secrets}:{settings};
}
function exportBundle(d,{includeSecrets=false}={}){
 // top level stays the journal itself, so older app versions can still import the file
 const at=stamp();
 return {...d,exportedAt:at,app:'the-family-save',_familySave:{format:1,schemaVersion:schemaOf(d),exportedAt:at,...settingsNow(includeSecrets)}};
}
function readBundle(obj){
 if(!isObj(obj))throw new Error('This is not a Family Save backup file.');
 const meta=isObj(obj._familySave)?obj._familySave:null;
 const {_familySave,exportedAt,app,...rest}=obj;
 if(!valid(rest)&&!(Array.isArray(rest.tasks)||isObj(rest.finance)||isObj(rest.fitness)))throw new Error('Invalid backup structure');
 const {data}=schemaOf(rest)>SCHEMA?{data:rest}:migrate(rest);
 return {data,settings:meta&&isObj(meta.settings)?meta.settings:{},secrets:meta&&isObj(meta.secrets)?meta.secrets:{},exportedAt:exportedAt||meta&&meta.exportedAt||null};
}
function applySettings(settings,secrets,{withSecrets=true}={}){
 // only known keys; current secrets are kept unless the file has its own
 for(const k of SETTINGS)if(typeof settings[k]==='string')write(k,settings[k]);
 if(typeof settings.vectorServer==='string'){
  const incoming=parse(settings.vectorServer),current=parse(get('vectorServer'))||{};
  if(isObj(incoming)){const key=withSecrets&&secrets.vectorServerKey?secrets.vectorServerKey:current.key;write('vectorServer',JSON.stringify(key?{...incoming,key}:incoming));}
 }
 if(withSecrets)for(const k of SECRETS)if(typeof secrets[k]==='string')write(k,secrets[k]);
}
function unblock(){blocked=false;if(status.state==='blocked')status={state:'restored'};}

window.FSStore={KEY,SCHEMA,load,save,migrate,settle,exportBundle,readBundle,applySettings,unblock,
 status:()=>status,blocked:()=>blocked,unreadable:()=>get(BAD),onChange:f=>listeners.push(f),
 clearUnreadable:()=>{try{localStorage.removeItem(BAD);}catch(_){}}};
})();
