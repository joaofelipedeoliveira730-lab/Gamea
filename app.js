import * as THREE from "three";

const $=id=>document.getElementById(id);
const socket=io({transports:["websocket","polling"]});
let quality=localStorage.getItem("neon_quality")||"auto";
const isTouchDevice=matchMedia("(pointer:coarse)").matches || navigator.maxTouchPoints>0;
const DEVICE_LOW=(navigator.deviceMemory&&navigator.deviceMemory<=3)||(navigator.hardwareConcurrency&&navigator.hardwareConcurrency<=4);
function effectiveQuality(){
  if(quality!=="auto")return quality;
  if(DEVICE_LOW)return "low";
  return Math.min(devicePixelRatio||1,1.25)>=1.1?"high":"medium";
}
let authToken=localStorage.getItem("neon_token")||"";
let currentUser="Piloto", selectedCharacter=0, selectedTrack="neon-city", pendingAction="quick";
let renderer,scene,camera,clock,playerMeshes=new Map(),itemBoxes=[],worldGroup,environmentGroup,environmentSeed=0,particles,trackDef,lastState,lastRaceStart=0,gameRunning=false,roomMode="room",trackBackdrop=null,trackTextureLoader=new THREE.TextureLoader(),backdropPromise=Promise.resolve(),loadingTimer=null;
let lastFrameTime=performance.now();
let keys={left:false,right:false,drift:false,accelerate:false,brake:false}, touchTimer=null, cameraTarget=new THREE.Vector3(), cameraLook=new THREE.Vector3(), renderFrame=0;

const CHARACTERS=[
 {id:1,name:"SPARK",icon:"🤖",portrait:"/1-spark.svg",color:"#38d9ff",stats:[78,76,72,88]},
 {id:2,name:"LUNA",icon:"🦊",portrait:"/2-luna.svg",color:"#ff5fb4",stats:[82,74,88,76]},
 {id:3,name:"STEEL",icon:"🦾",portrait:"/3-steel.svg",color:"#c9d3df",stats:[70,88,62,82]},
 {id:4,name:"ZIPPY",icon:"👽",portrait:"/4-zippy.svg",color:"#7cff58",stats:[92,67,72,86]},
 {id:5,name:"BLAZE",icon:"🐲",portrait:"/5-blaze.svg",color:"#ff6b35",stats:[80,84,66,90]},
 {id:6,name:"FROST",icon:"🐺",portrait:"/6-frost.svg",color:"#bcecff",stats:[74,80,90,70]},
 {id:7,name:"ROCKY",icon:"🐻",portrait:"/7-rocky.svg",color:"#b77d58",stats:[66,92,70,80]},
 {id:8,name:"NITRO",icon:"🧑‍🚀",portrait:"/8-nitro.svg",color:"#ffd84a",stats:[88,78,78,96]}
];
const TRACKS=[
 {id:"neon-city",name:"NEON CITY",theme:"city",desc:"Arranha-céus e curvas molhadas",colors:[0x071a43,0xff22d5]},
 {id:"pirate-bay",name:"PIRATE BAY",theme:"pirate",desc:"Porto, navios e pôr do sol",colors:[0x075a73,0xf08d39]},
 {id:"desert-run",name:"DESERT RUN",theme:"desert",desc:"Dunas, pontes e calor",colors:[0xd9913e,0x6b2c16]},
 {id:"mountain-peak",name:"MOUNTAIN PEAK",theme:"mountain",desc:"Montanha, pinheiros e neblina",colors:[0x6fa8cc,0x24394f]},
 {id:"space-station",name:"SPACE STATION",theme:"space",desc:"Circuito orbital neon",colors:[0x111a6b,0x04050b]},
 {id:"jungle-falls",name:"JUNGLE FALLS",theme:"jungle",desc:"Floresta, ruínas e cachoeiras",colors:[0x116847,0x081b12]},
 {id:"volcano-rush",name:"VOLCANO RUSH",theme:"volcano",desc:"Lava, cinzas e curvas rápidas",colors:[0xd84516,0x210308]},
 {id:"ice-world",name:"ICE WORLD",theme:"ice",desc:"Gelo, aurora e pista congelada",colors:[0x9deaff,0x1d4d7b]}
];
const api=async(path,opts={})=>{
 const headers={"Content-Type":"application/json",...(opts.headers||{})};
 if(authToken)headers.Authorization="Bearer "+authToken;
 const r=await fetch(path,{...opts,headers});const j=await r.json().catch(()=>({}));
 if(!r.ok)throw new Error(j.error||"erro");return j;
};
function escapeHtml(x){return String(x).replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[m]));}
function show(id){document.querySelectorAll("#app>.screen,#app>#game").forEach(e=>e.classList.add("hidden"));$(id)?.classList.remove("hidden");}
function message(t){$("msg").textContent=t||"";}
async function requestFullscreenLandscape(){
 try{ if(!document.fullscreenElement) await document.documentElement.requestFullscreen({navigationUI:"hide"}); }catch{}
 try{ if(screen.orientation?.lock) await screen.orientation.lock("landscape"); }catch{}
 document.documentElement.classList.add("race-landscape");
}
function releaseFullscreen(){try{if(document.fullscreenElement)document.exitFullscreen().catch(()=>{});}catch{}}
addEventListener("fullscreenchange",()=>{if(gameRunning)resize();});
addEventListener("orientationchange",()=>{setTimeout(resize,120);});
$("rotateFullscreen").onclick=()=>requestFullscreenLandscape();
async function showTermsGate(){
 $("termsGate").classList.remove("hidden");$("termsAccept").checked=false;$("downloadResources").disabled=true;$("continueWithoutDownload").disabled=true;
 const cached=localStorage.getItem("neon_resources_v1")==="ready";
 if(cached){$("resourceStatus").textContent="Recursos já preparados neste dispositivo.";$("resourcePercent").textContent="100%";$("downloadResources").textContent="RECURSOS JÁ BAIXADOS";$("downloadResources").disabled=false;$("continueWithoutDownload").disabled=false;}
}
async function downloadGameResources(){
 if(!$("termsAccept").checked)return;
 $("downloadResources").disabled=true;$("resourceStatus").textContent="Baixando recursos essenciais...";
 try{
  const manifest=await fetch("/assets-manifest.json",{cache:"no-store"}).then(r=>r.json());
  const files=["style.css","app.js",...(manifest.hd_scenes||[]),...(manifest.portraits||[]),...(manifest.environment_textures||[]).slice(0,12),...(manifest.sky_billboards||[]).slice(0,2),...(manifest.arena_detail||[]).slice(0,4)];
  const cache=await caches.open("neon-path-resources-v1");let done=0;
  for(const file of files){try{await cache.add("/"+file)}catch{}done++;const pct=Math.round(done/files.length*100);$("resourcePercent").textContent=pct+"%";$("loadFill")?.style.setProperty("width",pct+"%");}
  localStorage.setItem("neon_resources_v1","ready");$("resourceStatus").textContent=`Recursos preparados (${files.length} arquivos).`;$("resourcePercent").textContent="100%";$("continueWithoutDownload").disabled=false;$("downloadResources").textContent="RECURSOS PRONTOS";
 }catch(e){$("resourceStatus").textContent="Não foi possível preparar o cache. Você pode tentar novamente.";$("downloadResources").disabled=false;}
}
$("termsAccept").onchange=()=>{$("downloadResources").disabled=!$("termsAccept").checked;};
$("downloadResources").onclick=downloadGameResources;
$("continueWithoutDownload").onclick=async()=>{if(localStorage.getItem("neon_resources_v1")!=="ready")return;localStorage.setItem("neon_terms_v1","accepted");$("termsGate").classList.add("hidden");show("menu");};

