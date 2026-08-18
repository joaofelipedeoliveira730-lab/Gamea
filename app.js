import * as THREE from "three";

const $=id=>document.getElementById(id);
const socket=io({transports:["websocket","polling"]});
let quality=localStorage.getItem("neon_quality")||"auto";
let authToken=localStorage.getItem("neon_token")||"";
let currentUser="Piloto", selectedCharacter=0, selectedTrack="neon-city", pendingAction="quick";
let renderer,scene,camera,clock,playerMeshes=new Map(),worldGroup,particles,trackDef,lastState,lastRaceStart=0,gameRunning=false,roomMode="room";
let keys={left:false,right:false}, touchTimer=null;

const CHARACTERS=[
 {id:1,name:"SPARK",icon:"🤖",color:"#38d9ff",stats:[78,76,72,88]},
 {id:2,name:"LUNA",icon:"🦊",color:"#ff5fb4",stats:[82,74,88,76]},
 {id:3,name:"STEEL",icon:"🦾",color:"#c9d3df",stats:[70,88,62,82]},
 {id:4,name:"ZIPPY",icon:"👽",color:"#7cff58",stats:[92,67,72,86]},
 {id:5,name:"BLAZE",icon:"🐲",color:"#ff6b35",stats:[80,84,66,90]},
 {id:6,name:"FROST",icon:"🐺",color:"#bcecff",stats:[74,80,90,70]},
 {id:7,name:"ROCKY",icon:"🐻",color:"#b77d58",stats:[66,92,70,80]},
 {id:8,name:"NITRO",icon:"🧑‍🚀",color:"#ffd84a",stats:[88,78,78,96]}
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
}
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
  const files=["style.css","app.js",...(manifest.environment_textures||[]).slice(0,10),...(manifest.sky_billboards||[]).slice(0,2),...(manifest.arena_detail||[]).slice(0,4)];
  const cache=await caches.open("neon-path-resources-v1");let done=0;
  for(const file of files){try{await cache.add("/"+file)}catch{}done++;const pct=Math.round(done/files.length*100);$("resourcePercent").textContent=pct+"%";$("loadFill")?.style.setProperty("width",pct+"%");}
  localStorage.setItem("neon_resources_v1","ready");$("resourceStatus").textContent=`Recursos preparados (${files.length} arquivos).`;$("resourcePercent").textContent="100%";$("continueWithoutDownload").disabled=false;$("downloadResources").textContent="RECURSOS PRONTOS";
 }catch(e){$("resourceStatus").textContent="Não foi possível preparar o cache. Você pode tentar novamente.";$("downloadResources").disabled=false;}
}
$("termsAccept").onchange=()=>{$("downloadResources").disabled=!$("termsAccept").checked;};
$("downloadResources").onclick=downloadGameResources;
$("continueWithoutDownload").onclick=async()=>{if(localStorage.getItem("neon_resources_v1")!=="ready")return;localStorage.setItem("neon_terms_v1","accepted");$("termsGate").classList.add("hidden");show("menu");await requestFullscreenLandscape();};

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
 $("authPanel").hidden=true;$ ("app").hidden=false;
 try{const p=await api("/api/profile");currentUser=p.nickname||currentUser;$("menuNick").textContent=currentUser;$("menuLevel").textContent=p.level||1;$("menuCoins").textContent=(p.bruto_coins||0).toLocaleString("pt-BR");}catch{}
 if(localStorage.getItem("neon_terms_v1")!=="accepted") return showTermsGate();
 show("menu");
 requestFullscreenLandscape();
}
$("showLogin").onclick=()=>setAuthMode("login");$("showRegister").onclick=()=>setAuthMode("register");
$("toRegister").onclick=()=>setAuthMode("register");$("toLogin").onclick=()=>setAuthMode("login");
$("loginBtn").onclick=()=>auth("login");$("registerBtn").onclick=()=>auth("register");
setAuthMode("login");
if(authToken)enterApp();

