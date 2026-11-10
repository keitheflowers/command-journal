const CACHE='family-save-v37-20261103';
const ASSETS=['./','./index.html','./manifest.webmanifest','./icon.svg','./icons/vector-192.png','./icons/vector-512.png','./icons/vector-maskable-512.png','./voice-upgrade.js?v=13','./voice-capture.js','./calendar.js?v=3','./finance.js?v=3','./budget.js?v=3','./savings.js?v=2','./fitness.js?v=2','./nutrition.js?v=1','./grocery.js?v=2','./strength.js?v=5','./ai.js?v=8','./dashboard.js?v=4','./backup.js?v=1','./lock.js?v=1','./nav.js?v=1','./vendor/anthropic-sdk-0.137.0.js','./wake-journal.js?v=30'];
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
  }).catch(()=>caches.match(event.request).then(cached=>cached||caches.match('./index.html'))));
 }else{
  event.respondWith(caches.match(event.request).then(cached=>cached||fetch(event.request)));
 }
});