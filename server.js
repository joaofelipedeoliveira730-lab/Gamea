require("dotenv").config();
const path=require("path");
const http=require("http");
const crypto=require("crypto");
const express=require("express");
const cors=require("cors");
const {Pool}=require("pg");
const {WebSocketServer}=require("ws");

const PORT=Number(process.env.PORT||3000);
const app=express();
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));
const server=http.createServer(app);

const pool=new Pool({
  connectionString:process.env.DATABASE_URL,
  ssl:process.env.NODE_ENV==="production"?{rejectUnauthorized:false}:false
});

async function initDatabase(){
  await pool.query(`
    CREATE TABLE IF NOT EXISTS players (
      id BIGSERIAL PRIMARY KEY,
      nickname VARCHAR(18) NOT NULL UNIQUE,
      skill_points INTEGER NOT NULL DEFAULT 1000,
      wins INTEGER NOT NULL DEFAULT 0,
      kills INTEGER NOT NULL DEFAULT 0,
      games INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS players_skill_points_idx
      ON players(skill_points DESC);
  `);
}


app.get("/health",async(_,res)=>{
  try{
    await pool.query("SELECT 1 FROM players LIMIT 1");
    res.json({ok:true,service:"NEON PATH",database:"ok"});
  }catch(e){
    res.status(503).json({ok:false,service:"NEON PATH",database:"error"});
  }
});

app.get("/api/leaderboard",async(_,res)=>{
  try{const {rows}=await pool.query("SELECT nickname,skill_points,wins,kills,games FROM players ORDER BY skill_points DESC,wins DESC LIMIT 50");res.json(rows)}
  catch(e){res.status(500).json({error:"database"})}
});

const wss=new WebSocketServer({server});
const rooms=new Map();
const clients=new Map();
const MAX_PLAYERS=10;
const CEO_ROOM_KEY=String(process.env.CEO_ROOM_KEY||"");
const TICK=50;
const MAX_CHAT_PER_10S=8;
const MAX_INPUT_PER_SECOND=24;
const MAX_ROOM_AGE_MS=30*60*1000;
const MAX_MESSAGE=120;
const ARENA=1000;
const COLORS=10;

function send(ws,msg){if(ws.readyState===1)ws.send(JSON.stringify(msg))}
function broadcast(room,msg){for(const p of room.players)send(p.ws,msg)}
function cleanName(v){return String(v||"").trim().replace(/[^\p{L}\p{N}_ -]/gu,"").slice(0,18)}
function clamp(v,a,b){return Math.max(a,Math.min(b,v))}
function safeRoomCode(){return Math.random().toString(36).slice(2,6).toUpperCase()}
function publicPlayer(p){return {id:p.id,nickname:p.nickname,colorIndex:p.colorIndex,alive:p.alive,kills:p.kills,distance:Math.floor(p.distance),energy:Math.floor(p.energy),breath:Math.floor(p.breath),x:p.x/ARENA,y:p.y/ARENA,angle:p.angle,trail:p.trail.slice(-900)}} 
function publicRoom(r,p){
  return {
    id:r.id,
    players:r.players.map(x=>({id:x.id,nickname:x.nickname,ready:x.ready})),
    canStart: r.hostId===p.id && (r.ceoOnly ? p.isCEO : r.players.length>=2),
    ceoOnly:r.ceoOnly,
    isCEO:!!p.isCEO
  };
}

async function upsertPlayer(nickname){
  const q=`INSERT INTO players(nickname) VALUES($1)
    ON CONFLICT(nickname) DO UPDATE SET updated_at=NOW()
    RETURNING id,nickname,skill_points,wins,kills,games`;
  const {rows}=await pool.query(q,[nickname]); return rows[0];
}

