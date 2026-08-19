import * as THREE from "three";

const $=id=>document.getElementById(id);
const API_BASE=String(window.NEON_API_BASE||"").replace(/\/$/,"");
let authToken=localStorage.getItem("neon_token")||"";
const socket=typeof io==="function" ? io(API_BASE||undefined,{transports:["websocket","polling"],autoConnect:true,reconnection:true,reconnectionAttempts:Infinity,reconnectionDelay:500,reconnectionDelayMax:3000,timeout:9000,auth:{token:authToken}}) : {
  connected:false,
  on(){return this;},
  emit(){return false;},
  connect(){return this;},
  disconnect(){return this;}
};
let quality=localStorage.getItem("neon_quality")||"auto";
const isTouchDevice=matchMedia("(pointer:coarse)").matches || navigator.maxTouchPoints>0;
const DEVICE_LOW=(navigator.deviceMemory&&navigator.deviceMemory<=3)||(navigator.hardwareConcurrency&&navigator.hardwareConcurrency<=4);
function effectiveQuality(){
  if(quality!=="auto")return quality;
  if(DEVICE_LOW)return "low";
  return Math.min(devicePixelRatio||1,1.25)>=1.1?"high":"medium";
}
let currentUser="Piloto", selectedCharacter=1, selectedTrack=localStorage.getItem("neon_track")||"neon-city", pendingAction="quick";
let currentProfile=null,selectedResourcePack=localStorage.getItem("neon_resource_pack")||"lite",audioEnabled=localStorage.getItem("neon_audio")!=="off";
let renderer,scene,camera,clock,playerMeshes=new Map(),itemBoxes=[],worldGroup,environmentGroup,environmentSeed=0,particles,trackDef,lastState,lastRaceStart=0,gameRunning=false,roomMode="room",trackBackdrop=null,trackTextureLoader=new THREE.TextureLoader(),backdropPromise=Promise.resolve(),loadingTimer=null,raceStartWatchdog=null,raceStarting=false;
let lastFrameTime=performance.now();
let keys={left:false,right:false,drift:false,accelerate:false,brake:false}, touchTimer=null, cameraTarget=new THREE.Vector3(), cameraLook=new THREE.Vector3(), renderFrame=0;
let frameBudgetStarted=performance.now(),frameBudgetCount=0,adaptiveReduced=false,toastTimer=null;

const CHARACTERS=[
 {id:1,name:"SPARK",icon:"◈",portrait:"/1-spark.svg",color:"#38d9ff",stats:[78,76,72,88],unlock:0,rarity:"INICIAL"},
 {id:2,name:"LUNA",icon:"◒",portrait:"/2-luna.svg",color:"#ff5fb4",stats:[82,74,88,76],unlock:5,rarity:"RARA"},
 {id:3,name:"STEEL",icon:"⬢",portrait:"/3-steel.svg",color:"#c9d3df",stats:[70,88,62,82],unlock:10,rarity:"RARA"},
 {id:4,name:"ZIPPY",icon:"◇",portrait:"/4-zippy.svg",color:"#7cff58",stats:[92,67,72,86],unlock:18,rarity:"ÉPICA"},
 {id:5,name:"BLAZE",icon:"△",portrait:"/5-blaze.svg",color:"#ff6b35",stats:[80,84,66,90],unlock:28,rarity:"ÉPICA"},
 {id:6,name:"FROST",icon:"❄",portrait:"/6-frost.svg",color:"#bcecff",stats:[74,80,90,70],unlock:40,rarity:"LENDÁRIA"},
 {id:7,name:"ROCKY",icon:"⬣",portrait:"/7-rocky.svg",color:"#b77d58",stats:[66,92,70,80],unlock:55,rarity:"LENDÁRIA"},
 {id:8,name:"NITRO",icon:"✦",portrait:"/8-nitro.svg",color:"#ffd84a",stats:[88,78,78,96],unlock:75,rarity:"MÍTICA"}
];
const TRACKS=[
 {id:"neon-city",name:"NEON APEX",theme:"city",desc:"Megacidade molhada · velocidade alta",colors:[0x071a43,0xff22d5],world:"MUNDO 01",rx:48,rz:27},
 {id:"pirate-bay",name:"PORTO FANTASMA",theme:"pirate",desc:"Tempestade, docas e navios perdidos",colors:[0x03293c,0x16d7d8],world:"MUNDO 02",rx:50,rz:28},
 {id:"desert-run",name:"DUNA SOLAR",theme:"desert",desc:"Calor extremo e retas de areia",colors:[0xd9913e,0x6b2c16],world:"MUNDO 03",rx:52,rz:29},
 {id:"mountain-peak",name:"PICO TEMPESTADE",theme:"mountain",desc:"Abismos, pinheiros e neblina",colors:[0x6fa8cc,0x24394f],world:"MUNDO 04",rx:46,rz:30},
 {id:"space-station",name:"ÓRBITA ZERO",theme:"space",desc:"Gravidade baixa e circuito orbital",colors:[0x111a6b,0x04050b],world:"MUNDO 05",rx:50,rz:27},
 {id:"jungle-falls",name:"TEMPLO PERDIDO",theme:"jungle",desc:"Ruínas vivas entre cachoeiras",colors:[0x116847,0x081b12],world:"MUNDO 06",rx:48,rz:29},
 {id:"volcano-rush",name:"CORAÇÃO VULCÂNICO",theme:"volcano",desc:"Lava, cinzas e curvas agressivas",colors:[0xd84516,0x210308],world:"MUNDO 07",rx:52,rz:28},
 {id:"ice-world",name:"AURORA GLACIAL",theme:"ice",desc:"Gelo negro sob a aurora",colors:[0x9deaff,0x1d4d7b],world:"MUNDO 08",rx:49,rz:30},
 {id:"immortal-grid",name:"PROTOCOLO IMORTAL",theme:"immortal",desc:"Circuito secreto · exige Prestígio 5",colors:[0x190d35,0xffd45f],world:"PRESTÍGIO 5",rx:54,rz:31,prestige:5}
];
const PRESTIGE_TIERS=[
 {level:0,name:"RECRUTA",xp:0,reward:"Acesso ao circuito"},{level:1,name:"FAÍSCA",xp:1250,reward:"Rastro da Faísca"},{level:2,name:"VANGUARDA",xp:3000,reward:"+1.500 moedas"},{level:3,name:"FANTASMA",xp:6000,reward:"Aura Fantasma Real"},{level:4,name:"LENDÁRIO",xp:10000,reward:"Coroa da Lenda"},{level:5,name:"IMORTAL",xp:15000,reward:"Protocolo Imortal + circuito secreto"}
];
const api=async(path,opts={})=>{
 const headers={"Content-Type":"application/json",...(opts.headers||{})};
 if(authToken)headers.Authorization="Bearer "+authToken;
 const r=await fetch(API_BASE+path,{...opts,headers,credentials:"same-origin"});const j=await r.json().catch(()=>({}));
 if(!r.ok){const e=new Error(j.error||"erro");e.status=r.status;throw e;}return j;
};
function escapeHtml(x){return String(x).replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[m]));}
function show(id){document.querySelectorAll("#app>.screen,#app>#game").forEach(e=>e.classList.add("hidden"));$(id)?.classList.remove("hidden");}
function message(t){if($("msg"))$("msg").textContent=t||"";}
function toast(t,ms=2600){const el=$("toast");if(!el)return;clearTimeout(toastTimer);el.textContent=t;el.classList.remove("hidden");toastTimer=setTimeout(()=>el.classList.add("hidden"),ms);}
function formatNumber(v){return Math.max(0,Number(v)||0).toLocaleString("pt-BR");}

// ===== BOOT / PWA / ORIGINAL AUDIO =====
const soundtrack=$("soundtrack");
let musicVolume=Math.max(0,Math.min(1,Number(localStorage.getItem("neon_music_volume")??0.34))),audioContext=null;
function applyQualityClass(){document.documentElement.classList.toggle("quality-low",effectiveQuality()==="low");}
function syncAudio(){if(soundtrack){soundtrack.volume=audioEnabled?musicVolume:0;soundtrack.muted=!audioEnabled;}if($("raceAudio"))$("raceAudio").textContent=audioEnabled?"♪":"×";}
async function startAudio(){if(!audioEnabled||!soundtrack)return;syncAudio();try{await soundtrack.play();}catch{}}
function toggleAudio(){audioEnabled=!audioEnabled;localStorage.setItem("neon_audio",audioEnabled?"on":"off");syncAudio();if(audioEnabled)startAudio();toast(audioEnabled?"Áudio ativado":"Áudio silenciado");}
function playSfx(kind="select"){
 if(!audioEnabled)return;
 try{
  audioContext=audioContext||new (window.AudioContext||window.webkitAudioContext)();
  const now=audioContext.currentTime,o=audioContext.createOscillator(),g=audioContext.createGain();
  const table={select:[420,680,.055],turbo:[125,520,.22],hit:[95,48,.18],finish:[520,980,.45]};
  const [from,to,duration]=table[kind]||table.select;o.type=kind==="hit"?"square":"sawtooth";o.frequency.setValueAtTime(from,now);o.frequency.exponentialRampToValueAtTime(Math.max(20,to),now+duration);
  g.gain.setValueAtTime(.0001,now);g.gain.exponentialRampToValueAtTime(kind==="turbo"?.10:.065,now+.01);g.gain.exponentialRampToValueAtTime(.0001,now+duration);
  o.connect(g).connect(audioContext.destination);o.start(now);o.stop(now+duration+.02);
 }catch{}
}
function updateConnectionPill(online){const pill=document.querySelector(".server-pill");pill?.classList.toggle("online",online);if($("serverState"))$("serverState").textContent=online?"SERVIDOR ONLINE":"RECONECTANDO";}
function boot(){
 applyQualityClass();syncAudio();
 const fill=$("bootFill"),text=$("bootText"),steps=[[22,"CARREGANDO INTERFACE..."],[56,"PREPARANDO PISTAS..."],[82,"SINCRONIZANDO PERFIL..."],[100,"PRONTO PARA CORRER"]];
 steps.forEach(([pct,label],i)=>setTimeout(()=>{if(fill)fill.style.width=pct+"%";if(text)text.textContent=label;},160+i*230));
 setTimeout(()=>$("bootSplash")?.classList.add("done"),1300);
 if("serviceWorker" in navigator && location.protocol!=="file:")navigator.serviceWorker.register("/service-worker.js").catch(()=>{});
}
addEventListener("DOMContentLoaded",boot,{once:true});
addEventListener("online",()=>{updateConnectionPill(socket.connected);toast("Conexão restaurada")});
addEventListener("offline",()=>{updateConnectionPill(false);toast("Sem internet: tentando reconectar",3400)});
addEventListener("pointerdown",()=>startAudio(),{once:true,passive:true});

