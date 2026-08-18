'use strict';
require('dotenv').config();

const express = require('express');
const http = require('http');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const helmet = require('helmet');
const cors = require('cors');
const { Pool } = require('pg');
const { Server } = require('socket.io');
const core = require('./game-core');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: process.env.CLIENT_ORIGIN || '*', methods:['GET','POST'] }, maxHttpBufferSize: 32 * 1024 });

const PORT = Number(process.env.PORT || 3000);
const JWT_SECRET = process.env.JWT_SECRET || '';
const CEO_KEY = process.env.CEO_ROOM_KEY || 'Velho202026';
const CEO_ROOM_CODE = 'VELHO202026';
const MAX = core.MAX_PLAYERS;
const db = process.env.DATABASE_URL ? new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized:false },
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 8000
}) : null;

app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy:false }));
app.use(cors({ origin: process.env.CLIENT_ORIGIN || '*' }));
app.use(express.json({ limit:'32kb' }));
app.use(express.static(__dirname, { extensions:['html'] }));

const httpBuckets = new Map();
function httpRate(req, res, next) {
  const key = `${req.ip}:${req.path}`;
  const now = Date.now();
  let b = httpBuckets.get(key);
  if (!b || now - b.start >= 60000) b = { start:now, count:0 };
  b.count++;
  httpBuckets.set(key,b);
  if (b.count > (req.path.includes('/auth/') ? 30 : 120)) return res.status(429).json({error:'rate_limited'});
  next();
}
app.use('/api', httpRate);

function signUser(user) {
  if (!JWT_SECRET || JWT_SECRET.length < 32) throw new Error('JWT_SECRET_MISSING');
  return jwt.sign({ sub:String(user.id), nickname:user.nickname }, JWT_SECRET, { expiresIn:'30d' });
}
function authUser(req) {
  try {
    const h = req.headers.authorization || '';
    if (!h.startsWith('Bearer ')) return null;
    const p = jwt.verify(h.slice(7), JWT_SECRET);
    return { id:Number(p.sub), nickname:String(p.nickname || '') };
  } catch { return null; }
}

async function initDatabase() {
  if (!db) return;
  await db.query(`
    CREATE TABLE IF NOT EXISTS users(
      id BIGSERIAL PRIMARY KEY,
      nickname VARCHAR(20), email VARCHAR(160), password_hash TEXT,
      ph INTEGER NOT NULL DEFAULT 1000, wins INTEGER NOT NULL DEFAULT 0,
      kills INTEGER NOT NULL DEFAULT 0, races INTEGER NOT NULL DEFAULT 0,
      bruto_coins INTEGER NOT NULL DEFAULT 15000,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    ALTER TABLE users ADD COLUMN IF NOT EXISTS nickname VARCHAR(20);
    ALTER TABLE users ADD COLUMN IF NOT EXISTS email VARCHAR(160);
    ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS ph INTEGER NOT NULL DEFAULT 1000;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS wins INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS kills INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS races INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS bruto_coins INTEGER NOT NULL DEFAULT 15000;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
    CREATE TABLE IF NOT EXISTS race_results(
      id BIGSERIAL PRIMARY KEY, user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
      nickname VARCHAR(20) NOT NULL, position INTEGER NOT NULL, kills INTEGER NOT NULL DEFAULT 0,
      ph_delta INTEGER NOT NULL DEFAULT 0, map VARCHAR(40) NOT NULL DEFAULT 'Neon Canyon',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS player_profiles(
      user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      level INTEGER NOT NULL DEFAULT 1, xp BIGINT NOT NULL DEFAULT 0,
      prestige INTEGER NOT NULL DEFAULT 0, character_id INTEGER NOT NULL DEFAULT 1,
      total_wins INTEGER NOT NULL DEFAULT 0, total_races INTEGER NOT NULL DEFAULT 0,
      ph INTEGER NOT NULL DEFAULT 1000, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS player_characters(
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      character_id INTEGER NOT NULL, unlocked BOOLEAN NOT NULL DEFAULT FALSE,
      selected BOOLEAN NOT NULL DEFAULT FALSE, PRIMARY KEY(user_id,character_id)
    );
    CREATE TABLE IF NOT EXISTS shop_items(
      id SERIAL PRIMARY KEY, code VARCHAR(64) UNIQUE NOT NULL, name VARCHAR(120) NOT NULL,
      type VARCHAR(32) NOT NULL, price INTEGER NOT NULL DEFAULT 0, rarity VARCHAR(24) NOT NULL DEFAULT 'common',
      data JSONB NOT NULL DEFAULT '{}'::jsonb, enabled BOOLEAN NOT NULL DEFAULT TRUE
    );
    CREATE TABLE IF NOT EXISTS player_items(
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      item_id INTEGER NOT NULL REFERENCES shop_items(id) ON DELETE CASCADE,
      owned BOOLEAN NOT NULL DEFAULT TRUE, equipped BOOLEAN NOT NULL DEFAULT FALSE,
      PRIMARY KEY(user_id,item_id)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS uq_users_nickname_lower ON users(LOWER(nickname));
    CREATE UNIQUE INDEX IF NOT EXISTS uq_users_email_lower ON users(LOWER(email)) WHERE email IS NOT NULL AND email<>'';
    CREATE INDEX IF NOT EXISTS idx_users_ph ON users(ph DESC);
    CREATE INDEX IF NOT EXISTS idx_profiles_prestige ON player_profiles(prestige DESC, level DESC, xp DESC);
  `);
  const cols = (await db.query(`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='users'`)).rows.map(r=>r.column_name);
  if (cols.includes('username')) await db.query(`UPDATE users SET nickname=LEFT(username,20) WHERE (nickname IS NULL OR nickname='') AND username IS NOT NULL`);
  if (cols.includes('password')) await db.query(`UPDATE users SET password_hash=password WHERE (password_hash IS NULL OR password_hash='') AND password IS NOT NULL`);
  await db.query(`UPDATE users SET nickname='Piloto_'||id::text WHERE nickname IS NULL OR nickname=''`);
  await ensureStore();
}

