require("dotenv").config();
const express=require("express"),http=require("http"),path=require("path"),crypto=require("crypto");
const bcrypt=require("bcryptjs"),jwt=require("jsonwebtoken"),helmet=require("helmet"),cors=require("cors");
const {Pool}=require("pg"); const {Server}=require("socket.io");

const app=express(), server=http.createServer(app);
const PORT=Number(process.env.PORT||3000), JWT_SECRET=process.env.JWT_SECRET||"dev-only-change-me-32-characters-long";
const CEO_KEY=process.env.CEO_ROOM_KEY||"Velho202026";
const pool=process.env.DATABASE_URL?new Pool({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:false}}):null;
app.use(helmet({contentSecurityPolicy:false})); app.use(cors({origin:process.env.CLIENT_ORIGIN||"*"})); app.use(express.json({limit:"32kb"}));
app.use(express.static(__dirname));
app.get("/health",async(_,res)=>{let db="disabled";try{if(pool){await pool.query("SELECT 1");db="ok"}}catch{db="error"}res.json({ok:true,game:"NEON PATH",version:"3.0.0",database:db})});
app.get("/api/rank",async(_,res)=>{if(!pool)return res.json([]);try{const q=await pool.query("SELECT nickname,ph,wins,kills,races FROM users ORDER BY ph DESC LIMIT 50");res.json(q.rows)}catch{res.status(500).json({error:"rank"})}});
function cleanNick(v){return typeof v==="string"&&/^[A-Za-z0-9_À-ÿ ]{2,20}$/.test(v.trim())?v.trim():null}
app.post("/api/auth/guest",async(req,res)=>{
 const nickname=cleanNick(req.body.nickname); if(!nickname)return res.status(400).json({error:"apelido inválido"});
 if(!pool)return res.json({token:jwt.sign({nickname,guest:true},JWT_SECRET,{expiresIn:"7d"}),nickname});
 try{
   let q=await pool.query("SELECT id,nickname FROM users WHERE lower(nickname)=lower($1)",[nickname]);
   let id;
   if(q.rowCount) id=q.rows[0].id;
   else {const h=await bcrypt.hash(crypto.randomBytes(18).toString("hex"),10);q=await pool.query("INSERT INTO users(nickname,password_hash) VALUES($1,$2) RETURNING id",[nickname,h]);id=q.rows[0].id}
   res.json({token:jwt.sign({sub:id,nickname},JWT_SECRET,{expiresIn:"7d"}),nickname});
 }catch{res.status(500).json({error:"banco"})}
});