class Room{
  constructor(id,opts={}){this.id=id;this.hostId=null;this.ceoOnly=!!opts.ceoOnly;this.ceoId=opts.ceoId||null;this.players=[];this.phase="lobby";this.startedAt=0;this.time=0;this.zone=1;this.last=Date.now();this.timer=null;this.resultAt=0}
  add(p){if(this.players.length>=MAX_PLAYERS)return false;p.room=this;this.players.push(p);if(!this.hostId)this.hostId=p.id;return true}
  remove(p){
    this.players=this.players.filter(x=>x!==p);
    if(this.hostId===p.id)this.hostId=this.players[0]?.id||null;
    if(!this.players.length)this.stop();
  }
  start(requester){
    if(this.phase==="playing")return;
    if(this.ceoOnly){
      if(!requester?.isCEO || requester.id!==this.ceoId)return false;
      if(this.players.length<1)return false;
    }else if(this.players.length<2)return false;
    this.phase="playing";this.time=0;this.zone=1;this.startedAt=Date.now();
    const slots=spawnSlots(this.players.length);
    this.players.forEach((p,i)=>p.reset(slots[i],i));
    this.last=Date.now();
    this.timer=setInterval(()=>this.tick(),TICK);
    this.broadcastState();
  }
  tick(){
    const now=Date.now(),dt=Math.min((now-this.last)/1000,.1);this.last=now;
    if(this.phase!=="playing")return;
    this.time+=(dt);
    this.zone=clamp(1-Math.max(0,this.time-10)/170,.36,1);
    const active=this.players.filter(p=>p.alive);
    for(const p of active)p.update(dt,this);
    this.collisions();
    const aliveCount=this.players.filter(p=>p.alive).length;
    if(this.ceoOnly ? aliveCount===0 : aliveCount<=1)this.finish();
    else this.broadcastState();
  }
  collisions(){
    const alive=this.players.filter(p=>p.alive);
    for(const p of alive){
      const margin=ARENA*(1-this.zone)/2;
      if(p.x<margin||p.x>ARENA-margin||p.y<margin||p.y>ARENA-margin){this.eliminate(p,null,"zone");continue}
      const key=`${Math.round(p.x/8)},${Math.round(p.y/8)}`;
      if(p.occupied.has(key)){this.eliminate(p,null,"self");continue}
      p.occupied.add(key);
      for(const o of this.players){
        if(o===p)continue;
        if(o.trailKeys.has(key)){this.eliminate(p,o,"trail");break}
      }
    }
  }
  eliminate(p,killer,reason){
    if(!p.alive)return;
    p.alive=false;
    if(killer&&killer.alive)killer.kills++;
    broadcast(this,{type:"impact",x:p.x/ARENA,y:p.y/ARENA,colorIndex:p.colorIndex,killerId:killer?.id||null,reason});
  }
  finish(){
    if(this.phase!=="playing")return;
    this.phase="result";clearInterval(this.timer);this.timer=null;
    const alive=this.players.filter(p=>p.alive);
    const winner=alive[0]||this.players.slice().sort((a,b)=>b.kills-a.kills||b.distance-a.distance)[0];
    this.players.forEach(p=>p.games++);
    if(winner){winner.wins++;winner.skillDelta=winner.id===this.hostId?28:25}
    for(const p of this.players) p.skillDelta=(p.skillDelta||0)-(!p.alive?Math.min(18,4+p.kills*2):0);
    this.persist(winner);
    this.broadcastState();
    setTimeout(()=>{if(this.phase==="result")this.cleanup()},8000);
  }
  async persist(winner){
    for(const p of this.players){
      try{
        await pool.query(`UPDATE players SET skill_points=GREATEST(0,skill_points+$1),wins=wins+$2,kills=kills+$3,games=games+1,updated_at=NOW() WHERE id=$4`,
          [p.skillDelta||0,p.id===winner?.id?1:0,p.kills,p.dbId]);
      }catch{}
    }
  }
  cleanup(){
    if(this.players.length===0){rooms.delete(this.id);return}
    this.phase="lobby";this.time=0;this.zone=1;
    this.players.forEach(p=>{p.alive=false;p.ready=false;p.trail=[];p.trailKeys=new Set();p.occupied=new Set()});
    broadcast(this,{type:"room",room:publicRoom(this,this.players[0])});
  }
  stop(){clearInterval(this.timer);this.timer=null}
  broadcastState(){
    const winnerId=this.phase==="result"?(this.players.find(p=>p.alive)?.id||null):null;
    broadcast(this,{type:"state",state:{
      phase:this.phase,time:this.time,zone:this.zone,winnerId,
      players:this.players.map(publicPlayer)
    }});
  }
}

