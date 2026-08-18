(() => {
  "use strict";

  const $ = s => document.querySelector(s);
  const canvas = $("#game"), ctx = canvas.getContext("2d");
  const menu = $("#menu"), room = $("#room"), leader = $("#leaderboard"), result = $("#result"), hud = $("#hud"), joinPanel=$("#joinPanel"), createPanel=$("#createPanel");
  const nickname = $("#nickname"), menuMsg = $("#menuMsg"), roomMsg = $("#roomMsg"), joinMsg=$("#joinMsg"), createMsg=$("#createMsg");

  let ws = null, me = null, roomId = null, state = null, lastFrame = performance.now(), inputSeq = 0;
  let pressed = new Set(), audioCtx = null, musicTimer = null;

  const COLORS = ["#00f6ff","#ff2bd6","#a8ff00","#ffe600","#8a5cff","#ff6b35","#25ff9a","#ff4f8b","#54a0ff","#d6ff00"];

  function resize(){
    const dpr = Math.min(devicePixelRatio || 1, 2);
    canvas.width = innerWidth*dpr; canvas.height = innerHeight*dpr;
    ctx.setTransform(dpr,0,0,dpr,0,0);
  }
  addEventListener("resize", resize); resize();

  function show(which){
    [menu,room,leader,result,joinPanel,createPanel].filter(Boolean).forEach(x=>x.classList.add("hidden"));
    if(which) which.classList.remove("hidden");
  }

  function backendUrl(){
    const configured = window.NEON_PATH_BACKEND || location.origin;
    return configured.replace(/^http/, "ws");
  }

  function connect(){
    return new Promise((resolve,reject)=>{
      if(ws && ws.readyState===1) return resolve();
      ws = new WebSocket(backendUrl());
      ws.onopen = () => resolve();
      ws.onerror = () => reject(new Error("Falha de conexão"));
      ws.onclose = () => {
        if(state?.phase==="playing"){ $("#hud").classList.add("hidden"); menuMsg.textContent="Conexão perdida."; show(menu); }
      };
      ws.onmessage = e => {
        let m; try{m=JSON.parse(e.data)}catch{return}
        handle(m);
      };
    });
  }

  function send(type, data={}){
    if(ws?.readyState===1) ws.send(JSON.stringify({type,...data}));
  }

  function handle(m){
    if(m.type==="error"){ menuMsg.textContent=m.message; roomMsg.textContent=m.message; joinMsg.textContent=m.message; createMsg.textContent=m.message; return; }
    if(m.type==="hello"){ me=m.player; return; }
    if(m.type==="room"){
      roomId=m.room.id; $("#roomCode").textContent=roomId;
      renderRoom(m.room); show(room); return;
    }
    if(m.type==="leaderboard"){ renderLeaders(m.rows); show(leader); return; }
    if(m.type==="state"){
      state=m.state;
      if(state.phase==="playing"){ menu.classList.add("hidden"); room.classList.add("hidden"); result.classList.add("hidden"); hud.classList.remove("hidden"); }
      if(state.phase==="result") finish(state);
      renderHud(state);
      return;
    }
    if(m.type==="chat") addChat(m.nickname,m.message);
  }

  async function join(mode="quick", extra={}){
    const name=(nickname.value||"").trim();
    if(name.length<2){menuMsg.textContent="Digite um apelido de 2 a 18 caracteres.";return}
    try{
      menuMsg.textContent="Conectando...";
      await connect();
      send("join",{nickname:name, mode, ...extra});
      startAudio();
    }catch(e){menuMsg.textContent="Servidor indisponível. Confira a URL do Render."}
  }

  const bind = (selector, event, fn) => { const el=$(selector); if(el) el.addEventListener(event, fn); };

  bind("#joinExistingBtn","click",()=>{ if(joinMsg) joinMsg.textContent=""; show(joinPanel); $("#roomCodeInput")?.focus(); });
  bind("#joinCancelBtn","click",()=>show(menu));
  bind("#joinConfirmBtn","click",()=>{
    const code=($("#roomCodeInput")?.value||"").trim().toUpperCase();
    if(!code){if(joinMsg) joinMsg.textContent="Digite o código da sala.";return}
    const key=($("#joinKey")?.value||"").trim();
    if(joinMsg) joinMsg.textContent="Conectando...";
    join("join_room",{roomId:code,key});
  });

  bind("#roomBtn","click",()=>{if(createMsg) createMsg.textContent="";$("#ceoKeyBox")?.classList.add("hidden");show(createPanel)});
  bind("#normalCreateBtn","click",()=>join("create"));
  bind("#ceoCreateBtn","click",()=>{$("#ceoKeyBox")?.classList.remove("hidden");$("#ceoKey")?.focus()});
  bind("#ceoConfirmBtn","click",()=>{
    const key=($("#ceoKey")?.value||"").trim();
    if(!key){if(createMsg) createMsg.textContent="Digite a chave CEO.";return}
    if(createMsg) createMsg.textContent="Validando chave...";
    join("create_ceo",{key});
  });
  bind("#createCancelBtn","click",()=>show(menu));
  bind("#leaderBtn","click",async()=>{try{await connect();send("leaderboard")}catch{menuMsg.textContent="Servidor indisponível."}});
  bind("#backBtn","click",()=>show(menu));
  bind("#startBtn","click",()=>send("start"));
  bind("#leaveBtn","click",()=>{send("leave");show(menu)});
  bind("#againBtn","click",()=>{send("rematch");show(room)});
  bind("#resultHomeBtn","click",()=>{send("leave");show(menu)});

  addEventListener("keydown", e=>{
    if(["INPUT","TEXTAREA"].includes(document.activeElement?.tagName)) return;
    if(["ArrowLeft","ArrowRight","a","A","d","D"," ","e","E"].includes(e.key)) e.preventDefault();
    pressed.add(e.key.toLowerCase());
    if(e.key==="Enter") sendChat();
    if(e.key.toLowerCase()==="t") $("#chat").classList.toggle("hidden");
  });
  addEventListener("keyup", e=>pressed.delete(e.key.toLowerCase()));

  document.querySelectorAll(".mobile-controls button").forEach(b=>{
    const k=b.dataset.key;
    b.addEventListener("pointerdown",()=>pressed.add(k));
    b.addEventListener("pointerup",()=>pressed.delete(k));
    b.addEventListener("pointercancel",()=>pressed.delete(k));
  });

  let lastInput=0;
  function inputLoop(now){
    if(now-lastInput>45 && state?.phase==="playing"){
      let left=pressed.has("arrowleft")||pressed.has("a")||pressed.has("left");
      let right=pressed.has("arrowright")||pressed.has("d")||pressed.has("right");
      let turbo=pressed.has(" ")||pressed.has("turbo");
      let breath=pressed.has("e")||pressed.has("breath");
      if(left||right||turbo||breath){
        send("input",{left,right,turbo,breath,seq:++inputSeq});
        lastInput=now;
      }
    }
    requestAnimationFrame(inputLoop);
  }
  requestAnimationFrame(inputLoop);

  $("#chatInput").addEventListener("keydown",e=>{if(e.key==="Enter"){e.preventDefault();sendChat()}});
  function sendChat(){const el=$("#chatInput");if(el.value.trim()){send("chat",{message:el.value.trim()});el.value=""}}

  function renderRoom(r){
    $("#roomPlayers").innerHTML=r.players.map(p=>`<div class="player-row"><span>${esc(p.nickname)}</span><b>${p.ready?"READY":"WAIT"}</b></div>`).join("");
    $("#startBtn").disabled = !r.canStart;
    roomMsg.textContent = r.ceoOnly ? "SALA CEO • você pode iniciar sozinho para teste." : (r.players.length<2 ? "Aguardando mais jogadores..." : "Pronto para começar.");
  }

  function renderLeaders(rows){
    $("#leaders").innerHTML=rows.map((p,i)=>`<div class="leader"><span class="rank">#${i+1}</span><strong>${esc(p.nickname)}</strong><span class="ph">${p.skill_points} PH</span></div>`).join("");
  }

  function renderHud(s){
    if(!s)return;
    $("#roundTime").textContent=formatTime(s.time);
    $("#zoneText").textContent=Math.round(s.zone*100)+"%";
    const self=s.players.find(p=>p.id===me?.id);
    $("#turboBar").style.width=(self?.energy??0)+"%";
    $("#breathBar").style.width=(self?.breath??0)+"%";
    $("#scoreboard").innerHTML=s.players.slice().sort((a,b)=>b.alive-a.alive || b.kills-a.kills).map(p=>{
      const c=COLORS[p.colorIndex%COLORS.length];
      return `<div class="score-row"><i class="dot" style="color:${c};background:${c}"></i><span>${esc(p.nickname)}</span><span class="alive">${p.alive?"●":"×"}</span></div>`;
    }).join("");
  }

  function finish(s){
    hud.classList.add("hidden"); show(result);
    const w=s.players.find(p=>p.id===s.winnerId);
    $("#winnerName").textContent=w?.nickname||"Ninguém";
    $("#resultStats").innerHTML=s.players.slice().sort((a,b)=>b.kills-a.kills).slice(0,4).map(p=>`<div class="stat-card">${esc(p.nickname)} — ${p.kills} KILL · ${p.distance}m</div>`).join("");
  }

  function addChat(n,m){
    const log=$("#chatLog"); log.innerHTML+=`<div><b>${esc(n)}:</b> ${esc(m)}</div>`; log.scrollTop=log.scrollHeight;
  }

  function esc(s){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
  function formatTime(sec){sec=Math.floor(sec||0);return `${Math.floor(sec/60)}:${String(sec%60).padStart(2,"0")}`}

  function startAudio(){
    if(audioCtx)return;
    try{
      audioCtx=new (AudioContext||webkitAudioContext)();
      const gain=audioCtx.createGain(); gain.gain.value=.025; gain.connect(audioCtx.destination);
      musicTimer=setInterval(()=>{
        if(!audioCtx || state?.phase!=="playing")return;
        const osc=audioCtx.createOscillator(); osc.type="sawtooth";
        osc.frequency.value=[110,146.83,164.81,220][Math.floor(Math.random()*4)];
        osc.connect(gain);osc.start();osc.stop(audioCtx.currentTime+.09);
      },180);
    }catch{}
  }

  function draw(){
    const now=performance.now(), dt=Math.min((now-lastFrame)/1000,.05); lastFrame=now;
    renderArena(dt); requestAnimationFrame(draw);
  }

  function renderArena(dt){
    const w=innerWidth,h=innerHeight;
    ctx.fillStyle="#03040a";ctx.fillRect(0,0,w,h);
    if(!state){drawMenuGrid(w,h);return}
    const pad=Math.min(w,h)*.07;
    const ax=pad,ay=pad+10,aw=w-pad*2,ah=h-pad*2-20;
    ctx.save();
    ctx.translate(ax,ay);
    ctx.strokeStyle="#0b2440";ctx.lineWidth=1;
    for(let x=0;x<=aw;x+=40){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,ah);ctx.stroke()}
    for(let y=0;y<=ah;y+=40){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(aw,y);ctx.stroke()}
    const zone=(state.zone??1);
    ctx.strokeStyle="#ff2bd6";ctx.globalAlpha=.18;ctx.lineWidth=4;
    ctx.strokeRect(aw*(1-zone)/2,ah*(1-zone)/2,aw*zone,ah*zone);ctx.globalAlpha=1;
    for(const p of state.players){
      const c=COLORS[p.colorIndex%COLORS.length];
      if(p.trail?.length){
        ctx.save();ctx.strokeStyle=c;ctx.shadowColor=c;ctx.shadowBlur=14;ctx.lineWidth=4;ctx.lineJoin="round";
        ctx.beginPath();p.trail.forEach((q,i)=>{const x=q[0]*aw,y=q[1]*ah;i?ctx.lineTo(x,y):ctx.moveTo(x,y)});ctx.stroke();ctx.restore();
      }
      if(p.alive){
        const x=p.x*aw,y=p.y*ah;
        ctx.save();ctx.translate(x,y);ctx.rotate(p.angle);ctx.shadowColor=c;ctx.shadowBlur=22;
        ctx.fillStyle=c;ctx.beginPath();ctx.moveTo(13,0);ctx.lineTo(-10,-7);ctx.lineTo(-7,0);ctx.lineTo(-10,7);ctx.closePath();ctx.fill();
        ctx.fillStyle="#fff";ctx.beginPath();ctx.arc(2,0,2,0,Math.PI*2);ctx.fill();ctx.restore();
      }
    }
    ctx.restore();
  }

  function drawMenuGrid(w,h){
    ctx.strokeStyle="#0b1020";ctx.lineWidth=1;
    for(let x=0;x<w;x+=50){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,h);ctx.stroke()}
    for(let y=0;y<h;y+=50){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(w,y);ctx.stroke()}
  }

  draw();
})();