function setAuthMode(mode){const login=mode==="login";$("loginForm").classList.toggle("hidden",!login);$("registerForm").classList.toggle("hidden",login);$("showLogin").classList.toggle("active",login);$("showRegister").classList.toggle("active",!login);$("authMsg").textContent="";}
async function auth(mode){
 const nick=(mode==="login"?$("authNick"):$("registerNick")).value.trim(),pass=(mode==="login"?$("authPassword"):$("registerPassword")).value,email=mode==="register"?$("registerEmail").value.trim():"";
 if(!nick||!pass){$("authMsg").textContent="Preencha apelido e senha.";return}
 try{
  const body=mode==="register"?{username:nick,password:pass,email:email||null}:{username:nick,password:pass};
  const d=await api(mode==="register"?"/api/auth/register":"/api/auth/login",{method:"POST",body:JSON.stringify(body)});
  authToken=d.token;currentUser=d.nickname||nick;localStorage.setItem("neon_token",authToken);
  enterApp();
 }catch(e){$("authMsg").textContent="Não foi possível entrar: "+e.message;}
}
async function enterApp(){
 $("authPanel").hidden=true;$("app").hidden=false;
 try{const p=await api("/api/profile");currentUser=p.nickname||currentUser;$("menuNick").textContent=currentUser;$("menuLevel").textContent=p.level||1;$("menuCoins").textContent=(p.bruto_coins||0).toLocaleString("pt-BR");}catch{}
 if(localStorage.getItem("neon_terms_v1")!=="accepted") return showTermsGate();
 show("menu");
}
$("showLogin").onclick=()=>setAuthMode("login");$("showRegister").onclick=()=>setAuthMode("register");
$("toRegister").onclick=()=>setAuthMode("register");$("toLogin").onclick=()=>setAuthMode("login");
$("loginBtn").onclick=()=>auth("login");$("registerBtn").onclick=()=>auth("register");
setAuthMode("login");
if(authToken)enterApp();

function renderCharacters(){
 $("characterSelect").innerHTML=CHARACTERS.map(c=>`<button class="character-card ${selectedCharacter===c.id?"selected":""}" data-char="${c.id}"><div class="avatar portrait-avatar"><img src="${c.portrait}" alt=""></div><b>${c.name}</b><small>${c.id===1?"INICIAL":"DESBLOQUEÁVEL"}</small></button>`).join("");
 document.querySelectorAll("[data-char]").forEach(b=>b.onclick=()=>{selectedCharacter=Number(b.dataset.char);renderCharacters();});
}
function openCharacters(){renderCharacters();show("select");}
function renderTracks(){
 $("trackGrid").innerHTML=TRACKS.map(t=>`<button class="track-card ${selectedTrack===t.id?"selected":""}" data-track="${t.id}"><div class="track-art theme-${t.theme}"></div><b>${t.name}</b><small>${t.desc}</small></button>`).join("");
 document.querySelectorAll("[data-track]").forEach(b=>b.onclick=()=>{selectedTrack=b.dataset.track;renderTracks();});
}
function openTracks(){renderTracks();show("tracks");}
function openModes(){ $("modePanel").classList.remove("hidden"); }
function closeModes(){ $("modePanel").classList.add("hidden"); }
function openPrivate(create=true){
 $("privatePanel").classList.remove("hidden");
 $("privateCreateForm").classList.toggle("hidden",!create);$("privateJoinForm").classList.toggle("hidden",create);
 $("privateCreateTab").classList.toggle("active",create);$("privateJoinTab").classList.toggle("active",!create);
 $("privateMsg").textContent="";
}
function closePrivate(){ $("privatePanel").classList.add("hidden"); }
$("charactersBtn").onclick=openCharacters;$("mapsBtn").onclick=openTracks;
$("selectBack").onclick=()=>show("menu");$("tracksBack").onclick=()=>show("select");
$("selectContinue").onclick=()=>openTracks();
$("trackReady").onclick=()=>{ if(pendingAction==="solo") beginRoom(false,true); else if(pendingAction==="ceo") beginRoom(true,false); };
$("playQuick").onclick=openModes;
$("soloBtn").onclick=openModes;
$("create").onclick=()=>openPrivate(true);
$("join").onclick=()=>openPrivate(false);
$("modeClose").onclick=closeModes;
$("modeSolo").onclick=()=>{closeModes();pendingAction="solo";openCharacters();};
$("modePrivate").onclick=()=>{closeModes();openPrivate(true);};
$("modeJoin").onclick=()=>{closeModes();openPrivate(false);};
$("privateClose").onclick=closePrivate;
$("privateCreateTab").onclick=()=>openPrivate(true);$("privateJoinTab").onclick=()=>openPrivate(false);
$("privateCreateBtn").onclick=()=>{
 const name=$("roomNameInput").value.trim(), password=$("roomPasswordInput").value;
 if(name.length<2){$("privateMsg").textContent="Dê um nome para a sala.";return;}
 if(password.length<4){$("privateMsg").textContent="A senha deve ter pelo menos 4 caracteres.";return;}
 closePrivate();pendingAction="create";openCharacters();
 window.__privateRoom={name,password};
};
$("privateJoinBtn").onclick=()=>{
 const code=$("roomCodeInput").value.trim().toUpperCase(),password=$("roomJoinPassword").value;
 if(!code){$("privateMsg").textContent="Digite o código da sala.";return;}
 if(code.length>15){$("privateMsg").textContent="O código tem no máximo 15 caracteres.";return;}
 if(!password){$("privateMsg").textContent="Digite a senha da sala.";return;}
 closePrivate();currentUser=$("menuNick").textContent||currentUser;socket.emit("room:join",{nickname:currentUser,code,password,characterId:selectedCharacter});
};
$("ceoBtn").onclick=()=>{const key=prompt("Chave CEO:");if(!key)return;pendingAction="ceo";openTracks();window.__ceoKey=key;};
async function beginRoom(ceo=false,forceSolo=false){
 currentUser=$("menuNick").textContent||currentUser;
 if(ceo||pendingAction==="ceo") socket.emit("room:create",{nickname:currentUser,ceo:true,key:window.__ceoKey,track:selectedTrack,characterId:selectedCharacter});
 else if(forceSolo||pendingAction==="solo") socket.emit("room:create",{nickname:currentUser,ceo:false,track:selectedTrack,mode:"solo",characterId:selectedCharacter});
 else { const pr=window.__privateRoom||{}; socket.emit("room:create",{nickname:currentUser,ceo:false,track:selectedTrack,mode:"room",roomName:pr.name,password:pr.password,characterId:selectedCharacter}); }
}
function renderLobby(s){
 $("roomCode").textContent=s.code;$("roomName").textContent=s.roomName?`NOME: ${escapeHtml(s.roomName)}`:"";$("lobbyTrack").textContent=s.trackName||"NEON CITY";
 $("players").innerHTML=(s.players||[]).map((p,i)=>`<div class="p" style="--c:${p.color}"><span><b>${i+1}</b> ${escapeHtml(p.nickname)}</span><strong>${p.alive?"PRONTO":"FORA"}</strong></div>`).join("");
}
socket.on("connect",()=>message("SERVIDOR ONLINE"));
socket.on("connect_error",()=>message("Conexão instável — tentando novamente..."));
socket.on("error:game",x=>{const text=typeof x==="string"?x:(x?.message||x?.error||"Erro na partida");if($("lobbyMsg"))$("lobbyMsg").textContent=text;if($("privateMsg")&&!$("privatePanel").classList.contains("hidden"))$("privateMsg").textContent=text;message(text);});
socket.on("room",x=>{
 roomMode=x.mode||"room";
 if(roomMode==="solo"){
   $("lobbyMode").textContent="CORRIDA RÁPIDA";
   $("lobbyMsg").textContent="Preparando sua corrida...";
   if(x.canStart) setTimeout(()=>socket.emit("room:start"),80);
   return;
 }
 show("lobby");
 $("lobbyMode").textContent=x.ceo?"CEO • SALA PRIVADA":"SALA PRIVADA";
 renderLobby({code:x.code,roomName:x.roomName,trackName:TRACKS.find(t=>t.id===x.track)?.name||x.track,players:[]});
 $("start").classList.toggle("hidden",!x.canStart);
 $("ceoTools").classList.toggle("hidden",!x.ceo);
 $("ceoTrack").innerHTML=TRACKS.map(t=>`<option value="${t.id}" ${t.id===x.track?"selected":""}>${t.name}</option>`).join("");
});
socket.on("state",s=>{lastState=s;if(!$("lobby").classList.contains("hidden"))renderLobby(s);});
$("start").onclick=()=>socket.emit("room:start");
$("ceoTrack").onchange=e=>socket.emit("room:track",e.target.value);
$("back").onclick=()=>{socket.emit("room:leave");show("menu");};
socket.on("race:loading",()=>{ showLoading(lastState?.track||selectedTrack); });
socket.on("race:countdown",x=>{
 requestFullscreenLandscape();
 const el=$("countdown"); if(!el)return;
 el.classList.remove("hidden"); el.textContent=x.value==='GO'?'GO':String(x.value);
 el.classList.toggle('go',x.value==='GO');
 if(x.value==='GO')setTimeout(()=>el.classList.add('hidden'),700);
});
socket.on("start",x=>{requestFullscreenLandscape();startGame(x.track);});
socket.on("hit",x=>showHit(x));
socket.on("race:finish",x=>showFinish(x.results,x.track));