const io=new Server(server,{cors:{origin:process.env.CLIENT_ORIGIN||"*"}});
const rooms=new Map(), MAX=8, W=120, H=80, TICK=1000/30, MAX_SPEED=18;
const colors=["#00f6ff","#ff2bd6","#8cff00","#ffe600","#8b5cff","#ff6b35","#36ff8c","#ff3b6b"];
function roomCode(){return crypto.randomBytes(3).toString("hex").toUpperCase()}
function makeRoom(code,ceo=false){return {code,ceo,players:new Map(),running:false,started:0,last:Date.now()}}
function spawn(i){const a=[ [15,15,0],[105,15,Math.PI],[15,65,0],[105,65,Math.PI],[60,12,Math.PI/2],[60,68,-Math.PI/2],[25,40,0],[95,40,Math.PI] ][i%8];return {x:a[0],y:a[1],a:a[2],speed:9,energy:100,boost:0,alive:true,trail:[],kills:0,lastTurn:0,lastTurbo:0,lastSab:0}}
function snap(r){return {code:r.code,running:r.running,players:[...r.players.values()].map(p=>({id:p.id,nickname:p.nickname,x:p.x,y:p.y,a:p.a,speed:p.speed,energy:p.energy,boost:p.boost,alive:p.alive,trail:p.trail.slice(-350),kills:p.kills,color:p.color}))}}
function collision(p,r){
 if(p.x<2||p.y<2||p.x>W-2||p.y>H-2)return true;
 for(const q of r.players.values()){if(!q.alive)continue;if(q.id!==p.id&&Math.hypot(p.x-q.x,p.y-q.y)<1.6)return true}
 const old=p.trail.slice(-2), self=p.trail.slice(0,-3);
 for(const t of [...self,...[].concat(...[...r.players.values()].filter(q=>q.id!==p.id).map(q=>q.trail.slice(-350)))])
   if(Math.abs(p.x-t[0])<.75&&Math.abs(p.y-t[1])<.75)return true;
 return false;
}
function start(r){if(r.running)return; r.running=true;r.started=Date.now();let i=0;for(const p of r.players.values()){Object.assign(p,spawn(i++));}io.to(r.code).emit("start",{code:r.code});}
io.on("connection",s=>{
 s.on("room:create",({nickname,ceo,key}={})=>{
   nickname=cleanNick(nickname)||"Piloto"; if(ceo&&key!==CEO_KEY)return s.emit("error:game","Chave CEO inválida");
   let code=ceo?"CEO50":roomCode(); if(rooms.has(code)&&!ceo)code=roomCode();
   const r=makeRoom(code,!!ceo);rooms.set(code,r); const p=spawn(0);Object.assign(p,{id:s.id,nickname,color:colors[0]});r.players.set(s.id,p);s.join(code);s.data.room=code;s.emit("room",{code,ceo:r.ceo});
 });
 s.on("room:join",({code,nickname}={})=>{
   const r=rooms.get(String(code||"").toUpperCase()); if(!r)return s.emit("error:game","Sala não encontrada");
   if(r.running||r.players.size>=MAX)return s.emit("error:game","Sala cheia ou corrida iniciada");
   const p=spawn(r.players.size);Object.assign(p,{id:s.id,nickname:cleanNick(nickname)||"Piloto",color:colors[r.players.size]});r.players.set(s.id,p);s.join(r.code);s.data.room=r.code;s.emit("room",{code:r.code,ceo:r.ceo});io.to(r.code).emit("state",snap(r));
 });
 s.on("room:start",()=>{const r=rooms.get(s.data.room);if(r&&r.ceo&&r.players.get(s.id))start(r)});
 s.on("input",m=>{
   const r=rooms.get(s.data.room),p=r?.players.get(s.id); if(!r||!p||!p.alive)return;
   const now=Date.now(); if(now-p.lastTurn<70)return;
   const type=m?.type;
   if(type==="left"||type==="right"){p.a+=(type==="left"?-1:1)*Math.PI/2;p.lastTurn=now}
   if(type==="turbo"&&p.energy>=20&&now-p.lastTurbo>900){p.energy-=20;p.boost=1.65;p.lastTurbo=now}
   if(type==="sabotage"&&p.energy>=30&&now-p.lastSab>8000){p.energy-=30;p.lastSab=now;let target=null,d=999;for(const q of r.players.values())if(q.alive&&q.id!==p.id){const dd=Math.hypot(p.x-q.x,p.y-q.y);if(dd<d){d=dd;target=q}}if(target&&d<12){target.speed=Math.max(3,target.speed*.55);target.boost=.25;s.to(r.code).emit("hit",{from:p.nickname,to:target.nickname})}}
 });
 s.on("disconnect",()=>{const r=rooms.get(s.data.room);if(r){r.players.delete(s.id);if(!r.players.size)rooms.delete(r.code)}})
});
setInterval(()=>{
 const now=Date.now();
 for(const r of rooms.values()){if(!r.running)continue;for(const p of r.players.values()){if(!p.alive)continue;
   const dt=TICK/1000, max=MAX_SPEED*(p.boost>0?1.65:1);p.speed+=((9+Math.min(6,(now-r.started)/30000))-p.speed)*.08;p.speed=Math.min(p.speed,max);
   p.x+=Math.cos(p.a)*p.speed*dt;p.y+=Math.sin(p.a)*p.speed*dt;p.energy=Math.min(100,p.energy+4*dt);p.boost=Math.max(0,p.boost-dt);
   p.trail.push([+p.x.toFixed(2),+p.y.toFixed(2)]);if(p.trail.length>450)p.trail.shift();if(collision(p,r))p.alive=false;
 }io.to(r.code).emit("state",snap(r))}
},TICK);
server.listen(PORT,()=>console.log(`NEON PATH ${PORT}`));
