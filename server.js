require('dotenv').config();

const express = require('express');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const helmet = require('helmet');
const cors = require('cors');
const { Pool } = require('pg');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const PORT = Number(process.env.PORT || 3000);
const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-neon-path-secret-change-me-32';
const CEO_KEY = process.env.CEO_ROOM_KEY || 'Velho202026';
const CEO_ROOM_CODE = 'VELHO202026';
const MAX_ROOM_CODE_LENGTH = 15;
const pool = process.env.DATABASE_URL
  ? new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 5 })
  : null;
const db = pool;

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: process.env.CLIENT_ORIGIN || '*' }));
app.use(express.json({ limit: '32kb' }));
app.use(express.static(__dirname));

function cleanNick(v) {
  return typeof v === 'string' && /^[A-Za-z0-9_À-ÿ ]{2,20}$/.test(v.trim()) ? v.trim() : null;
}
function cleanEmail(v) {
  return typeof v === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim().toLowerCase()) ? v.trim().toLowerCase() : null;
}
function validPassword(v) { return typeof v === 'string' && v.length >= 8 && v.length <= 200; }
function signUser(user) {
  return jwt.sign({ sub: String(user.id), nickname: user.nickname }, JWT_SECRET, { expiresIn: '30d' });
}
function authUser(req) {
  try {
    const h = req.headers.authorization || '';
    const token = h.startsWith('Bearer ') ? h.slice(7) : null;
    if (!token) return null;
    const p = jwt.verify(token, JWT_SECRET);
    return { id: Number(p.sub), nickname: p.nickname };
  } catch { return null; }
}