function showLoading(id){
 if(loadingTimer){clearInterval(loadingTimer);loadingTimer=null;}
 const t=TRACKS.find(x=>x.id===id)||TRACKS[0];
 $("loadingTitle").textContent=t.name;
 $("loadingSub").textContent="CARREGANDO PISTA...";
 $("loadFill").style.width="8%";
 show("loading");
 let n=8;
 const tip=["Montando chão e asfalto...","Aplicando iluminação...","Carregando cenário...","Preparando pilotos...","Otimizando sombras...","Tudo pronto!"];
 let i=0;
 loadingTimer=setInterval(()=>{n=Math.min(94,n+Math.random()*8);$("loadFill").style.width=n+"%";$("loadTip").textContent="DICA: "+tip[i++%tip.length];},180);
}
function showHit(x){const el=document.createElement("div");el.textContent=`⚡ ${x.from} acertou ${x.to}`;el.style.cssText="position:fixed;top:20%;left:50%;transform:translateX(-50%);z-index:20;font-weight:1000;color:#ffe600;text-shadow:0 0 20px #ff8c00";document.body.appendChild(el);setTimeout(()=>el.remove(),900);}

function setupRenderer(){
 const oldCanvas=$("scene");
 if(!window.WebGLRenderingContext) throw new Error("WebGL indisponível neste navegador");
 if(renderer){try{renderer.dispose();}catch{} oldCanvas.replaceWith(oldCanvas.cloneNode(false));}
 const canvas=$("scene");
 const q=effectiveQuality();
 renderer=new THREE.WebGLRenderer({canvas,antialias:q!=="low",powerPreference:"high-performance",alpha:false,stencil:false,depth:true});
 const dpr=q==="low"?.72:q==="medium"?.95:q==="high"?Math.min(devicePixelRatio||1,1.5):Math.min(devicePixelRatio||1,1.1);
 renderer.setPixelRatio(dpr);
 renderer.setSize(innerWidth,innerHeight,false);
 renderer.outputColorSpace=THREE.SRGBColorSpace;
 renderer.toneMapping=THREE.ACESFilmicToneMapping;
 renderer.toneMappingExposure=q==="high"?1.12:1.0;
 renderer.shadowMap.enabled=q!=="low";
 renderer.shadowMap.type=THREE.PCFSoftShadowMap;
 canvas.addEventListener("webglcontextlost",e=>{e.preventDefault();gameRunning=false;show("loading");$("loadingTitle").textContent="RECUPERANDO GRÁFICOS";$("loadingSub").textContent="REINICIANDO O MOTOR 3D...";setTimeout(()=>startGame(trackDef?.id||selectedTrack),250);},{passive:false});
 scene=new THREE.Scene();
 camera=new THREE.PerspectiveCamera(66,innerWidth/innerHeight,.08,420);
 clock=new THREE.Clock();
}
function mat(c,rough=.75,metal=0,em=0){
 const m=new THREE.MeshStandardMaterial({color:c,roughness:rough,metalness:metal});
 if(em){m.emissive=new THREE.Color(c);m.emissiveIntensity=em;}
 return m;
}
function addBox(group,x,y,z,sx,sy,sz,c,em=0){
 const m=new THREE.Mesh(new THREE.BoxGeometry(sx,sy,sz),mat(c,.7,em?0.2:0,em));m.position.set(x,y,z);group.add(m);return m;
}
function addTree(group,x,z,c=0x1f8a50,scale=1){
 const g=new THREE.Group();
 const trunk=addBox(g,0,1,0,.55,2,.55,0x5b3b25);
 const crown=new THREE.Mesh(new THREE.SphereGeometry(1.9,12,8),mat(c,.9,0));crown.position.y=3.0;g.add(crown);
 const crown2=new THREE.Mesh(new THREE.SphereGeometry(1.35,12,8),mat(c===0x1f8a50?0x35b85d:c,.92,0));crown2.position.set(.45,4.0,.15);g.add(crown2);
 g.position.set(x,0,z);g.scale.setScalar(scale);group.add(g);return g;
}
function addLamp(group,x,z,color=0x00eaff){
 const g=new THREE.Group();addBox(g,0,2,0,.16,4,.16,0x1d2638);const s=new THREE.Mesh(new THREE.SphereGeometry(.32,10,8),new THREE.MeshBasicMaterial({color}));s.position.y=4.1;g.add(s);if(effectiveQuality()!=="low"){const l=new THREE.PointLight(color,1.1,9);l.position.y=3.8;g.add(l);}g.position.set(x,0,z);group.add(g);return g;
}
function addBillboard(group,url,x,z,w=9,h=5){
 const m=new THREE.SpriteMaterial({color:0xffffff,transparent:true,depthWrite:false});
 const s=new THREE.Sprite(m);s.position.set(x,h*.55,z);s.scale.set(w,h,1);group.add(s);
 trackTextureLoader.load(url,tex=>{tex.colorSpace=THREE.SRGBColorSpace;m.map=tex;m.needsUpdate=true;},undefined,()=>{});
 return s;
}
function addBackdrop(t){
 const path=`/${t.id}.svg`;
 const spriteMat=new THREE.SpriteMaterial({color:0xffffff,transparent:true,opacity:.94,depthWrite:false,fog:false});
 trackBackdrop=new THREE.Sprite(spriteMat);trackBackdrop.position.set(0,34,0);trackBackdrop.scale.set(210,118,1);scene.add(trackBackdrop);
 backdropPromise=new Promise(resolve=>trackTextureLoader.load(path,tex=>{tex.colorSpace=THREE.SRGBColorSpace;spriteMat.map=tex;spriteMat.needsUpdate=true;resolve(true)},undefined,()=>resolve(false)));
}
function makeRoadTexture(){
 const c=document.createElement("canvas");c.width=c.height=256;const ctx=c.getContext("2d");
 ctx.fillStyle="#252932";ctx.fillRect(0,0,256,256);const img=ctx.getImageData(0,0,256,256);
 for(let i=0;i<img.data.length;i+=4){const n=31+Math.floor(Math.random()*18);img.data[i]=n;img.data[i+1]=n+2;img.data[i+2]=n+5;img.data[i+3]=255;}ctx.putImageData(img,0,0);
 for(let i=0;i<260;i++){const x=Math.random()*256,y=Math.random()*256,r=.25+Math.random()*1.4;ctx.fillStyle=Math.random()>.72?"rgba(255,255,255,.055)":"rgba(0,0,0,.08)";ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.fill();}
 const tex=new THREE.CanvasTexture(c);tex.colorSpace=THREE.SRGBColorSpace;tex.wrapS=THREE.RepeatWrapping;tex.wrapT=THREE.RepeatWrapping;tex.repeat.set(22,2);tex.anisotropy=Math.min(renderer?.capabilities?.getMaxAnisotropy?.()||1,8);return tex;
}

