import * as THREE from 'three';

const $ = id => document.getElementById(id);
const socket = io({ transports:['websocket','polling'], reconnection:true, reconnectionAttempts:8, timeout:8000 });
let authToken = localStorage.getItem('neon_token') || '';
let profile = null;
let quality = localStorage.getItem('neon_quality') || 'auto';
let room = '';
let me = '';
let lastState = null;
let scene, camera, renderer;
const vehicles = new Map();
let floorMat;

function escapeHtml(x){return String(x).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));}
function setMsg(text){$('msg').textContent=text||'';}
function authMsg(text){$('authMsg').textContent=text||'';}
function setAuthMode(mode){
  const login=mode==='login';
  $('loginForm').classList.toggle('hidden',!login);
  $('registerForm').classList.toggle('hidden',login);
  $('showLogin').classList.toggle('active',login);
  $('showRegister').classList.toggle('active',!login);
  authMsg('');
}
async function api(path,opts={}){
  const headers={'Content-Type':'application/json',...(opts.headers||{})};
  if(authToken)headers.Authorization='Bearer '+authToken;
  const r=await fetch(path,{...opts,headers});
  const data=await r.json().catch(()=>({}));
  if(r.status===401){authToken='';localStorage.removeItem('neon_token');}
  if(!r.ok)throw new Error(data.error||'erro_desconhecido');
  return data;
}
async function authenticate(mode,e){
  e?.preventDefault();
  const login=mode==='login';
  const nick=(login?$('authNick').value:$('registerNick').value).trim();
  const password=login?$('authPassword').value:$('registerPassword').value;
  const email=login?'':$('registerEmail').value.trim();
  if(!nick||!password){authMsg('Preencha apelido e senha.');return;}
  authMsg('Conectando ao servidor...');
  try{
    const data=await api(login?'/api/auth/login':'/api/auth/register',{method:'POST',body:JSON.stringify(login?{username:nick,password}:{username:nick,password,email:email||null})});
    authToken=data.token;localStorage.setItem('neon_token',authToken);me=data.nickname||nick;
    await loadProfile();
    $('authPanel').hidden=true;$('app').hidden=false;$('nick').value=me;authMsg('');setMsg('CONEXÃO ESTABELECIDA');
  }catch(err){authMsg(formatError(err.message));}
}
function formatError(code){
  const map={database_unavailable:'Banco de dados indisponível. Tente novamente em alguns segundos.',login_invalido:'Apelido ou senha incorretos.',apelido_ou_email_ja_cadastrado:'Apelido ou e-mail já cadastrado.',apelido_invalido:'Apelido inválido. Use 2–20 caracteres.',senha_invalida:'A senha precisa ter pelo menos 8 caracteres.',email_invalido:'E-mail inválido.',rate_limited:'Muitas tentativas. Aguarde um pouco.',server_awards_only:'XP é concedido pelo servidor após a partida.'};
  return map[code]||code.replaceAll('_',' ');
}
async function loadProfile(){
  if(!authToken)return;
  try{profile=await api('/api/profile');if(profile?.nickname){me=profile.nickname;$('nick').value=me;}}catch{}
}
function logout(){authToken='';profile=null;localStorage.removeItem('neon_token');location.reload();}

$('loginForm').addEventListener('submit',e=>authenticate('login',e));
$('registerForm').addEventListener('submit',e=>authenticate('register',e));
$('toRegister').onclick=()=>setAuthMode('register');
$('toLogin').onclick=()=>setAuthMode('login');
$('showLogin').onclick=()=>setAuthMode('login');
$('showRegister').onclick=()=>setAuthMode('register');
$('logout').onclick=logout;
setAuthMode('login');

$('room').addEventListener('input',()=>{$('room').value=$('room').value.slice(0,15);});
$('quality').onclick=()=>{quality=quality==='auto'?'low':quality==='low'?'medium':quality==='medium'?'high':'auto';localStorage.setItem('neon_quality',quality);updateQualityButton();if(renderer)applyQuality();};
function updateQualityButton(){$('quality').textContent='QUALIDADE: '+quality.toUpperCase();}
updateQualityButton();

