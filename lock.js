/* The Family Save app lock: PIN (stored only as a salted PBKDF2 hash) and
   optional fingerprint / face unlock through the phone's own biometrics
   (WebAuthn platform authenticator, no server). Locks on open and after the
   app has been in the background for the chosen time.
   It is a screen lock: it keeps people out of the app, but the data in
   browser storage is not encrypted by it. */
(function(){
'use strict';
const K={pin:'lockPin',cred:'lockCred',after:'lockAfter',hid:'lockHiddenAt',fails:'lockFails'};
const ls={get:k=>{try{return localStorage.getItem(k);}catch(_){return null;}},set:(k,v)=>{try{v==null?localStorage.removeItem(k):localStorage.setItem(k,v);}catch(_){}}};
const b64=buf=>btoa(String.fromCharCode(...new Uint8Array(buf))),unb64=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
async function hashPin(pin,saltB64){const salt=saltB64?unb64(saltB64):crypto.getRandomValues(new Uint8Array(16));
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(pin),'PBKDF2',false,['deriveBits']);
 const bits=await crypto.subtle.deriveBits({name:'PBKDF2',salt,iterations:150000,hash:'SHA-256'},key,256);return {salt:b64(salt),hash:b64(bits)};}
const stored=()=>{try{return JSON.parse(ls.get(K.pin)||'null');}catch(_){return null;}};
async function checkPin(pin){const s=stored();if(!s)return false;const h=await hashPin(pin,s.salt);return h.hash===s.hash;}
const enabled=()=>!!stored();
let locked=false;

// ---- biometrics -------------------------------------------------------------
async function bioAvailable(){try{return !!(window.PublicKeyCredential&&await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable());}catch(_){return false;}}
async function bioEnroll(){
 const cred=await navigator.credentials.create({publicKey:{challenge:crypto.getRandomValues(new Uint8Array(32)),rp:{name:'The Family Save',id:location.hostname},
  user:{id:crypto.getRandomValues(new Uint8Array(16)),name:'family-save',displayName:'The Family Save'},pubKeyCredParams:[{type:'public-key',alg:-7},{type:'public-key',alg:-257}],
  authenticatorSelection:{authenticatorAttachment:'platform',userVerification:'required',residentKey:'discouraged'},timeout:60000,attestation:'none'}});
 ls.set(K.cred,b64(cred.rawId));
}
async function bioVerify(){
 const id=ls.get(K.cred);if(!id)return false;
 const a=await navigator.credentials.get({publicKey:{challenge:crypto.getRandomValues(new Uint8Array(32)),rpId:location.hostname,allowCredentials:[{type:'public-key',id:unb64(id)}],userVerification:'required',timeout:60000}});
 return !!(a&&a.response&&a.response.authenticatorData);
}

// ---- lock screen -------------------------------------------------------------
const css=document.createElement('style');css.textContent=`
#lockScreen{position:fixed;inset:0;z-index:1000;background:radial-gradient(ellipse at top right,#0f2a3f,transparent 55%),#070a12;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:24px;color:#eef6fb}
#lockScreen[hidden]{display:none!important}
#lockScreen .brand{width:64px;height:64px;border-radius:18px;margin-bottom:14px}#lockScreen .brand svg{width:36px;height:36px}
#lockScreen h1{font-size:22px;margin:0}#lockScreen .msg{font-size:13px;color:#aebdcc;margin:6px 0 18px;min-height:18px;text-align:center}
.lk-dots{display:flex;gap:14px;margin-bottom:22px}.lk-dots i{width:14px;height:14px;border-radius:50%;border:2px solid #46d9f5}.lk-dots i.on{background:#46d9f5}
.lk-pad{display:grid;grid-template-columns:repeat(3,72px);gap:14px}.lk-pad button{height:72px;border-radius:50%;border:1px solid #24394f;background:#0e1826;color:#fff;font-size:26px;font-weight:600}
.lk-pad button:active{background:#14304a}.lk-pad .ghost{background:none;border:0;font-size:15px;color:#9fd9ec}
.lk-links{margin-top:20px;display:flex;flex-direction:column;align-items:center;gap:10px}.lk-links button{background:none;border:0;color:#9fd9ec;font-size:14px}
.lk-shake{animation:lkS .35s}@keyframes lkS{0%,100%{transform:none}25%{transform:translateX(-10px)}75%{transform:translateX(10px)}}`;
document.head.appendChild(css);
const screen=document.createElement('div');screen.id='lockScreen';screen.setAttribute('role','dialog');screen.setAttribute('aria-label','The Family Save is locked');screen.hidden=true;document.body.appendChild(screen);
let entry='',busy=false;
function draw(msg){
 const n=(stored()||{}).len||4;const hasBio=!!ls.get(K.cred);
 screen.innerHTML=`<div class="brand">${(document.querySelector('.brand')||{}).innerHTML||''}</div><h1>The Family Save</h1><div class="msg" id="lkMsg">${msg||'Enter your PIN'}</div>
  <div class="lk-dots" id="lkDots">${Array.from({length:n},(_,i)=>`<i class="${i<entry.length?'on':''}"></i>`).join('')}</div>
  <div class="lk-pad">${[1,2,3,4,5,6,7,8,9].map(d=>`<button data-lk="${d}">${d}</button>`).join('')}<button class="ghost" data-lk="bio" ${hasBio?'':'style="visibility:hidden"'} aria-label="Use fingerprint">👆</button><button data-lk="0">0</button><button class="ghost" data-lk="del" aria-label="Delete">⌫</button></div>
  <div class="lk-links"><button data-lk="forgot">Forgot PIN?</button></div>`;
}
function lock(){if(!enabled()||locked)return;locked=true;entry='';document.documentElement.classList.add('app-locked');screen.hidden=false;draw();if(ls.get(K.cred))setTimeout(tryBio,300);}
function unlock(){locked=false;entry='';ls.set(K.fails,null);screen.hidden=true;document.documentElement.classList.remove('app-locked');document.dispatchEvent(new Event('app-unlocked'));}
async function tryBio(){if(busy||!locked)return;busy=true;try{if(await bioVerify())unlock();}catch(e){const m=document.getElementById('lkMsg');if(m)m.textContent='Fingerprint cancelled. Enter your PIN.';}busy=false;}
async function submit(){
 const fails=+(ls.get(K.fails)||0),wait=fails>=5?30000*(2**Math.min(fails-5,4)):0,lastFail=+(ls.get('lockFailAt')||0);
 if(wait&&Date.now()-lastFail<wait){entry='';draw(`Too many tries. Wait ${Math.ceil((wait-(Date.now()-lastFail))/1000)} s.`);return;}
 if(await checkPin(entry)){unlock();return;}
 ls.set(K.fails,String(fails+1));ls.set('lockFailAt',String(Date.now()));entry='';draw(fails+1>=5?'Wrong PIN. Wait 30 seconds before trying again.':'Wrong PIN. Try again.');
 document.getElementById('lkDots')?.classList.add('lk-shake');
}
screen.addEventListener('click',e=>{
 const b=e.target.closest('[data-lk]');if(!b||busy)return;const k=b.dataset.lk,n=(stored()||{}).len||4;
 if(/^\d$/.test(k)){if(entry.length<n){entry+=k;draw();if(entry.length===n)submit();}}
 else if(k==='del'){entry=entry.slice(0,-1);draw();}
 else if(k==='bio')tryBio();
 else if(k==='forgot'){
  if(ls.get(K.cred)){draw('Use your fingerprint 👆, then change the PIN in Settings.');tryBio();return;}
  if(confirm('There is no way to recover a forgotten PIN; that is what keeps the app private.\n\nThe only option is to erase everything on this phone and restore from a backup file. Continue?')){
   const t=prompt('Type ERASE to delete all Family Save data on this phone.');if(t==='ERASE'){try{localStorage.clear();indexedDB.deleteDatabase('familysave');indexedDB.deleteDatabase('familysave-chat');}catch(_){}location.reload();}}
 }
});
document.addEventListener('keydown',e=>{if(!locked)return;if(/^\d$/.test(e.key))screen.querySelector(`[data-lk="${e.key}"]`)?.click();else if(e.key==='Backspace')screen.querySelector('[data-lk="del"]').click();});

// auto-lock after the app has been in the background long enough
document.addEventListener('visibilitychange',()=>{
 if(!enabled())return;
 if(document.hidden){ls.set(K.hid,String(Date.now()));if((+(ls.get(K.after)||0))===0)lock();}
 else{const gone=Date.now()-(+(ls.get(K.hid)||Date.now())),after=+(ls.get(K.after)||0)*60000;if(gone>=after)lock();}
});

// ---- Settings panel -------------------------------------------------------------
const panel=document.createElement('div');panel.className='panel';panel.id='lk-panel';
let setting=null;
async function drawPanel(){
 const on=enabled(),bio=await bioAvailable(),hasBio=!!ls.get(K.cred),after=ls.get(K.after)||'0';
 panel.innerHTML=`<h2>🔒 App lock</h2><p class="hint" style="margin:0 0 8px">${on?'The app asks for your PIN'+(hasBio?' or fingerprint':'')+' when it opens.':'Require a PIN, and optionally your fingerprint, to open The Family Save.'} It keeps people out of the app. It doesn’t encrypt the data stored underneath.</p>
 ${setting?`<div class="bg-det"><b>${setting==='change'?'Change PIN':'Choose a PIN'}</b>${setting==='change'?'<label>Current PIN</label><input id="lkOld" type="password" inputmode="numeric" maxlength="6" autocomplete="off">':''}
  <label>New PIN (4–6 digits)</label><input id="lkNew" type="password" inputmode="numeric" maxlength="6" autocomplete="off"><label>Type it again</label><input id="lkNew2" type="password" inputmode="numeric" maxlength="6" autocomplete="off">
  <div class="actions" style="margin-top:10px"><button class="btn sm" data-lks="savepin">Save PIN</button><button class="btn alt sm" data-lks="cancel">Cancel</button></div></div>`:''}
 <div class="actions">${on?`<button class="btn" data-lks="locknow">Lock now</button><button class="btn alt" data-lks="change">Change PIN</button><button class="btn danger sm" data-lks="off">Turn off</button>`:`<button class="btn" data-lks="set">Set up a PIN</button>`}</div>
 ${on?`<label>Lock after leaving the app for</label><select id="lkAfter">${[['0','Immediately'],['1','1 minute'],['5','5 minutes'],['15','15 minutes'],['60','1 hour']].map(([v,l])=>`<option value="${v}"${v===after?' selected':''}>${l}</option>`).join('')}</select>
  <div class="actions" style="margin-top:10px">${bio?(hasBio?'<span class="hint">👆 Fingerprint / face unlock is on.</span><button class="btn alt sm" data-lks="bio-off">Turn off fingerprint</button>':'<button class="btn alt" data-lks="bio-on">👆 Use fingerprint / face unlock</button>'):'<span class="hint">Fingerprint unlock isn’t available in this browser. The PIN still works.</span>'}</div>`:''}`;
}
panel.addEventListener('change',e=>{if(e.target.id==='lkAfter'){ls.set(K.after,e.target.value);toast('Auto-lock updated.');}});
panel.addEventListener('click',async e=>{
 const b=e.target.closest('[data-lks]');if(!b)return;const a=b.dataset.lks;
 if(a==='set'||a==='change'){setting=a==='set'?'new':'change';drawPanel();return;}
 if(a==='cancel'){setting=null;drawPanel();return;}
 if(a==='savepin'){
  const n1=document.getElementById('lkNew').value,n2=document.getElementById('lkNew2').value;
  if(setting==='change'&&!(await checkPin(document.getElementById('lkOld').value))){toast('Current PIN is wrong.');return;}
  if(!/^\d{4,6}$/.test(n1)){toast('Use 4 to 6 digits.');return;}if(n1!==n2){toast('The PINs don’t match.');return;}
  if(/^(\d)\1+$/.test(n1)||'0123456789'.includes(n1)||'9876543210'.includes(n1)){if(!confirm('That PIN is easy to guess. Use it anyway?'))return;}
  const h=await hashPin(n1);ls.set(K.pin,JSON.stringify({...h,len:n1.length}));setting=null;toast('PIN saved. The app now locks.');drawPanel();return;
 }
 if(a==='off'){const p=prompt('Enter your PIN to turn the lock off');if(p===null)return;if(!(await checkPin(p))){toast('Wrong PIN.');return;}ls.set(K.pin,null);ls.set(K.cred,null);toast('App lock is off.');drawPanel();return;}
 if(a==='locknow'){lock();return;}
 if(a==='bio-on'){try{await bioEnroll();toast('Fingerprint unlock is on 👆');}catch(err){toast('Fingerprint setup was cancelled or isn’t supported.');}drawPanel();return;}
 if(a==='bio-off'){ls.set(K.cred,null);toast('Fingerprint unlock is off.');drawPanel();return;}
});
const settings=document.getElementById('settings');settings.insertBefore(panel,settings.firstChild);
window.AppLock={locked:()=>locked,enabled,lock};
const baseRender=window.render;window.render=function(){baseRender.apply(this,arguments);if(view==='settings')drawPanel();};
drawPanel();
if(enabled())lock();else document.documentElement.classList.remove('app-locked');
})();