async function initDatabase() {
  if (!db) return;
  // Migration segura: permite usar um PostgreSQL que já possuía uma tabela users
  // de versões anteriores do NEON PATH.
  await db.query(`
    CREATE TABLE IF NOT EXISTS users (
      id BIGSERIAL PRIMARY KEY,
      nickname VARCHAR(20),
      email VARCHAR(160),
      password_hash TEXT,
      ph INTEGER NOT NULL DEFAULT 1000,
      wins INTEGER NOT NULL DEFAULT 0,
      kills INTEGER NOT NULL DEFAULT 0,
      races INTEGER NOT NULL DEFAULT 0,
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
  `);

  // Compatibilidade com bancos antigos que usavam username/password.
  const cols = (await db.query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema='public' AND table_name='users'
  `)).rows.map(r=>r.column_name);
  if (cols.includes('username')) {
    await db.query(`UPDATE users SET nickname=LEFT(username,20) WHERE (nickname IS NULL OR nickname='') AND username IS NOT NULL`);
  }
  if (cols.includes('password')) {
    await db.query(`UPDATE users SET password_hash=password WHERE (password_hash IS NULL OR password_hash='') AND password IS NOT NULL`);
  }
  await db.query(`UPDATE users SET nickname='Piloto_'||id::text WHERE nickname IS NULL OR nickname=''`);
  await db.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_users_nickname_lower ON users (LOWER(nickname))`);
  await db.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_users_email_lower ON users (LOWER(email)) WHERE email IS NOT NULL AND email<>''`);

  await db.query(`
    CREATE TABLE IF NOT EXISTS race_results (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
      nickname VARCHAR(20) NOT NULL,
      position INTEGER NOT NULL,
      kills INTEGER NOT NULL DEFAULT 0,
      ph_delta INTEGER NOT NULL DEFAULT 0,
      map VARCHAR(40) NOT NULL DEFAULT 'Neon Canyon',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS player_profiles (
      user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      level INTEGER NOT NULL DEFAULT 1,
      xp BIGINT NOT NULL DEFAULT 0,
      prestige INTEGER NOT NULL DEFAULT 0,
      character_id INTEGER NOT NULL DEFAULT 1,
      total_wins INTEGER NOT NULL DEFAULT 0,
      total_races INTEGER NOT NULL DEFAULT 0,
      ph INTEGER NOT NULL DEFAULT 1000,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS player_characters (
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      character_id INTEGER NOT NULL,
      unlocked BOOLEAN NOT NULL DEFAULT FALSE,
      selected BOOLEAN NOT NULL DEFAULT FALSE,
      PRIMARY KEY(user_id, character_id)
    );
    CREATE TABLE IF NOT EXISTS shop_items (
      id SERIAL PRIMARY KEY,
      code VARCHAR(64) UNIQUE NOT NULL,
      name VARCHAR(120) NOT NULL,
      type VARCHAR(32) NOT NULL,
      price INTEGER NOT NULL DEFAULT 0,
      rarity VARCHAR(24) NOT NULL DEFAULT 'common',
      data JSONB NOT NULL DEFAULT '{}'::jsonb,
      enabled BOOLEAN NOT NULL DEFAULT TRUE
    );
    CREATE TABLE IF NOT EXISTS player_items (
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      item_id INTEGER NOT NULL REFERENCES shop_items(id) ON DELETE CASCADE,
      owned BOOLEAN NOT NULL DEFAULT TRUE,
      equipped BOOLEAN NOT NULL DEFAULT FALSE,
      PRIMARY KEY(user_id, item_id)
    );
    CREATE INDEX IF NOT EXISTS idx_users_ph ON users(ph DESC);
    CREATE INDEX IF NOT EXISTS idx_profiles_prestige ON player_profiles(prestige DESC, level DESC, xp DESC);
  `);
  await ensureStore();
}

function xpForLevel(level) { return Math.floor(100 * Math.pow(1.12, Math.max(0, level - 1))); }

async function getProfile(userId) {
  if (!db) return null;
  await db.query(`INSERT INTO player_profiles(user_id) VALUES($1) ON CONFLICT DO NOTHING`, [userId]);
  await db.query(`INSERT INTO player_characters(user_id,character_id,unlocked,selected) VALUES($1,1,TRUE,TRUE) ON CONFLICT DO NOTHING`, [userId]);
  const p = (await db.query(`
    SELECT p.*, u.nickname, u.bruto_coins
    FROM player_profiles p JOIN users u ON u.id=p.user_id
    WHERE p.user_id=$1`, [userId])).rows[0];
  const chars = (await db.query(`SELECT character_id,unlocked,selected FROM player_characters WHERE user_id=$1 ORDER BY character_id`, [userId])).rows;
  return { ...p, characters: chars };
}

const CHARACTER_IDS = [1,2,3,4,5,6];
const STORE_CATALOG = [
  { code:'crown_royal', name:'Coroa Imperial Neon', type:'crown', price:0, rarity:'legendary', data:{glow:'#ffd84a', aura:'gold'} },
  { code:'crown_cyber', name:'Coroa Cyber Real', type:'crown', price:4200, rarity:'epic', data:{glow:'#00f6ff', aura:'cyan'} },
  { code:'trail_plasma', name:'Rastro Plasma', type:'trail', price:2600, rarity:'epic', data:{color:'#ff25d9', width:1.7} },
  { code:'trail_lime', name:'Rastro Veneno', type:'trail', price:1800, rarity:'rare', data:{color:'#8cff00', width:1.4} },
  { code:'aura_phantom', name:'Aura Fantasma', type:'aura', price:5200, rarity:'legendary', data:{color:'#8c5cff', pulse:true} },
  { code:'engine_sparks', name:'Faíscas Turbo', type:'effect', price:1400, rarity:'rare', data:{color:'#00f6ff'} },
  { code:'neon_wings', name:'Asas de Neon', type:'back', price:6800, rarity:'mythic', data:{color:'#ff25d9'} },
  { code:'spawn_burst', name:'Entrada Explosiva', type:'effect', price:3500, rarity:'epic', data:{color:'#ffe600'} }
];

async function ensureStore() {
  if (!db) return;
  for (const it of STORE_CATALOG) {
    await db.query(`INSERT INTO shop_items(code,name,type,price,rarity,data) VALUES($1,$2,$3,$4,$5,$6)
      ON CONFLICT(code) DO UPDATE SET name=EXCLUDED.name,type=EXCLUDED.type,price=EXCLUDED.price,rarity=EXCLUDED.rarity,data=EXCLUDED.data`,
      [it.code,it.name,it.type,it.price,it.rarity,it.data]);
  }
}

app.get('/health', async (_req, res) => {
  let database = 'disabled';
  try { if (db) { await db.query('SELECT 1'); database = 'ok'; } }
  catch { database = 'error'; }
  res.json({ ok:true, service:'NEON PATH', database, version:'6.1.0' });
});

app.post('/api/auth/register', async (req,res) => {
  if (!db) return res.status(503).json({error:'database_unavailable'});
  const nickname=cleanNick(req.body?.username || req.body?.nickname);
  const email=cleanEmail(req.body?.email);
  const password=req.body?.password;
  if (!nickname) return res.status(400).json({error:'apelido inválido'});
  if (!validPassword(password)) return res.status(400).json({error:'senha deve ter pelo menos 8 caracteres'});
  try {
    const hash=await bcrypt.hash(password,12);
    const q=await db.query(`INSERT INTO users(nickname,email,password_hash) VALUES($1,$2,$3) RETURNING id,nickname`,[nickname,email || null,hash]);
    const user=q.rows[0];
    await getProfile(user.id);
    res.json({token:signUser(user),nickname:user.nickname});
  } catch(e) {
    if (e.code==='23505') return res.status(409).json({error:'apelido ou e-mail já cadastrado'});
    console.error('register:',e); res.status(500).json({error:'register_error'});
  }
});

app.post('/api/auth/login', async (req,res) => {
  if (!db) return res.status(503).json({error:'database_unavailable'});
  const nickname=cleanNick(req.body?.username || req.body?.nickname);
  const email=cleanEmail(req.body?.email);
  const password=req.body?.password;
  if (!password || (!nickname && !email)) return res.status(400).json({error:'dados de login inválidos'});
  try {
    const q=await db.query(`SELECT id,nickname,password_hash FROM users WHERE ${email?'lower(email)=lower($1)':'lower(nickname)=lower($1)'} LIMIT 1`,[email||nickname]);
    const user=q.rows[0];
    if (!user?.password_hash || !(await bcrypt.compare(password,user.password_hash))) return res.status(401).json({error:'apelido/e-mail ou senha incorretos'});
    res.json({token:signUser(user),nickname:user.nickname});
  } catch(e) { console.error('login:',e); res.status(500).json({error:'login_error',detail:process.env.NODE_ENV==='production'?undefined:e.message}); }
});

app.post('/api/auth/guest', async (req,res) => {
  const nickname=cleanNick(req.body?.nickname); if(!nickname)return res.status(400).json({error:'apelido inválido'});
  if(!db)return res.json({token:jwt.sign({sub:'guest-'+crypto.randomUUID(),nickname},JWT_SECRET,{expiresIn:'7d'}),nickname});
  try {
    let q=await db.query('SELECT id,nickname FROM users WHERE lower(nickname)=lower($1)',[nickname]);
    let user=q.rows[0];
    if(!user){const h=await bcrypt.hash(crypto.randomBytes(18).toString('hex'),10);q=await db.query('INSERT INTO users(nickname,password_hash) VALUES($1,$2) RETURNING id,nickname',[nickname,h]);user=q.rows[0];}
    await getProfile(user.id); res.json({token:signUser(user),nickname:user.nickname});
  } catch(e){console.error('guest:',e);res.status(500).json({error:'banco'});}
});

app.get('/api/rank', async (_req,res)=>{
  if(!db)return res.json([]);
  try{const q=await db.query('SELECT nickname,ph,wins,kills,races FROM users ORDER BY ph DESC,wins DESC LIMIT 50');res.json(q.rows);}
  catch(e){console.error('rank:',e);res.status(500).json({error:'rank'});}
});

app.get('/api/profile', async(req,res)=>{
  const u=authUser(req); if(!u?.id)return res.status(401).json({error:'unauthorized'});
  try{res.json(await getProfile(u.id));}catch(e){console.error('profile:',e);res.status(500).json({error:'profile_error'});}
});

app.post('/api/profile/character', async(req,res)=>{
  const u=authUser(req); if(!u?.id)return res.status(401).json({error:'unauthorized'});
  const id=Number(req.body?.characterId); if(!CHARACTER_IDS.includes(id))return res.status(400).json({error:'invalid_character'});
  try{
    const q=await db.query('SELECT unlocked FROM player_characters WHERE user_id=$1 AND character_id=$2',[u.id,id]);
    if(!q.rows[0]?.unlocked)return res.status(403).json({error:'locked'});
    await db.query('UPDATE player_profiles SET character_id=$2,updated_at=NOW() WHERE user_id=$1',[u.id,id]);
    await db.query('UPDATE player_characters SET selected=(character_id=$2) WHERE user_id=$1',[u.id,id]);
    res.json(await getProfile(u.id));
  }catch(e){console.error('character:',e);res.status(500).json({error:'save_error'});}
});

app.post('/api/profile/xp', async(req,res)=>{
  const u=authUser(req); if(!u?.id)return res.status(401).json({error:'unauthorized'});
  const gain=Math.max(0,Math.min(5000,Number(req.body?.xp)||0));
  try{
    const old=(await db.query('SELECT level,xp,prestige FROM player_profiles WHERE user_id=$1',[u.id])).rows[0]||{level:1,xp:0,prestige:0};
    let total=Number(old.xp)+gain, level=Number(old.level), prestige=Number(old.prestige);
    while(level<100 && total>=xpForLevel(level)){total-=xpForLevel(level);level++;}
    if(level>=100 && total>=xpForLevel(100)){prestige++;level=1;total=0;}
    await db.query('UPDATE player_profiles SET level=$2,xp=$3,prestige=$4,updated_at=NOW() WHERE user_id=$1',[u.id,level,total,prestige]);
    res.json(await getProfile(u.id));
  }catch(e){console.error('xp:',e);res.status(500).json({error:'xp_error'});}
});

app.get('/api/shop',async(_req,res)=>{try{const r=await db.query('SELECT id,code,name,type,price,rarity,data FROM shop_items WHERE enabled=true ORDER BY price');res.json(r.rows);}catch(e){res.status(500).json({error:'shop_error'});}});
app.get('/api/inventory',async(req,res)=>{const u=authUser(req);if(!u?.id)return res.status(401).json({error:'unauthorized'});try{const r=await db.query(`SELECT s.id,s.code,s.name,s.type,s.price,s.rarity,s.data,p.equipped FROM player_items p JOIN shop_items s ON s.id=p.item_id WHERE p.user_id=$1 AND p.owned=true ORDER BY s.type,s.id`,[u.id]);res.json(r.rows);}catch(e){res.status(500).json({error:'inventory_error'});}});
app.post('/api/shop/buy',async(req,res)=>{
  const u=authUser(req);if(!u?.id)return res.status(401).json({error:'unauthorized'});const code=String(req.body?.code||'');const client=await db.connect();
  try{await client.query('BEGIN');const item=(await client.query('SELECT * FROM shop_items WHERE code=$1 AND enabled=true FOR UPDATE',[code])).rows[0];if(!item){await client.query('ROLLBACK');return res.status(404).json({error:'item_not_found'});}const owned=(await client.query('SELECT 1 FROM player_items WHERE user_id=$1 AND item_id=$2',[u.id,item.id])).rowCount;if(owned){await client.query('ROLLBACK');return res.status(409).json({error:'already_owned'});}if(Number(item.price)>0){const q=await client.query('UPDATE users SET bruto_coins=bruto_coins-$1 WHERE id=$2 AND bruto_coins >= $1 RETURNING bruto_coins',[item.price,u.id]);if(!q.rowCount){await client.query('ROLLBACK');return res.status(400).json({error:'insufficient_coins'});}}await client.query('INSERT INTO player_items(user_id,item_id) VALUES($1,$2)',[u.id,item.id]);await client.query('COMMIT');res.json({ok:true,item});}
  catch(e){await client.query('ROLLBACK').catch(()=>{});console.error('buy:',e);res.status(500).json({error:'purchase_error'});}finally{client.release();}
});
app.post('/api/inventory/equip',async(req,res)=>{const u=authUser(req);if(!u?.id)return res.status(401).json({error:'unauthorized'});const code=String(req.body?.code||'');try{const item=(await db.query('SELECT * FROM shop_items WHERE code=$1',[code])).rows[0];if(!item)return res.status(404).json({error:'item_not_found'});const owned=(await db.query('SELECT 1 FROM player_items WHERE user_id=$1 AND item_id=$2 AND owned=true',[u.id,item.id])).rowCount;if(!owned)return res.status(403).json({error:'not_owned'});await db.query('UPDATE player_items p SET equipped=false FROM shop_items s WHERE p.item_id=s.id AND p.user_id=$1 AND s.type=$2',[u.id,item.type]);await db.query('UPDATE player_items SET equipped=true WHERE user_id=$1 AND item_id=$2',[u.id,item.id]);res.json({ok:true});}catch(e){res.status(500).json({error:'equip_error'});}});

// ===== Multiplayer =====
const io=new Server(server,{cors:{origin:process.env.CLIENT_ORIGIN||'*'}});
const rooms=new Map(), MAX=8, W=120, H=80, TICK=1000/30, MAX_SPEED=18;
const colors=['#00f6ff','#ff2bd6','#8cff00','#ffe600','#8b5cff','#ff6b35','#36ff8c','#ff3b6b'];
function roomCode(){return crypto.randomBytes(3).toString('hex').toUpperCase();}
function makeRoom(code,ceo=false){return{code,ceo,players:new Map(),running:false,started:0,last:Date.now(),persistent:!!ceo};}
function normalizeRoomCode(v){return String(v||'').trim().toUpperCase();}
function ensureCeoRoom(){let r=rooms.get(CEO_ROOM_CODE);if(!r){r=makeRoom(CEO_ROOM_CODE,true);rooms.set(CEO_ROOM_CODE,r);}return r;}
function spawn(i){const a=[[15,15,0],[105,15,Math.PI],[15,65,0],[105,65,Math.PI],[60,12,Math.PI/2],[60,68,-Math.PI/2],[25,40,0],[95,40,Math.PI]][i%8];return{x:a[0],y:a[1],a:a[2],speed:9,energy:100,boost:0,alive:true,trail:[],kills:0,lastTurn:0,lastTurbo:0,lastSab:0};}
function snap(r){return{code:r.code,running:r.running,started:r.started,players:[...r.players.values()].map(p=>({id:p.id,nickname:p.nickname,x:p.x,y:p.y,a:p.a,speed:p.speed,energy:p.energy,boost:p.boost,alive:p.alive,trail:p.trail.slice(-350),kills:p.kills,color:p.color}))};}
function collision(p,r){if(p.x<2||p.y<2||p.x>W-2||p.y>H-2)return true;for(const q of r.players.values()){if(q.id!==p.id&&q.alive&&Math.hypot(p.x-q.x,p.y-q.y)<1.6)return true;}for(const q of r.players.values()){if(q.id===p.id)continue;for(const t of q.trail.slice(-350)){if(Math.abs(p.x-t[0])<.75&&Math.abs(p.y-t[1])<.75)return true;}}return false;}
function start(r){if(r.running)return;r.running=true;r.started=Date.now();let i=0;for(const p of r.players.values())Object.assign(p,spawn(i++));io.to(r.code).emit('start',{code:r.code});}

io.on('connection',s=>{
  s.on('room:create',({nickname,ceo,key}={})=>{
    nickname=cleanNick(nickname)||'Piloto';
    const wantsCeo=!!ceo;
    if(wantsCeo && key!==CEO_KEY)return s.emit('error:game','Chave CEO inválida');
    const code=wantsCeo?CEO_ROOM_CODE:roomCode();
    if(wantsCeo){
      const r=ensureCeoRoom();
      if(r.running||r.players.size>=MAX)return s.emit('error:game','Sala CEO ocupada ou corrida iniciada');
      const p=spawn(r.players.size);Object.assign(p,{id:s.id,nickname,color:colors[r.players.size]});
      r.players.set(s.id,p);s.join(r.code);s.data.room=r.code;s.data.ceo=true;s.emit('room',{code:r.code,ceo:true});io.to(r.code).emit('state',snap(r));return;
    }
    let finalCode=code;while(rooms.has(finalCode))finalCode=roomCode();
    const r=makeRoom(finalCode,false);rooms.set(finalCode,r);
    const p=spawn(0);Object.assign(p,{id:s.id,nickname,color:colors[0]});r.players.set(s.id,p);s.join(finalCode);s.data.room=finalCode;s.data.ceo=false;s.emit('room',{code:finalCode,ceo:false});io.to(finalCode).emit('state',snap(r));
  });
  s.on('room:join',({code,nickname,key}={})=>{
    code=normalizeRoomCode(code);
    if(code.length>MAX_ROOM_CODE_LENGTH)return s.emit('error:game','Código da sala deve ter no máximo 15 caracteres');
    let r=rooms.get(code);
    if(code===CEO_ROOM_CODE){
      if(key!==CEO_KEY)return s.emit('error:game','Chave da sala CEO inválida');
      r=ensureCeoRoom();
    }
    if(!r)return s.emit('error:game','Sala não encontrada');
    if(r.running||r.players.size>=MAX)return s.emit('error:game','Sala cheia ou corrida iniciada');
    const p=spawn(r.players.size);Object.assign(p,{id:s.id,nickname:cleanNick(nickname)||'Piloto',color:colors[r.players.size]});
    r.players.set(s.id,p);s.join(r.code);s.data.room=r.code;s.data.ceo=!!r.ceo;s.emit('room',{code:r.code,ceo:r.ceo});io.to(r.code).emit('state',snap(r));
  });
  s.on('room:start',()=>{const r=rooms.get(s.data.room);if(r&&r.ceo&&r.players.get(s.id))start(r);});
  s.on('input',m=>{const r=rooms.get(s.data.room),p=r?.players.get(s.id);if(!r||!p||!p.alive||!r.running)return;const now=Date.now();if(now-p.lastTurn<70)return;const type=m?.type;if(type==='left'||type==='right'){p.a+=(type==='left'?-1:1)*Math.PI/2;p.lastTurn=now;}if(type==='turbo'&&p.energy>=20&&now-p.lastTurbo>900){p.energy-=20;p.boost=1.65;p.lastTurbo=now;}if(type==='sabotage'&&p.energy>=30&&now-p.lastSab>8000){p.energy-=30;p.lastSab=now;let target=null,d=999;for(const q of r.players.values())if(q.alive&&q.id!==p.id){const dd=Math.hypot(p.x-q.x,p.y-q.y);if(dd<d){d=dd;target=q;}}if(target&&d<12){target.speed=Math.max(3,target.speed*.55);target.boost=.25;s.to(r.code).emit('hit',{from:p.nickname,to:target.nickname});}}});
  s.on('disconnect',()=>{const r=rooms.get(s.data.room);if(r){r.players.delete(s.id);if(!r.players.size&&!r.persistent)rooms.delete(r.code);else io.to(r.code).emit('state',snap(r));}});
});

setInterval(()=>{const now=Date.now();for(const r of rooms.values()){if(!r.running)continue;for(const p of r.players.values()){if(!p.alive)continue;const dt=TICK/1000,max=MAX_SPEED*(p.boost>0?1.65:1);p.speed+=((9+Math.min(6,(now-r.started)/30000))-p.speed)*.08;p.speed=Math.min(p.speed,max);p.x+=Math.cos(p.a)*p.speed*dt;p.y+=Math.sin(p.a)*p.speed*dt;p.energy=Math.min(100,p.energy+4*dt);p.boost=Math.max(0,p.boost-dt);p.trail.push([+p.x.toFixed(2),+p.y.toFixed(2)]);if(p.trail.length>450)p.trail.shift();if(collision(p,r))p.alive=false;}io.to(r.code).emit('state',snap(r));}},TICK);

ensureCeoRoom();
server.listen(PORT,()=>console.log(`NEON PATH listening on ${PORT} | CEO room ${CEO_ROOM_CODE}`));

initDatabase().then(()=>console.log('NEON PATH database: ready')).catch(err=>console.error('database init:',err));
