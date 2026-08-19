const SHELL_CACHE='neon-path-shell-v12';
const RUNTIME_CACHE='neon-path-runtime-v12';
const KEEP=new Set([SHELL_CACHE,RUNTIME_CACHE,'neon-path-resources-v12']);
const SHELL=['/','/index.html','/style.css','/app.js','/config.js','/loading-hero.webp','/prestige-emblem.webp','/1-spark.svg'];

self.addEventListener('install',event=>{
  event.waitUntil(caches.open(SHELL_CACHE).then(cache=>cache.addAll(SHELL)));
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
  if(url.pathname.startsWith('/api/')||url.pathname.startsWith('/socket.io/'))return;
  if(request.mode==='navigate'){
    event.respondWith(fetch(request).then(response=>{
      const copy=response.clone();caches.open(RUNTIME_CACHE).then(cache=>cache.put('/index.html',copy));return response;
    }).catch(()=>caches.match('/index.html')));
    return;
  }
  event.respondWith(caches.match(request).then(cached=>{
    const network=fetch(request).then(response=>{
      if(response.ok){const copy=response.clone();caches.open(RUNTIME_CACHE).then(cache=>cache.put(request,copy));}
      return response;
    });
    return cached||network;
  }));
});