function nickname(){return $('nick').value.trim()||me||'Piloto';}
$('create').onclick=()=>{me=nickname();socket.emit('room:create',{nickname:me,ceo:false});};
$('join').onclick=()=>{
  me=nickname();const code=$('room').value.trim();const key=$('roomKey').value;
  if(!code){setMsg('Digite o código da sala.');return;}
  if(code.length>15){setMsg('O código pode ter no máximo 15 caracteres.');return;}
  socket.emit('room:join',{nickname:me,code,key});
};
$('start').onclick=()=>socket.emit('room:start');
$('back').onclick=()=>{socket.disconnect();location.reload();};
$('rank').onclick=async()=>{try{const rows=await api('/api/rank');setMsg(rows.length?rows.slice(0,10).map((r,i)=>`${i+1}. ${r.nickname} — ${r.ph} PH`).join(' • '):'Ranking vazio.'):setMsg('Ranking indisponível.');}};

socket.on('connect',()=>setMsg('SERVIDOR ONLINE'));
socket.on('disconnect',()=>setMsg('Conexão perdida. Tentando reconectar...'));
socket.on('connect_error',()=>setMsg('Não foi possível conectar ao servidor.'));
socket.on('error:game',message=>setMsg(formatError(message)));
socket.on('room',data=>{
  room=data.code;$('menu').classList.add('hidden');$('lobby').classList.remove('hidden');$('roomCode').textContent=room;
  $('start').classList.toggle('hidden',!data.host);
  setMsg('');
});
socket.on('state',state=>{lastState=state;renderLobby(state);if(state.hostId===socket.id)$('start').classList.remove('hidden');});
socket.on('start',()=>{$('lobby').classList.add('hidden');$('game').classList.remove('hidden');init3D();});
socket.on('hit',hit=>{if(hit?.to===me)setMsg(`⚡ ${hit.from} usou sabotagem em você!`);});

function renderLobby(state){
  $('players').innerHTML=state.players.map(p=>`<div class="p" style="--c:${escapeHtml(p.color)}"><span>${escapeHtml(p.nickname)}</span><b>${p.alive?'READY':'OUT'}</b></div>`).join('');
}