function addTrackRibbon(group,rx,rz,width,color,y=0.08,textureUrl=null,segments=192){
 const positions=new Float32Array((segments+1)*2*3),uvs=new Float32Array((segments+1)*2*2),indices=[];
 const half=width/2;
 for(let i=0;i<=segments;i++){
  const t=i/segments*Math.PI*2;
  const sx=Math.sin(t),cz=Math.cos(t);
  const tx=rx*cz,tz=-rz*sx,len=Math.hypot(tx,tz)||1;
  const nx=-tz/len,nz=tx/len;
  const bank=Math.sin(t*2)*0.20;
  const innerR=half, outerR=-half;
  const x1=rx*sx+nx*innerR,z1=rz*cz+nz*innerR;
  const x2=rx*sx+nx*outerR,z2=rz*cz+nz*outerR;
  const k=i*6; positions[k]=x1;positions[k+1]=y+bank;positions[k+2]=z1;
  positions[k+3]=x2;positions[k+4]=y-bank;positions[k+5]=z2;
  const u=i/segments; uvs[i*4]=u*18;uvs[i*4+1]=0;uvs[i*4+2]=u*18;uvs[i*4+3]=1;
 }
 for(let i=0;i<segments;i++){const a=i*2,b=a+1,c=a+2,d=a+3;indices.push(a,c,b,c,d,b)}
 const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.BufferAttribute(positions,3));geo.setAttribute('uv',new THREE.BufferAttribute(uvs,2));geo.setIndex(indices);geo.computeVertexNormals();
 const material=mat(color,.9,0);
 if(textureUrl){const loader=new THREE.TextureLoader();loader.load(textureUrl,tex=>{tex.colorSpace=THREE.SRGBColorSpace;tex.wrapS=THREE.RepeatWrapping;tex.wrapT=THREE.RepeatWrapping;tex.repeat.set(18,1);material.map=tex;material.color.set(0xffffff);material.needsUpdate=true;},undefined,()=>{});}
 const mesh=new THREE.Mesh(geo,material);mesh.receiveShadow=true;group.add(mesh);return mesh;
}
function addTrackEdge(group,rx,rz,offset,color,y=0.18,segments=192){
 const geo=new THREE.TubeGeometry(new THREE.CatmullRomCurve3(Array.from({length:segments+1},(_,i)=>{const t=i/segments*Math.PI*2;return new THREE.Vector3((rx+offset)*Math.sin(t),y,(rz+offset*.7)*Math.cos(t));}),true,'centripetal',4),segments,.12,6,true);
 const m=new THREE.MeshBasicMaterial({color,transparent:true,opacity:.9});const mesh=new THREE.Mesh(geo,m);group.add(mesh);return mesh;
}
function addLaneMarks(group,rx,rz,offset,count=72,color=0xffffff){
 for(let i=0;i<count;i+=2){const a=i/count*Math.PI*2,x=rx*Math.sin(a),z=rz*Math.cos(a),tx=rx*Math.cos(a),tz=-rz*Math.sin(a),len=Math.hypot(tx,tz)||1;const mark=addBox(group,x,.24,z,.16,.035,1.9,color);mark.rotation.y=Math.atan2(tx,tz);mark.position.x+=(-tz/len)*offset;mark.position.z+=(tx/len)*offset;}
}
function addItemBoxes(group,rx,rz,theme){
 const q=effectiveQuality(), count=q==='low'?6:q==='medium'?8:10;
 const color=theme==='city'?0xff25d9:theme==='ice'?0x55e8ff:theme==='volcano'?0xff6a21:theme==='jungle'?0x63e86d:0xffd52b;
 itemBoxes=[];
 for(let i=0;i<count;i++){
  const a=(i/count)*Math.PI*2+Math.PI/8, x=rx*Math.sin(a), z=rz*Math.cos(a);
  const tx=rx*Math.cos(a),tz=-rz*Math.sin(a),len=Math.hypot(tx,tz)||1,nx=-tz/len,nz=tx/len;
  const g=new THREE.Group();
  const body=new THREE.Mesh(new THREE.BoxGeometry(1.05,1.05,1.05),new THREE.MeshStandardMaterial({color,roughness:.3,metalness:.16,emissive:new THREE.Color(color),emissiveIntensity:.22,transparent:true,opacity:.94}));
  body.rotation.y=Math.PI/4;body.castShadow=true;g.add(body);
  const ring=new THREE.Mesh(new THREE.TorusGeometry(.38,.055,8,16),new THREE.MeshBasicMaterial({color:0xffffff,transparent:true,opacity:.9}));ring.rotation.x=Math.PI/2;g.add(ring);
  // Keep boxes above the lane edge rather than blocking the racing line.
  const side=(i%2?1:-1)*5.2;
  g.position.set(x+nx*side,1.35,z+nz*side);g.rotation.y=Math.atan2(tx,tz);group.add(g);itemBoxes.push(g);
 }
}
function addStartGrid(group,rx,rz){
 const t=0; const tx=rx,tz=0,len=rx,nx=0,nz=1;
 for(let row=0;row<3;row++)for(let lane=-3;lane<=3;lane++){const x=lane*2.15,z=rz+2-row*2.25;const tile=addBox(group,x,.28,z,1.75,.045,1.15,(row+lane)%2?0x151b29:0xf4f6ff);tile.receiveShadow=true;}
 const banner=addBox(group,0,6.1,rz+4,18,.8,.45,0xff25d9,1.8);banner.castShadow=true;
 addBox(group,-8.7,3,rz+4,.38,6,.38,0xffffff,1);addBox(group,8.7,3,rz+4,.38,6,.38,0xffffff,1);
}
function addGuardRail(group,rx,rz,offset,color){
 const pts=[];for(let i=0;i<=96;i++){const a=i/96*Math.PI*2;pts.push(new THREE.Vector3((rx+offset)*Math.sin(a),1.15,(rz+offset*.7)*Math.cos(a)));}
 const curve=new THREE.CatmullRomCurve3(pts,true,'centripetal');const rail=new THREE.Mesh(new THREE.TubeGeometry(curve,192,.11,6,true),new THREE.MeshStandardMaterial({color,roughness:.55,metalness:.35}));rail.castShadow=effectiveQuality()!=='low';group.add(rail);
}
function addRock(group,x,z,s=1,color=0x586578){
 const g=new THREE.Group();
 const m=new THREE.Mesh(new THREE.DodecahedronGeometry(1.25,0),mat(color,.92,0));
 m.scale.set(1.25*s,.75*s,.95*s);m.position.y=.55*s;m.rotation.y=Math.random()*Math.PI;g.add(m);
 g.position.set(x,0,z);g.castShadow=effectiveQuality()!=='low';group.add(g);return g;
}
function addBush(group,x,z,s=1,color=0x16834c){
 const g=new THREE.Group();
 for(let i=0;i<3;i++){
  const m=new THREE.Mesh(new THREE.SphereGeometry(.9*s*(.8+Math.random()*.35),10,8),mat(i%2?color:0x0f6c3f,.95,0));
  m.position.set((i-1)*.55*s,.75*s+(i%2)*.22*s,Math.sin(i)*.3*s);m.castShadow=effectiveQuality()!=='low';g.add(m);
 }
 g.position.set(x,0,z);group.add(g);return g;
}
function addCloud(group,x,y,z,s=1){
 const g=new THREE.Group();
 for(let i=0;i<4;i++){
  const m=new THREE.Mesh(new THREE.SphereGeometry((1.6+Math.random()*1.2)*s,12,8),new THREE.MeshBasicMaterial({color:0xffffff,transparent:true,opacity:.78,depthWrite:false}));
  m.position.set((i-1.5)*1.5*s,Math.sin(i)*.35*s,Math.cos(i)*.4*s);g.add(m);
 }
 g.position.set(x,y,z);group.add(g);return g;
}
function buildEnvironment(t,rx,rz){
 environmentGroup=new THREE.Group();scene.add(environmentGroup);environmentSeed=Date.now()%100000;
 // Far scenery: always visible even when a remote SVG texture fails. This is geometry, not a baked image.
 const sky=new THREE.Mesh(new THREE.SphereGeometry(240,32,18),new THREE.MeshBasicMaterial({color:t.colors[0],side:THREE.BackSide,depthWrite:false,fog:false}));environmentGroup.add(sky);
 const sun=new THREE.Mesh(new THREE.SphereGeometry(10,20,12),new THREE.MeshBasicMaterial({color:t.colors[1],transparent:true,opacity:.85,depthWrite:false}));sun.position.set(-75,75,-125);environmentGroup.add(sun);
 const farGround=addBox(environmentGroup,0,-.05,0,235,.25,195,t.theme==='desert'?0x9f6a31:t.theme==='ice'?0x75b8d5:t.theme==='jungle'?0x145b38:t.theme==='volcano'?0x2a1012:t.theme==='space'?0x080b16:0x17402f);farGround.receiveShadow=true;
 // Layered hills make the world read as a real place instead of an empty plane.
 const hillColor=t.theme==='desert'?0xc88a45:t.theme==='ice'?0x9ed8e9:t.theme==='jungle'?0x0c4f32:t.theme==='volcano'?0x3a1718:t.theme==='space'?0x10132d:0x163b55;
 for(let i=0;i<18;i++){
  const side=i%2?-1:1, z=-105+i*12+(i%3)*3, x=side*(58+(i%4)*9);
  const h=10+(i%5)*4,w=13+(i%4)*4;
  const hill=new THREE.Mesh(new THREE.ConeGeometry(w,h,7),mat(hillColor,.98,0));hill.position.set(x,h/2,z);hill.scale.z=.75;hill.castShadow=effectiveQuality()!=='low';environmentGroup.add(hill);
 }
 if(t.theme==='city'){
  for(let i=0;i<26;i++){const side=i%2?-1:1,x=side*(38+(i%7)*5.5),z=-112+i*8,h=8+(i%6)*4,w=4+(i%3)*2;const b=addBox(environmentGroup,x,h/2,z,w,h,w,i%3?0x142a56:0x2b1558,.08);b.castShadow=effectiveQuality()!=='low';if(i%3===0)addLamp(environmentGroup,x,z,i%2?0x00eaff:0xff25d9);}
  for(let i=0;i<10;i++)addCloud(environmentGroup,-80+i*18,28+(i%3)*5,-80+(i%4)*22,1.2);
 } else if(t.theme==='pirate'){
  for(let i=0;i<20;i++){const side=i%2?-1:1,x=side*(38+(i%5)*6),z=-110+i*11;addBush(environmentGroup,x,z,.9,0x1b765f);}
  // Distant sails give the bay a recognizable silhouette without heavy assets.
  for(let i=0;i<5;i++){const mast=addBox(environmentGroup,-70+i*34,7,-90+i*8,.35,14,.35,0x4a3020);const sail=addBox(environmentGroup,-70+i*34,7.5,-90+i*8,5.5,7,.18,0xf0dfb5);sail.rotation.z=(i%2?.08:-.08);}
 } else if(t.theme==='desert'){
  for(let i=0;i<34;i++){const side=i%2?-1:1,x=side*(38+(i%7)*5),z=-110+i*7;addRock(environmentGroup,x,z,.8+(i%3)*.35,i%2?0xb57a3b:0xd29a55);}
  for(let i=0;i<8;i++)addCloud(environmentGroup,-90+i*25,34+(i%2)*5,-100+i*12,1.0);
 } else if(t.theme==='mountain'){
  for(let i=0;i<28;i++){const side=i%2?-1:1,x=side*(39+(i%8)*5),z=-110+i*8;addTree(environmentGroup,x,z,i%3?0x1c7043:0x255d3b,.9+(i%3)*.18);}
  for(let i=0;i<8;i++)addCloud(environmentGroup,-85+i*24,30+(i%3)*6,-95+i*10,1.1);
 } else if(t.theme==='jungle'){
  for(let i=0;i<42;i++){const side=i%2?-1:1,x=side*(38+(i%9)*4),z=-112+i*6;addTree(environmentGroup,x,z,i%3?0x147344:0x0b5b36,1+(i%4)*.12);if(i%4===0)addBush(environmentGroup,x+side*2,z+3,.8);}
 } else if(t.theme==='volcano'){
  for(let i=0;i<28;i++){const side=i%2?-1:1,x=side*(40+(i%7)*5),z=-110+i*8,h=6+(i%5)*2;const m=new THREE.Mesh(new THREE.ConeGeometry(2.4+(i%3),h,7),mat(i%2?0x2a1518:0x171017,.98,0));m.position.set(x,h/2,z);m.castShadow=effectiveQuality()!=='low';environmentGroup.add(m);if(i%5===0)addLamp(environmentGroup,x,z,0xff4d00);}
 } else if(t.theme==='space'){
  const starCount=effectiveQuality()==='low'?90:180;for(let i=0;i<starCount;i++){const s=new THREE.Mesh(new THREE.SphereGeometry(.08+(i%3)*.03,6,4),new THREE.MeshBasicMaterial({color:i%5?0x9edbff:0xff55dd}));s.position.set((i*37%190)-95,15+(i*17%75),(i*29%170)-85);environmentGroup.add(s);}
 } else if(t.theme==='ice'){
  for(let i=0;i<28;i++){const side=i%2?-1:1,x=side*(38+(i%7)*5),z=-110+i*8;addRock(environmentGroup,x,z,.9+(i%3)*.25,i%2?0xc7f5ff:0x8fc8e5);}
  for(let i=0;i<10;i++)addCloud(environmentGroup,-90+i*20,30+(i%3)*5,-100+i*12,1.1);
 }
 // Decorative roadside strips: flowers/rocks/bushes keep the track edges from looking dead.
 if(t.theme!=='space')for(let i=0;i<34;i++){const a=i/34*Math.PI*2,side=i%2?-1:1;const x=(rx+12+((i*7)%8))*Math.sin(a),z=(rz+12+((i*5)%7))*Math.cos(a);if(i%3===0)addRock(environmentGroup,x,z,.45);else addBush(environmentGroup,x,z,.42,t.theme==='ice'?0x64b6ca:t.theme==='desert'?0x6f8d35:0x18864c);}
}
function buildTrack(t){
 worldGroup=new THREE.Group();scene.add(worldGroup);
 const q=effectiveQuality(),rx=t.rx||48,rz=t.rz||28,theme=t.theme;
 const groundColor=theme==='desert'?0xb97935:theme==='ice'?0x8fc9e4:theme==='volcano'?0x241015:theme==='space'?0x050716:theme==='jungle'?0x0b3d25:theme==='pirate'?0x285e55:0x102b2b;
 const ground=addBox(worldGroup,0,-.9,0,230,1.2,190,groundColor);ground.receiveShadow=true;
 buildEnvironment(t,rx,rz);
 // Broad, banked ribbon: avoids the old flat/white slab perspective and gives the camera a readable racing surface.
 // Pista: asfalto limpo + faixas tracejadas + zebras. Não usamos fotos como textura do asfalto,
 // porque isso causava a antiga "lâmina branca" e deformações quando a câmera aproximava.
 const roadMat=mat(theme==='ice'?0x3b5363:theme==='desert'?0x38312d:0x252932,.92,0.05);
 roadMat.map=makeRoadTexture();roadMat.needsUpdate=true;
 const shoulder=addTrackRibbon(worldGroup,rx,rz,23.5,theme==='city'?0x13283b:theme==='desert'?0x76502e:theme==='ice'?0x6fb6c9:theme==='jungle'?0x155d37:theme==='volcano'?0x30171a:0x1a3f3a,.03,null,q==='low'?128:192);shoulder.material.roughness=1;
 const road=addTrackRibbon(worldGroup,rx,rz,17.5,0x252932,.10,null,q==='low'?128:192);road.material=roadMat;road.material.roughness=.92;road.material.metalness=.03;
 addLaneMarks(worldGroup,rx,rz,-2.8,q==='low'?44:72,0xf8fbff);
 addLaneMarks(worldGroup,rx,rz,2.8,q==='low'?44:72,0xf8fbff);
 // Zebras coloridas nas bordas, em blocos, sem uma faixa branca contínua.
 const curbColor=theme==='city'?0xff25d9:theme==='space'?0x7b4dff:theme==='ice'?0x8be9ff:theme==='volcano'?0xff641c:0xffd329;
 for(let i=0;i<(q==='low'?44:72);i+=2){
   const a=i/(q==='low'?44:72)*Math.PI*2;
   for(const off of [-8.75,8.75]){
     const x=rx*Math.sin(a),z=rz*Math.cos(a),tx=rx*Math.cos(a),tz=-rz*Math.sin(a),len=Math.hypot(tx,tz)||1;
     const nx=-tz/len,nz=tx/len; const c=addBox(worldGroup,x+nx*off,.16,z+nz*off,1.05,.12,.62,(i/2)%2?0xf4f6f8:curbColor);
     c.rotation.y=Math.atan2(tx,tz);
   }
 }
 addTrackEdge(worldGroup,rx,rz,9.5,0x101724,.14,192);
 addItemBoxes(worldGroup,rx,rz,theme);addStartGrid(worldGroup,rx,rz);addGuardRail(worldGroup,rx,rz,10.4,theme==='city'?0x00eaff:theme==='volcano'?0xff6b1a:0xd7e2f0);
 addBackdrop(t);
 const count=q==='low'?18:q==='medium'?30:46;
 if(theme==='city'){
  for(let i=0;i<count;i++){const side=i%2?-1:1,x=side*(39+Math.random()*35),z=(Math.random()-.5)*130,h=7+Math.random()*18,w=5+Math.random()*7;const b=addBox(worldGroup,x,h/2,z,w,h,w,i%3?0x15244b:0x2d1551,1);b.castShadow=q!=='low';if(i%2===0)addLamp(worldGroup,x,z,i%3?0x00eaff:0xff25d9);}
 } else if(theme==='pirate'){
  for(let i=0;i<count;i++){const side=i%2?-1:1,x=side*(39+Math.random()*28),z=(Math.random()-.5)*130;addBox(worldGroup,x,1,z,5,2,6,0x704526);addBox(worldGroup,x,5,z,.32,8,.32,0x39251b);addBox(worldGroup,x+side*2.1,5,z,3,.22,.22,0xefd59a);}
 } else if(theme==='desert'){
  for(let i=0;i<count;i++){const side=i%2?-1:1,x=side*(39+Math.random()*30),z=(Math.random()-.5)*130;const h=5+Math.random()*9;const m=new THREE.Mesh(new THREE.ConeGeometry(2.5+Math.random()*4,h,8),mat(i%2?0xc18442:0xe2ad5c));m.position.set(x,h/2,z);m.castShadow=q!=='low';worldGroup.add(m);}
 } else if(theme==='mountain'||theme==='jungle'){
  for(let i=0;i<count+(theme==='jungle'?10:0);i++){const side=i%2?-1:1;addTree(worldGroup,side*(39+Math.random()*28),(Math.random()-.5)*130,theme==='jungle'?(i%2?0x147344:0x0c4f31):0x185b3b,.9+Math.random()*.6);}
 } else if(theme==='volcano'){
  for(let i=0;i<count;i++){const side=i%2?-1:1,x=side*(39+Math.random()*30),z=(Math.random()-.5)*130,h=5+Math.random()*12;const m=new THREE.Mesh(new THREE.ConeGeometry(2+Math.random()*4,h,8),mat(i%2?0x351a18:0x111018));m.position.set(x,h/2,z);m.castShadow=q!=='low';worldGroup.add(m);if(i%4===0)addLamp(worldGroup,x,z,0xff4d00);}
 } else if(theme==='space'){
  for(let i=0;i<(q==='low'?55:q==='medium'?85:120);i++){const s=new THREE.Mesh(new THREE.SphereGeometry(.08,6,4),new THREE.MeshBasicMaterial({color:i%4?0x7fbfff:0xff55dd}));s.position.set((Math.random()-.5)*200,12+Math.random()*75,(Math.random()-.5)*160);worldGroup.add(s);}
 } else if(theme==='ice'){
  for(let i=0;i<count;i++){const side=i%2?-1:1,x=side*(39+Math.random()*27),z=(Math.random()-.5)*130,h=5+Math.random()*9;const m=new THREE.Mesh(new THREE.ConeGeometry(2+Math.random()*3,h,6),mat(0xc9f6ff,.25,.05));m.position.set(x,h/2,z);m.castShadow=q!=='low';worldGroup.add(m);}
 }
 if(theme!=='space'&&theme!=='volcano')for(let i=0;i<(q==='low'?8:16);i++){const a=i/16*Math.PI*2;addTree(worldGroup,(rx*.55)*Math.sin(a),(rz*.55)*Math.cos(a),theme==='ice'?0x91d9ec:theme==='desert'?0x7c5a2b:0x1c7b46,.65+Math.random()*.3);}
}
function buildVehicle(c){
 const q=effectiveQuality(),g=new THREE.Group();
 const body=addBox(g,0,.62,0,2.8,.55,3.55,c.color,.05);body.scale.set(1,.92,1);body.castShadow=true;
 const nose=new THREE.Mesh(new THREE.SphereGeometry(1,24,16),mat(0x111827,.32,.5));nose.scale.set(1.3,.32,.95);nose.position.set(0,.55,-1.65);nose.castShadow=true;g.add(nose);
 const sideA=addBox(g,-1.45,.62,0,.22,.48,2.45,0x101725,.5),sideB=addBox(g,1.45,.62,0,.22,.48,2.45,0x101725,.5);sideA.castShadow=sideB.castShadow=true;
 const cockpit=new THREE.Mesh(new THREE.SphereGeometry(.82,24,16),mat(0x07101d,.08,.7));cockpit.scale.set(.82,.55,.95);cockpit.position.set(0,1.12,.18);cockpit.castShadow=true;g.add(cockpit);
 const head=new THREE.Mesh(new THREE.SphereGeometry(.52,24,16),mat(0xd6b38b,.8,0));head.position.set(0,1.67,.18);head.castShadow=true;g.add(head);
 const helmet=new THREE.Mesh(new THREE.SphereGeometry(.57,24,16),mat(c.color,.24,.4));helmet.scale.y=.68;helmet.position.set(0,1.86,.18);helmet.castShadow=true;g.add(helmet);
 const visor=new THREE.Mesh(new THREE.SphereGeometry(.35,16,10),new THREE.MeshStandardMaterial({color:0x06101c,metalness:.85,roughness:.06,emissive:new THREE.Color(c.color),emissiveIntensity:.22}));visor.scale.set(1.38,.6,.18);visor.position.set(0,1.86,-.29);g.add(visor);
 const spoiler=addBox(g,0,1.25,1.55,3.0,.16,.35,0x101827,.2);spoiler.castShadow=true;addBox(g,0,.98,1.48,.18,.68,.18,0x20293a);
 for(const x of [-1.52,1.52])for(const z of [-1.15,1.15]){const w=new THREE.Mesh(new THREE.CylinderGeometry(.5,.5,.45,24),mat(0x0b1018,.94,0));w.rotation.z=Math.PI/2;w.position.set(x,.43,z);w.castShadow=true;g.add(w);const hub=new THREE.Mesh(new THREE.CylinderGeometry(.18,.18,.46,16),mat(0xb7c2d5,.25,.72));hub.rotation.z=Math.PI/2;hub.position.set(x,.43,z);g.add(hub);}
 for(const x of [-.72,.72]){const light=new THREE.Mesh(new THREE.SphereGeometry(.16,12,8),new THREE.MeshBasicMaterial({color:0xffffff}));light.position.set(x,.82,-1.92);g.add(light);}
 const exhaust=[];for(const x of [-.62,.62]){const flame=new THREE.Mesh(new THREE.ConeGeometry(.2,.95,10),new THREE.MeshBasicMaterial({color:c.color,transparent:true,opacity:.9}));flame.rotation.x=-Math.PI/2;flame.position.set(x,.5,2.05);flame.visible=false;g.add(flame);exhaust.push(flame);}
 const glow=new THREE.PointLight(c.color,q==='low'?0:1.2,8);glow.position.y=.6;g.add(glow);
 g.scale.setScalar(1.12);g.userData={character:c.id,exhaust,baseScale:1.12};return g;
}
function buildParticles(){
 const q=effectiveQuality(),n=q==="low"?70:q==="medium"?120:190;const geo=new THREE.BufferGeometry(),a=new Float32Array(n*3);
 for(let i=0;i<n;i++){a[i*3]=(Math.random()-.5)*170;a[i*3+1]=2+Math.random()*25;a[i*3+2]=(Math.random()-.5)*130}
 geo.setAttribute("position",new THREE.BufferAttribute(a,3));particles=new THREE.Points(geo,new THREE.PointsMaterial({color:0x8ddfff,size:q==="low"?.07:.12,transparent:true,opacity:.55,depthWrite:false}));scene.add(particles);
}
function disposeRaceWorld(){
  if(!scene)return;
  for(const obj of [...scene.children]){
    if(obj===trackBackdrop || obj===worldGroup || obj===environmentGroup || obj===particles || obj.isLight){
      scene.remove(obj);
      obj.traverse?.(o=>{try{o.geometry?.dispose?.();if(o.material){const ms=Array.isArray(o.material)?o.material:[o.material];ms.forEach(m=>{m.map?.dispose?.();m.dispose?.();});}}catch{}});
    }
  }
  playerMeshes.clear();itemBoxes=[];worldGroup=null;environmentGroup=null;particles=null;trackBackdrop=null;
}
function buildEmergencyTrack(t){
  disposeRaceWorld();
  worldGroup=new THREE.Group();scene.add(worldGroup);
  const rx=48,rz=28;
  const ground=addBox(worldGroup,0,-1,0,220,1.4,180,0x173a31);ground.receiveShadow=true;
  const shoulder=addTrackRibbon(worldGroup,rx,rz,24,0x315a54,.03,null,96);shoulder.material.roughness=1;
  const road=addTrackRibbon(worldGroup,rx,rz,17.5,0x242830,.10,null,96);road.material.roughness=.95;
  addLaneMarks(worldGroup,rx,rz,-2.8,36,0xf8fbff);addLaneMarks(worldGroup,rx,rz,2.8,36,0xf8fbff);
  addTrackEdge(worldGroup,rx,rz,9.5,0x111827,.14,96);addStartGrid(worldGroup,rx,rz);addGuardRail(worldGroup,rx,rz,10.4,0x00dfff);
  buildParticles();
}
function buildRaceWorldSafe(t){
  try{buildTrack(t);buildParticles();return true;}
  catch(err){
    console.error('NEON PATH 3D world detail failed; using emergency track:',err);
    try{buildEmergencyTrack(t);return false;}catch(fatal){console.error('NEON PATH emergency track failed:',fatal);return false;}
  }
}