// ===== AUTO BUG RECOVERY / CEO REPORTING =====
let bugRecoveryTimer=null, bugRecoverySeconds=15, lastBugFingerprint="", lastBugAt=0, recoveryAttempts=0;
function bugFingerprint(message,source){
  const raw=`${source||"client"}|${message||"unknown"}|${location.pathname}`;
  let h=2166136261; for(let i=0;i<raw.length;i++){h^=raw.charCodeAt(i);h=Math.imul(h,16777619);} return (h>>>0).toString(16);
}
async function reportBug(err,{source="client",message:msg,stack}={}){
  const text=String(msg||err?.message||err||"Erro desconhecido").slice(0,1000);
  const fp=bugFingerprint(text,source), now=Date.now();
  if(fp===lastBugFingerprint && now-lastBugAt<15000)return;
  lastBugFingerprint=fp;lastBugAt=now;
  try{await fetch(API_BASE+"/api/bug-report",{method:"POST",headers:{"Content-Type":"application/json",...(authToken?{Authorization:"Bearer "+authToken}:{})},body:JSON.stringify({fingerprint:fp,message:text,stack:String(stack||err?.stack||"").slice(0,6000),source,screen:document.querySelector("#game:not(.hidden)")?"game":(document.querySelector(".screen:not(.hidden)")?.id||"unknown"),track:trackDef?.id||selectedTrack,mode:roomMode,quality:effectiveQuality(),viewport:`${innerWidth}x${innerHeight}`})});}catch{}
}
function showBugRecovery(title="OPS! O JOGO ENCONTROU UM PROBLEMA",text="O erro foi registrado automaticamente. O jogo vai tentar continuar com segurança."){
  const box=$("bugRecovery");if(!box)return;
  $("bugRecoveryTitle").textContent=title;$("bugRecoveryText").textContent=text;
  bugRecoverySeconds=15;$("bugRecoveryTimer").textContent="Fechando em 15s...";box.classList.remove("hidden");
  clearInterval(bugRecoveryTimer);bugRecoveryTimer=setInterval(()=>{bugRecoverySeconds--;if(bugRecoverySeconds<=0){clearInterval(bugRecoveryTimer);box.classList.add("hidden");return;}$("bugRecoveryTimer").textContent=`Fechando em ${bugRecoverySeconds}s...`;},1000);
}
function closeBugRecovery(){clearInterval(bugRecoveryTimer);$("bugRecovery")?.classList.add("hidden");}
$("bugRecoveryClose")?.addEventListener("click",closeBugRecovery);
async function handleClientFault(err,source="runtime"){
  const text=String(err?.message||err||"Erro desconhecido");
  console.error("NEON PATH AUTO-RECOVERY",source,err);
  await reportBug(err,{source});
  showBugRecovery("ERRO RECUPERADO", "Detectamos uma falha e enviamos um relatório automático para o CEO. O jogo será recuperado sem travar a sessão.");
  if(gameRunning){
    gameRunning=false;
    if(recoveryAttempts<2){
      recoveryAttempts++;
      setTimeout(()=>{try{recoverRaceAfterRenderError(trackDef?.id||selectedTrack);}catch{}},450);
    }else{
      setTimeout(()=>{recoveryAttempts=0;show("menu");message("A corrida foi encerrada com segurança. O erro foi enviado ao CEO.");try{socket.emit("room:leave");}catch{}},1800);
    }
  }
  return text;
}
window.addEventListener("error",e=>{if(e?.error||e?.message)handleClientFault(e.error||new Error(e.message),"window-error");});
window.addEventListener("unhandledrejection",e=>handleClientFault(e.reason||new Error("Promise rejeitada"),"unhandled-rejection"));

