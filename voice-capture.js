/* Command Journal speech capture v3: pause-tolerant, manual finish.
 * Keeps completed segments, attempts to resume if Android ends a recognition session.
 * Browser speech recognition has platform-specific time limits and may require network access.
 */
(function(){
'use strict';
let recording=false, rec=null, finalized='', sessionFinal='', base='', finishing=false, restartTimer=null, errors=0, generation=0;
const input=()=>document.getElementById('command');
const controls=()=>[document.getElementById('microphone'),...document.querySelectorAll('button[onclick="startVoice()"]')].filter(Boolean);
function present(){
  controls().forEach(b=>{
    b.classList.toggle('live',recording);
    b.textContent=recording?'■ Finish speaking':b.id==='microphone'?'🎙 Voice update':'🎙 Speak';
    b.setAttribute('aria-pressed',String(recording));
  });
  let node=document.getElementById('voiceStatus');
  if(!node){node=document.createElement('div');node.id='voiceStatus';node.className='hint';node.setAttribute('role','status');let box=input();box.parentNode.insertBefore(node,box.nextSibling);}
  node.textContent=recording?'Listening — you can pause. Tap Finish speaking when done.':finishing?'Finishing transcription…':'';
}
function join(a,b){return [a.trim(),b.trim()].filter(Boolean).join(' ');}
function update(extra=''){input().value=join(base,join(finalized,join(sessionFinal,extra)));}
function cancelRestart(){if(restartTimer){clearTimeout(restartTimer);restartTimer=null;}}
function stopByUser(){
  recording=false;finishing=true;cancelRestart();present();
  if(rec){try{rec.stop();}catch(e){finish();}}else finish();
}
function finish(){
  finishing=false;rec=null;cancelRestart();present();
  let transcript=input().value.trim();
  if(!transcript){toast('No speech captured. Try again or type your update.');return;}
  toast('Transcription ready — review the words before confirming any task changes.');
  input().focus();
  // Never automatically apply actions. Show the interpretation for explicit approval.
  if(typeof window.interpretCommand==='function')window.interpretCommand();
}
function begin(myGen){
  if(!recording||myGen!==generation)return;
  const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
  let r=new SR();rec=r;sessionFinal='';
  r.lang='en-US';r.continuous=true;r.interimResults=true;r.maxAlternatives=1;
  r.onresult=event=>{
    if(myGen!==generation)return;
    let committed='',interim='';
    for(let i=0;i<event.results.length;i++){
      let t=event.results[i][0]?.transcript||'';
      if(event.results[i].isFinal)committed=join(committed,t);
      else interim=join(interim,t);
    }
    sessionFinal=committed;
    update(interim);
    errors=0;
  };
  r.onerror=event=>{
    if(myGen!==generation)return;
    if(event.error==='not-allowed'||event.error==='service-not-allowed'||event.error==='audio-capture'){
      recording=false;finishing=false;toast('Microphone permission or audio capture unavailable.');present();return;
    }
    if(event.error==='network'){recording=false;finishing=false;toast('Speech service connection failed; transcript preserved.');present();return;}
    if(event.error!=='no-speech'&&event.error!=='aborted')toast('Speech recognition: '+event.error);
  };
  r.onend=()=>{
    if(myGen!==generation)return;
    finalized=join(finalized,sessionFinal);
    sessionFinal='';
    update();
    rec=null;
    if(finishing||!recording){finish();return;}
    errors++;
    if(errors>15){recording=false;toast('Speech service repeatedly stopped. Review the captured text.');finish();return;}
    // SpeechRecognition can stop itself on Android, even with continuous=true.
    // Restarting is best-effort; some browsers require another user gesture.
    restartTimer=setTimeout(()=>{restartTimer=null;try{begin(myGen);}catch(e){recording=false;finish();toast('Tap Speak to continue if the microphone stopped.');}},250);
  };
  try{r.start();present();}catch(e){recording=false;finish();toast('Unable to restart microphone; try tapping Speak again.');}
}
window.startVoice=function(){
  if(recording){stopByUser();return;}
  if(finishing)return;
  const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
  if(!SR){openView('today');input().focus();toast('Speech recognition unavailable. Use keyboard dictation.');return;}
  openView('today');
  generation++;
  recording=true;finishing=false;errors=0;finalized='';sessionFinal='';
  base=input().value.trim();
  // Append to an existing unfinished dictation rather than discarding it.
  try{begin(generation);toast('Listening — pause as needed; tap Finish speaking when done.');}
  catch(e){recording=false;present();toast('Unable to start microphone.');}
};
present();
})();