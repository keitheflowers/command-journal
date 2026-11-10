/* Foreground wake phrase for The Family Save. Browser limitation:
   user gesture required to arm; recognition may stop or require another gesture.
   Never runs in background, never modifies tasks without existing confirmation. */
(function(){
'use strict';
const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
const trigger=/\b(?:vector|victor|vektor|vecter|hector)[\s,.!]+(?:open|opened|opening|opens)\s+(?:the\s+|my\s+)?(?:journal|journals|general|family\s+(?:save|saves|saved|safe|safes))\b/i;
let armed=false,active=false,recognizer=null,restart=null,retries=0,gen=0;
let session=false,sessionTimer=null,lastSaid='',confirmUntil=0,quietUntil=0,lastHeard='',buffered='',recognized='',silenceTimer=null,commandMode=false,autoTry=false;
const PREF='wakeAuto';
function autoPref(){try{return localStorage.getItem(PREF)!=='0';}catch(_){return true;}}
function setAutoPref(on){try{localStorage.setItem(PREF,on?'1':'0');}catch(_){}}
const input=()=>document.getElementById('command');
const status=()=>document.getElementById('wakeStatus');
const button=()=>document.getElementById('wakeArm');
const clean=t=>String(t||'').trim();
const pill=document.createElement('div');pill.id='wakePill';pill.setAttribute('aria-hidden','true');
const pillCss=document.createElement('style');pillCss.textContent='#wakePill{position:fixed;top:6px;left:50%;transform:translateX(-50%);z-index:20;font-size:11.5px;font-weight:700;padding:6px 12px;border-radius:20px;background:#0b1a28ee;border:1px solid #1f5a78;color:#9fd9ec;white-space:nowrap;max-width:94%;overflow:hidden;text-overflow:ellipsis;pointer-events:none;transition:opacity .2s}#wakePill.live{background:linear-gradient(135deg,#46d9f5,#5b7cff);color:#03101a;border-color:transparent;box-shadow:0 0 18px #46d9f566}#wakePill.off{opacity:0}';
document.head.appendChild(pillCss);document.body.appendChild(pill);
function updatePill(){
 if(!armed){pill.className='off';return;}
 if(Date.now()<confirmUntil&&hasPending()){pill.className='live';pill.textContent='🎙 Say “confirm” or “cancel”';return;}
 if(commandMode){pill.className='live';pill.textContent='🎙 Listening… say a task, or “that’s all”';return;}
 pill.className='';pill.textContent='🎙 Say “Vector, open Family Save”';
}
function ui(msg){
 setTimeout(updatePill,0);
 if(button()){button().textContent=armed?'Disable hands-free':'Enable hands-free';button().setAttribute('aria-pressed',String(armed));}
 if(status())status().textContent=msg||(armed?(commandMode?'Family Save is listening for your instructions…':'Waiting for “Vector, open Family Save”…'):'Hands-free is off.');
}
// Android Chrome often re-sends the whole phrase so far as a new final result
// ("add", "add milk", "add milk tomorrow"); replace instead of appending.
function merge(prev,next){
 const n=x=>x.toLowerCase().replace(/[^a-z0-9 ]/g,'').replace(/\s+/g,' ').trim();
 const p=n(prev),q=n(next);
 if(!p)return next;
 if(q.startsWith(p))return next;
 if(p.endsWith(q)||p.includes(q))return prev;
 return clean(prev+' '+next);
}
function waitMsg(){return '🎙 Listening. Say “Vector, open Family Save”.'+(lastHeard?' Last heard: “'+lastHeard+'”':'');}
// ---- Hands-free confirmation -------------------------------------------
const YES=/\b(?:confirm|confirmed|yes|yeah|yep|save|save it|do it|go ahead|approve|approved|sounds good)\b/i;
const NO=/\b(?:cancel|cancelled|canceled|no|nope|never ?mind|discard|scrap that|delete that)\b/i;
const previewBox=()=>document.getElementById('commandPreview');
function hasPending(){const b=previewBox();return !!(b&&!b.classList.contains('hidden')&&b.querySelector('button[onclick="applyPreview()"]'));}
function say(text){
 // Read results aloud; ignore the microphone while speaking so it can't hear itself.
 if(!window.speechSynthesis||!window.SpeechSynthesisUtterance)return;
 try{
  speechSynthesis.cancel();
  lastSaid=text;
  const u=new SpeechSynthesisUtterance(text);u.lang='en-US';u.rate=1.2;
  // Only go deaf once speech has actually started: Chrome may block speech
  // without a tap, and then the mic must keep listening for "confirm".
  u.onstart=()=>{quietUntil=Date.now()+Math.min(12000,1500+text.length*75);};
  u.onend=()=>{quietUntil=Date.now()+800;};
  u.onerror=()=>{quietUntil=0;};
  speechSynthesis.speak(u);
 }catch(_){}
}
function spoken(item){
 let t=item.replace(/\s+·\s+/g,', ');
 try{t=t.split(plusDays(day(),1)).join('tomorrow').split(day()).join('today');}catch(_){}
 try{for(const ar of AREAS)if(t.endsWith(', '+ar))return t.slice(0,-(ar.length+2));}catch(_){}
 return t;
}
function startConfirm(){
 confirmUntil=Date.now()+60000;
 const b=previewBox();
 if(b&&!b.querySelector('.voice-confirm')){const p=document.createElement('p');p.className='voice-confirm';p.textContent='🎙 Say “confirm” to save or “cancel” to discard.';b.appendChild(p);}
 const items=Array.from(b.querySelectorAll('li')).map(li=>spoken(li.textContent));
 try{b.scrollIntoView({behavior:'smooth',block:'center'});}catch(_){}
 say(items.join('. ')+'.');
 ui('Waiting for “confirm” or “cancel”…');
}
const QUICK=/^(?:confirm|confirmed|cancel|yes|yeah|yep|no|nope|save it|never ?mind|go ahead|do it)$/;
function quickReply(t){
 const w=t.toLowerCase().replace(/[^a-z ]/g,'').trim();
 if(!QUICK.test(w))return false;
 const items=Array.from(previewBox()?.querySelectorAll('li')||[]).map(li=>li.textContent.toLowerCase()).join(' ');
 return !new RegExp('\\b'+w+'\\b').test(items); // never a word Journal itself is reading aloud
}
const END=/^(?:no|nope|that'?s all|that is all|that'?s it|i'?m done|all done|done|nothing|nothing else|no thanks|no thank you|close journal|goodbye|bye|stop listening)$/i;
const norm=t=>t.toLowerCase().replace(/[^a-z0-9 ]/g,' ').replace(/\s+/g,' ').trim();
function isEcho(t){const a=norm(t),b=norm(lastSaid);return a.length>2&&b.includes(a);}
function nextInSession(prompt){
 // Stay open for another instruction instead of requiring the wake phrase again.
 session=true;say(prompt);startCommandMode('');
}
function endSession(msg){
 session=false;commandMode=false;buffered='';cancelTimer();clearTimeout(sessionTimer);
 ui(msg||waitMsg());
}
function handleConfirm(t){
 if(!hasPending()){confirmUntil=0;return false;}
 const yes=YES.test(t),no=NO.test(t);
 if(yes===no)return false; // neither, or ambiguous: ignore
 confirmUntil=0;
 if(yes){window.lastSaveSummary='';window.applyPreview();const sum=window.lastSaveSummary;nextInSession(sum?sum+' What else?':'Saved. What else?');}
 else{window.cancelVoicePreview();nextInSession('Cancelled. What else?');}
 return true;
}
function cancelTimer(){if(silenceTimer)clearTimeout(silenceTimer);silenceTimer=null;}
function stopRecognition(){if(recognizer){let r=recognizer;recognizer=null;try{r.abort();}catch(_){}}}
function disarm(msg){armed=false;commandMode=false;session=false;clearTimeout(sessionTimer);active=false;gen++;clearTimeout(restart);cancelTimer();stopRecognition();ui(msg||'Hands-free is off.');}
function execute(){
 cancelTimer();
 let command=clean(buffered);
 buffered='';recognized='';commandMode=false;
 if(command){
  openView('today');input().value=command;
  ui('🧠 Working on it…');
  Promise.resolve(typeof window.interpretCommand==='function'&&window.interpretCommand()).catch(()=>{}).then(()=>{
   if(!armed)return;
   if(hasPending())startConfirm();
   else if(window.lastVectorReply)nextInSession(window.lastVectorReply);
   else nextInSession('Sorry, I didn’t catch that. Try again, or say that’s all.');
  });
 }else if(session)startCommandMode('');
 else ui('No instruction heard. Say “Vector, open Family Save” to try again.');
}
function startCommandMode(initial){
 commandMode=true;session=true;buffered=clean(initial);recognized='';openView('today');
 clearTimeout(sessionTimer);sessionTimer=setTimeout(()=>{if(commandMode&&!buffered)endSession('Family Save closed after a quiet spell. Say “Vector, open Family Save” to start again.');},30000);
 ui('Listening. Give an instruction, pause to review, or say “that’s all”.');
 if(buffered)timer();
}
function timer(ms){cancelTimer();silenceTimer=setTimeout(execute,ms||2000);}
function onSpeech(text,isFinal){
 let t=clean(text);if(!t)return;
 if(!commandMode&&Date.now()<confirmUntil&&quickReply(t)){try{speechSynthesis.cancel();}catch(_){}quietUntil=0;if(handleConfirm(t))return;}
 if(Date.now()<quietUntil)return; // Journal is talking; don't hear itself
 if(isFinal&&isEcho(t))return; // late transcript of Journal's own voice
 if(!commandMode&&isFinal&&Date.now()<confirmUntil&&!trigger.test(t)&&handleConfirm(t))return;
 if(!commandMode){
  let m=trigger.exec(t);
  if(!m){if(isFinal){lastHeard=t;ui(waitMsg());}return;}
  let extra=clean(t.slice(m.index+m[0].length)).replace(/^[,.!?\s]+/,'');
  startCommandMode(extra);
  if(extra){buffered=isFinal?extra:'';timer(isFinal?1200:2000);}
  return;
 }
 clearTimeout(sessionTimer);
 if(isFinal&&!buffered&&END.test(t.toLowerCase().replace(/[^a-z' ]/g,'').replace(/\s+/g,' ').trim().replace(/^(?:ok(?:ay)?|no)\s+/,''))){say('Okay.');endSession();return;}
 // Receive only final command segments to avoid duplicate interim words.
 if(isFinal){let phrase=trigger.exec(t);if(phrase)t=clean(t.slice(phrase.index+phrase[0].length)); t=t.replace(/^[,.!?\s]+/,''); if(t){buffered=merge(buffered,t);timer(1200);}}
 else{timer();ui('Listening to your instruction…');}
}
function listen(localGen){
 if(!armed||localGen!==gen||document.hidden)return;
 let r=new SR();recognizer=r;active=true;
 r.lang='en-US';r.continuous=true;r.interimResults=true;r.maxAlternatives=1;
 let seen=0,startedAt=Date.now();
 r.onresult=e=>{
  if(!armed||localGen!==gen)return;
  // Browser results include full session; process finalized results just once.
  for(let i=seen;i<e.results.length;i++){
   if(e.results[i].isFinal){onSpeech(e.results[i][0].transcript,true);seen=i+1;}
   else{let interim=e.results[i][0].transcript; if(!commandMode&&Date.now()<confirmUntil&&quickReply(clean(interim)))onSpeech(interim,false);else if(trigger.test(interim)&&!commandMode)onSpeech(interim,false);else if(commandMode)timer();else ui('🎙 Hearing: “'+clean(interim)+'”');}
  }
  retries=0;
 };
 r.onerror=e=>{
  if(localGen!==gen)return;
  if(e.error==='not-allowed'&&autoTry){autoTry=false;disarm('Chrome needs one tap first. Tap anywhere to start hands-free.');waitForTap();return;}
  if(['not-allowed','service-not-allowed','audio-capture'].includes(e.error)){disarm('Activation failed ('+e.error+'). Open Family Save in Chrome and allow microphone permission for this site.');return;}
  if(e.error==='network'){disarm('Activation failed (network). Browser speech service unavailable; try Chrome with internet access.');return;}
  if(e.error!=='no-speech'&&e.error!=='aborted')ui('Speech recognition error: '+e.error+'. Retrying…');
 };
 r.onend=()=>{
  if(localGen!==gen)return;
  active=false;recognizer=null;
  if(!armed)return;
  if(commandMode&&buffered)timer();
  if(document.hidden)return;
  // Only count rapid failures; normal silence timeouts restart indefinitely.
  if(Date.now()-startedAt>1500)retries=0;
  if(++retries>12){disarm('Android repeatedly stopped speech recognition. Try opening Family Save in Chrome; browser wake detection may be unsupported.');return;}
  restart=setTimeout(()=>{try{listen(localGen)}catch(_){disarm('Browser requires another tap to restart listening.');}},150);
 };
 r.onstart=()=>{if(localGen===gen&&armed&&!commandMode)ui(waitMsg());};
 try{r.start();if(!retries)ui('Starting microphone…');}catch(e){disarm('Activation failed ('+(e.name||'start blocked')+'). Open Family Save in Chrome and allow the microphone.');}
}
function arm(auto){
 if(armed)return;
 if(!SR){ui('Activation unavailable: this browser lacks SpeechRecognition. Open Family Save in Chrome.');return;}
 if(!window.isSecureContext){ui('Activation unavailable: open Family Save using its secure HTTPS address.');return;}
 autoTry=!!auto;armed=true;commandMode=false;buffered='';retries=0;gen++;
 try{listen(gen);}catch(_){disarm('Unable to start microphone.');if(auto)waitForTap();}
}
function toggle(){
 if(armed){setAutoPref(false);disarm('Hands-free is off. It will stay off until you enable it again.');return;}
 setAutoPref(true);arm(false);
}
let tapWaiting=false;
function waitForTap(){
 if(tapWaiting)return;tapWaiting=true;
 const go=e=>{
  document.removeEventListener('pointerup',go,true);tapWaiting=false;
  if(e.target&&e.target.closest&&e.target.closest('#wakeArm'))return; // button handles itself
  if(autoPref()&&!armed&&!document.hidden)arm(false);
 };
 document.addEventListener('pointerup',go,true);
}
function autoStart(){if(window.AppLock&&window.AppLock.locked())return; // wait until unlocked
 if(autoPref()&&!armed&&!document.hidden)arm(true);}
document.addEventListener('app-unlocked',()=>setTimeout(autoStart,200));
const panel=document.createElement('div');
panel.className='panel';
panel.innerHTML='<h2>Vector voice activation</h2><p class="hint">Say <strong>“Vector, open Family Save”</strong>, then your instruction. It reads back the change — say <strong>“confirm”</strong> or <strong>“cancel”</strong>. It keeps listening for more until you say <strong>“that’s all”</strong>. Works only while this page is open and active; Android may stop browser listening.</p><button id="wakeArm" class="btn alt" type="button">Enable hands-free</button><p id="wakeStatus" class="hint" role="status">Hands-free is off.</p>';
const settings=document.getElementById('settings');
const voiceSection=Array.from(settings.querySelectorAll('.panel')).find(p=>p.querySelector('h2')?.textContent==='Voice and notifications');
if(voiceSection)voiceSection.insertAdjacentElement('afterbegin',panel);
else settings.appendChild(panel);
panel.style.marginTop='12px';
button().addEventListener('click',toggle);
document.addEventListener('visibilitychange',()=>{if(document.hidden){if(armed)disarm('App left foreground.');}else autoStart();});
window.addEventListener('pagehide',()=>{if(armed)disarm();});
// Android app: "Hey Vector" heard while the app was closed -> ready for an instruction
window.VectorWake={wake(){if(!armed){setAutoPref(true);arm(false);}if(!armed)return;session=true;say('Yes?');startCommandMode('');}};
ui('Voice activation v40 loaded.'+(autoPref()?' Starting hands-free…':' Hands-free is off.'));
setTimeout(autoStart,300);
})();