function renderCharacters(){
 $("characterSelect").innerHTML=CHARACTERS.map(c=>`<button class="character-card ${selectedCharacter===c.id?"selected":""}" data-char="${c.id}"><div class="avatar" style="color:${c.color}">${c.icon}</div><b>${c.name}</b><small>${c.id===1?"INICIAL":"DESBLOQUEÁVEL"}</small></button>`).join("");
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
$("charactersBtn").onclick=openCharacters;$("garageBtn").onclick=openCharacters;$("mapsBtn").onclick=openTracks;
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
 closePrivate();currentUser=$("menuNick").textContent||currentUser;socket.emit("room:join",{nickname:currentUser,code,password});
};
$("ceoBtn").onclick=()=>{const key=prompt("Chave CEO:");if(!key)return;pendingAction="ceo";openTracks();window.__ceoKey=key;};
async function beginRoom(ceo=false,forceSolo=false){
 currentUser=$("menuNick").textContent||currentUser;
 if(ceo||pendingAction==="ceo") socket.emit("room:create",{nickname:currentUser,ceo:true,key:window.__ceoKey,track:selectedTrack});
 else if(forceSolo||pendingAction==="solo") socket.emit("room:create",{nickname:currentUser,ceo:false,track:selectedTrack,mode:"solo"});
 else { const pr=window.__privateRoom||{}; socket.emit("room:create",{nickname:currentUser,ceo:false,track:selectedTrack,mode:"room",roomName:pr.name,password:pr.password}); }
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
socket.on("race:loading",x=>showLoading(x.track));
socket.on("start",x=>{showLoading(x.track);setTimeout(()=>startGame(x.track),350);});
socket.on("hit",x=>showHit(x));
socket.on("race:finish",x=>showFinish(x.results,x.track));

function showLoading(id){
 const t=TRACKS.find(x=>x.id===id)||TRACKS[0];$("loadingTitle").textContent=t.name;$("loadingSub").textContent="CARREGANDO PISTA...";
 $("loadFill").style.width="5%";show("loading");
 let n=5;const tip=["Montando cenário...","Otimizando sombras...","Carregando detalhes da pista...","Preparando pilotos...","Tudo pronto!"];
 let i=0;const timer=setInterval(()=>{n=Math.min(96,n+Math.random()*18);$("loadFill").style.width=n+"%";$("loadTip").textContent="DICA: "+tip[i++%tip.length];if(n>=95)clearInterval(timer)},120);
}
function showHit(x){const el=document.createElement("div");el.textContent=`⚡ ${x.from} acertou ${x.to}`;el.style.cssText="position:fixed;top:20%;left:50%;transform:translateX(-50%);z-index:20;font-weight:1000;color:#ffe600;text-shadow:0 0 20px #ff8c00";document.body.appendChild(el);setTimeout(()=>el.remove(),900);}

function setupRenderer(){
 if(renderer){renderer.dispose();$("scene").replaceWith($("scene").cloneNode());}
 const canvas=$("scene");renderer=new THREE.WebGLRenderer({canvas,antialias:quality!=="low",powerPreference:"high-performance"});
 const q=quality==="low"?.75:quality==="medium"?1:quality==="high"?1.35:Math.min(devicePixelRatio,1.1);
 renderer.setPixelRatio(q);renderer.setSize(innerWidth,innerHeight,false);renderer.shadowMap.enabled=quality!=="low";renderer.shadowMap.type=THREE.PCFSoftShadowMap;
 scene=new THREE.Scene();camera=new THREE.PerspectiveCamera(62,innerWidth/innerHeight,.1,500);clock=new THREE.Clock();
}
function mat(c,rough=.75,metal=0){return new THREE.MeshStandardMaterial({color:c,roughness:rough,metalness:metal});}
function addBox(group,x,y,z,sx,sy,sz,c,em=0){const m=new THREE.Mesh(new THREE.BoxGeometry(sx,sy,sz),mat(c,.7,em?0.2:0));m.position.set(x,y,z);if(em){m.material.emissive=new THREE.Color(c);m.material.emissiveIntensity=em}group.add(m);return m}
function addTree(group,x,z,c=0x176b3d){const g=new THREE.Group();const trunk=addBox(g,x,1,z,.7,2,.7,0x5b3b25);const cone=new THREE.Mesh(new THREE.ConeGeometry(2.6,6,8),mat(c));cone.position.set(x,4,z);g.add(cone);group.add(g)}
function addLamp(group,x,z){const g=new THREE.Group();addBox(g,x,2,z,.18,4,.18,0x1d2638);const s=new THREE.Mesh(new THREE.SphereGeometry(.45,8,6),new THREE.MeshBasicMaterial({color:0x00eaff}));s.position.set(x,4,z);g.add(s);group.add(g)}
function buildTrack(t){
 worldGroup=new THREE.Group();scene.add(worldGroup);
 const rx=48,rz=27;
 // broad landscape
 const ground=addBox(worldGroup,0,-1,0,170,1,130,t.theme==="desert"?0xb97935:t.theme==="ice"?0x8fc9e4:t.theme==="volcano"?0x241015:t.theme==="space"?0x050716:t.theme==="jungle"?0x0b3d25:0x17322a);
 // road ring using two scaled ring meshes
 const road=new THREE.Mesh(new THREE.RingGeometry(20,25,128,2),mat(0x252832,.95,0));
 road.rotation.x=-Math.PI/2;road.scale.set(rx/25,rz/25,1);road.position.y=.03;worldGroup.add(road);
 const shoulder=new THREE.Mesh(new THREE.RingGeometry(25.1,26.1,128,2),mat(0xd8d8d8,.9));shoulder.rotation.x=-Math.PI/2;shoulder.scale.set(rx/26,rz/26,1);shoulder.position.y=.06;worldGroup.add(shoulder);
 // lane markings: lightweight blocks around oval
 for(let i=0;i<64;i++){const a=i/64*Math.PI*2,x=rx*Math.sin(a),z=rz*Math.cos(a);const m=addBox(worldGroup,x,.08,z,.55,.06,2.4,0xf5f5f5);m.rotation.y=-a; if(i%2)m.material.opacity=.9}
 // start line
 for(let i=-5;i<=5;i++)addBox(worldGroup,i*1.4,.11,rz,1,.08,.55,0xffffff);
 // map personality
 const theme=t.theme;
 if(theme==="city"){for(let i=0;i<36;i++){const x=(Math.random()-.5)*130,z=(Math.random()-.5)*90;if(Math.hypot(x/rx,z/rz)<1.25)continue;addBox(worldGroup,x,4,z,4+Math.random()*4,8+Math.random()*16,4+Math.random()*4,0x111b3d,2);if(i%2)addLamp(worldGroup,x,z)}}
 if(theme==="pirate"){for(let i=0;i<22;i++){const side=i%2?-1:1;addBox(worldGroup,side*(31+Math.random()*15),1,(Math.random()-.5)*70,3,2,3,0x6a3f22);addLamp(worldGroup,side*29,(Math.random()-.5)*70)}}
 if(theme==="desert"){for(let i=0;i<30;i++){const x=(Math.random()-.5)*140,z=(Math.random()-.5)*90;if(Math.hypot(x/rx,z/rz)<1.15)continue;const c=i%3?0xb87a38:0xd19a52;const m=new THREE.Mesh(new THREE.ConeGeometry(2+Math.random()*3,2+Math.random()*3,8),mat(c));m.position.set(x,1,z);worldGroup.add(m)}}
 if(theme==="mountain"){for(let i=0;i<38;i++){const side=i%2?-1:1;addTree(worldGroup,side*(31+Math.random()*20),(Math.random()-.5)*90,0x185b3b)}}
 if(theme==="jungle"){for(let i=0;i<48;i++){const x=(Math.random()-.5)*145,z=(Math.random()-.5)*100;if(Math.hypot(x/rx,z/rz)<1.2)continue;addTree(worldGroup,x,z,i%2?0x147344:0x0c4f31)}}
 if(theme==="volcano"){for(let i=0;i<30;i++){const x=(Math.random()-.5)*140,z=(Math.random()-.5)*95;const m=new THREE.Mesh(new THREE.ConeGeometry(2+Math.random()*4,5+Math.random()*10,7),mat(i%2?0x351a18:0x111018));m.position.set(x,3,z);worldGroup.add(m)}}
 if(theme==="space"){ground.material.color.set(0x050716);for(let i=0;i<150;i++){const s=new THREE.Mesh(new THREE.SphereGeometry(.08,5,4),new THREE.MeshBasicMaterial({color:i%4?0x7fbfff:0xff55dd}));s.position.set((Math.random()-.5)*180,10+Math.random()*55,(Math.random()-.5)*150);worldGroup.add(s)}}
 if(theme==="ice"){for(let i=0;i<30;i++){const x=(Math.random()-.5)*140,z=(Math.random()-.5)*90;const m=new THREE.Mesh(new THREE.ConeGeometry(2+Math.random()*3,5+Math.random()*8,6),mat(0xc9f6ff,.35));m.position.set(x,2,z);worldGroup.add(m)}}
 // finish gate
 addBox(worldGroup,0,3,rz-2,.5,6,.5,0xffffff,2);addBox(worldGroup,0,5,rz-2,12,.7,.5,0xff25d9,2);
}
function buildVehicle(c){
 const g=new THREE.Group();
 const body=new THREE.Mesh(new THREE.BoxGeometry(2.4,.65,3.5),mat(c.color,.35,.55));body.position.y=.75;g.add(body);
 const nose=new THREE.Mesh(new THREE.BoxGeometry(1.7,.35,1.2),mat(0x151a27,.2,.6));nose.position.set(0,1.05,1.0);g.add(nose);
 for(const x of [-1.35,1.35])for(const z of [-1.1,1.1]){const w=new THREE.Mesh(new THREE.CylinderGeometry(.38,.38,.32,10),mat(0x171717));w.rotation.z=Math.PI/2;w.position.set(x,.45,z);g.add(w)}
 const head=new THREE.Mesh(new THREE.SphereGeometry(.55,10,8),mat(0x1e2537,.5));head.position.set(0,1.45,-.2);g.add(head);
 const visor=new THREE.Mesh(new THREE.BoxGeometry(.72,.24,.1),new THREE.MeshBasicMaterial({color:c.color}));visor.position.set(0,1.5,-.7);g.add(visor);
 const glow=new THREE.PointLight(c.color,quality==="low"?0:2,8);glow.position.y=.6;g.add(glow);
 return g;
}
function buildParticles(){
 const n=quality==="low"?80:quality==="medium"?130:180;const geo=new THREE.BufferGeometry(),a=new Float32Array(n*3);
 for(let i=0;i<n;i++){a[i*3]=(Math.random()-.5)*150;a[i*3+1]=2+Math.random()*18;a[i*3+2]=(Math.random()-.5)*100}
 geo.setAttribute("position",new THREE.BufferAttribute(a,3));particles=new THREE.Points(geo,new THREE.PointsMaterial({color:0x8ddfff,size:quality==="low"?.08:.13,transparent:true,opacity:.6}));scene.add(particles);
}
function startGame(id){
 gameRunning=true;trackDef=TRACKS.find(t=>t.id===id)||TRACKS[0];show("game");setupRenderer();
 scene.background=new THREE.Color(trackDef.colors[0]);scene.fog=new THREE.Fog(trackDef.colors[0],45,150);
 scene.add(new THREE.HemisphereLight(0xb7d8ff,0x182010,2.2));
 const sun=new THREE.DirectionalLight(0xffffff,2.3);sun.position.set(20,45,20);sun.castShadow=quality!=="low";scene.add(sun);
 buildTrack(trackDef);buildParticles();window.onresize=resize;
 lastRaceStart=Date.now();
 animate();
}
function updateCars(s){
 const sorted=[...s.players].sort((a,b)=>b.progress-a.progress);
 $("score").innerHTML=sorted.map((p,i)=>`<div style="color:${p.color}">${i+1} ${escapeHtml(p.nickname)}</div>`).join("");
 for(const p of s.players){
  let o=playerMeshes.get(p.id);
  if(!o){o=buildVehicle(CHARACTERS[(p.id?.length||0)%CHARACTERS.length]||CHARACTERS[0]);scene.add(o);playerMeshes.set(p.id,o)}
  o.position.set(p.x,.25,p.y);o.rotation.y=p.a;
  o.scale.setScalar(p.boost>0?1.06:1);
 }
 for(const [id,o] of playerMeshes)if(!s.players.some(p=>p.id===id)){scene.remove(o);playerMeshes.delete(id)}
 const me=s.players.find(p=>p.nickname===currentUser)||s.players[0];
 if(me){
  const ahead=10, bx=me.x-Math.sin(me.a)*ahead,bz=me.y-Math.cos(me.a)*ahead;
  camera.position.lerp(new THREE.Vector3(me.x-Math.sin(me.a)*11,5.3,me.y-Math.cos(me.a)*11),.13);
  camera.lookAt(new THREE.Vector3(bx,1,bz));
  $("bar").style.width=me.energy+"%";$("speed").textContent=String(Math.round(me.speed*12)).padStart(3,"0");$("lap").textContent=`VOLTA ${Math.min(me.lap,3)}/3`;
 }
 drawMap(s);
}
function drawMap(s){
 const c=$("map"),x=c.getContext("2d");x.clearRect(0,0,c.width,c.height);x.strokeStyle="#ffffff66";x.lineWidth=5;x.beginPath();
 for(let i=0;i<=80;i++){const a=i/80*Math.PI*2;x.lineTo(90+65*Math.sin(a),50+36*Math.cos(a))}x.stroke();
 for(const p of s.players){x.fillStyle=p.color;x.beginPath();x.arc(90+62*Math.sin(p.progress*2*Math.PI),50+34*Math.cos(p.progress*2*Math.PI),3.5,0,Math.PI*2);x.fill()}
}
function animate(){
 if(!gameRunning)return;requestAnimationFrame(animate);if(lastState)updateCars(lastState);
 if(particles)particles.rotation.y+=.0003;renderer.render(scene,camera);
 $("timer").textContent=new Date(Date.now()-lastRaceStart).toISOString().slice(14,19);
}
function resize(){if(!renderer)return;camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight,false)}
function emitSteer(type){socket.emit("input",{type});}
addEventListener("keydown",e=>{
 if(e.repeat)return;
 if(e.key==="ArrowLeft"||e.key.toLowerCase()==="a"){keys.left=true;emitSteer("left")}
 if(e.key==="ArrowRight"||e.key.toLowerCase()==="d"){keys.right=true;emitSteer("right")}
 if(e.code==="Space"||e.key.toLowerCase()==="shift")socket.emit("input",{type:"turbo"});
});
addEventListener("keyup",e=>{if(e.key==="ArrowLeft"||e.key.toLowerCase()==="a")keys.left=false;if(e.key==="ArrowRight"||e.key.toLowerCase()==="d")keys.right=false;if(!keys.left&&!keys.right)emitSteer("neutral")});
$("turbo").onclick=()=>socket.emit("input",{type:"turbo"});$("sab").onclick=()=>socket.emit("input",{type:"sabotage"});
$("touchLeft").onpointerdown=()=>{emitSteer("left");touchTimer=setInterval(()=>emitSteer("left"),120)};$("touchLeft").onpointerup=()=>{clearInterval(touchTimer);emitSteer("neutral")};
$("touchRight").onpointerdown=()=>{emitSteer("right");touchTimer=setInterval(()=>emitSteer("right"),120)};$("touchRight").onpointerup=()=>{clearInterval(touchTimer);emitSteer("neutral")};

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