async function startGame(id){
 try{
  if(loadingTimer){clearInterval(loadingTimer);loadingTimer=null;}
  gameRunning=true;playerMeshes.clear();trackDef=TRACKS.find(t=>t.id===id)||TRACKS[0];
  showLoading(trackDef.id);
  const loadingStarted=performance.now();
  setupRenderer();
  lastFrameTime=performance.now();
 const q=effectiveQuality();
 scene.background=new THREE.Color(trackDef.colors[0]);scene.fog=new THREE.Fog(trackDef.colors[0],q==='low'?48:62,q==='high'?210:170);
 scene.add(new THREE.HemisphereLight(0xb7d8ff,0x24402d,q==='high'?3.0:2.2));
 scene.add(new THREE.AmbientLight(0xffffff,q==='low'?.45:.7));
 const sun=new THREE.DirectionalLight(0xffffff,q==='high'?2.8:2.15);sun.position.set(30,55,25);sun.castShadow=q!=='low';if(sun.shadow){sun.shadow.mapSize.set(q==='high'?1536:1024,q==='high'?1536:1024);sun.shadow.camera.near=1;sun.shadow.camera.far=140;sun.shadow.camera.left=-70;sun.shadow.camera.right=70;sun.shadow.camera.top=70;sun.shadow.camera.bottom=-70;}scene.add(sun);
 const fullWorld=buildRaceWorldSafe(trackDef);window.onresize=resize;
  if(!fullWorld) $("loadingSub").textContent="PISTA CARREGADA EM MODO SEGURO...";
 let slow=false;
 const slowTimer=setTimeout(()=>{slow=true;$('loadingSub').textContent='AINDA CARREGANDO... OTIMIZANDO O CENÁRIO';document.querySelector('.loading-shell')?.classList.add('slow');},3000);
 // Cenário remoto nunca pode bloquear a corrida inteira.
 // A geometria procedural continua sendo o fallback visual completo.
 await Promise.race([backdropPromise,new Promise(resolve=>setTimeout(resolve,1800))]);
 clearTimeout(slowTimer);
 const elapsed=performance.now()-loadingStarted;
 if(elapsed<450)await new Promise(r=>setTimeout(r,450-elapsed));
 $('loadFill').style.width='100%';
 show('game');
  lastRaceStart=Date.now();
  lastFrameTime=performance.now();
  animate();
 }catch(err){
  console.error('NEON PATH race boot failed',err);
  gameRunning=false;
  document.querySelector('.loading-shell')?.classList.remove('slow');
  $('loadingTitle').textContent='INICIANDO PISTA SEGURA';
  $('loadingSub').textContent='RECUPERANDO O CENÁRIO SEM TRAVAR A CORRIDA...';
  $('loadFill').style.width='65%';
  try{
    setupRenderer();
    trackDef=TRACKS.find(t=>t.id===id)||TRACKS[0];
    scene.background=new THREE.Color(trackDef.colors[0]);
    scene.fog=new THREE.Fog(trackDef.colors[0],50,170);
    scene.add(new THREE.HemisphereLight(0xb7d8ff,0x24402d,2.2));
    const sun=new THREE.DirectionalLight(0xffffff,2.2);sun.position.set(30,55,25);sun.castShadow=false;scene.add(sun);
    buildEmergencyTrack(trackDef);
    show('game');lastRaceStart=Date.now();lastFrameTime=performance.now();gameRunning=true;animate();
  }catch(fatal){
    console.error('NEON PATH fatal race boot:',fatal);
    $('loadingSub').textContent='NÃO FOI POSSÍVEL INICIAR O MOTOR 3D. ATUALIZE A PÁGINA.';
    gameRunning=false;
  }
 }
}}
function updateCars(s,dt=.016){
 const sorted=[...s.players].sort((a,b)=>b.progress-a.progress);
 $('score').innerHTML=sorted.map((p,i)=>{const c=CHARACTERS.find(x=>x.id===p.characterId)||CHARACTERS[i%CHARACTERS.length];return `<div class="race-player" style="--c:${p.color}"><span class="race-rank">${i+1}</span><img src="${c.portrait}" alt=""><b>${escapeHtml(p.nickname)}</b></div>`}).join('');
 for(const p of s.players){
  let o=playerMeshes.get(p.id);
  if(!o){const c=CHARACTERS.find(x=>x.id===p.characterId)||CHARACTERS[(p.id?.length||0)%CHARACTERS.length];o=buildVehicle(c);o.position.set(p.x,.22,p.y);scene.add(o);playerMeshes.set(p.id,o)}
  const target=new THREE.Vector3(p.x,.22,p.y);o.position.lerp(target,1-Math.exp(-dt*10));o.rotation.y=THREE.MathUtils.lerp(o.rotation.y,p.a,1-Math.exp(-dt*12));o.rotation.z=THREE.MathUtils.lerp(o.rotation.z,-(p.lane||0)*0.035,1-Math.exp(-dt*8));const boost=p.boost>0;o.scale.setScalar(boost?1.075:1);
  if(o.userData.exhaust)o.userData.exhaust.forEach(f=>f.visible=boost);
 }
 for(const [id,o] of playerMeshes)if(!s.players.some(p=>p.id===id)){scene.remove(o);playerMeshes.delete(id)}
 const me=s.players.find(p=>p.id===socket.id)||s.players.find(p=>p.nickname===currentUser)||s.players[0];
 if(me){
  const behind=8.5,ahead=10.5;
  cameraTarget.set(me.x-Math.sin(me.a)*behind,3.65,me.y-Math.cos(me.a)*behind);camera.position.lerp(cameraTarget,Math.min(1,0.18));
  cameraLook.set(me.x+Math.sin(me.a)*ahead,1.25,me.y+Math.cos(me.a)*ahead);camera.lookAt(cameraLook);
  $('bar').style.width=me.energy+'%';$('speed').textContent=String(Math.round(me.speed*12)).padStart(3,'0');$('lap').textContent=`VOLTA ${Math.min(me.lap,3)}/3`;
  const itemReady=!!me.itemReady;
  for(const id of ['sab','touchItem']){const b=$(id);if(!b)continue;b.classList.toggle('item-ready',itemReady);b.classList.toggle('item-empty',!itemReady);b.setAttribute('aria-disabled',String(!itemReady));b.title=itemReady?'ITEM PRONTO':'ITEM INDISPONÍVEL';}
 }
 drawMap(s);
}
function drawMap(s){
 const c=$('map'),x=c.getContext('2d');x.clearRect(0,0,c.width,c.height);x.strokeStyle='#ffffff88';x.lineWidth=7;x.beginPath();for(let i=0;i<=90;i++){const a=i/90*Math.PI*2;x.lineTo(90+65*Math.sin(a),50+35*Math.cos(a));}x.stroke();for(const p of s.players){x.fillStyle=p.color;x.beginPath();x.arc(90+62*Math.sin(p.progress*2*Math.PI),50+33*Math.cos(p.progress*2*Math.PI),4,0,Math.PI*2);x.fill();}
}
function animate(){
 if(!gameRunning)return;
 requestAnimationFrame(animate);
 try{
  const now=performance.now(),dt=Math.min(.05,Math.max(.001,(now-lastFrameTime)/1000||.016));lastFrameTime=now;
  if(lastState)updateCars(lastState,dt);
  if(particles)particles.rotation.y+=dt*.015;
  itemBoxes.forEach((b,i)=>{b.rotation.y+=dt*(1.0+(i%3)*.15);b.position.y=1.35+Math.sin(now/260+i)*.12;});
  if(renderer&&scene&&camera)renderer.render(scene,camera);
  $('timer').textContent=new Date(Date.now()-lastRaceStart).toISOString().slice(14,19);
 }catch(err){
  console.error('NEON PATH render loop recovered:',err);
  gameRunning=false;
  setTimeout(()=>{ if(!gameRunning) recoverRaceAfterRenderError(trackDef?.id||selectedTrack); },0);
 }
}
function recoverRaceAfterRenderError(id){
 try{
  trackDef=TRACKS.find(t=>t.id===id)||TRACKS[0];
  setupRenderer();
  scene.background=new THREE.Color(trackDef.colors[0]);
  scene.fog=new THREE.Fog(trackDef.colors[0],55,170);
  scene.add(new THREE.HemisphereLight(0xb7d8ff,0x24402d,2.0));
  const sun=new THREE.DirectionalLight(0xffffff,2.0);sun.position.set(30,55,25);sun.castShadow=false;scene.add(sun);
  buildEmergencyTrack(trackDef);
  show('game');lastRaceStart=lastRaceStart||Date.now();lastFrameTime=performance.now();gameRunning=true;animate();
 }catch(err){
  console.error('NEON PATH render recovery failed:',err);
  gameRunning=false;
  show('menu');
  message('Não foi possível iniciar o motor 3D. Tente novamente.');
 }
}
function resize(){if(!renderer||!camera)return;camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight,false);}
function emitSteer(type){if(socket.connected)socket.emit('input',{type});}
addEventListener('keydown',e=>{if(e.repeat)return;if(e.key==='ArrowLeft'||e.key.toLowerCase()==='a'){keys.left=true;emitSteer('left')}if(e.key==='ArrowRight'||e.key.toLowerCase()==='d'){keys.right=true;emitSteer('right')}if(e.key.toLowerCase()==='w'||e.key==='ArrowUp')socket.connected&&socket.emit('input',{type:'throttle',active:true});if(e.key.toLowerCase()==='s'||e.key==='ArrowDown')socket.connected&&socket.emit('input',{type:'brake',active:true});if(e.code==='Space'||e.key.toLowerCase()==='shift'){if(socket.connected)socket.emit('input',{type:'turbo'});}
 if(e.key.toLowerCase()==='x'){if(socket.connected)socket.emit('input',{type:'drift',active:true});}});
