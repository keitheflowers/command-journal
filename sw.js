const CACHE='family-save-v47-20261112';
const ASSETS=['./','./index.html','./manifest.webmanifest','./icon.svg','./icons/vector-192.png','./icons/vector-512.png','./icons/vector-maskable-512.png','./native.js?v=1','./voice-upgrade.js?v=16','./voice-capture.js','./calendar.js?v=3','./finance.js?v=4','./budget.js?v=5','./savings.js?v=2','./fitness.js?v=4','./nutrition.js?v=3','./grocery.js?v=2','./strength.js?v=5','./store.js?v=2','./config.js?v=1','./chat-memory.js?v=1','./ai.js?v=10','./sync.js?v=3','./chat-ui.js?v=1','./dashboard.js?v=4','./backup.js?v=2','./lock.js?v=2','./nav.js?v=1','./recap.js?v=1','./onboarding.js?v=1','./privacy.html','./terms.html','./vendor/anthropic-sdk-0.137.0.js','./wake-journal.js?v=32'];
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)));self.skipWaiting()});
self.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))));self.clients.claim()});
self.addEventListener('fetch',event=>{
 if(event.request.method!=='GET')return;
 const url=new URL(event.request.url);
 if(url.origin!==self.location.origin)return;
 const isApp=url.pathname.endsWith('/')||/\.(?:html|js|css)$/.test(url.pathname);
 if(isApp){
  event.respondWith(fetch(event.request).then(response=>{
   if(response.ok){const copy=response.clone();event.waitUntil(caches.open(CACHE).then(cache=>cache.put(event.request,copy)));}
   return response;
  }).catch(()=>caches.match(event.request).then(cached=>cached||(event.request.mode==='navigate'?caches.match('./index.html'):caches.match(event.request,{ignoreSearch:true})))));
 }else{
  event.respondWith(caches.match(event.request).then(cached=>cached||fetch(event.request)));
 }
});