const CHARACTER_IDS=[1,2,3,4,5,6];
const STORE_CATALOG=[
  {code:'crown_royal',name:'Coroa Imperial Neon',type:'crown',price:0,rarity:'legendary',data:{glow:'#ffd84a'}},
  {code:'crown_cyber',name:'Coroa Cyber Real',type:'crown',price:4200,rarity:'epic',data:{glow:'#00f6ff'}},
  {code:'trail_plasma',name:'Rastro Plasma',type:'trail',price:2600,rarity:'epic',data:{color:'#ff25d9'}},
  {code:'trail_lime',name:'Rastro Veneno',type:'trail',price:1800,rarity:'rare',data:{color:'#8cff00'}},
  {code:'aura_phantom',name:'Aura Fantasma',type:'aura',price:5200,rarity:'legendary',data:{color:'#8c5cff'}},
  {code:'engine_sparks',name:'Faíscas Turbo',type:'effect',price:1400,rarity:'rare',data:{color:'#00f6ff'}},
  {code:'neon_wings',name:'Asas de Neon',type:'back',price:6800,rarity:'mythic',data:{color:'#ff25d9'}},
  {code:'spawn_burst',name:'Entrada Explosiva',type:'effect',price:3500,rarity:'epic',data:{color:'#ffe600'}}
];
async function ensureStore(){
  if(!db)return;
  for(const it of STORE_CATALOG) await db.query(`INSERT INTO shop_items(code,name,type,price,rarity,data) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(code) DO UPDATE SET name=EXCLUDED.name,type=EXCLUDED.type,price=EXCLUDED.price,rarity=EXCLUDED.rarity,data=EXCLUDED.data`,[it.code,it.name,it.type,it.price,it.rarity,it.data]);
}
function xpForLevel(level){ return Math.floor(100*Math.pow(1.12,Math.max(0,level-1))); }
async function getProfile(userId){
  await db.query(`INSERT INTO player_profiles(user_id) VALUES($1) ON CONFLICT DO NOTHING`,[userId]);
  await db.query(`INSERT INTO player_characters(user_id,character_id,unlocked,selected) VALUES($1,1,TRUE,TRUE) ON CONFLICT DO NOTHING`,[userId]);
  const p=(await db.query(`SELECT p.*,u.nickname,u.bruto_coins FROM player_profiles p JOIN users u ON u.id=p.user_id WHERE p.user_id=$1`,[userId])).rows[0];
  const chars=(await db.query(`SELECT character_id,unlocked,selected FROM player_characters WHERE user_id=$1 ORDER BY character_id`,[userId])).rows;
  return {...p,characters:chars};
}

app.get('/health',async(_req,res)=>{
  let database='disabled';
  try{if(db){await db.query('SELECT 1');database='ok';}}catch{database='error';}
  res.json({ok:true,service:'NEON PATH',database,version:'7.0.0'});
});
app.get('/api/rank',async(_req,res)=>{if(!db)return res.status(503).json({error:'database_unavailable'});try{const q=await db.query(`SELECT nickname,ph,wins,races FROM users ORDER BY ph DESC,wins DESC LIMIT 100`);res.json(q.rows);}catch(e){console.error(e);res.status(500).json({error:'ranking_error'});}});