addEventListener('keyup',e=>{if(e.key==='ArrowLeft'||e.key.toLowerCase()==='a')keys.left=false;if(e.key==='ArrowRight'||e.key.toLowerCase()==='d')keys.right=false;if((e.key.toLowerCase()==='w'||e.key==='ArrowUp')&&socket.connected)socket.emit('input',{type:'throttle',active:false});if((e.key.toLowerCase()==='s'||e.key==='ArrowDown')&&socket.connected)socket.emit('input',{type:'brake',active:false});if(e.key.toLowerCase()==='x'&&socket.connected)socket.emit('input',{type:'drift',active:false});if(!keys.left&&!keys.right)emitSteer('neutral');});
function bindHold(id,type){const b=$(id);if(!b)return;const stop=e=>{e?.preventDefault?.();b.releasePointerCapture?.(e.pointerId);clearInterval(b.__hold);emitSteer('neutral');};b.onpointerdown=e=>{e.preventDefault();b.setPointerCapture?.(e.pointerId);emitSteer(type);clearInterval(b.__hold);b.__hold=setInterval(()=>emitSteer(type),90);};b.onpointerup=stop;b.onpointercancel=stop;b.onpointerleave=e=>{if(e.buttons===0)stop(e);};}
function bindDrift(id){const b=$(id);if(!b)return;const stop=e=>{e?.preventDefault?.();b.releasePointerCapture?.(e.pointerId);clearInterval(b.__hold);socket.connected&&socket.emit('input',{type:'drift',active:false});b.classList.remove('held');};b.onpointerdown=e=>{e.preventDefault();b.setPointerCapture?.(e.pointerId);b.classList.add('held');socket.connected&&socket.emit('input',{type:'drift',active:true});};b.onpointerup=stop;b.onpointercancel=stop;b.onpointerleave=e=>{if(e.buttons===0)stop(e);};}
function bindActionHold(id,type){const b=$(id);if(!b)return;const stop=e=>{e?.preventDefault?.();b.releasePointerCapture?.(e.pointerId);socket.connected&&socket.emit('input',{type,active:false});b.classList.remove('held');};b.onpointerdown=e=>{e.preventDefault();b.setPointerCapture?.(e.pointerId);b.classList.add('held');socket.connected&&socket.emit('input',{type,active:true});};b.onpointerup=stop;b.onpointercancel=stop;b.onpointerleave=e=>{if(e.buttons===0)stop(e);};}
bindHold('touchLeft','left');bindHold('touchRight','right');bindDrift('touchDrift');
$('turbo').onclick=()=>socket.connected&&socket.emit('input',{type:'turbo'});$('sab').onclick=()=>socket.connected&&$('sab').classList.contains('item-ready')&&socket.emit('input',{type:'sabotage'});
$('touchTurbo').onclick=()=>socket.connected&&socket.emit('input',{type:'turbo'});$('touchItem').onclick=()=>socket.connected&&$('touchItem').classList.contains('item-ready')&&socket.emit('input',{type:'sabotage'});
bindActionHold('touchAccelerate','throttle');bindActionHold('touchBrake','brake');
function exitRace(){gameRunning=false;try{socket.emit("room:leave");}catch{}playerMeshes.clear();if(scene){scene.traverse(o=>{if(o.geometry)o.geometry.dispose?.();if(o.material){const ms=Array.isArray(o.material)?o.material:[o.material];ms.forEach(m=>{m.map?.dispose?.();m.dispose?.();});}});}show("menu");message("Você saiu da corrida.");}
$("raceExit").onclick=exitRace;
function showFinish(results,track){
 gameRunning=false;show("finish");
 const icons=["🥇","🥈","🥉"],top=results.slice(0,3);
 $("podium").innerHTML=top.map((p,i)=>`<div class="pod ${i===0?"first":i===1?"second":"third"}"><div class="avatar">${CHARACTERS[i%CHARACTERS.length].icon}</div><b>${icons[i]} ${escapeHtml(p.nickname)}</b><small>${p.position}º LUGAR</small></div>`).join("");
 $("rewards").innerHTML=`<div class="reward">◉ +250 MOEDAS</div><div class="reward">XP +120</div><div class="reward">♛ +1 PRESTÍGIO</div>`;
}
$("nextRace").onclick=()=>{show("menu");message("Escolha outra pista e corra novamente.")};