function ceoKey(){return window.__ceoKey||sessionStorage.getItem("neon_ceo_key")||"";}
function renderCEOReports(data){
 const box=$("ceoReports"), reports=data?.reports||[];
 if(!reports.length){box.innerHTML='<div class="ceo-empty">✓ Nenhum bug registrado ainda.</div>';return;}
 box.innerHTML=reports.map(r=>`<article class="bug-report ${r.resolved?"resolved":"open"}"><div class="bug-report-head"><b>${escapeHtml(r.message||"Erro")}</b><span>${r.resolved?"RESOLVIDO":"ABERTO"}</span></div><div class="bug-meta">${escapeHtml(r.nickname||"Piloto")} · ${escapeHtml(r.source||"client")} · ${escapeHtml(r.screen||"?")} · ${escapeHtml(r.track||"?")} · ${new Date(r.created_at||r.createdAt||Date.now()).toLocaleString("pt-BR")}</div><code>${escapeHtml((r.stack||r.fingerprint||"").slice(0,1400))}</code>${!r.resolved?`<button class="secondary-btn resolve-bug" data-bug-id="${r.id}">MARCAR RESOLVIDO</button>`:""}</article>`).join("");
 box.querySelectorAll(".resolve-bug").forEach(b=>b.onclick=async()=>{try{await fetch(`${API_BASE}/api/ceo/bug-reports/${encodeURIComponent(b.dataset.bugId)}/resolve`,{method:"POST",headers:{"X-CEO-Key":ceoKey()}});loadCEOReports();}catch{}});
}
async function loadCEOReports(){
 const key=ceoKey(); if(!key){$("ceoReports").innerHTML='<div class="ceo-empty">Chave CEO não informada.</div>';return;}
 $("ceoReports").innerHTML='<div class="modal-muted">Carregando relatórios...</div>';
 try{const r=await fetch(API_BASE+"/api/ceo/bug-reports",{headers:{"X-CEO-Key":key}});const d=await r.json();if(!r.ok)throw new Error(d.error||"Acesso negado");renderCEOReports(d);}catch(e){$("ceoReports").innerHTML=`<div class="ceo-empty">Não foi possível abrir os relatórios: ${escapeHtml(e.message)}</div>`;}
}
function openCEO(){
 const key=prompt("Chave CEO:",ceoKey()); if(!key)return; window.__ceoKey=key;sessionStorage.setItem("neon_ceo_key",key);$("ceoPanel").classList.remove("hidden");loadCEOReports();
}
$("ceoClose")?.addEventListener("click",()=>$("ceoPanel").classList.add("hidden"));$("ceoRefresh")?.addEventListener("click",loadCEOReports);
let fullscreenBusy=false;
async function requestFullscreenLandscape(){
  // Android/Chrome is stricter about fullscreen: keep the API call directly in the
  // user gesture, do not pass optional arguments, and try vendor fallbacks.
  if(fullscreenBusy) return !!document.fullscreenElement;
  fullscreenBusy=true;
  let entered=!!document.fullscreenElement;
  try{
    if(!entered){
      const root=document.documentElement;
      const fn=root.requestFullscreen||root.webkitRequestFullscreen||root.msRequestFullscreen;
      if(fn){
        try{ await fn.call(root); }
        catch(e){
          // Some WebViews reject the promise after accepting the gesture. Retry once.
          try{ await Promise.resolve(fn.call(root)); }catch{}
        }
      }
    }
    entered=!!(document.fullscreenElement||document.webkitFullscreenElement||document.msFullscreenElement);
    // Orientation lock only works in fullscreen on supported Android browsers.
    if(entered && screen.orientation?.lock){
      try{ await screen.orientation.lock("landscape"); }catch{
        try{ await screen.orientation.lock("landscape-primary"); }catch{}
      }
    }
  }finally{
    fullscreenBusy=false;
    document.documentElement.classList.toggle("race-landscape",entered);
    document.documentElement.dataset.fullscreen=entered?"1":"0";
    $("rotateNotice")?.classList.toggle("fullscreen-active",entered);
    setTimeout(()=>resize(),80);
  }
  if(!entered && isTouchDevice && $("rotateFullscreen")){
    $("rotateFullscreen").textContent="TENTAR TELA CHEIA NOVAMENTE";
    $("rotateFullscreen").classList.add("fullscreen-failed");
  }
  return entered;
}
function releaseFullscreen(){
  try{
    const fn=document.exitFullscreen||document.webkitExitFullscreen||document.msExitFullscreen;
    if(fn && (document.fullscreenElement||document.webkitFullscreenElement||document.msFullscreenElement)) Promise.resolve(fn.call(document)).catch(()=>{});
  }catch{}
  document.documentElement.classList.remove("race-landscape");
  document.documentElement.dataset.fullscreen="0";
}
addEventListener("fullscreenchange",()=>{
  const active=!!(document.fullscreenElement||document.webkitFullscreenElement||document.msFullscreenElement);
  document.documentElement.classList.toggle("race-landscape",active);
  document.documentElement.dataset.fullscreen=active?"1":"0";
  $("rotateNotice")?.classList.toggle("fullscreen-active",active);
  setTimeout(()=>resize(),80);
});
addEventListener("webkitfullscreenchange",()=>dispatchEvent(new Event("fullscreenchange")));
addEventListener("orientationchange",()=>{setTimeout(resize,120);});
function maybeOfferLandscape(){
 const portrait=isTouchDevice&&matchMedia("(orientation:portrait)").matches;
 if(portrait&&sessionStorage.getItem("neon_portrait_ok")!=="1"&&!document.fullscreenElement)$("rotateNotice")?.classList.add("visible");
}
$("rotateFullscreen").onclick=async()=>{
  const ok=await requestFullscreenLandscape();
  if(ok){$("rotateFullscreen").textContent="TELA CHEIA ATIVADA";$("rotateNotice").classList.remove("visible");}
};
const acceptPortrait=()=>{sessionStorage.setItem("neon_portrait_ok","1");$("rotateNotice")?.classList.remove("visible");setTimeout(resize,80);};
$("rotateDismiss")?.addEventListener("click",acceptPortrait);
$("portraitContinue")?.addEventListener("click",acceptPortrait);
async function showTermsGate(){
 $("termsGate").classList.remove("hidden");$("termsAccept").checked=false;$("continueWithoutDownload").disabled=true;
 setResourcePlan(selectedResourcePack);
 const cached=localStorage.getItem(`neon_resources_v12_${selectedResourcePack}`)==="ready";
 $("downloadResources").disabled=true;
 if(cached){$("resourceStatus").textContent="Pacote já preparado neste dispositivo.";$("resourcePercent").textContent="100%";$("resourceFill").style.width="100%";$("downloadResources").textContent="PACOTE JÁ PREPARADO";}
}
function setResourcePlan(pack){
 selectedResourcePack=pack==="hd"?"hd":"lite";localStorage.setItem("neon_resource_pack",selectedResourcePack);
 document.querySelectorAll(".resource-plan").forEach(b=>{const active=b.dataset.pack===selectedResourcePack;b.classList.toggle("selected",active);b.setAttribute("aria-checked",String(active));});
 if($("resourcePackName"))$("resourcePackName").textContent=selectedResourcePack==="hd"?"PACOTE HD":"PACOTE ESSENCIAL";
 const cached=localStorage.getItem(`neon_resources_v12_${selectedResourcePack}`)==="ready";
 if($("resourceStatus"))$("resourceStatus").textContent=cached?"Pacote já está pronto.":"Pronto para preparar.";
 if($("resourcePercent"))$("resourcePercent").textContent=cached?"100%":"0%";
 if($("resourceFill"))$("resourceFill").style.width=cached?"100%":"0%";
 if($("termsAccept"))$("downloadResources").disabled=!$("termsAccept").checked;
 $("continueWithoutDownload").disabled=!$("termsAccept")?.checked;
}
async function downloadGameResources(){
 if(!$("termsAccept").checked)return;
 $("downloadResources").disabled=true;$("resourceStatus").textContent=`Preparando pacote ${selectedResourcePack==="hd"?"HD":"essencial"}...`;
 try{
  const manifest=await fetch("/assets-manifest.json",{cache:"no-store"}).then(r=>r.json());
  const lite=manifest.packs?.lite||["index.html","style.css","app.js","loading-hero.webp","loading-cinematic.mp4","velocity-protocol.mp3",...(manifest.portraits||[]).slice(0,2)];
  const hd=manifest.packs?.hd||[...lite,...(manifest.hd_scenes||[]),...(manifest.portraits||[]),...(manifest.environment_textures||[]),...(manifest.sky_billboards||[]),...(manifest.arena_detail||[])];
  const files=[...new Set(selectedResourcePack==="hd"?hd:lite)];
  if(!("caches" in window))throw new Error("cache_unavailable");
  const cache=await caches.open("neon-path-resources-v12");let cursor=0,done=0,failed=0;
  const worker=async()=>{while(cursor<files.length){const index=cursor++,file=files[index];try{await cache.add(new Request(file.startsWith("/")?file:"/"+file,{cache:"reload"}));}catch{failed++;}done++;const pct=Math.round(done/files.length*100);$("resourcePercent").textContent=pct+"%";$("resourceFill").style.width=pct+"%";$("resourceStatus").textContent=`Preparando ${done} de ${files.length} recursos...`;}};
  await Promise.all(Array.from({length:Math.min(3,files.length)},worker));
  if(failed>Math.ceil(files.length*.35))throw new Error("many_assets_failed");
  localStorage.setItem(`neon_resources_v12_${selectedResourcePack}`,"ready");$("resourceStatus").textContent=`Pacote pronto · ${files.length-failed} recursos armazenados.`;$("resourcePercent").textContent="100%";$("resourceFill").style.width="100%";$("continueWithoutDownload").disabled=false;$("downloadResources").textContent="PACOTE PRONTO";
 }catch(e){$("resourceStatus").textContent="O cache não ficou disponível. A versão online continua funcionando.";$("downloadResources").disabled=false;$("continueWithoutDownload").disabled=false;reportBug(e,{source:"resource-pack"});}
}
document.querySelectorAll(".resource-plan").forEach(b=>b.onclick=()=>setResourcePlan(b.dataset.pack));
$("termsAccept").onchange=()=>{const accepted=$("termsAccept").checked;$("downloadResources").disabled=!accepted;$("continueWithoutDownload").disabled=!accepted;};
$("downloadResources").onclick=downloadGameResources;
$("continueWithoutDownload").onclick=async()=>{localStorage.setItem("neon_terms_v12","accepted");$("termsGate").classList.add("hidden");show("menu");startAudio();};

function xpForLevel(level){return Math.floor(100*Math.pow(1.12,Math.max(0,(Number(level)||1)-1)));}
function prestigeTierFor(xp){let tier=PRESTIGE_TIERS[0];for(const t of PRESTIGE_TIERS)if(xp>=t.xp)tier=t;return tier;}
function applyProfile(p){
 if(!p)return;currentProfile=p;currentUser=p.nickname||currentUser;
 const level=Math.max(1,Number(p.level)||1),xp=Math.max(0,Number(p.xp)||0),lifetimeXp=Math.max(xp,Number(p.lifetime_xp??p.lifetimeXp)||0),need=Math.max(1,Number(p.xp_needed)||xpForLevel(level));
 const prestige=Math.max(0,Math.min(5,Number(p.prestige)||prestigeTierFor(lifetimeXp).level));
 const savedTrack=TRACKS.find(t=>t.id===selectedTrack);if(savedTrack?.prestige&&prestige<savedTrack.prestige){selectedTrack='neon-city';localStorage.setItem('neon_track',selectedTrack);}
 selectedCharacter=Math.max(1,Math.min(8,Number(p.character_id)||selectedCharacter||1));
 $("menuNick").textContent=currentUser;$("menuLevel").textContent=level;$("levelLarge").textContent=level;$("menuPrestige").textContent=prestige;$("menuCoins").textContent=formatNumber(p.bruto_coins);
 $("menuXpText").textContent=`${formatNumber(xp)} / ${formatNumber(need)} XP`;$("menuXp").style.width=Math.min(100,xp/need*100)+"%";
 const tier=PRESTIGE_TIERS[prestige]||PRESTIGE_TIERS[0],next=PRESTIGE_TIERS[Math.min(5,prestige+1)];$("prestigeName").textContent=tier.name;$("prestigeProgressText").textContent=prestige>=5?"PRESTÍGIO MÁXIMO":`${formatNumber(lifetimeXp)} / ${formatNumber(next.xp)} XP`;
 $("profileAvatar").textContent=currentUser.split(/\s+/).map(x=>x[0]).join("").slice(0,2).toUpperCase()||"NP";
 const daily=Math.max(0,Math.min(3,Number(p.daily_races)||0));$("dailyMissionFill").style.width=daily/3*100+"%";$("dailyMissionText").textContent=`${daily}/3 · +450 ◉`;
}
function setAuthMode(mode){const login=mode==="login";$("loginForm").classList.toggle("hidden",!login);$("registerForm").classList.toggle("hidden",login);$("showLogin").classList.toggle("active",login);$("showRegister").classList.toggle("active",!login);$("authMsg").textContent="";}
async function auth(mode){
 const nick=(mode==="login"?$("authNick"):$("registerNick")).value.trim(),pass=(mode==="login"?$("authPassword"):$("registerPassword")).value,email=mode==="register"?$("registerEmail").value.trim():"";
 if(!nick||!pass){$("authMsg").textContent="Preencha apelido e senha.";return}
 const button=mode==="login"?$("loginBtn"):$("registerBtn"),oldText=button.textContent;button.disabled=true;button.textContent="CONECTANDO...";$("authMsg").textContent="";
 try{
  const body=mode==="register"?{username:nick,password:pass,email:email||null}:{username:nick,password:pass};
  const d=await api(mode==="register"?"/api/auth/register":"/api/auth/login",{method:"POST",body:JSON.stringify(body)});
  authToken=d.token;currentUser=d.nickname||nick;localStorage.setItem("neon_token",authToken);
  if(socket.connected)socket.disconnect();socket.auth={token:authToken};socket.connect();
  await enterApp();startAudio();playSfx("select");
 }catch(e){$("authMsg").textContent="Não foi possível entrar: "+e.message;}finally{button.disabled=false;button.textContent=oldText;}
}
async function enterApp(){
 try{const p=await api("/api/profile");applyProfile(p);}catch(e){if(e.status===401){authToken="";localStorage.removeItem("neon_token");$("authMsg").textContent="Sua sessão expirou. Entre novamente.";return;}throw e;}
 $("authPanel").hidden=true;$("app").hidden=false;
 if(localStorage.getItem("neon_terms_v12")!=="accepted") return showTermsGate();
 show("menu");
}
$("showLogin").onclick=()=>setAuthMode("login");$("showRegister").onclick=()=>setAuthMode("register");
$("toRegister").onclick=()=>setAuthMode("register");$("toLogin").onclick=()=>setAuthMode("login");
$("loginBtn").onclick=()=>auth("login");$("registerBtn").onclick=()=>auth("register");
[$("authNick"),$("authPassword")].forEach(el=>el?.addEventListener("keydown",e=>{if(e.key==="Enter")auth("login")}));
[$("registerNick"),$("registerPassword"),$("registerEmail")].forEach(el=>el?.addEventListener("keydown",e=>{if(e.key==="Enter")auth("register")}));
setAuthMode("login");
if(authToken)enterApp().catch(()=>{$("authMsg").textContent="Não foi possível validar a sessão. Verifique a conexão.";});