app.post('/api/auth/register',async(req,res)=>{
  if(!db)return res.status(503).json({error:'database_unavailable'});
  const nickname=core.cleanNick(req.body?.username??req.body?.nickname);
  const email=core.cleanEmail(req.body?.email);
  const password=req.body?.password;
  if(!nickname)return res.status(400).json({error:'apelido_invalido'});
  if(req.body?.email && !email)return res.status(400).json({error:'email_invalido'});
  if(!core.validPassword(password))return res.status(400).json({error:'senha_invalida'});
  try{
    const hash=await bcrypt.hash(password,12);
    const q=await db.query(`INSERT INTO users(nickname,email,password_hash) VALUES($1,$2,$3) RETURNING id,nickname`,[nickname,email,hash]);
    await getProfile(q.rows[0].id);
    res.json({token:signUser(q.rows[0]),nickname:q.rows[0].nickname});
  }catch(e){if(e.code==='23505')return res.status(409).json({error:'apelido_ou_email_ja_cadastrado'});console.error('register',e);res.status(500).json({error:'register_error'});}
});

app.post('/api/auth/login',async(req,res)=>{
  if(!db)return res.status(503).json({error:'database_unavailable'});
  const nickname=core.cleanNick(req.body?.username??req.body?.nickname);
  const email=core.cleanEmail(req.body?.email);
  const password=req.body?.password;
  if((!nickname && !email)||!core.validPassword(password))return res.status(400).json({error:'credenciais_invalidas'});
  try{
    const q=nickname?await db.query(`SELECT id,nickname,password_hash FROM users WHERE LOWER(nickname)=LOWER($1) LIMIT 1`,[nickname]):await db.query(`SELECT id,nickname,password_hash FROM users WHERE LOWER(email)=LOWER($1) LIMIT 1`,[email]);
    const user=q.rows[0];
    if(!user?.password_hash || !(await bcrypt.compare(password,user.password_hash)))return res.status(401).json({error:'login_invalido'});
    await getProfile(user.id);
    res.json({token:signUser(user),nickname:user.nickname});
  }catch(e){console.error('login',e);res.status(500).json({error:'login_error'});}
});

