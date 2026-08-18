import * as THREE from "three";
const $=id=>document.getElementById(id), socket=io();
let quality="auto",room="",me="",scene,camera,renderer,world=[],trailMeshes=new Map(),lastState=null,last=performance.now(),keys={};
$("quality").onclick=()=>{quality=quality==="auto"?"low":quality==="low"?"medium":quality==="medium"?"high":"auto";$("quality").textContent="QUALIDADE: "+quality.toUpperCase();if(renderer)applyQuality()};
function nick(){return $("nick").value.trim()||"Piloto"}
function msg(x){$("msg").textContent=x}
$("create").onclick=()=>{me=nick();socket.emit("room:create",{nickname:me,ceo:false})};
$("join").onclick=()=>{me=nick();socket.emit("room:join",{nickname:me,code:$("room").value.trim().toUpperCase()})};
$("rank").onclick=async()=>{try{const r=await fetch("/api/rank");const a=await r.json();msg(a.length?a.map((x,i)=>`${i+1}. ${x.nickname} — ${x.ph} PH`).join(" • "):"Ranking vazio")}catch{msg("Ranking indisponível")}};
$("start").onclick=()=>socket.emit("room:start");$("back").onclick=()=>location.reload();
socket.on("connect",()=>msg("ONLINE"));
socket.on("error:game",x=>msg(x));
socket.on("room",x=>{room=x.code;$("menu").classList.add("hidden");$("lobby").classList.remove("hidden");$("roomCode").textContent=room;if(x.ceo){$("start").classList.remove("hidden")}});
socket.on("state",s=>{lastState=s;renderLobby(s)});
socket.on("start",()=>{ $("lobby").classList.add("hidden");$("game").classList.remove("hidden");init3D()});
socket.on("hit",x=>{});
function renderLobby(s){$("players").innerHTML=s.players.map(p=>`<div class="p" style="--c:${p.color}"><span>${escapeHtml(p.nickname)}</span><b>${p.alive?"READY":"OUT"}</b></div>`).join("")}
function escapeHtml(x){return String(x).replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[m]))}
function init3D(){
 scene=new THREE.Scene();scene.background=new THREE.Color(0x02040b);scene.fog=new THREE.FogExp2(0x02040b,.018);
 camera=new THREE.PerspectiveCamera(55,innerWidth/innerHeight,.1,400);camera.position.set(0,34,30);camera.lookAt(0,0,0);
 renderer=new THREE.WebGLRenderer({canvas:$("scene"),antialias:quality!=="low",powerPreference:"high-performance"});renderer.setPixelRatio(Math.min(devicePixelRatio,quality==="high"?1.75:quality==="medium"?1.35:1));renderer.setSize(innerWidth,innerHeight);applyQuality();
 const amb=new THREE.HemisphereLight(0x5c7cff,0x050509,2);scene.add(amb);
 const floorMat=new THREE.MeshStandardMaterial({color:0x070b15,roughness:.82,metalness:.25}); const floor=new THREE.Mesh(new THREE.PlaneGeometry(120,80),floorMat);floor.rotation.x=-Math.PI/2;scene.add(floor);
 const grid=new THREE.GridHelper(120,30,0x073cff,0x10203a);grid.position.y=.02;scene.add(grid); applyEnvironmentTexture();
 for(let x=-50;x<=50;x+=10) billboard(x,-8,0x102c6e); for(let x=-50;x<=50;x+=10) billboard(x,8,0x3c0b55);
 const wallMat=new THREE.MeshStandardMaterial({color:0x081b30,emissive:0x001d44,emissiveIntensity:2});
 for(const [x,z,sx,sz] of [[0,-39,120,1],[0,39,120,1],[-59,0,1,80],[59,0,1,80]]){const m=new THREE.Mesh(new THREE.BoxGeometry(sx,2,sz),wallMat);m.position.set(x,1,z);scene.add(m)}
 addStars(); window.addEventListener("resize",resize);animate();
}