function renderCharacters(){
 const explicit=new Map((currentProfile?.characters||[]).map(x=>[Number(x.character_id),!!x.unlocked])),level=Number(currentProfile?.level)||1;
 const unlocked=c=>c.id===1||explicit.get(c.id)===true||level>=c.unlock;
 $("characterSelect").innerHTML=CHARACTERS.map(c=>{const open=unlocked(c);return `<button class="character-card ${selectedCharacter===c.id?"selected":""} ${open?"":"locked"}" data-char="${c.id}" aria-pressed="${selectedCharacter===c.id}" aria-disabled="${!open}"><div class="avatar portrait-avatar"><img src="${c.portrait}" alt="Retrato de ${c.name}"></div><b>${c.name}</b><small>${open?c.rarity:`LIBERA NO LV ${c.unlock}`}</small>${open?"":'<span class="lock-badge">BLOQUEADO</span>'}</button>`}).join("");
 document.querySelectorAll("[data-char]").forEach(b=>b.onclick=()=>{const c=CHARACTERS.find(x=>x.id===Number(b.dataset.char));if(!c||!unlocked(c)){toast(`Chegue ao nível ${c?.unlock||"necessário"} para liberar.`);return;}selectedCharacter=c.id;renderCharacters();playSfx("select");});
 const c=CHARACTERS.find(x=>x.id===selectedCharacter)||CHARACTERS[0];$("selectedPortrait").innerHTML=`<img src="${c.portrait}" alt="${c.name}">`;$("selectedCharacterName").textContent=c.name;$("selectedCharacterRarity").textContent=c.rarity;
 document.querySelectorAll("[data-stat]").forEach(el=>{el.style.setProperty("--stat",`${c.stats[Number(el.dataset.stat)]||50}%`)});
}
function openCharacters(){renderCharacters();show("select");}
function renderTracks(){
 const prestige=Math.max(0,Number(currentProfile?.prestige)||0);
 $("trackGrid").innerHTML=TRACKS.map(t=>{const locked=t.prestige&&prestige<t.prestige;return `<button class="track-card ${selectedTrack===t.id?"selected":""} ${locked?'locked':''}" data-track="${t.id}" aria-disabled="${!!locked}"><div class="track-art theme-${t.theme}"></div><b>${t.name}</b><small>${locked?`BLOQUEADO · PRESTÍGIO ${t.prestige}`:t.desc}</small>${locked?'<span class="track-lock">PRESTÍGIO 5</span>':''}</button>`}).join("");
 document.querySelectorAll("[data-track]").forEach(b=>b.onclick=()=>{const t=TRACKS.find(x=>x.id===b.dataset.track);if(t?.prestige&&prestige<t.prestige){toast(`Alcance o Prestígio ${t.prestige} para abrir este circuito.`);return;}selectedTrack=b.dataset.track;localStorage.setItem("neon_track",selectedTrack);renderTracks();playSfx("select");});
 $("selectedTrackName").textContent=(TRACKS.find(t=>t.id===selectedTrack)||TRACKS[0]).name;
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
$("charactersBtn").onclick=()=>{pendingAction="customize";openCharacters();};$("mapsBtn").onclick=()=>{pendingAction="preview";openTracks();};
$("selectBack").onclick=()=>show("menu");$("tracksBack").onclick=()=>pendingAction==="preview"?show("menu"):show("select");
$("selectContinue").onclick=async()=>{if(pendingAction==="customize"){try{const p=await api("/api/profile/character",{method:"POST",body:JSON.stringify({characterId:selectedCharacter})});applyProfile(p);toast("Piloto equipado");}catch(e){toast("Não foi possível equipar: "+e.message);}show("menu");return;}openTracks();};
$("trackReady").onclick=()=>{
 localStorage.setItem("neon_track",selectedTrack);maybeOfferLandscape();
 if(pendingAction==="solo")beginRoom(false,true);
 else if(pendingAction==="online")beginMatchmaking();
 else if(pendingAction==="ceo")beginRoom(true,false);
 else if(pendingAction==="create")beginRoom(false,false);
 else {show("menu");toast("Pista favorita salva");}
};
$("playQuick").onclick=()=>{startAudio();openModes();};
$("soloBtn").onclick=openModes;
$("create").onclick=()=>openPrivate(true);
$("join").onclick=()=>openPrivate(false);
$("modeClose").onclick=closeModes;
$("modeSolo").onclick=()=>{closeModes();pendingAction="solo";openCharacters();};
$("modeOnline").onclick=()=>{closeModes();pendingAction="online";openCharacters();};
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
$("ceoBtn").onclick=()=>openCEO();
async function beginRoom(ceo=false,forceSolo=false){
 currentUser=$("menuNick").textContent||currentUser;
 if(!socket.connected){toast("Servidor reconectando. Tente novamente em instantes.");show("menu");return;}
 if(ceo||pendingAction==="ceo") socket.emit("room:create",{nickname:currentUser,ceo:true,key:window.__ceoKey,track:selectedTrack,characterId:selectedCharacter});
 else if(forceSolo||pendingAction==="solo") socket.emit("room:create",{nickname:currentUser,ceo:false,track:selectedTrack,mode:"solo",characterId:selectedCharacter});
 else { const pr=window.__privateRoom||{}; socket.emit("room:create",{nickname:currentUser,ceo:false,track:selectedTrack,mode:"room",roomName:pr.name,password:pr.password,characterId:selectedCharacter}); }
}
function beginMatchmaking(){
 currentUser=$("menuNick").textContent||currentUser;
 if(!socket.connected){toast("Servidor reconectando. Tente novamente em instantes.");show("menu");return;}
 show("lobby");$("lobbyMode").textContent="MATCHMAKING GLOBAL";$("roomCode").textContent="BUSCANDO";$("roomName").textContent="Encontrando rivais do seu nível...";$("start").classList.add("hidden");$("players").innerHTML="";
 socket.emit("room:matchmake",{nickname:currentUser,track:selectedTrack,characterId:selectedCharacter});
}
function renderLobby(s){
 $("roomCode").textContent=s.code||"------";$("roomName").textContent=s.roomName?`NOME: ${s.roomName}`:"";$("lobbyTrack").textContent=(TRACKS.find(t=>t.id===s.track)?.name)||s.trackName||"NEON APEX";
 $("players").innerHTML=(s.players||[]).map((p,i)=>`<div class="player" data-seat="${i+1}" style="--c:${p.color}"><span><b>${escapeHtml(p.nickname)}</b><small>${p.finish?`${p.finish}º LUGAR`:p.alive?"PRONTO":"FORA"}</small></span><strong style="color:${p.color}">●</strong></div>`).join("");
}
socket.on("connect",()=>{updateConnectionPill(true);message("SERVIDOR ONLINE");});
socket.on("disconnect",()=>{updateConnectionPill(false);message("Reconectando ao servidor...");});
socket.on("connect_error",error=>{updateConnectionPill(false);if(error?.message==='unauthorized'){logout(false);$("authMsg").textContent="Sua sessão expirou. Entre novamente.";}else message("Conexão instável — tentando novamente...");});
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
 $("lobbyMode").textContent=x.mode==="public"?"MATCHMAKING GLOBAL":x.ceo?"CEO · SALA PRIVADA":"SALA PRIVADA";
 renderLobby({code:x.code,roomName:x.roomName,trackName:TRACKS.find(t=>t.id===x.track)?.name||x.track,players:[]});
 $("start").classList.toggle("hidden",!x.canStart||x.mode==="public");
 $("ceoTools").classList.toggle("hidden",!x.ceo);
 $("ceoTrack").innerHTML=TRACKS.map(t=>`<option value="${t.id}" ${t.id===x.track?"selected":""}>${t.name}</option>`).join("");
});
socket.on("state",s=>{lastState=s;if(!$("lobby").classList.contains("hidden"))renderLobby(s);});
$("start").onclick=()=>socket.emit("room:start");
$("ceoTrack").onchange=e=>socket.emit("room:track",e.target.value);
$("back").onclick=()=>{socket.emit("room:leave");show("menu");};
socket.on("race:loading",()=>{ const id=lastState?.track||selectedTrack; showLoading(id); armRaceStartWatchdog(id); });
socket.on("race:countdown",x=>{
 const el=$("countdown"); if(!el)return;
 el.classList.remove("hidden"); el.textContent=x.value==='GO'?'GO':String(x.value);
 el.classList.toggle('go',x.value==='GO');
 if(x.value==='GO')setTimeout(()=>el.classList.add('hidden'),700);
});
socket.on("start",x=>{disarmRaceStartWatchdog();startGame(x.track);});
socket.on("hit",x=>{playSfx("hit");showHit(x)});
socket.on("race:finish",x=>showFinish(x.results,x.track,x.rewards,x.profile));