app.get('/api/profile',async(req,res)=>{const u=authUser(req);if(!u)return res.status(401).json({error:'unauthorized'});try{res.json(await getProfile(u.id));}catch(e){console.error(e);res.status(500).json({error:'profile_error'});}});
app.post('/api/profile/character',async(req,res)=>{const u=authUser(req);if(!u)return res.status(401).json({error:'unauthorized'});const id=Number(req.body?.characterId);if(!CHARACTER_IDS.includes(id))return res.status(400).json({error:'invalid_character'});try{const q=await db.query('SELECT unlocked FROM player_characters WHERE user_id=$1 AND character_id=$2',[u.id,id]);if(!q.rows[0]?.unlocked)return res.status(403).json({error:'locked'});await db.query('UPDATE player_profiles SET character_id=$2,updated_at=NOW() WHERE user_id=$1',[u.id,id]);await db.query('UPDATE player_characters SET selected=(character_id=$2) WHERE user_id=$1',[u.id,id]);res.json(await getProfile(u.id));}catch(e){res.status(500).json({error:'save_error'});}});
app.post('/api/profile/xp',async(req,res)=>{const u=authUser(req);if(!u)return res.status(401).json({error:'unauthorized'});return res.status(403).json({error:'server_awards_only'});});
app.get('/api/shop',async(_req,res)=>{if(!db)return res.status(503).json({error:'database_unavailable'});try{res.json((await db.query('SELECT id,code,name,type,price,rarity,data FROM shop_items WHERE enabled=true ORDER BY price,id')).rows);}catch{res.status(500).json({error:'shop_error'});}});
app.get('/api/inventory',async(req,res)=>{const u=authUser(req);if(!u)return res.status(401).json({error:'unauthorized'});try{res.json((await db.query(`SELECT s.id,s.code,s.name,s.type,s.price,s.rarity,s.data,p.equipped FROM player_items p JOIN shop_items s ON s.id=p.item_id WHERE p.user_id=$1 AND p.owned=true ORDER BY s.type,s.id`,[u.id])).rows);}catch{res.status(500).json({error:'inventory_error'});}});
app.post('/api/shop/buy',async(req,res)=>{const u=authUser(req);if(!u)return res.status(401).json({error:'unauthorized'});const code=String(req.body?.code||'').slice(0,64);const client=await db.connect();try{await client.query('BEGIN');const item=(await client.query('SELECT * FROM shop_items WHERE code=$1 AND enabled=true FOR UPDATE',[code])).rows[0];if(!item){await client.query('ROLLBACK');return res.status(404).json({error:'item_not_found'});}if((await client.query('SELECT 1 FROM player_items WHERE user_id=$1 AND item_id=$2',[u.id,item.id])).rowCount){await client.query('ROLLBACK');return res.status(409).json({error:'already_owned'});}if(item.price>0){const q=await client.query('UPDATE users SET bruto_coins=bruto_coins-$1 WHERE id=$2 AND bruto_coins >= $1 RETURNING bruto_coins',[item.price,u.id]);if(!q.rowCount){await client.query('ROLLBACK');return res.status(400).json({error:'insufficient_coins'});}}await client.query('INSERT INTO player_items(user_id,item_id) VALUES($1,$2)',[u.id,item.id]);await client.query('COMMIT');res.json({ok:true,item});}catch(e){await client.query('ROLLBACK').catch(()=>{});console.error(e);res.status(500).json({error:'purchase_error'});}finally{client.release();}});
app.post('/api/inventory/equip',async(req,res)=>{const u=authUser(req);if(!u)return res.status(401).json({error:'unauthorized'});const code=String(req.body?.code||'').slice(0,64);try{const item=(await db.query('SELECT * FROM shop_items WHERE code=$1 AND enabled=true',[code])).rows[0];if(!item)return res.status(404).json({error:'item_not_found'});if(!(await db.query('SELECT 1 FROM player_items WHERE user_id=$1 AND item_id=$2 AND owned=true',[u.id,item.id])).rowCount)return res.status(403).json({error:'not_owned'});await db.query('UPDATE player_items p SET equipped=false FROM shop_items s WHERE p.item_id=s.id AND p.user_id=$1 AND s.type=$2',[u.id,item.type]);await db.query('UPDATE player_items SET equipped=true WHERE user_id=$1 AND item_id=$2',[u.id,item.id]);res.json({ok:true});}catch{res.status(500).json({error:'equip_error'});}});

const colors=['#00f6ff','#ff2bd6','#8cff00','#ffe600','#8b5cff','#ff6b35','#36ff8c','#ff3b6b'];
const rooms=new Map();
function makeRoom(code,ceo=false,hostId=null){return{code,ceo,hostId,players:new Map(),running:false,started:0,persistent:ceo,createdAt:Date.now()};}
function ensureCeoRoom(){let r=rooms.get(CEO_ROOM_CODE);if(!r){r=makeRoom(CEO_ROOM_CODE,true,null);rooms.set(CEO_ROOM_CODE,r);}return r;}
function randomRoomCode(){let code;do{code=crypto.randomBytes(5).toString('base64url').replace(/[-_]/g,'').slice(0,10).toUpperCase();}while(rooms.has(code));return code;}
function safePlayer(p){return{id:p.id,nickname:p.nickname,x:Number(p.x.toFixed(2)),y:Number(p.y.toFixed(2)),a:p.a,speed:Number(p.speed.toFixed(2)),energy:Number(p.energy.toFixed(1)),boost:Number(p.boost.toFixed(2)),alive:p.alive,trail:p.trail.slice(-100),kills:p.kills,color:p.color};}
function snapshot(r){return{code:r.code,ceo:r.ceo,hostId:r.hostId,running:r.running,started:r.started,players:[...r.players.values()].map(safePlayer)};}
function addPlayer(r,socket,nickname){const p=core.spawn(r.players.size);Object.assign(p,{id:socket.id,nickname:core.cleanNick(nickname)||'Piloto',color:colors[r.players.size%colors.length]});r.players.set(socket.id,p);socket.join(r.code);socket.data.room=r.code;socket.data.ceo=r.ceo;socket.data.strikes=0;return p;}
function leaveRoom(socket){const code=socket.data.room;if(!code)return;const r=rooms.get(code);if(!r)return;r.players.delete(socket.id);if(r.hostId===socket.id)r.hostId=r.players.keys().next().value||null;if(!r.players.size){if(r.ceo){r.running=false;r.started=0;r.hostId=null;}else rooms.delete(r.code);}else io.to(r.code).emit('state',snapshot(r));socket.data.room=null;}
function startRoom(r){if(r.running)return false;r.running=true;r.started=Date.now();let i=0;for(const p of r.players.values())Object.assign(p,core.spawn(i++),{id:p.id,nickname:p.nickname,color:p.color});io.to(r.code).emit('start',{code:r.code});io.to(r.code).emit('state',snapshot(r));return true;}

