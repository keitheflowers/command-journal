/* Foreground wake phrase for Command Journal. Browser limitation:
   user gesture required to arm; recognition may stop or require another gesture.
   Never runs in background, never modifies tasks without existing confirmation. */
(function(){
'use strict';
const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
const trigger=/\b(?:vector|victor|vektor|vecter|hector)[\s,.!]+(?:open|opened|opening|opens)\s+(?:the\s+|my\s+)?(?:journal|journals|general)\b/i;
let armed=false,active=false,recognizer=null,restart=null,retries=0,gen=0;
let lastHeard='',buffered='',recognized='',silenceTimer=null,commandMode=false,autoTry=false;
const PREF='wakeAuto';
function autoPref(){try{return localStorage.getItem(PREF)!=='0';}catch(_){return true;}}
function setAutoPref(on){try{localStorage.setItem(PREF,on?'1':'0');}catch(_){}}
const input=()=>document.getElementById('command');
const status=()=>document.getElementById('wakeStatus');
const button=()=>document.getElementById('wakeArm');
const clean=t=>String(t||'').trim();
function ui(msg){
 if(button()){button().textContent=armed?'Disable hands-free':'Enable hands-free';button().setAttribute('aria-pressed',String(armed));}
 if(status())status().textContent=msg||(armed?(commandMode?'Journal listening for your instructions…':'Waiting for “Vector, open Journal”…'):'Hands-free is off.');
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
function waitMsg(){return '🎙 Listening. Say “Vector, open Journal”.'+(lastHeard?' Last heard: “'+lastHeard+'”':'');}
function cancelTimer(){if(silenceTimer)clearTimeout(silenceTimer);silenceTimer=null;}
function stopRecognition(){if(recognizer){let r=recognizer;recognizer=null;try{r.abort();}catch(_){}}}
function disarm(msg){armed=false;commandMode=false;active=false;gen++;clearTimeout(restart);cancelTimer();stopRecognition();ui(msg||'Hands-free is off.');}
function execute(){
 cancelTimer();
 let command=clean(buffered);
 buffered='';recognized='';commandMode=false;
 if(command){
  openView('today');input().value=command;
  if(typeof window.interpretCommand==='function')window.interpretCommand();
  ui('Review the proposed changes, then confirm. Wake listener is still armed.');
 }else ui('No instruction heard. Say “Vector, open Journal” to try again.');
}
function startCommandMode(initial){
 commandMode=true;buffered=clean(initial);recognized='';openView('today');
 ui('Journal listening. Speak your instruction, then pause to preview.');
 if(buffered)timer();
}
function timer(){cancelTimer();silenceTimer=setTimeout(execute,2600);}
function onSpeech(text,isFinal){
 let t=clean(text);if(!t)return;
 if(!commandMode){
  let m=trigger.exec(t);
  if(!m){if(isFinal){lastHeard=t;ui(waitMsg());}return;}
  let extra=clean(t.slice(m.index+m[0].length)).replace(/^[,.!?\s]+/,'');
  startCommandMode(extra);
  if(extra){buffered=isFinal?extra:'';timer();}
  return;
 }
 // Receive only final command segments to avoid duplicate interim words.
 if(isFinal){let phrase=trigger.exec(t);if(phrase)t=clean(t.slice(phrase.index+phrase[0].length)); t=t.replace(/^[,.!?\s]+/,''); if(t){buffered=merge(buffered,t);timer();}}
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
   else{let interim=e.results[i][0].transcript; if(trigger.test(interim)&&!commandMode)onSpeech(interim,false);else if(commandMode)timer();else ui('🎙 Hearing: “'+clean(interim)+'”');}
  }
  retries=0;
 };
 r.onerror=e=>{
  if(localGen!==gen)return;
  if(e.error==='not-allowed'&&autoTry){autoTry=false;disarm('Chrome needs one tap first. Tap anywhere to start hands-free.');waitForTap();return;}
  if(['not-allowed','service-not-allowed','audio-capture'].includes(e.error)){disarm('Activation failed ('+e.error+'). Open Journal in Chrome and allow microphone permission for this site.');return;}
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
  if(++retries>12){disarm('Android repeatedly stopped speech recognition. Try opening Journal in Chrome; browser wake detection may be unsupported.');return;}
  restart=setTimeout(()=>{try{listen(localGen)}catch(_){disarm('Browser requires another tap to restart listening.');}},350);
 };
 r.onstart=()=>{if(localGen===gen&&armed&&!commandMode)ui(waitMsg());};
 try{r.start();if(!retries)ui('Starting microphone…');}catch(e){disarm('Activation failed ('+(e.name||'start blocked')+'). Open Journal in Chrome and allow the microphone.');}
}
function arm(auto){
 if(armed)return;
 if(!SR){ui('Activation unavailable: this browser lacks SpeechRecognition. Open Journal in Chrome.');return;}
 if(!window.isSecureContext){ui('Activation unavailable: open Journal using its secure HTTPS address.');return;}
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
function autoStart(){if(autoPref()&&!armed&&!document.hidden)arm(true);}
const panel=document.createElement('div');
panel.className='panel';
panel.innerHTML='<h2>Vector voice activation</h2><p class="hint">When enabled, say <strong>“Vector, open Journal”</strong>, then speak a task instruction. Pause to review proposed changes before saving. Works only while this page is open and active; Android may stop browser listening.</p><button id="wakeArm" class="btn alt" type="button">Enable hands-free</button><p id="wakeStatus" class="hint" role="status">Hands-free is off.</p>';
const settings=document.getElementById('settings');
const voiceSection=Array.from(settings.querySelectorAll('.panel')).find(p=>p.querySelector('h2')?.textContent==='Voice and notifications');
if(voiceSection)voiceSection.insertAdjacentElement('afterbegin',panel);
else settings.appendChild(panel);
panel.style.marginTop='12px';
button().addEventListener('click',toggle);
document.addEventListener('visibilitychange',()=>{if(document.hidden){if(armed)disarm('App left foreground.');}else autoStart();});
window.addEventListener('pagehide',()=>{if(armed)disarm();});
ui('Voice activation v14 loaded.'+(autoPref()?' Starting hands-free…':' Hands-free is off.'));
setTimeout(autoStart,300);
})();