function armRaceStartWatchdog(id){
 clearTimeout(raceStartWatchdog);
 raceStartWatchdog=setTimeout(()=>{
   if(gameRunning || raceStarting || $("game")?.classList.contains("hidden")===false)return;
   const text="A partida demorou mais que o esperado para iniciar.";
   reportBug(new Error(text),{source:"race-start-timeout"});
   showBugRecovery("RECUPERAÇÃO AUTOMÁTICA", "A partida não respondeu a tempo. Vamos iniciar o modo seguro sem apagar sua sessão.");
   try{startGame(id,{watchdog:true});}catch{}
 },8000);
}
function disarmRaceStartWatchdog(){clearTimeout(raceStartWatchdog);raceStartWatchdog=null;}
function showLoading(id){
 if(loadingTimer){clearInterval(loadingTimer);loadingTimer=null;}
 const t=TRACKS.find(x=>x.id===id)||TRACKS[0];
 $("loadingTitle").textContent=t.name;
 $("loadingWorld").textContent=t.world||"MUNDO";$("loadingSub").textContent="SINCRONIZANDO PISTA E PILOTOS...";
 $("loadFill").style.width="8%";
 $("loadingPercent").textContent="8%";
 show("loading");
 const video=$("loadingVideo");if(video&&!matchMedia("(prefers-reduced-motion:reduce)").matches&&effectiveQuality()!=="low"){video.currentTime=0;video.play().catch(()=>{});}
 let n=8;
 const tip=["Solte o DRIFT quando o brilho chegar ao máximo.","Pegue a linha interna, mas proteja seu turbo.","No celular, segure ACELERAR para ganhar velocidade.","O servidor valida posição, XP e moedas.","Mapas HD são carregados somente quando necessários.","Prestígio vem de XP conquistado nas corridas."];
 let i=0;
 loadingTimer=setInterval(()=>{n=Math.min(94,n+2+Math.random()*4);const pct=Math.round(n);$("loadFill").style.width=pct+"%";$("loadingPercent").textContent=pct+"%";if(i%4===0)$("loadTip").textContent="DICA: "+tip[(i/4|0)%tip.length];i++;},220);
}
function showHit(x){const el=document.createElement("div");el.textContent=`IMPACTO · ${x.from} → ${x.to}`;el.style.cssText="position:fixed;top:20%;left:50%;transform:translateX(-50%) skewX(-8deg);z-index:120;font-weight:1000;color:#ffe600;background:#080b16d9;border:1px solid #ffe60055;padding:10px 16px;border-radius:8px;text-shadow:0 0 20px #ff8c00;pointer-events:none";document.body.appendChild(el);setTimeout(()=>el.remove(),900);}

function setupRenderer(){
 const oldCanvas=$("scene");
 if(!window.WebGLRenderingContext) throw new Error("WebGL indisponível neste navegador");
 if(renderer){try{renderer.dispose();}catch{} oldCanvas.replaceWith(oldCanvas.cloneNode(false));}
 const canvas=$("scene");
 const q=effectiveQuality();
 renderer=new THREE.WebGLRenderer({canvas,antialias:q!=="low",powerPreference:q==="low"?"default":"high-performance",alpha:false,stencil:false,depth:true,preserveDrawingBuffer:false,failIfMajorPerformanceCaveat:false});
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
 camera=new THREE.PerspectiveCamera(64,innerWidth/innerHeight,.08,520);
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
 const path=t.id==='immortal-grid'?'/prestige-emblem.webp':`/${t.id}.svg`;
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
 const farGround=addBox(environmentGroup,0,-.05,0,235,.25,195,t.theme==='desert'?0x9f6a31:t.theme==='ice'?0x75b8d5:t.theme==='jungle'?0x145b38:t.theme==='volcano'?0x2a1012:t.theme==='space'?0x080b16:t.theme==='immortal'?0x0a0618:0x17402f);farGround.receiveShadow=true;
 // Layered hills make the world read as a real place instead of an empty plane.
 const hillColor=t.theme==='desert'?0xc88a45:t.theme==='ice'?0x9ed8e9:t.theme==='jungle'?0x0c4f32:t.theme==='volcano'?0x3a1718:t.theme==='space'?0x10132d:t.theme==='immortal'?0x24113e:0x163b55;
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
 } else if(t.theme==='space'||t.theme==='immortal'){
  const starCount=effectiveQuality()==='low'?90:180;for(let i=0;i<starCount;i++){const s=new THREE.Mesh(new THREE.SphereGeometry(.08+(i%3)*.03,6,4),new THREE.MeshBasicMaterial({color:t.theme==='immortal'?(i%5?0xffd45f:0x8b5cff):(i%5?0x9edbff:0xff55dd)}));s.position.set((i*37%190)-95,15+(i*17%75),(i*29%170)-85);environmentGroup.add(s);}
 } else if(t.theme==='ice'){
  for(let i=0;i<28;i++){const side=i%2?-1:1,x=side*(38+(i%7)*5),z=-110+i*8;addRock(environmentGroup,x,z,.9+(i%3)*.25,i%2?0xc7f5ff:0x8fc8e5);}
  for(let i=0;i<10;i++)addCloud(environmentGroup,-90+i*20,30+(i%3)*5,-100+i*12,1.1);
 }
 // Decorative roadside strips: flowers/rocks/bushes keep the track edges from looking dead.
 if(t.theme!=='space'&&t.theme!=='immortal')for(let i=0;i<34;i++){const a=i/34*Math.PI*2,side=i%2?-1:1;const x=(rx+12+((i*7)%8))*Math.sin(a),z=(rz+12+((i*5)%7))*Math.cos(a);if(i%3===0)addRock(environmentGroup,x,z,.45);else addBush(environmentGroup,x,z,.42,t.theme==='ice'?0x64b6ca:t.theme==='desert'?0x6f8d35:0x18864c);}
}
function buildTrack(t){
 worldGroup=new THREE.Group();scene.add(worldGroup);
 const q=effectiveQuality(),rx=t.rx||48,rz=t.rz||28,theme=t.theme;
 const groundColor=theme==='desert'?0xb97935:theme==='ice'?0x8fc9e4:theme==='volcano'?0x241015:theme==='space'?0x050716:theme==='immortal'?0x090515:theme==='jungle'?0x0b3d25:theme==='pirate'?0x285e55:0x102b2b;
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
 } else if(theme==='space'||theme==='immortal'){
  for(let i=0;i<(q==='low'?55:q==='medium'?85:120);i++){const s=new THREE.Mesh(new THREE.SphereGeometry(.08,6,4),new THREE.MeshBasicMaterial({color:theme==='immortal'?(i%4?0xffd45f:0x8b5cff):(i%4?0x7fbfff:0xff55dd)}));s.position.set((Math.random()-.5)*200,12+Math.random()*75,(Math.random()-.5)*160);worldGroup.add(s);}
 } else if(theme==='ice'){
  for(let i=0;i<count;i++){const side=i%2?-1:1,x=side*(39+Math.random()*27),z=(Math.random()-.5)*130,h=5+Math.random()*9;const m=new THREE.Mesh(new THREE.ConeGeometry(2+Math.random()*3,h,6),mat(0xc9f6ff,.25,.05));m.position.set(x,h/2,z);m.castShadow=q!=='low';worldGroup.add(m);}
 }
 if(theme!=='space'&&theme!=='immortal'&&theme!=='volcano')for(let i=0;i<(q==='low'?8:16);i++){const a=i/16*Math.PI*2;addTree(worldGroup,(rx*.55)*Math.sin(a),(rz*.55)*Math.cos(a),theme==='ice'?0x91d9ec:theme==='desert'?0x7c5a2b:0x1c7b46,.65+Math.random()*.3);}
 // Arcade dressing: luminous gates, banners and spectator blocks make every lap feel inhabited.
 for(let i=0;i<(q==='low'?6:12);i++){const a=i/(q==='low'?6:12)*Math.PI*2,x=(rx+13)*Math.sin(a),z=(rz+10)*Math.cos(a);addLamp(worldGroup,x,z,i%2?t.colors[1]:0x00eaff);}
 for(let i=0;i<(q==='low'?4:8);i++){const a=(i+.5)/(q==='low'?4:8)*Math.PI*2,x=(rx+19)*Math.sin(a),z=(rz+15)*Math.cos(a);const stand=addBox(worldGroup,x,2.1,z,7,4,3,i%2?0x17234a:0x2c164b);stand.rotation.y=-a;for(let r=0;r<3;r++)for(let c=0;c<5;c++){const dot=new THREE.Mesh(new THREE.SphereGeometry(.11,6,4),new THREE.MeshBasicMaterial({color:[0xffd84a,0x38d9ff,0xff5fb4,0x7cff58][(r+c+i)%4]}));dot.position.set(x+(c-2)*.55,2.3+r*.55,z);worldGroup.add(dot);}}
}
function safeCosmeticColor(value,fallback){return typeof value==='string'&&/^#[0-9a-f]{6}$/i.test(value)?parseInt(value.slice(1),16):fallback;}
function buildVehicle(c,equipped=[]){
 const q=effectiveQuality(),g=new THREE.Group();
 const cosmetics=Array.isArray(equipped)?equipped.slice(0,8):[],findType=type=>cosmetics.find(x=>x?.type===type),kart=findType('kart'),trail=findType('trail'),crown=findType('crown'),aura=findType('aura'),back=findType('back');
 const body=addBox(g,0,.62,0,2.8,.55,3.55,c.color,.05);body.scale.set(1,.92,1);body.castShadow=true;
 if(kart)body.material.color.setHex(safeCosmeticColor(kart.data?.accent,c.color));
 const nose=new THREE.Mesh(new THREE.SphereGeometry(1,24,16),mat(0x111827,.32,.5));nose.scale.set(1.3,.32,.95);nose.position.set(0,.55,-1.65);nose.castShadow=true;g.add(nose);
 const sideA=addBox(g,-1.45,.62,0,.22,.48,2.45,0x101725,.5),sideB=addBox(g,1.45,.62,0,.22,.48,2.45,0x101725,.5);sideA.castShadow=sideB.castShadow=true;
 const cockpit=new THREE.Mesh(new THREE.SphereGeometry(.82,24,16),mat(0x07101d,.08,.7));cockpit.scale.set(.82,.55,.95);cockpit.position.set(0,1.12,.18);cockpit.castShadow=true;g.add(cockpit);
 const head=new THREE.Mesh(new THREE.SphereGeometry(.52,24,16),mat(0xd6b38b,.8,0));head.position.set(0,1.67,.18);head.castShadow=true;g.add(head);
 const helmet=new THREE.Mesh(new THREE.SphereGeometry(.57,24,16),mat(c.color,.24,.4));helmet.scale.y=.68;helmet.position.set(0,1.86,.18);helmet.castShadow=true;g.add(helmet);
 const visor=new THREE.Mesh(new THREE.SphereGeometry(.35,16,10),new THREE.MeshStandardMaterial({color:0x06101c,metalness:.85,roughness:.06,emissive:new THREE.Color(c.color),emissiveIntensity:.22}));visor.scale.set(1.38,.6,.18);visor.position.set(0,1.86,-.29);g.add(visor);
 const spoiler=addBox(g,0,1.25,1.55,3.0,.16,.35,0x101827,.2);spoiler.castShadow=true;addBox(g,0,.98,1.48,.18,.68,.18,0x20293a);
 const wheels=[];for(const x of [-1.52,1.52])for(const z of [-1.15,1.15]){const w=new THREE.Mesh(new THREE.CylinderGeometry(.5,.5,.45,24),mat(0x0b1018,.94,0));w.rotation.z=Math.PI/2;w.position.set(x,.43,z);w.castShadow=true;g.add(w);wheels.push(w);const hub=new THREE.Mesh(new THREE.CylinderGeometry(.18,.18,.46,16),mat(0xb7c2d5,.25,.72));hub.rotation.z=Math.PI/2;hub.position.set(x,.43,z);g.add(hub);}
 for(const x of [-.72,.72]){const light=new THREE.Mesh(new THREE.SphereGeometry(.16,12,8),new THREE.MeshBasicMaterial({color:0xffffff}));light.position.set(x,.82,-1.92);g.add(light);}
 const trailColor=safeCosmeticColor(trail?.data?.color,c.color),exhaust=[];for(const x of [-.62,.62]){const flame=new THREE.Mesh(new THREE.ConeGeometry(.2,.95,10),new THREE.MeshBasicMaterial({color:trailColor,transparent:true,opacity:.9}));flame.rotation.x=-Math.PI/2;flame.position.set(x,.5,2.05);flame.visible=false;g.add(flame);exhaust.push(flame);}
 if(crown){const crownColor=safeCosmeticColor(crown.data?.color||crown.data?.glow,0xffd45f),ring=new THREE.Mesh(new THREE.TorusGeometry(.48,.09,8,20),new THREE.MeshStandardMaterial({color:crownColor,emissive:crownColor,emissiveIntensity:.7,metalness:.65,roughness:.24}));ring.rotation.x=Math.PI/2;ring.position.y=2.52;g.add(ring);for(let i=0;i<5;i++){const spike=new THREE.Mesh(new THREE.ConeGeometry(.09,.42,6),ring.material);const a=i/5*Math.PI*2;spike.position.set(Math.sin(a)*.4,2.75,Math.cos(a)*.4);g.add(spike);}}
 if(aura){const auraColor=safeCosmeticColor(aura.data?.color,0x8b5cff),halo=new THREE.Mesh(new THREE.TorusGeometry(1.82,.055,8,36),new THREE.MeshBasicMaterial({color:auraColor,transparent:true,opacity:.72}));halo.rotation.x=Math.PI/2;halo.position.y=.28;g.add(halo);}
 if(back){const wingColor=safeCosmeticColor(back.data?.color,0xffd45f);for(const side of [-1,1]){const wing=addBox(g,side*1.25,1.25,1.05,1.15,.12,.72,wingColor,.75);wing.rotation.z=side*.42;wing.rotation.y=side*.18;}}
 const glowColor=aura?safeCosmeticColor(aura.data?.color,c.color):trailColor,glow=new THREE.PointLight(glowColor,q==='low'?0:1.2,8);glow.position.y=.6;g.add(glow);
 g.scale.setScalar(1.12);g.userData={character:c.id,exhaust,wheels,baseScale:1.12};return g;
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
    console.error('NEON PATH 3D world detail failed; using emergency track:',err); reportBug(err,{source:"world-build"});
    try{buildEmergencyTrack(t);return false;}catch(fatal){console.error('NEON PATH emergency track failed:',fatal);return false;}
  }
}