class Player{
  constructor(ws,db){
    this.ws=ws;this.dbId=db.id;this.id=crypto.randomUUID();this.nickname=db.nickname;this.ready=true;this.isCEO=false;this.room=null;
    this.colorIndex=Math.floor(Math.random()*COLORS);this.alive=false;this.trail=[];this.trailKeys=new Set();this.occupied=new Set();
    this.x=0;this.y=0;this.angle=0;this.speed=165;this.energy=100;this.breath=100;this.kills=0;this.distance=0;this.lastLeft=0;this.lastRight=0;this.coolTurbo=0;this.coolBreath=0;
  }
  reset(slot,index){
    this.colorIndex=index%COLORS;this.alive=true;this.kills=0;this.distance=0;this.energy=100;this.breath=100;
    this.x=slot.x;this.y=slot.y;this.angle=slot.angle;this.trail=[];this.trailKeys=new Set();this.occupied=new Set();
  }
  update(dt,room){
    if(!this.alive)return;
    this.coolTurbo=Math.max(0,this.coolTurbo-dt);this.coolBreath=Math.max(0,this.coolBreath-dt);
    const now=Date.now();
    if(this.ws._input?.left && now-this.lastLeft>170){this.angle-=Math.PI/2;this.lastLeft=now}
    if(this.ws._input?.right && now-this.lastRight>170){this.angle+=Math.PI/2;this.lastRight=now}
    const turbo=this.ws._input?.turbo&&this.energy>0;
    if(turbo)this.energy=Math.max(0,this.energy-42*dt);else this.energy=Math.min(100,this.energy+9*dt);
    this.breath=Math.min(100,this.breath+15*dt);
    if(this.ws._input?.breath&&this.breath>=35&&this.coolBreath<=0){this.breath-=35;this.coolBreath=2.5;this.soplo(room)}
    this.ws._input=null;
    const speed=(room.time<30?165:room.time<60?185:room.time<100?210:235)*(turbo?1.8:1);
    this.x+=Math.cos(this.angle)*speed*dt;this.y+=Math.sin(this.angle)*speed*dt;
    this.distance+=speed*dt;
    const last=this.trail[this.trail.length-1];
    if(!last||Math.hypot(this.x-last[0],this.y-last[1])>5)this.trail.push([this.x,this.y]);
    const k=`${Math.round(this.x/8)},${Math.round(this.y/8)}`;this.trailKeys.add(k);
  }
  soplo(room){
    const radius=190;
    for(const o of room.players){
      if(o===this||!o.alive)continue;
      const dx=o.x-this.x,dy=o.y-this.y,d=Math.hypot(dx,dy);
      if(d<radius){
        const force=(1-d/radius)*95;
        const nx=d?dx/d:Math.cos(this.angle),ny=d?dy/d:Math.sin(this.angle);
        o.x+=nx*force;o.y+=ny*force;
      }
    }
  }
}

function spawnSlots(n){
  const cx=ARENA/2,cy=ARENA/2,r=Math.min(ARENA*.36,ARENA/(n+2));
  return Array.from({length:n},(_,i)=>{const a=i/n*Math.PI*2;return {x:cx+Math.cos(a)*r,y:cy+Math.sin(a)*r,angle:a+Math.PI}});
}