function init3D(){
  if(renderer)return;
  scene=new THREE.Scene();scene.background=new THREE.Color(0x02040b);scene.fog=new THREE.FogExp2(0x02040b,.018);
  camera=new THREE.PerspectiveCamera(55,innerWidth/innerHeight,.1,400);camera.position.set(0,34,30);camera.lookAt(0,0,0);
  renderer=new THREE.WebGLRenderer({canvas:$('scene'),antialias:quality!=='low',powerPreference:'high-performance'});
  renderer.setPixelRatio(quality==='high'?Math.min(devicePixelRatio,1.5):quality==='medium'?Math.min(devicePixelRatio,1.2):quality==='low'?1:Math.min(devicePixelRatio,1.25));
  renderer.setSize(innerWidth,innerHeight);
  const amb=new THREE.HemisphereLight(0x5c7cff,0x050509,2);scene.add(amb);
  floorMat=new THREE.MeshStandardMaterial({color:0x070b15,roughness:.82,metalness:.25});
  const floor=new THREE.Mesh(new THREE.PlaneGeometry(120,80),floorMat);floor.rotation.x=-Math.PI/2;scene.add(floor);
  const grid=new THREE.GridHelper(120,30,0x073cff,0x10203a);grid.position.y=.02;scene.add(grid);
  const wallMat=new THREE.MeshStandardMaterial({color:0x081b30,emissive:0x001d44,emissiveIntensity:2});
  for(const [x,z,sx,sz] of [[0,-39,120,1],[0,39,120,1],[-59,0,1,80],[59,0,1,80]]){const m=new THREE.Mesh(new THREE.BoxGeometry(sx,2,sz),wallMat);m.position.set(x,1,z);scene.add(m);}
  addBillboards();addStars();window.addEventListener('resize',resize);animate();
  loadFloorTexture();
}
async function loadFloorTexture(){try{const m=await fetch('/assets-manifest.json').then(r=>r.json());const count=quality==='high'?6:quality==='medium'?3:1;const file=m.environment_textures?.[Math.floor(Math.random()*Math.max(1,count))];if(!file)return;const tex=await new THREE.TextureLoader().loadAsync('/'+file);tex.wrapS=tex.wrapT=THREE.RepeatWrapping;tex.repeat.set(3,2);floorMat.map=tex;floorMat.needsUpdate=true;}catch{}}
function addBillboards(){for(let x=-50;x<=50;x+=10){const g=new THREE.PlaneGeometry(9,4);const m=new THREE.MeshBasicMaterial({color:x%20===0?0x102c6e:0x3c0b55,transparent:true,opacity:.55,side:THREE.DoubleSide});const o=new THREE.Mesh(g,m);o.position.set(x,2,x%20===0?-8:8);o.rotation.y=Math.PI;scene.add(o);}}
function addStars(){const n=quality==='low'?120:quality==='medium'?250:450;const geo=new THREE.BufferGeometry();const a=new Float32Array(n*3);for(let i=0;i<n;i++){a[i*3]=(Math.random()-.5)*180;a[i*3+1]=10+Math.random()*50;a[i*3+2]=(Math.random()-.5)*180;}geo.setAttribute('position',new THREE.BufferAttribute(a,3));scene.add(new THREE.Points(geo,new THREE.PointsMaterial({color:0x49bfff,size:.18,sizeAttenuation:true})));}
function vehicle(p){const g=new THREE.Group();const body=new THREE.Mesh(new THREE.BoxGeometry(2.1,.55,3.7),new THREE.MeshStandardMaterial({color:p.color,emissive:new THREE.Color(p.color),emissiveIntensity:1.8,metalness:.7,roughness:.2}));body.position.y=.65;g.add(body);const glow=new THREE.Mesh(new THREE.BoxGeometry(1.5,.1,2.8),new THREE.MeshBasicMaterial({color:p.color,transparent:true,opacity:.55}));glow.position.y=.95;g.add(glow);scene.add(g);return g;}
function updateObjects(state){
  $('score').innerHTML=state.players.map(p=>`<div style="color:${escapeHtml(p.color)}">● ${escapeHtml(p.nickname)} ${p.alive?'':'✕'}</div>`).join('');
  for(const p of state.players){let obj=vehicles.get(p.id);if(!obj){obj=vehicle(p);vehicles.set(p.id,obj);}obj.position.set(p.x-60,.0,p.y-40);obj.rotation.y=-p.a+Math.PI/2;}
}
function animate(){requestAnimationFrame(animate);if(lastState){updateObjects(lastState);const own=lastState.players.find(p=>p.id===socket.id||p.nickname===me);if(own)$('bar').style.width=own.energy+'%';drawMap();const elapsed=Math.max(0,Date.now()-(lastState.started||Date.now()));$('timer').textContent=new Date(elapsed).toISOString().slice(14,19);}renderer.render(scene,camera);}
function drawMap(){const c=$('map'),ctx=c.getContext('2d');ctx.clearRect(0,0,c.width,c.height);ctx.strokeStyle='#14345c';ctx.strokeRect(5,5,170,100);for(const p of lastState.players){ctx.fillStyle=p.color;ctx.beginPath();ctx.arc(5+p.x/120*170,5+p.y/80*100,3,0,Math.PI*2);ctx.fill();}}
function applyQuality(){if(renderer)renderer.setPixelRatio(quality==='high'?Math.min(devicePixelRatio,1.5):quality==='medium'?Math.min(devicePixelRatio,1.2):quality==='low'?1:Math.min(devicePixelRatio,1.25));}
function resize(){if(!camera||!renderer)return;camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);}

addEventListener('keydown',e=>{if(e.repeat)return;if(e.key==='ArrowLeft'||e.key.toLowerCase()==='a')socket.emit('input',{type:'left'});if(e.key==='ArrowRight'||e.key.toLowerCase()==='d')socket.emit('input',{type:'right'});if(e.code==='Space')socket.emit('input',{type:'turbo'});});
$('turbo').onclick=()=>socket.emit('input',{type:'turbo'});
$('sab').onclick=()=>socket.emit('input',{type:'sabotage'});

loadProfile().then(()=>{if(authToken){$('authPanel').hidden=true;$('app').hidden=false;$('nick').value=me;}});