async function startGame(id,{watchdog=false}={}){
 if(raceStarting && !watchdog)return;
 raceStarting=true;
 try{
  disarmRaceStartWatchdog();
  if(loadingTimer){clearInterval(loadingTimer);loadingTimer=null;}
  gameRunning=false;playerMeshes.clear();trackDef=TRACKS.find(t=>t.id===id)||TRACKS[0];adaptiveReduced=false;frameBudgetStarted=performance.now();frameBudgetCount=0;
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
 $('loadFill').style.width='100%';$('loadingPercent').textContent='100%';document.querySelector('.loading-shell')?.classList.remove('slow');$('loadingVideo')?.pause();
 show('game');startAudio();
  lastRaceStart=Date.now();
  lastFrameTime=performance.now();
  gameRunning=true;
  animate();
  raceStarting=false;
 }catch(err){
  console.error('NEON PATH race boot failed',err); reportBug(err,{source:"race-boot"}); showBugRecovery("PISTA RECUPERADA", "O motor 3D encontrou um erro. O modo seguro está sendo ativado.");
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
    show('game');lastRaceStart=Date.now();lastFrameTime=performance.now();gameRunning=true;raceStarting=false;animate();
  }catch(fatal){
    console.error('NEON PATH fatal race boot:',fatal); reportBug(fatal,{source:"race-boot-fatal"}); showBugRecovery("MODO SEGURO", "O motor 3D não iniciou normalmente. O erro foi enviado ao CEO.");
    $('loadingSub').textContent='NÃO FOI POSSÍVEL INICIAR O MOTOR 3D. ATUALIZE A PÁGINA.';
    gameRunning=false;
    raceStarting=false;
  }
 }}
function updateCars(s,dt=.016){
 const raceScore=p=>(Number(p.lap||1)-1)+Number(p.progress||0)+(p.finish?100-p.finish:0);
 const sorted=[...s.players].sort((a,b)=>raceScore(b)-raceScore(a));
 $('score').innerHTML=sorted.map((p,i)=>{const c=CHARACTERS.find(x=>x.id===p.characterId)||CHARACTERS[i%CHARACTERS.length];return `<div class="race-player" style="--c:${p.color}"><span class="race-rank">${i+1}</span><img src="${c.portrait}" alt=""><b>${escapeHtml(p.nickname)}</b></div>`}).join('');
 for(const p of s.players){
  let o=playerMeshes.get(p.id);
  if(!o){const c=CHARACTERS.find(x=>x.id===p.characterId)||CHARACTERS[(p.id?.length||0)%CHARACTERS.length];o=buildVehicle(c,p.cosmetics);o.position.set(p.x,.22,p.y);scene.add(o);playerMeshes.set(p.id,o)}
  const target=new THREE.Vector3(p.x,.22,p.y);o.position.lerp(target,1-Math.exp(-dt*10));o.rotation.y=THREE.MathUtils.lerp(o.rotation.y,p.a,1-Math.exp(-dt*12));o.rotation.z=THREE.MathUtils.lerp(o.rotation.z,-(p.lane||0)*0.035,1-Math.exp(-dt*8));const boost=p.boost>0;o.scale.setScalar(boost?1.075:1);
  const speedAbs=Math.abs(p.speed||0);o.userData.wheels?.forEach(w=>w.rotation.x-=dt*speedAbs*2.8);
  o.position.y=.22+Math.sin(performance.now()/85+(p.progress||0)*20)*Math.min(.035,speedAbs*.002);
  o.rotation.x=THREE.MathUtils.lerp(o.rotation.x,boost?-.035:0,1-Math.exp(-dt*8));
  if(o.userData.exhaust)o.userData.exhaust.forEach(f=>f.visible=boost);
 }
 for(const [id,o] of playerMeshes)if(!s.players.some(p=>p.id===id)){scene.remove(o);playerMeshes.delete(id)}
 const me=s.players.find(p=>p.id===socket.id)||s.players.find(p=>p.nickname===currentUser)||s.players[0];
 if(me){
  const speedNorm=Math.min(1,Math.abs(me.speed||0)/18);camera.fov=THREE.MathUtils.lerp(camera.fov,64+speedNorm*8,1-Math.exp(-dt*4));camera.updateProjectionMatrix();
  const behind=9.2+speedNorm*1.8,ahead=12+speedNorm*4;
  const shake=me.boost>0&&effectiveQuality()!=="low"?Math.sin(performance.now()*.055)*.055:0;
  cameraTarget.set(me.x-Math.sin(me.a)*behind+shake,3.65+Math.abs(shake)*.35,me.y-Math.cos(me.a)*behind);camera.position.lerp(cameraTarget,Math.min(1,0.18));
  cameraLook.set(me.x+Math.sin(me.a)*ahead,1.25,me.y+Math.cos(me.a)*ahead);camera.lookAt(cameraLook);
  $('bar').style.width=me.energy+'%';$('speed').textContent=String(Math.round(me.speed*12)).padStart(3,'0');$('lap').textContent=`VOLTA ${Math.min(me.lap,3)}/3`;
  $('racePosition').textContent=String(Math.max(1,sorted.findIndex(p=>p.id===me.id)+1));$('raceProgress').style.width=Math.min(100,((Math.max(1,me.lap)-1+me.progress)/3)*100)+'%';$('speedLines').style.setProperty('--speed-opacity',String(Math.max(0,(speedNorm-.68)*1.8)));
  $('driftStatus').textContent=me.driftLevel>=2?'SUPER DRIFT PRONTO':me.driftLevel>=1?'DRIFT CARREGANDO':'SHIFT / ESPAÇO';
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
  frameBudgetCount++;if(quality==="auto"&&!adaptiveReduced&&now-frameBudgetStarted>4500){const fps=frameBudgetCount/((now-frameBudgetStarted)/1000);if(fps<29&&renderer){adaptiveReduced=true;renderer.setPixelRatio(Math.min(.82,devicePixelRatio||1));document.documentElement.classList.add('quality-low');toast('Desempenho ajustado automaticamente');}else{frameBudgetStarted=now;frameBudgetCount=0;}}
 }catch(err){
  console.error('NEON PATH render loop recovered:',err); handleClientFault(err,"render-loop");
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
  console.error('NEON PATH render recovery failed:',err); reportBug(err,{source:"render-recovery"}); showBugRecovery("RECUPERAÇÃO FALHOU", "A corrida foi encerrada com segurança e o erro foi enviado ao CEO.");
  gameRunning=false;
  show('menu');
  message('Não foi possível iniciar o motor 3D. Tente novamente.');
 }
}
function resize(){if(!renderer||!camera)return;camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight,false);}
function emitSteer(type){if(socket.connected)socket.emit('input',{type});}
addEventListener('keydown',e=>{if(e.repeat)return;if(e.key==='Escape'&&gameRunning){$('pausePanel').classList.remove('hidden');return;}if(e.key==='ArrowLeft'||e.key.toLowerCase()==='a'){keys.left=true;emitSteer('left')}if(e.key==='ArrowRight'||e.key.toLowerCase()==='d'){keys.right=true;emitSteer('right')}if(e.key.toLowerCase()==='w'||e.key==='ArrowUp')socket.connected&&socket.emit('input',{type:'throttle',active:true});if(e.key.toLowerCase()==='s'||e.key==='ArrowDown')socket.connected&&socket.emit('input',{type:'brake',active:true});if(e.code==='Space'||e.key.toLowerCase()==='shift'){if(socket.connected){socket.emit('input',{type:'turbo'});playSfx('turbo');}}
 if(e.key.toLowerCase()==='x'){if(socket.connected)socket.emit('input',{type:'drift',active:true});}});