io.on('connection',socket=>{
  socket.data.strikes=0;
  const reject=(message, strike=true)=>{if(strike){socket.data.strikes=(socket.data.strikes||0)+1;if(socket.data.strikes>=10){socket.emit('error:game','Conexão encerrada por excesso de mensagens inválidas.');return socket.disconnect(true);}}socket.emit('error:game',message);};
  socket.on('room:create',payload=>{
    if(socket.data.room)return reject('Você já está em uma sala.',false);
    const nickname=core.cleanNick(payload?.nickname)||'Piloto';
    const ceo=payload?.ceo===true;
    if(ceo){if(String(payload?.key||'')!==CEO_KEY)return reject('Chave CEO inválida.');const r=ensureCeoRoom();if(r.running||r.players.size>=MAX)return reject('Sala CEO ocupada ou corrida em andamento.',false);r.hostId=socket.id;addPlayer(r,socket,nickname);socket.emit('room',{code:r.code,ceo:true,host:true});return io.to(r.code).emit('state',snapshot(r));}
    const code=randomRoomCode();const r=makeRoom(code,false,socket.id);addPlayer(r,socket,nickname);socket.emit('room',{code,ceo:false,host:true});io.to(code).emit('state',snapshot(r));
  });
  socket.on('room:join',payload=>{
    if(socket.data.room)return reject('Você já está em uma sala.',false);
    const raw=String(payload?.code||'').trim();if(!core.isRoomCodeLengthValid(raw))return reject('Código da sala inválido.',false);
    const code=core.normalizeRoomCode(raw);
    let r=rooms.get(code);
    if(code===CEO_ROOM_CODE){if(String(payload?.key||'')!==CEO_KEY)return reject('Chave da sala CEO inválida.');r=ensureCeoRoom();}
    if(!r)return reject('Sala não encontrada.',false);
    if(r.running)return reject('A corrida dessa sala já começou.',false);
    if(r.players.size>=MAX)return reject('Sala cheia.',false);
    addPlayer(r,socket,payload?.nickname);socket.emit('room',{code:r.code,ceo:r.ceo,host:r.hostId===socket.id});io.to(r.code).emit('state',snapshot(r));
  });
  socket.on('room:start',()=>{const r=rooms.get(socket.data.room);if(!r)return reject('Você não está em uma sala.',false);if(r.hostId!==socket.id)return reject('Apenas o criador/CEO pode iniciar.',false);if(r.ceo||r.players.size>=1)startRoom(r);});
  socket.on('input',payload=>{
    const r=rooms.get(socket.data.room),p=r?.players.get(socket.id);if(!r||!p||!p.alive||!r.running)return;
    const type=core.sanitizeInput(payload);if(!type)return reject('Entrada inválida.');
    const now=Date.now();const result=core.applyInput(p,type,now,r);
    if(!result.accepted)return;
    if(result.sabotage){const target=core.chooseSabotageTarget(p,r);if(target){target.speed=Math.max(3,target.speed*0.55);target.boost=0.25;target.sabotagedUntil=now+5000;target.sabotageHits=(target.sabotageHits||0)+1;io.to(r.code).emit('hit',{from:p.nickname,to:target.nickname});}}
  });
  socket.on('disconnect',()=>leaveRoom(socket));
});

setInterval(()=>{
  const now=Date.now();
  for(const r of rooms.values()){
    if(!r.running)continue;
    for(const p of r.players.values()){
      if(!p.alive)continue;
      const dt=core.TICK_MS/1000;
      core.stepPlayer(p,r,dt,now);
      if(core.collision(p,r))p.alive=false;
    }
    io.to(r.code).emit('state',snapshot(r));
  }
},core.TICK_MS);

process.on('SIGTERM',async()=>{await db?.end().catch(()=>{});process.exit(0);});
process.on('SIGINT',async()=>{await db?.end().catch(()=>{});process.exit(0);});

ensureCeoRoom();
async function boot(){
  if(!JWT_SECRET || JWT_SECRET.length<32) console.warn('WARNING: JWT_SECRET ausente ou menor que 32 caracteres. Login ficará indisponível.');
  try{await initDatabase();console.log('NEON PATH database: ready');}catch(e){console.error('database init:',e.message);}
  server.listen(PORT,()=>console.log(`NEON PATH 7.0 listening on ${PORT} | CEO ${CEO_ROOM_CODE}`));
}
boot();