wss.on("connection",ws=>{
  ws._input=null;
  ws._inputCount=0;
  ws._chatTimes=[];
  ws._lastSeq=-1;
  ws._connectedAt=Date.now();
  ws._lastPacket=Date.now();
  const rateTimer=setInterval(()=>{ws._inputCount=0},1000);
  ws.on("error",()=>{});
  send(ws,{type:"hello",server:"NEON PATH"});
  ws.on("message",async raw=>{
    if(Date.now()-ws._connectedAt>2*60*60*1000)return ws.close(1008,"session expired");
    if(raw.length>8192)return send(ws,{type:"error",message:"Pacote muito grande."});
    let m;try{m=JSON.parse(raw.toString())}catch{return}
    if(!m || typeof m.type!=="string")return;
    ws._lastPacket=Date.now();
    if(m.type==="input"){
      ws._inputCount++;
      if(ws._inputCount>MAX_INPUT_PER_SECOND)return;
      if(Number.isInteger(m.seq)){if(m.seq<=ws._lastSeq)return;ws._lastSeq=m.seq}
    }
    try{
      if(m.type==="join"){
        const nickname=cleanName(m.nickname);
        if(nickname.length<2)return send(ws,{type:"error",message:"Apelido inválido."});
        const db=await upsertPlayer(nickname);
        const p=new Player(ws,db);clients.set(p.id,p);

        if(m.mode==="create_ceo"){
          if(!CEO_ROOM_KEY || String(m.key||"")!==CEO_ROOM_KEY){
            clients.delete(p.id);
            return send(ws,{type:"error",message:"Chave CEO inválida."});
          }
          p.isCEO=true;
          const r=new Room(safeRoomCode(),{ceoOnly:true,ceoId:p.id});
          rooms.set(r.id,r);
          r.add(p);
          send(ws,{type:"hello",player:{id:p.id,nickname:p.nickname,isCEO:true}});
          return broadcast(r,{type:"room",room:publicRoom(r,p)});
        }

        if(m.mode==="create"){
          const r=new Room(safeRoomCode());
          rooms.set(r.id,r); r.add(p);
          send(ws,{type:"hello",player:{id:p.id,nickname:p.nickname,isCEO:false}});
          return broadcast(r,{type:"room",room:publicRoom(r,p)});
        }

        if(m.mode==="join_room"){
          const code=String(m.roomId||"").trim().toUpperCase();
          const r=rooms.get(code);
          if(!r || r.phase!=="lobby" || r.players.length>=MAX_PLAYERS){
            clients.delete(p.id); return send(ws,{type:"error",message:"Sala não encontrada ou lotada."});
          }
          if(r.ceoOnly && String(m.key||"")!==CEO_ROOM_KEY){
            clients.delete(p.id); return send(ws,{type:"error",message:"Esta é uma sala exclusiva do CEO."});
          }
          if(!r.add(p)){clients.delete(p.id);return send(ws,{type:"error",message:"Sala lotada."});}
          if(r.ceoOnly)p.isCEO=(p.id===r.ceoId);
          send(ws,{type:"hello",player:{id:p.id,nickname:p.nickname,isCEO:!!p.isCEO}});
          return broadcast(r,{type:"room",room:publicRoom(r,p)});
        }

        // Quick play never selects CEO-only rooms.
        let r=[...rooms.values()].find(x=>!x.ceoOnly&&x.phase==="lobby"&&x.players.length<MAX_PLAYERS);
        if(!r){r=new Room(safeRoomCode());rooms.set(r.id,r);}
        r.add(p);
        send(ws,{type:"hello",player:{id:p.id,nickname:p.nickname,isCEO:false}});
        broadcast(r,{type:"room",room:publicRoom(r,p)});
      }
      else if(m.type==="start"){
        const p=clients.get(m.id)||[...clients.values()].find(x=>x.ws===ws);if(!p?.room)return;
        if(p.id!==p.room.hostId)return send(ws,{type:"error",message:"Só o líder da sala pode iniciar."});
        if(!p.room.start(p))return send(ws,{type:"error",message:p.room.ceoOnly?"Somente o CEO pode iniciar esta sala.":"São necessários 2 jogadores."});
      }
      else if(m.type==="input"){
        const p=[...clients.values()].find(x=>x.ws===ws);if(p)p.ws._input={left:!!m.left,right:!!m.right,turbo:!!m.turbo,breath:!!m.breath};
      }
      else if(m.type==="leave"){
        const p=[...clients.values()].find(x=>x.ws===ws);if(p){const r=p.room;r?.remove(p);clients.delete(p.id);if(r)broadcast(r,{type:"room",room:publicRoom(r,r.players[0]||p)})}
      }
      else if(m.type==="rematch"){
        const p=[...clients.values()].find(x=>x.ws===ws);if(p?.room&&p.room.phase==="lobby")p.room.start();
      }
      else if(m.type==="chat"){
        const p=[...clients.values()].find(x=>x.ws===ws);
        if(p?.room&&typeof m.message==="string"){
          const now=Date.now();
          ws._chatTimes=ws._chatTimes.filter(t=>now-t<10000);
          if(ws._chatTimes.length>=MAX_CHAT_PER_10S)return send(ws,{type:"error",message:"Chat temporariamente limitado."});
          ws._chatTimes.push(now);
          const message=m.message.trim().slice(0,MAX_MESSAGE);
          if(message)broadcast(p.room,{type:"chat",nickname:p.nickname,message});
        }
      }
      else if(m.type==="leaderboard"){
        const {rows}=await pool.query("SELECT nickname,skill_points,wins,kills,games FROM players ORDER BY skill_points DESC,wins DESC LIMIT 50");
        send(ws,{type:"leaderboard",rows});
      }
    }catch(e){send(ws,{type:"error",message:"Erro interno. Tente novamente."})}
  });
  ws.on("close",()=>{
    clearInterval(rateTimer);
    const p=[...clients.values()].find(x=>x.ws===ws);
    if(p){const r=p.room;r?.remove(p);clients.delete(p.id);if(r&&r.players.length)broadcast(r,{type:"room",room:publicRoom(r,r.players[0])})}
  });
});

setInterval(()=>{
  const now=Date.now();
  for(const [id,r] of rooms){
    if(r.phase==="lobby" && now-r.startedAt>MAX_ROOM_AGE_MS && r.startedAt) { r.stop(); rooms.delete(id); }
  }
},60000);

initDatabase()
  .then(()=>server.listen(PORT,()=>console.log(`NEON PATH on :${PORT}`)))
  .catch(err=>{
    console.error("DATABASE INIT FAILED:",err);
    process.exit(1);
  });