addEventListener('keyup',e=>{if(e.key==='ArrowLeft'||e.key.toLowerCase()==='a')keys.left=false;if(e.key==='ArrowRight'||e.key.toLowerCase()==='d')keys.right=false;if((e.key.toLowerCase()==='w'||e.key==='ArrowUp')&&socket.connected)socket.emit('input',{type:'throttle',active:false});if((e.key.toLowerCase()==='s'||e.key==='ArrowDown')&&socket.connected)socket.emit('input',{type:'brake',active:false});if(e.key.toLowerCase()==='x'&&socket.connected)socket.emit('input',{type:'drift',active:false});if(!keys.left&&!keys.right)emitSteer('neutral');});
function bindHold(id,type){const b=$(id);if(!b)return;const stop=e=>{e?.preventDefault?.();b.releasePointerCapture?.(e.pointerId);clearInterval(b.__hold);emitSteer('neutral');};b.onpointerdown=e=>{e.preventDefault();b.setPointerCapture?.(e.pointerId);emitSteer(type);clearInterval(b.__hold);b.__hold=setInterval(()=>emitSteer(type),90);};b.onpointerup=stop;b.onpointercancel=stop;b.onpointerleave=e=>{if(e.buttons===0)stop(e);};}
function bindDrift(id){const b=$(id);if(!b)return;const stop=e=>{e?.preventDefault?.();b.releasePointerCapture?.(e.pointerId);clearInterval(b.__hold);socket.connected&&socket.emit('input',{type:'drift',active:false});b.classList.remove('held');};b.onpointerdown=e=>{e.preventDefault();b.setPointerCapture?.(e.pointerId);b.classList.add('held');socket.connected&&socket.emit('input',{type:'drift',active:true});};b.onpointerup=stop;b.onpointercancel=stop;b.onpointerleave=e=>{if(e.buttons===0)stop(e);};}
function bindActionHold(id,type){const b=$(id);if(!b)return;const stop=e=>{e?.preventDefault?.();b.releasePointerCapture?.(e.pointerId);socket.connected&&socket.emit('input',{type,active:false});b.classList.remove('held');};b.onpointerdown=e=>{e.preventDefault();b.setPointerCapture?.(e.pointerId);b.classList.add('held');socket.connected&&socket.emit('input',{type,active:true});};b.onpointerup=stop;b.onpointercancel=stop;b.onpointerleave=e=>{if(e.buttons===0)stop(e);};}
bindHold('touchLeft','left');bindHold('touchRight','right');bindDrift('touchDrift');
const useTurbo=()=>{if(socket.connected){socket.emit('input',{type:'turbo'});playSfx('turbo');}};
$('turbo').onclick=useTurbo;$('sab').onclick=()=>socket.connected&&$('sab').classList.contains('item-ready')&&socket.emit('input',{type:'sabotage'});
$('touchTurbo').onclick=useTurbo;$('touchItem').onclick=()=>socket.connected&&$('touchItem').classList.contains('item-ready')&&socket.emit('input',{type:'sabotage'});
bindActionHold('touchAccelerate','throttle');bindActionHold('touchBrake','brake');
function exitRace(){gameRunning=false;releaseFullscreen();try{socket.emit("room:leave");}catch{}playerMeshes.clear();if(scene){scene.traverse(o=>{if(o.geometry)o.geometry.dispose?.();if(o.material){const ms=Array.isArray(o.material)?o.material:[o.material];ms.forEach(m=>{m.map?.dispose?.();m.dispose?.();});}});}show("menu");message("Você saiu da corrida.");}
$("raceExit").onclick=()=>$("pausePanel").classList.remove("hidden");$("racePause").onclick=()=>$("pausePanel").classList.remove("hidden");$("resumeRace").onclick=()=>$("pausePanel").classList.add("hidden");$("pauseExit").onclick=()=>{$("pausePanel").classList.add("hidden");exitRace();};$("raceAudio").onclick=toggleAudio;
$("pauseSettings").onclick=()=>{$("pausePanel").classList.add("hidden");openSettings();};
document.addEventListener('visibilitychange',()=>{if(document.hidden&&gameRunning){emitSteer('neutral');socket.connected&&socket.emit('input',{type:'throttle',active:false});}});
function showFinish(results=[],track,rewards={},profile){
 gameRunning=false;$("loadingVideo")?.pause();playSfx("finish");show("finish");
 const top=results.slice(0,3);
 $("podium").innerHTML=top.map((p,i)=>{const c=CHARACTERS.find(x=>x.id===Number(p.characterId))||CHARACTERS[i%CHARACTERS.length];return `<div class="pod ${i===0?"first":i===1?"second":"third"}"><div class="avatar"><img src="${c.portrait}" alt="${c.name}" style="width:100%;height:100%;object-fit:cover;border-radius:50%"></div><b>${p.position||i+1}º · ${escapeHtml(p.nickname)}</b><small>${i===0?"VITÓRIA":i===1?"VICE-CAMPEÃO":"PÓDIO"}</small></div>`}).join("");
 const xp=Math.max(0,Number(rewards?.xp)||0),coins=Math.max(0,Number(rewards?.coins)||0),ph=Number(rewards?.ph)||0,prestigeUp=!!rewards?.prestigeUp;
 $("rewards").innerHTML=`<div class="reward">◉ +${formatNumber(coins)} MOEDAS</div><div class="reward">XP +${formatNumber(xp)}</div><div class="reward">${ph>=0?"+":""}${ph} PH</div>${Number(rewards?.dailyBonus)>0?'<div class="reward">MISSÃO DIÁRIA +450 ◉</div>':""}${Number(rewards?.prestigeCoinBonus)>0?'<div class="reward">COFRE VANGUARDA +1.500 ◉</div>':""}${prestigeUp?'<div class="reward">NOVO PRESTÍGIO · ITEM DESBLOQUEADO!</div>':""}`;
 if(profile)applyProfile(profile);else if(authToken)setTimeout(()=>api("/api/profile").then(applyProfile).catch(()=>{}),400);
}
$("nextRace").onclick=()=>{show("menu");message("Recompensas salvas. Pronto para outra corrida.")};
$("raceAgain").onclick=()=>{show("menu");openModes()};

function modal(title,html,kicker="NEON PATH"){const box=$("modalContent");box.innerHTML=`<span class="eyebrow">${escapeHtml(kicker)}</span><h2>${escapeHtml(title)}</h2>${html}`;$("overlayPanel").classList.remove("hidden")}
$("modalClose").onclick=()=>$("overlayPanel").classList.add("hidden");
function openSettings(){
 modal("AJUSTES",`<div class="settings-grid">
  <div class="setting"><b>QUALIDADE GRÁFICA</b><p>O modo AUTO reduz resolução quando o FPS cai.</p><button data-q="low" class="${quality==='low'?'active':''}">BAIXA</button><button data-q="medium" class="${quality==='medium'?'active':''}">MÉDIA</button><button data-q="high" class="${quality==='high'?'active':''}">ALTA</button><button data-q="auto" class="${quality==='auto'?'active':''}">AUTO</button></div>
  <div class="setting"><b>TRILHA ORIGINAL</b><p>Velocity Protocol · tema adaptado para loop.</p><button data-audio="toggle" class="${audioEnabled?'active':''}">${audioEnabled?'ÁUDIO LIGADO':'ÁUDIO DESLIGADO'}</button><label for="musicVolume">VOLUME</label><input id="musicVolume" type="range" min="0" max="1" step="0.05" value="${musicVolume}"></div>
  <div class="setting"><b>CONTROLES</b><p>PC: W/A/S/D ou setas. Turbo: SHIFT/ESPAÇO. Drift: X.</p><p>Celular: direção, drift, freio, acelerar, turbo e item na tela.</p></div>
  <div class="setting"><b>RECURSOS</b><p>Pacote atual: <strong>${selectedResourcePack.toUpperCase()}</strong>. Você pode trocar o pacote apagando os dados do site no navegador.</p><button data-action="fullscreen">TESTAR TELA CHEIA</button></div>
 </div>`,"SISTEMA");
}
$("configBtn").onclick=openSettings;