function modal(title,html){$("modalContent").innerHTML=`<h2>${title}</h2>${html}`;$("overlayPanel").classList.remove("hidden")}
$("modalClose").onclick=()=>$("overlayPanel").classList.add("hidden");
$("configBtn").onclick=()=>modal("CONFIGURAÇÕES",`<div class="settings-grid">
 <div class="setting"><b>QUALIDADE</b><p>Reduza efeitos e resolução para celulares fracos.</p><button data-q="low">BAIXA</button><button data-q="medium">MÉDIA</button><button data-q="high">ALTA</button><button data-q="auto">AUTO</button></div>
 <div class="setting"><b>CONTROLES</b><p>PC: A/D ou ←/→. Turbo: SHIFT ou ESPAÇO.</p><p>Celular: botões na tela.</p></div>
 <div class="setting"><b>DESEMPENHO</b><p>Mapas são construídos sob demanda. Texturas não são baixadas todas de uma vez.</p></div>
 <div class="setting"><b>ÁUDIO</b><p>Controles de áudio preparados para a próxima camada.</p></div></div>`);
document.querySelector("#modalContent").onclick=e=>{const q=e.target.dataset.q;if(q){quality=q;localStorage.setItem("neon_quality",q);e.target.parentElement.querySelectorAll("button").forEach(b=>b.style.outline=b.dataset.q===q?"2px solid #00eaff":"none");$("overlayPanel").classList.add("hidden");message("Qualidade salva: "+q.toUpperCase())}};
$("rank").onclick=async()=>{try{const a=await api("/api/rank");modal("RANKING GLOBAL",a.length?`<div>${a.map((x,i)=>`<div class="p"><span>${i+1}º ${escapeHtml(x.nickname)}</span><b>${x.ph} PH</b></div>`).join("")}</div>`:"<p>Ranking vazio.</p>")}catch(e){message("Ranking indisponível")}};
$("shopBtn").onclick=()=>modal("LOJA",`<div class="shop-unavailable"><b>INDISPONÍVEL NO MOMENTO</b><p>A loja está temporariamente desativada enquanto os sistemas de cosméticos são revisados.</p></div>`);
$("modalContent").addEventListener("click",async e=>{const code=e.target.dataset.buy;if(!code)return;try{await api("/api/shop/buy",{method:"POST",body:JSON.stringify({code})});e.target.textContent="ADQUIRIDO";}catch(err){e.target.textContent=err.message.toUpperCase()}});
