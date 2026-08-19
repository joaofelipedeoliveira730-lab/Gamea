const CACHE_VERSION='v12-0-4';
const SHELL_CACHE=`neon-path-shell-${CACHE_VERSION}`;
const RUNTIME_CACHE=`neon-path-runtime-${CACHE_VERSION}`;
const RESOURCES_CACHE='neon-path-resources-v12';
const KEEP=new Set([SHELL_CACHE,RUNTIME_CACHE,RESOURCES_CACHE]);
const scopeUrl=new URL(self.registration.scope);
const assetUrl=file=>new URL(String(file||'').replace(/^\//,''),scopeUrl).toString();
const SHELL=['','index.html','style.css','app.js','config.js','loading-hero.webp','prestige-emblem.webp','1-spark.svg'].map(assetUrl);
const INDEX_URL=assetUrl('index.html');

self.addEventListener('install',event=>{
  event.waitUntil(caches.open(SHELL_CACHE).then(cache=>cache.addAll(SHELL)).then(()=>self.skipWaiting()));
});

self.addEventListener('activate',event=>{
  event.waitUntil(Promise.all([
    caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('neon-path-')&&!KEEP.has(key)).map(key=>caches.delete(key)))),
    self.clients.claim()
  ]));
});

self.addEventListener('message',event=>{
  if(event.data?.type==='SKIP_WAITING')self.skipWaiting();
});

self.addEventListener('fetch',event=>{
  const request=event.request;
  if(request.method!=='GET'||request.headers.has('range'))return;
  const url=new URL(request.url);
  if(url.origin!==self.location.origin)return;
  if(url.pathname.includes('/api/')||url.pathname.includes('/socket.io/'))return;

  if(request.mode==='navigate'){
    event.respondWith(fetch(request).then(response=>{
      if(response.ok){const copy=response.clone();caches.open(RUNTIME_CACHE).then(cache=>cache.put(INDEX_URL,copy)).catch(()=>{});}
      return response;
    }).catch(async()=>await caches.match(INDEX_URL)||await caches.match(assetUrl(''))));
    return;
  }

  event.respondWith(caches.match(request).then(cached=>{
    const network=fetch(request).then(response=>{
      if(response.ok){const copy=response.clone();caches.open(RUNTIME_CACHE).then(cache=>cache.put(request,copy)).catch(()=>{});}
      return response;
    }).catch(()=>cached);
    return cached||network;
  }));
});