const itemGlyph=type=>({crown:"♛",trail:"⌁",aura:"◉",effect:"✦",back:"◇",kart:"⬢",map:"▦"}[type]||"◆");
async function openShop(){
 modal("LOJA NEON",'<p class="modal-muted">Carregando catálogo seguro...</p>',"ECONOMIA");
 try{
  const [items,inventory,profile]=await Promise.all([api("/api/shop"),api("/api/inventory"),api("/api/profile")]);applyProfile(profile);const owned=new Set(inventory.map(x=>x.code));
  const cards=items.map(it=>`<article class="shop-item" data-rarity="${escapeHtml(it.rarity)}"><div class="item-icon">${itemGlyph(it.type)}</div><span class="rarity">${escapeHtml(it.rarity)}</span><h3>${escapeHtml(it.name)}</h3><p>${escapeHtml(it.description||it.type)}</p><footer><b>◉ ${formatNumber(it.price)}</b>${owned.has(it.code)?'<button disabled>ADQUIRIDO</button>':`<button data-buy="${escapeHtml(it.code)}">COMPRAR</button>`}</footer></article>`).join("");
  modal("LOJA NEON",`<div class="shop-head"><p class="modal-muted">Cosméticos não alteram a física da corrida.</p><div class="wallet">◉ ${formatNumber(profile.bruto_coins)}</div></div><div class="shop-grid">${cards||'<p>Catálogo vazio.</p>'}</div>`,"ECONOMIA");
 }catch(e){modal("LOJA INDISPONÍVEL",`<p class="modal-muted">A conexão com a economia não respondeu: ${escapeHtml(e.message)}</p>`,"RECUPERAÇÃO");}
}
async function openInventory(){
 modal("INVENTÁRIO",'<p class="modal-muted">Sincronizando seus itens...</p>',"GARAGEM");
 try{const items=await api("/api/inventory");const cards=items.map(it=>`<article class="inventory-item" data-rarity="${escapeHtml(it.rarity)}"><div class="item-icon">${itemGlyph(it.type)}</div><span class="rarity">${escapeHtml(it.rarity)}</span><h3>${escapeHtml(it.name)}</h3><p>${escapeHtml(it.type)}</p><footer><span>${it.equipped?'EQUIPADO':'DISPONÍVEL'}</span><button data-equip="${escapeHtml(it.code)}" ${it.equipped?'disabled':''}>${it.equipped?'ATIVO':'EQUIPAR'}</button></footer></article>`).join("");modal("INVENTÁRIO",`<div class="inventory-grid">${cards||'<p class="modal-muted">Seu inventário ainda está vazio.</p>'}</div>`,"GARAGEM");}catch(e){modal("INVENTÁRIO",`<p class="modal-muted">Não foi possível carregar: ${escapeHtml(e.message)}</p>`,"RECUPERAÇÃO");}
}
async function openRanking(){
 modal("RANK MUNDIAL",'<p class="modal-muted">Calculando os maiores pilotos...</p>',"TEMPORADA 01");
 try{const rows=await api("/api/rank");const html=rows.map((x,i)=>`<div class="rank-row ${i<3?'top':''}"><span class="rank-pos">${i+1}</span><span class="rank-avatar">${escapeHtml(String(x.nickname||'NP').slice(0,2).toUpperCase())}</span><span class="rank-driver"><b>${escapeHtml(x.nickname)}</b><small>${formatNumber(x.wins)} vitórias · ${formatNumber(x.races)} corridas</small></span><span class="rank-prestige">P${Math.min(5,Number(x.prestige)||0)} · LV ${Number(x.level)||1}</span><span class="rank-score">${formatNumber(x.ph)} PH</span></div>`).join("");modal("RANK MUNDIAL",`<div class="rank-head"><p class="modal-muted">Top 50 por Pontos de Honra, com Prestígio como desempate.</p></div><div class="rank-list">${html||'<p>Ranking vazio.</p>'}</div>`,"TEMPORADA 01");}catch(e){modal("RANK MUNDIAL",`<p class="modal-muted">Ranking temporariamente indisponível: ${escapeHtml(e.message)}</p>`,"RECUPERAÇÃO");}
}
function openPrestige(){
 const xp=Math.max(0,Number(currentProfile?.lifetime_xp)||0),level=Math.max(0,Math.min(5,Number(currentProfile?.prestige)||prestigeTierFor(xp).level)),tier=PRESTIGE_TIERS[level];
 const road=PRESTIGE_TIERS.slice(1).map(t=>`<div class="prestige-tier ${level>=t.level?'unlocked':''} ${level===t.level?'current':''}"><i>${t.level}</i><div><b>${t.name}</b><small>${escapeHtml(t.reward)}</small></div><span>${level>=t.level?'CONQUISTADO':formatNumber(t.xp)+' XP'}</span></div>`).join("");
 modal("CAMINHO DO PRESTÍGIO",`<div class="prestige-modal"><div class="prestige-hero"><img src="prestige-emblem.webp" alt="Emblema"><b>${tier.name}</b><small>${formatNumber(xp)} XP TOTAL</small></div><div class="prestige-road">${road}</div></div>`,"PROGRESSÃO");
}
function logout(showMessage=true){gameRunning=false;authToken='';currentProfile=null;localStorage.removeItem('neon_token');socket.auth={token:''};socket.disconnect();$("overlayPanel").classList.add("hidden");$("app").hidden=true;$("authPanel").hidden=false;setAuthMode('login');if(showMessage)$("authMsg").textContent="Sessão encerrada com segurança.";}
function openProfile(){const p=currentProfile||{};modal("PERFIL DO PILOTO",`<div class="settings-grid"><div class="setting"><b>${escapeHtml(currentUser)}</b><p>Nível ${Number(p.level)||1} · Prestígio ${Number(p.prestige)||0}</p><p>${formatNumber(p.total_wins||p.wins)} vitórias em ${formatNumber(p.total_races||p.races)} corridas.</p></div><div class="setting"><b>ECONOMIA</b><p>◉ ${formatNumber(p.bruto_coins)} moedas</p><p>${formatNumber(p.lifetime_xp||p.xp)} XP total conquistado.</p><button data-action="logout">SAIR DA CONTA</button></div></div>`,"CARTEIRA DE PILOTO")}
$("shopBtn").onclick=openShop;$("inventoryBtn").onclick=openInventory;$("rank").onclick=openRanking;$("prestigeBtn").onclick=openPrestige;$("profileBtn").onclick=openProfile;

$("modalContent").addEventListener("click",async e=>{
 const q=e.target.dataset.q;if(q){quality=q;localStorage.setItem("neon_quality",q);applyQualityClass();openSettings();toast("Qualidade salva: "+q.toUpperCase());return;}
 if(e.target.dataset.audio){toggleAudio();openSettings();return;}
 if(e.target.dataset.action==="fullscreen"){requestFullscreenLandscape();return;}
 if(e.target.dataset.action==="logout"){logout();return;}
 const buy=e.target.dataset.buy;if(buy){e.target.disabled=true;e.target.textContent="COMPRANDO...";try{const result=await api("/api/shop/buy",{method:"POST",body:JSON.stringify({code:buy})});if(result.profile)applyProfile(result.profile);playSfx("finish");toast("Item adquirido");openShop();}catch(err){e.target.disabled=false;e.target.textContent="TENTAR NOVAMENTE";toast(err.message);}return;}
 const equip=e.target.dataset.equip;if(equip){e.target.disabled=true;try{await api("/api/inventory/equip",{method:"POST",body:JSON.stringify({code:equip})});toast("Item equipado");openInventory();}catch(err){toast(err.message);e.target.disabled=false;}return;}
});
$("modalContent").addEventListener("input",e=>{if(e.target.id==="musicVolume"){musicVolume=Number(e.target.value);localStorage.setItem("neon_music_volume",String(musicVolume));syncAudio();}});


// ===== CINEMATIC / QA DEMO MODE =====
// Only enabled explicitly with ?demo=1. It never affects normal players.
if(new URLSearchParams(location.search).get('demo')==='1'){
  addEventListener('load',async()=>{
    try{
      document.getElementById('termsGate')?.remove();document.getElementById('authPanel')?.remove();
      document.getElementById('app').hidden=false;currentUser='CeoVelho';selectedTrack=new URLSearchParams(location.search).get('track')||'pirate-bay';
      const demoPlayers=CHARACTERS.map((c,i)=>({id:i===0?'demo-me':'demo-'+i,nickname:i===0?'CeoVelho':c.name,characterId:c.id,color:c.color,progress:(.03-i*.006+1)%1,lap:1,speed:13+i*.25,a:0,x:0,y:0,energy:92,boost:i===0?1:0,itemReady:i===0}));
      lastState={track:selectedTrack,players:demoPlayers};
      await startGame(selectedTrack);lastRaceStart=Date.now()-73000;
      const rx=48,rz=28;let t=.08;
      const tick=()=>{if(!gameRunning)return;t=(t+.00075)%1;demoPlayers.forEach((p,i)=>{const u=(t-i*.012+1)%1,a=u*Math.PI*2;p.progress=u;p.lap=2;p.speed=14+Math.sin(performance.now()/500+i)*1.6;p.x=rx*Math.sin(a);p.y=rz*Math.cos(a);const dx=rx*Math.cos(a),dz=-rz*Math.sin(a);p.a=Math.atan2(dx,dz);p.boost=i===0&&Math.sin(performance.now()/650)>0.35?1:0;});lastState={track:selectedTrack,players:demoPlayers};requestAnimationFrame(tick)};tick();
    }catch(e){console.error(e)}
  },{once:true});
}