async function applyEnvironmentTexture(){try{const m=await fetch("/assets-manifest.json").then(r=>r.json());const q=quality==="high"?10:quality==="medium"?4:2;const file=m.environment_textures[Math.floor(Math.random()*q)];const tex=await new THREE.TextureLoader().loadAsync("/"+file);tex.wrapS=tex.wrapT=THREE.RepeatWrapping;tex.repeat.set(3,2);floorMat.map=tex;floorMat.needsUpdate=true;}catch(e){}}
function billboard(x,z,c){const g=new THREE.PlaneGeometry(9,4);const m=new THREE.MeshBasicMaterial({color:c,transparent:true,opacity:.55,side:THREE.DoubleSide});const o=new THREE.Mesh(g,m);o.position.set(x,2,z);o.lookAt(camera.position);scene.add(o)}
function addStars(){const n=quality==="low"?180:quality==="medium"?350:600;const geo=new THREE.BufferGeometry(),a=new Float32Array(n*3);for(let i=0;i<n;i++){a[i*3]=(Math.random()-.5)*180;a[i*3+1]=10+Math.random()*50;a[i*3+2]=(Math.random()-.5)*180}geo.setAttribute("position",new THREE.BufferAttribute(a,3));scene.add(new THREE.Points(geo,new THREE.PointsMaterial({color:0x49bfff,size:.18,sizeAttenuation:true})))}
function vehicle(p){const g=new THREE.Group();const body=new THREE.Mesh(new THREE.BoxGeometry(2.1,.55,3.7),new THREE.MeshStandardMaterial({color:p.color,emissive:new THREE.Color(p.color),emissiveIntensity:1.8,metalness:.7,roughness:.2}));body.position.y=.65;g.add(body);const glow=new THREE.Mesh(new THREE.BoxGeometry(1.5,.1,2.8),new THREE.MeshBasicMaterial({color:p.color,transparent:true,opacity:.55}));glow.position.y=.95;g.add(glow);scene.add(g);return g}
function updateObjects(s){const alive=s.players.filter(p=>p.alive);$("score").innerHTML=s.players.map(p=>`<div style="color:${p.color}">● ${escapeHtml(p.nickname)} ${p.alive?"":"✕"}</div>`).join("");for(const p of s.players){let o=trailMeshes.get(p.id);if(!o){o=vehicle(p);trailMeshes.set(p.id,o)}o.position.set(p.x-60,.0,p.y-40);o.rotation.y=-p.a+Math.PI/2}}
function animate(t=performance.now()){requestAnimationFrame(animate);if(lastState)updateObjects(lastState);renderer.render(scene,camera);$("bar").style.width=((lastState?.players.find(p=>p.nickname===me)?.energy??100))+"%";drawMap();$("timer").textContent=new Date((Date.now()-(lastState?.started||Date.now()))).toISOString().slice(14,19)}
function drawMap(){const c=$("map"),x=c.getContext("2d");x.clearRect(0,0,c.width,c.height);x.strokeStyle="#14345c";x.strokeRect(5,5,170,100);if(!lastState)return;for(const p of lastState.players){x.fillStyle=p.color;x.beginPath();x.arc(5+p.x/120*170,5+p.y/80*100,3,0,Math.PI*2);x.fill()}}
function applyQuality(){if(!renderer)return;const q=quality==="high"?1.75:quality==="medium"?1.35:quality==="low"?0.8:Math.min(devicePixelRatio,1.35);renderer.setPixelRatio(q)}
function resize(){camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight)}
addEventListener("keydown",e=>{if(e.repeat)return;if(e.key==="ArrowLeft"||e.key.toLowerCase()==="a")socket.emit("input",{type:"left"});if(e.key==="ArrowRight"||e.key.toLowerCase()==="d")socket.emit("input",{type:"right"});if(e.code==="Space")socket.emit("input",{type:"turbo"})});
$("turbo").onclick=()=>socket.emit("input",{type:"turbo"});$("sab").onclick=()=>socket.emit("input",{type:"sabotage"});



// NEON PATH 4.0 — real resources, lazy loaded by quality.
const RESOURCE_BASE="/";
async function preloadResources(level="auto"){
  try{
    const m=await fetch(RESOURCE_BASE+"assets-manifest.json",{cache:"no-store"}).then(r=>r.json());
    const count=level==="low"?2:level==="medium"?4:level==="high"?10:4;
    const files=[...m.environment_textures.slice(0,count),...m.sky_billboards.slice(0,Math.max(1,Math.ceil(count/2)))];
    await Promise.all(files.map(src=>fetch(RESOURCE_BASE+src,{cache:"force-cache"}).catch(()=>null)));
  }catch(e){}
}
preloadResources(quality);
