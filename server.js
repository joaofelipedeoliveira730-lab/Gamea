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
const core = require('./game-core');
const dbCompat = require('./db-compat');

const app = express();
const server = http.createServer(app);
const PORT = Number(process.env.PORT || 3000);
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
if (IS_PRODUCTION && !process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL é obrigatório em produção. Conecte um Render Postgres antes de iniciar o serviço.');
}
if (IS_PRODUCTION && (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32)) {
  throw new Error('JWT_SECRET com pelo menos 32 caracteres é obrigatório em produção.');
}
if (IS_PRODUCTION && (!process.env.CEO_ROOM_KEY || process.env.CEO_ROOM_KEY.length < 12)) {
  throw new Error('CEO_ROOM_KEY com pelo menos 12 caracteres é obrigatório em produção.');
}
const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-neon-path-secret-change-me-32';
const CEO_KEY = process.env.CEO_ROOM_KEY || 'dev-ceo-key-change-me';
const databaseSsl = process.env.PGSSLMODE==='disable'||/\b(?:localhost|127\.0\.0\.1)\b/i.test(process.env.DATABASE_URL||'')
  ? false : { rejectUnauthorized: process.env.PGSSL_REJECT_UNAUTHORIZED==='true' };
const pool = process.env.DATABASE_URL
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: databaseSsl,
      max: 5,
      idleTimeoutMillis:30_000,
      connectionTimeoutMillis:8_000,
      statement_timeout:10_000,
      query_timeout:12_000,
      keepAlive:true
    })
  : null;
if (pool) pool.on('error',error=>console.error('NEON PATH PostgreSQL idle client error:',error.message));
const db = pool;
let requiredUserInsertColumns=[];

function normalizeAllowedOrigins(value) {
  const raw=String(value||'').split(',').map(v=>v.trim()).filter(Boolean);
  if (!raw.length || raw.includes('*')) return ['*'];
  return [...new Set(raw.map(value=>{
    try {
      const url=new URL(value);
      if (!['http:','https:'].includes(url.protocol)) throw new Error('protocol');
      return url.origin;
    } catch {
      throw new Error(`CLIENT_ORIGIN inválido: ${value}. Use uma URL completa, por exemplo https://seu-jogo.onrender.com`);
    }
  }))];
}
const allowedOrigins = normalizeAllowedOrigins(process.env.CLIENT_ORIGIN);
const corsOrigin = allowedOrigins.includes('*') ? '*' : (origin, callback) => callback(null, !origin || allowedOrigins.includes(origin));
app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy:{policy:'cross-origin'} }));
app.use(cors({ origin: corsOrigin, credentials: allowedOrigins[0] !== '*' }));
app.use(express.json({ limit: '32kb' }));
// O projeto é plano para facilitar o GitHub, mas o backend não deve virar arquivo público.
const PRIVATE_WEB_FILES=new Set(['server.js','game-core.js','db-compat.js','package.json','package-lock.json','schema.sql','render.yaml','README.md','QA-12.0.txt','RELATORIO-12.0-PRESTIGE.md','test.js','test-qa.js','test-room.js']);
app.use((req,res,next)=>{
  if(req.method!=='GET'&&req.method!=='HEAD')return next();
  const name=path.basename(req.path||'');
  if(name.startsWith('.')||PRIVATE_WEB_FILES.has(name)||/^test(?:-|\.)/i.test(name)||/\.(?:sql|ya?ml|md|txt)$/i.test(name))return res.status(404).end();
  next();
});
app.use(express.static(__dirname,{dotfiles:'deny',etag:true,maxAge:IS_PRODUCTION?'1h':0,index:'index.html'}));

function createRateLimit(windowMs, max) {
  const hits = new Map();
  return (req,res,next) => {
    const key = req.ip || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const item = hits.get(key);
    if (!item || now - item.started >= windowMs) hits.set(key,{started:now,count:1});
    else if (++item.count > max) return res.status(429).json({error:'muitas_tentativas'});
    if (hits.size > 2000) for (const [id,value] of hits) if (now-value.started >= windowMs) hits.delete(id);
    next();
  };
}
const authRateLimit = createRateLimit(60_000, 18);
const reportRateLimit = createRateLimit(60_000, 10);

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

async function migrationStep(name, task) {
  try { return await task(); }
  catch (error) {
    console.error(`[database migration: ${name}]`, error.message, error.code || '');
    throw error;
  }
}

async function tableColumns(table) {
  const result=await db.query(`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1`,[table]);
  return new Set(result.rows.map(row=>row.column_name));
}

async function ensureColumns(table, definitions) {
  if(!/^[a-z_]+$/.test(table))throw new Error('invalid migration table');
  for(const definition of definitions){
    const column=definition.trim().split(/\s+/)[0];
    if(!/^[a-z_]+$/.test(column))throw new Error('invalid migration column');
    await migrationStep(`${table}.${column}`,()=>db.query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${definition}`));
  }
}

async function requiredInsertColumns(table) {
  if(!/^[a-z_]+$/.test(table))throw new Error('invalid compatibility table');
  return (await db.query(`
    SELECT c.column_name,c.data_type,c.udt_name,c.character_maximum_length,
      (SELECT e.enumlabel FROM pg_type t JOIN pg_enum e ON e.enumtypid=t.oid
       WHERE t.typname=c.udt_name ORDER BY e.enumsortorder LIMIT 1) AS enum_label
    FROM information_schema.columns c
    WHERE c.table_schema='public' AND c.table_name=$1
      AND c.is_nullable='NO' AND c.column_default IS NULL
      AND COALESCE(c.is_identity,'NO')='NO' AND COALESCE(c.is_generated,'NEVER')='NEVER'
    ORDER BY c.ordinal_position`,[table])).rows;
}

async function initDatabase() {
  if (!db) return;

  // Cada tabela é migrada em etapas. Assim bancos de versões antigas recebem
  // todas as colunas antes da criação de índices que dependem delas.
  await migrationStep('users.create',()=>db.query(`CREATE TABLE IF NOT EXISTS users (id BIGSERIAL PRIMARY KEY)`));
  await ensureColumns('users',[
    'id BIGSERIAL','nickname VARCHAR(20)','email VARCHAR(160)','password_hash TEXT',
    'ph INTEGER NOT NULL DEFAULT 1000','wins INTEGER NOT NULL DEFAULT 0','kills INTEGER NOT NULL DEFAULT 0',
    'races INTEGER NOT NULL DEFAULT 0','bruto_coins INTEGER NOT NULL DEFAULT 15000',
    "role VARCHAR(24) NOT NULL DEFAULT 'player'",'last_seen_at TIMESTAMPTZ','created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()'
  ]);
  requiredUserInsertColumns=await requiredInsertColumns('users');
  await migrationStep('users.id-index',()=>db.query('CREATE UNIQUE INDEX IF NOT EXISTS uq_users_id ON users(id)'));

  const userCols=await tableColumns('users');
  if(userCols.has('username'))await migrationStep('users.legacy-username',()=>db.query(`UPDATE users SET nickname=LEFT(username,20) WHERE (nickname IS NULL OR nickname='') AND username IS NOT NULL`));
  if(userCols.has('password'))await migrationStep('users.legacy-password',()=>db.query(`UPDATE users SET password_hash=password WHERE (password_hash IS NULL OR password_hash='') AND password IS NOT NULL`));
  await migrationStep('users.fill-nickname',()=>db.query(`UPDATE users SET nickname=LEFT('Piloto_'||id::text,20) WHERE nickname IS NULL OR nickname=''`));
  await migrationStep('users.dedupe-nickname',()=>db.query(`
    WITH ranked AS (SELECT id,ROW_NUMBER() OVER(PARTITION BY LOWER(nickname) ORDER BY id) AS n FROM users)
    UPDATE users u SET nickname=LEFT(COALESCE(NULLIF(u.nickname,''),'Piloto'),10)||'_'||LEFT(MD5(u.id::text),8)
    FROM ranked r WHERE r.id=u.id AND r.n>1`));
  await migrationStep('users.dedupe-email',()=>db.query(`
    WITH ranked AS (SELECT id,ROW_NUMBER() OVER(PARTITION BY LOWER(email) ORDER BY id) AS n FROM users WHERE email IS NOT NULL AND email<>'')
    UPDATE users u SET email=NULL FROM ranked r WHERE r.id=u.id AND r.n>1`));
  await migrationStep('users.nickname-index',()=>db.query('CREATE UNIQUE INDEX IF NOT EXISTS uq_users_nickname_lower ON users(LOWER(nickname))'));
  await migrationStep('users.email-index',()=>db.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_users_email_lower ON users(LOWER(email)) WHERE email IS NOT NULL AND email<>''`));
  await migrationStep('users.ph-index',()=>db.query('CREATE INDEX IF NOT EXISTS idx_users_ph ON users(ph DESC)'));

  await migrationStep('race_results.create',()=>db.query(`CREATE TABLE IF NOT EXISTS race_results (id BIGSERIAL PRIMARY KEY)`));
  await ensureColumns('race_results',[
    'id BIGSERIAL','user_id BIGINT',"nickname VARCHAR(20) NOT NULL DEFAULT 'Piloto'",'position INTEGER NOT NULL DEFAULT 8',
    'kills INTEGER NOT NULL DEFAULT 0','ph_delta INTEGER NOT NULL DEFAULT 0',"map VARCHAR(40) NOT NULL DEFAULT 'Neon Canyon'",
    'xp_earned INTEGER NOT NULL DEFAULT 0','coins_earned INTEGER NOT NULL DEFAULT 0','duration_ms INTEGER NOT NULL DEFAULT 0',
    "mode VARCHAR(24) NOT NULL DEFAULT 'room'",'character_id INTEGER NOT NULL DEFAULT 1','created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()'
  ]);
  await migrationStep('race_results.user-created-index',()=>db.query('CREATE INDEX IF NOT EXISTS idx_results_user_created ON race_results(user_id,created_at DESC)'));

  await migrationStep('player_profiles.create',()=>db.query(`CREATE TABLE IF NOT EXISTS player_profiles (user_id BIGINT PRIMARY KEY)`));
  const oldProfileCols=await tableColumns('player_profiles');
  await ensureColumns('player_profiles',[
    'user_id BIGINT','level INTEGER NOT NULL DEFAULT 1','xp BIGINT NOT NULL DEFAULT 0','prestige INTEGER NOT NULL DEFAULT 0',
    'character_id INTEGER NOT NULL DEFAULT 1','total_wins INTEGER NOT NULL DEFAULT 0','total_races INTEGER NOT NULL DEFAULT 0',
    'ph INTEGER NOT NULL DEFAULT 1000','lifetime_xp BIGINT NOT NULL DEFAULT 0','daily_races INTEGER NOT NULL DEFAULT 0',
    'daily_races_date DATE','created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()','updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()'
  ]);
  if(oldProfileCols.has('id'))await migrationStep('player_profiles.legacy-id',()=>db.query('UPDATE player_profiles SET user_id=id WHERE user_id IS NULL'));
  await migrationStep('player_profiles.user-index',()=>db.query('CREATE UNIQUE INDEX IF NOT EXISTS uq_player_profiles_user ON player_profiles(user_id)'));
  await migrationStep('player_profiles.prestige-index',()=>db.query('CREATE INDEX IF NOT EXISTS idx_profiles_prestige ON player_profiles(prestige DESC,level DESC,xp DESC)'));
  await migrationStep('player_profiles.lifetime-index',()=>db.query('CREATE INDEX IF NOT EXISTS idx_profiles_lifetime_xp ON player_profiles(lifetime_xp DESC)'));
  await migrationStep('player_profiles.seed-lifetime',()=>db.query('UPDATE player_profiles SET lifetime_xp=GREATEST(lifetime_xp,xp) WHERE lifetime_xp < xp'));

  await migrationStep('player_characters.create',()=>db.query(`CREATE TABLE IF NOT EXISTS player_characters (user_id BIGINT NOT NULL,character_id INTEGER NOT NULL,unlocked BOOLEAN NOT NULL DEFAULT FALSE,selected BOOLEAN NOT NULL DEFAULT FALSE,PRIMARY KEY(user_id,character_id))`));
  await ensureColumns('player_characters',['user_id BIGINT','character_id INTEGER','unlocked BOOLEAN NOT NULL DEFAULT FALSE','selected BOOLEAN NOT NULL DEFAULT FALSE']);
  await migrationStep('player_characters.user-character-index',()=>db.query('CREATE UNIQUE INDEX IF NOT EXISTS uq_player_characters_user_character ON player_characters(user_id,character_id)'));

  // A loja usa nomes exclusivos do NEON PATH. Bancos reutilizados podem possuir
  // shop_items/player_items de outros projetos com CHECKs incompatíveis.
  await migrationStep('neon_shop_items.create',()=>db.query(`CREATE TABLE IF NOT EXISTS neon_shop_items (
    id SERIAL PRIMARY KEY,code VARCHAR(64) UNIQUE NOT NULL,name VARCHAR(120) NOT NULL,description VARCHAR(220),
    type VARCHAR(32) NOT NULL,price INTEGER NOT NULL DEFAULT 0 CHECK(price>=0),
    rarity VARCHAR(24) NOT NULL DEFAULT 'common',data JSONB NOT NULL DEFAULT '{}'::jsonb,enabled BOOLEAN NOT NULL DEFAULT TRUE
  )`));
  await migrationStep('neon_player_items.create',()=>db.query(`CREATE TABLE IF NOT EXISTS neon_player_items (
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    item_id INTEGER NOT NULL REFERENCES neon_shop_items(id) ON DELETE CASCADE,
    owned BOOLEAN NOT NULL DEFAULT TRUE,equipped BOOLEAN NOT NULL DEFAULT FALSE,PRIMARY KEY(user_id,item_id)
  )`));

  await migrationStep('bug_reports.create',()=>db.query(`CREATE TABLE IF NOT EXISTS bug_reports (id BIGSERIAL PRIMARY KEY)`));
  await ensureColumns('bug_reports',[
    'id BIGSERIAL','user_id BIGINT','nickname VARCHAR(20)','fingerprint VARCHAR(80)',"message TEXT NOT NULL DEFAULT 'Erro legado'",
    'stack TEXT','source VARCHAR(80)','screen VARCHAR(80)','track VARCHAR(80)','mode VARCHAR(40)',
    'resolved BOOLEAN NOT NULL DEFAULT FALSE','created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()'
  ]);
  await migrationStep('bug_reports.open-index',()=>db.query('CREATE INDEX IF NOT EXISTS idx_bug_reports_open ON bug_reports(resolved,created_at DESC)'));

  await migrationStep('store.seed',ensureStore);
  await migrateLegacyInventory();
}

async function getProfile(userId, queryable=db) {
  if (!queryable) return null;
  await queryable.query(`INSERT INTO player_profiles(user_id) VALUES($1) ON CONFLICT DO NOTHING`, [userId]);
  const profile = (await queryable.query(`SELECT level,character_id FROM player_profiles WHERE user_id=$1`,[userId])).rows[0] || {level:1,character_id:1};
  const unlockLevels = [1,5,10,18,28,40,55,75];
  for (let characterId=1;characterId<=8;characterId++) {
    const unlocked = Number(profile.level) >= unlockLevels[characterId-1];
    await queryable.query(`INSERT INTO player_characters(user_id,character_id,unlocked,selected) VALUES($1,$2,$3,$4)
      ON CONFLICT(user_id,character_id) DO UPDATE SET unlocked=player_characters.unlocked OR EXCLUDED.unlocked`,
      [userId,characterId,unlocked,characterId===1]);
  }
  await queryable.query('UPDATE player_characters SET selected=(character_id=$2) WHERE user_id=$1',[userId,Math.max(1,Math.min(8,Number(profile.character_id)||1))]);
  const p = (await queryable.query(`
    SELECT p.*, CASE WHEN p.daily_races_date=CURRENT_DATE THEN p.daily_races ELSE 0 END AS daily_races, u.nickname, u.bruto_coins
    FROM player_profiles p JOIN users u ON u.id=p.user_id
    WHERE p.user_id=$1`, [userId])).rows[0];
  const chars = (await queryable.query(`SELECT character_id,unlocked,selected FROM player_characters WHERE user_id=$1 ORDER BY character_id`, [userId])).rows;
  await queryable.query(`INSERT INTO neon_player_items(user_id,item_id)
    SELECT $1,id FROM neon_shop_items WHERE enabled=TRUE AND price=0 ON CONFLICT DO NOTHING`,[userId]);
  await queryable.query(`INSERT INTO neon_player_items(user_id,item_id)
    SELECT $1,id FROM neon_shop_items WHERE code IN ('prestige_spark','prestige_phantom','prestige_crown','immortal_protocol')
    AND COALESCE((data->>'prestige')::integer,99) <= $2 ON CONFLICT DO NOTHING`,[userId,Math.max(0,Math.min(5,Number(p.prestige)||0))]);
  return { ...p, xp_needed:core.xpForLevel(p.level), characters: chars };
}

const CHARACTER_IDS = [1,2,3,4,5,6,7,8];
const STORE_CATALOG = [
  { code:'crown_royal', name:'Coroa Imperial Neon', description:'Presente fundador com aura dourada.', type:'crown', price:0, rarity:'legendary', data:{glow:'#ffd84a', aura:'gold'} },
  { code:'crown_cyber', name:'Coroa Cyber Real', description:'Coroa holográfica de campeão.', type:'crown', price:4200, rarity:'epic', data:{glow:'#00f6ff', aura:'cyan'} },
  { code:'trail_plasma', name:'Rastro Plasma', description:'Plasma magenta de alta energia.', type:'trail', price:2600, rarity:'epic', data:{color:'#ff25d9', width:1.7} },
  { code:'trail_lime', name:'Rastro Veneno', description:'Rastro tóxico verde radioativo.', type:'trail', price:1800, rarity:'rare', data:{color:'#8cff00', width:1.4} },
  { code:'aura_phantom', name:'Aura Fantasma', description:'Pulso violeta do Porto Fantasma.', type:'aura', price:5200, rarity:'legendary', data:{color:'#8c5cff', pulse:true} },
  { code:'engine_sparks', name:'Faíscas Turbo', description:'Descarga ciano a cada impulso.', type:'effect', price:1400, rarity:'rare', data:{color:'#00f6ff'} },
  { code:'neon_wings', name:'Asas de Neon', description:'Asas míticas reativas à velocidade.', type:'back', price:6800, rarity:'mythic', data:{color:'#ff25d9'} },
  { code:'spawn_burst', name:'Entrada Explosiva', description:'Explosão solar na linha de largada.', type:'effect', price:3500, rarity:'epic', data:{color:'#ffe600'} },
  { code:'kart_carbon', name:'Chassi Carbon Phantom', description:'Visual carbono fosco para seu kart.', type:'kart', price:3900, rarity:'epic', data:{finish:'carbon',accent:'#00f6ff'} },
  { code:'kart_solar', name:'Chassi Solar Flare', description:'Pintura incandescente de competição.', type:'kart', price:2400, rarity:'rare', data:{finish:'solar',accent:'#ff7b28'} },
  { code:'holo_skull', name:'Holograma Caveira', description:'Projeção pirata sobre o piloto.', type:'aura', price:6100, rarity:'mythic', data:{color:'#55e9ff',shape:'skull'} },
  { code:'trail_aurora', name:'Rastro Aurora', description:'Fita boreal dinâmica e elegante.', type:'trail', price:3100, rarity:'epic', data:{color:'#62ffd0',secondary:'#8b5cff'} },
  { code:'prestige_spark', name:'Rastro da Faísca', description:'Exclusivo do Prestígio 1.', type:'trail', price:0, rarity:'prestige', enabled:false, prestige:1, data:{color:'#26e9ff',prestige:1} },
  { code:'prestige_phantom', name:'Aura Fantasma Real', description:'Exclusiva do Prestígio 3.', type:'aura', price:0, rarity:'prestige', enabled:false, prestige:3, data:{color:'#8b5cff',pulse:true,prestige:3} },
  { code:'prestige_crown', name:'Coroa da Lenda', description:'Exclusiva do Prestígio 4.', type:'crown', price:0, rarity:'prestige', enabled:false, prestige:4, data:{color:'#ffd45f',prestige:4} },
  { code:'immortal_protocol', name:'Protocolo Imortal', description:'O cosmético supremo do Prestígio 5.', type:'back', price:0, rarity:'immortal', enabled:false, prestige:5, data:{color:'#ffd45f',secondary:'#8b5cff',prestige:5} }
];

async function ensureStore() {
  if (!db) return;
  for (const it of STORE_CATALOG) {
    await db.query(`INSERT INTO neon_shop_items(code,name,description,type,price,rarity,data,enabled) VALUES($1,$2,$3,$4,$5,$6,$7,$8)
      ON CONFLICT(code) DO UPDATE SET name=EXCLUDED.name,description=EXCLUDED.description,type=EXCLUDED.type,
      price=EXCLUDED.price,rarity=EXCLUDED.rarity,data=EXCLUDED.data,enabled=EXCLUDED.enabled`,
      [it.code,it.name,it.description,it.type,it.price,it.rarity,it.data,it.enabled!==false]);
  }
}

async function migrateLegacyInventory() {
  try {
    const oldShop=await tableColumns('shop_items'),oldInventory=await tableColumns('player_items');
    if(!['id','code'].every(column=>oldShop.has(column))||!['user_id','item_id'].every(column=>oldInventory.has(column)))return;
    const owned=oldInventory.has('owned')?'COALESCE(p.owned,TRUE)':'TRUE';
    const equipped=oldInventory.has('equipped')?'COALESCE(p.equipped,FALSE)':'FALSE';
    await db.query(`INSERT INTO neon_player_items(user_id,item_id,owned,equipped)
      SELECT p.user_id,n.id,${owned},${equipped} FROM player_items p
      JOIN shop_items old ON old.id=p.item_id JOIN neon_shop_items n ON n.code=old.code
      WHERE p.user_id IS NOT NULL ON CONFLICT(user_id,item_id) DO UPDATE
      SET owned=neon_player_items.owned OR EXCLUDED.owned,equipped=neon_player_items.equipped OR EXCLUDED.equipped`);
  } catch(error) {
    console.warn('NEON PATH database: inventário legado mantido intacto; importação opcional ignorada:',error.code||error.message);
  }
}

app.get('/health', async (_req, res) => {
  let database = db ? 'checking' : 'disabled';
  try { if (db) { await db.query('SELECT 1'); database = 'ok'; } }
  catch (error) { database = 'error'; console.error('health database:',error.message); }
  const ok = !IS_PRODUCTION || database === 'ok';
  res.status(ok?200:503).json({ ok, service:'NEON PATH', database, version:'12.0.4', realtime:'authoritative-30hz' });
});

app.post('/api/bug-report', reportRateLimit, async(req,res)=>{
  const u=authUser(req), b=req.body||{};
  if(!db)return res.json({ok:true,stored:false});
  try{await db.query('INSERT INTO bug_reports(user_id,nickname,fingerprint,message,stack,source,screen,track,mode) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[u?.id||null,u?.nickname||'Piloto',String(b.fingerprint||'').slice(0,80),String(b.message||'Erro').slice(0,1000),String(b.stack||'').slice(0,6000),String(b.source||'client').slice(0,80),String(b.screen||'unknown').slice(0,80),String(b.track||'').slice(0,80),String(b.mode||'').slice(0,40)]);res.json({ok:true,stored:true});}catch(e){res.status(500).json({error:'bug_report_error'});}
});
app.get('/api/ceo/bug-reports', async(req,res)=>{
  if(req.headers['x-ceo-key']!==CEO_KEY)return res.status(403).json({error:'forbidden'});if(!db)return res.json({reports:[]});
  try{const reports=(await db.query('SELECT * FROM bug_reports ORDER BY resolved ASC, created_at DESC LIMIT 200')).rows;res.json({reports});}catch(e){res.status(500).json({error:'bug_report_read_error'});}
});
app.post('/api/ceo/bug-reports/:id/resolve', async(req,res)=>{
  if(req.headers['x-ceo-key']!==CEO_KEY)return res.status(403).json({error:'forbidden'});if(!db)return res.json({ok:true});
  await db.query('UPDATE bug_reports SET resolved=TRUE WHERE id=$1',[Number(req.params.id)||0]);res.json({ok:true});
});

app.post('/api/auth/register', authRateLimit, async (req,res) => {
  if (!db) return res.status(503).json({error:'database_unavailable'});
  const nickname=cleanNick(req.body?.username || req.body?.nickname);
  const email=cleanEmail(req.body?.email);
  const password=req.body?.password;
  if (!nickname) return res.status(400).json({error:'apelido inválido'});
  if (req.body?.email && !email) return res.status(400).json({error:'e-mail inválido'});
  if (!validPassword(password)) return res.status(400).json({error:'senha deve ter pelo menos 8 caracteres'});
  try {
    const hash=await bcrypt.hash(password,12);
    const insert=dbCompat.buildUserInsert({nickname,email:email||null,passwordHash:hash},requiredUserInsertColumns);
    const q=await db.query(insert.sql,insert.values);
    const user=q.rows[0];
    await getProfile(user.id);
    res.json({token:signUser(user),nickname:user.nickname});
  } catch(e) {
    if (e.code==='23505') return res.status(409).json({error:'apelido ou e-mail já cadastrado'});
    console.error('register:',e); res.status(500).json({error:'register_error'});
  }
});

app.post('/api/auth/login', authRateLimit, async (req,res) => {
  if (!db) return res.status(503).json({error:'database_unavailable'});
  const nickname=cleanNick(req.body?.username || req.body?.nickname);
  const email=cleanEmail(req.body?.email);
  const password=req.body?.password;
  if (!password || (!nickname && !email)) return res.status(400).json({error:'dados de login inválidos'});
  try {
    const q=await db.query(`SELECT id,nickname,password_hash FROM users WHERE ${email?'lower(email)=lower($1)':'lower(nickname)=lower($1)'} LIMIT 1`,[email||nickname]);
    const user=q.rows[0];
    if (!user?.password_hash || !(await bcrypt.compare(password,user.password_hash))) return res.status(401).json({error:'apelido/e-mail ou senha incorretos'});
    await db.query('UPDATE users SET last_seen_at=NOW() WHERE id=$1',[user.id]);
    res.json({token:signUser(user),nickname:user.nickname});
  } catch(e) { console.error('login:',e); res.status(500).json({error:'login_error',detail:process.env.NODE_ENV==='production'?undefined:e.message}); }
});

app.post('/api/auth/guest', authRateLimit, async (req,res) => {
  const nickname=cleanNick(req.body?.nickname); if(!nickname)return res.status(400).json({error:'apelido inválido'});
  if(!db)return res.json({token:jwt.sign({sub:'guest-'+crypto.randomUUID(),nickname},JWT_SECRET,{expiresIn:'7d'}),nickname});
  try {
    const suffix='_'+crypto.randomBytes(2).toString('hex').toUpperCase();
    const guestName=(nickname.slice(0,20-suffix.length)+suffix);
    const h=await bcrypt.hash(crypto.randomBytes(18).toString('hex'),10);
    const insert=dbCompat.buildUserInsert({nickname:guestName,email:null,passwordHash:h},requiredUserInsertColumns);
    const q=await db.query(insert.sql,insert.values);
    const user=q.rows[0];
    await getProfile(user.id); res.json({token:signUser(user),nickname:user.nickname});
  } catch(e){console.error('guest:',e);res.status(500).json({error:'banco'});}
});

app.get('/api/rank', async (_req,res)=>{
  if(!db)return res.json([]);
  try{const q=await db.query(`SELECT u.nickname,u.ph,u.wins,u.kills,u.races,COALESCE(p.prestige,0) prestige,COALESCE(p.level,1) level
    FROM users u LEFT JOIN player_profiles p ON p.user_id=u.id
    ORDER BY u.ph DESC,COALESCE(p.prestige,0) DESC,u.wins DESC LIMIT 50`);res.json(q.rows);}
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
  res.status(403).json({error:'server_awards_only'});
});

app.get('/api/shop',async(_req,res)=>{if(!db)return res.status(503).json({error:'database_unavailable'});try{const r=await db.query('SELECT id,code,name,description,type,price,rarity,data FROM neon_shop_items WHERE enabled=true ORDER BY price,id');res.json(r.rows);}catch(e){res.status(500).json({error:'shop_error'});}});
app.get('/api/inventory',async(req,res)=>{const u=authUser(req);if(!u?.id)return res.status(401).json({error:'unauthorized'});if(!db)return res.status(503).json({error:'database_unavailable'});try{const r=await db.query(`SELECT s.id,s.code,s.name,s.description,s.type,s.price,s.rarity,s.data,p.equipped FROM neon_player_items p JOIN neon_shop_items s ON s.id=p.item_id WHERE p.user_id=$1 AND p.owned=true ORDER BY s.type,s.id`,[u.id]);res.json(r.rows);}catch(e){res.status(500).json({error:'inventory_error'});}});
app.post('/api/shop/buy',async(req,res)=>{
  const u=authUser(req);if(!u?.id)return res.status(401).json({error:'unauthorized'});if(!db)return res.status(503).json({error:'database_unavailable'});const code=String(req.body?.code||'').slice(0,64);const client=await db.connect();
  try{await client.query('BEGIN');const item=(await client.query('SELECT * FROM neon_shop_items WHERE code=$1 AND enabled=true FOR UPDATE',[code])).rows[0];if(!item){await client.query('ROLLBACK');return res.status(404).json({error:'item_not_found'});}const owned=(await client.query('SELECT 1 FROM neon_player_items WHERE user_id=$1 AND item_id=$2',[u.id,item.id])).rowCount;if(owned){await client.query('ROLLBACK');return res.status(409).json({error:'already_owned'});}if(Number(item.price)>0){const q=await client.query('UPDATE users SET bruto_coins=bruto_coins-$1 WHERE id=$2 AND bruto_coins >= $1 RETURNING bruto_coins',[item.price,u.id]);if(!q.rowCount){await client.query('ROLLBACK');return res.status(400).json({error:'insufficient_coins'});}}await client.query('INSERT INTO neon_player_items(user_id,item_id) VALUES($1,$2)',[u.id,item.id]);await client.query('COMMIT');res.json({ok:true,item,profile:await getProfile(u.id)});}
  catch(e){await client.query('ROLLBACK').catch(()=>{});console.error('buy:',e);res.status(500).json({error:'purchase_error'});}finally{client.release();}
});
app.post('/api/inventory/equip',async(req,res)=>{const u=authUser(req);if(!u?.id)return res.status(401).json({error:'unauthorized'});if(!db)return res.status(503).json({error:'database_unavailable'});const code=String(req.body?.code||'').slice(0,64);try{const item=(await db.query('SELECT * FROM neon_shop_items WHERE code=$1',[code])).rows[0];if(!item)return res.status(404).json({error:'item_not_found'});const owned=(await db.query('SELECT 1 FROM neon_player_items WHERE user_id=$1 AND item_id=$2 AND owned=true',[u.id,item.id])).rowCount;if(!owned)return res.status(403).json({error:'not_owned'});await db.query('UPDATE neon_player_items p SET equipped=false FROM neon_shop_items s WHERE p.item_id=s.id AND p.user_id=$1 AND s.type=$2',[u.id,item.type]);await db.query('UPDATE neon_player_items SET equipped=true WHERE user_id=$1 AND item_id=$2',[u.id,item.id]);res.json({ok:true});}catch(e){res.status(500).json({error:'equip_error'});}});

// ===== Multiplayer — NEON PATH RACING 12.0 =====
const io=new Server(server,{cors:{origin:corsOrigin,credentials:allowedOrigins[0]!=='*'},pingTimeout:20_000,pingInterval:10_000,maxHttpBufferSize:32_000});
io.use((socket,next)=>{
  try{
    const token=socket.handshake.auth?.token;
    if(!token)return next();
    const payload=jwt.verify(token,JWT_SECRET);
    const numericId=Number(payload.sub);
    if(Number.isSafeInteger(numericId)&&numericId>0)socket.data.userId=numericId;
    socket.data.authNickname=cleanNick(payload.nickname);
    next();
  }catch{next(new Error('unauthorized'));}
});
const rooms=new Map(), MAX=8, TICK=1000/30;
const TRACKS=[
  {id:'neon-city',name:'NEON CITY',theme:'city',rx:48,rz:27},
  {id:'pirate-bay',name:'PIRATE BAY',theme:'pirate',rx:50,rz:28},
  {id:'desert-run',name:'DESERT RUN',theme:'desert',rx:52,rz:29},
  {id:'mountain-peak',name:'MOUNTAIN PEAK',theme:'mountain',rx:46,rz:30},
  {id:'space-station',name:'SPACE STATION',theme:'space',rx:50,rz:27},
  {id:'jungle-falls',name:'JUNGLE FALLS',theme:'jungle',rx:48,rz:29},
  {id:'volcano-rush',name:'VOLCANO RUSH',theme:'volcano',rx:52,rz:28},
  {id:'ice-world',name:'ICE WORLD',theme:'ice',rx:49,rz:30},
  {id:'immortal-grid',name:'PROTOCOLO IMORTAL',theme:'immortal',rx:54,rz:31,prestige:5}
];
const colors=['#00f6ff','#ff2bd6','#8cff00','#ffe600','#8b5cff','#ff6b35','#36ff8c','#ff3b6b'];
function roomCode(){return crypto.randomBytes(6).toString('hex').toUpperCase().slice(0,12);}
function roomPasswordHash(v){return crypto.createHash('sha256').update(String(v||'')).digest('hex');}
function cleanRoomName(v){return typeof v==='string' && /^[A-Za-z0-9À-ÿ _.-]{2,30}$/.test(v.trim()) ? v.trim() : null;}
function soloCode(){return 'SOLO-'+crypto.randomBytes(4).toString('hex').toUpperCase();}
function trackById(id){return TRACKS.find(t=>t.id===id)||TRACKS[0];}
function makeRoom(code,ceo=false,mode='room',roomName='',passwordHash=''){return{code,ceo,mode,roomName,passwordHash,ownerId:null,players:new Map(),running:false,finishing:false,started:0,track:TRACKS[0].id,created:Date.now(),finishOrder:[],startTimer:null,maxRaceTimer:null};}
const BOT_NAMES=['LUNA','STEEL','ZIPPY','BLAZE','FROST','ROCKY','NITRO'];
const BOT_SKILLS=[0.94,0.98,1.02,0.96,1.05,0.92,1.00];

/*
 * The server uses a compact, deterministic oval track model.
 * Players advance along the center line; steering changes lane offset.
 * This prevents the old "drive through walls / 90° teleport" behavior.
 */
function spawn(i){
  const lane=(i%4-1.5)*2.1;
  return {id:null,nickname:'Piloto',characterId:(i%8)+1,color:colors[i%colors.length],
    progress:Math.max(0,i*0.008),lane,steer:0,speed:0,energy:100,boost:0,alive:true,
    trail:[],kills:0,lastInput:0,lastTurbo:0,lastSab:0,throttle:true,brake:false,lap:1,finish:null,drift:false,driftCharge:0,driftLevel:0,boostTimer:0,checkpoint:0,rocketBoost:0};
}
function posFor(p,t){
  const theta=(p.progress%1)*Math.PI*2;
  const x=t.rx*Math.sin(theta), z=t.rz*Math.cos(theta);
  const tx=t.rx*Math.cos(theta), tz=-t.rz*Math.sin(theta);
  const len=Math.hypot(tx,tz)||1, nx=-tz/len, nz=tx/len;
  return {x:x+nx*p.lane,z:z+nz*p.lane,a:Math.atan2(tx,tz)};
}
function snap(r){
  const t=trackById(r.track);
  return {code:r.code,mode:r.mode,solo:r.mode==='solo',roomName:r.roomName||'',running:r.running,started:r.started,track:r.track,trackName:t.name,
    players:[...r.players.values()].map(p=>{const q=posFor(p,t);return{
      id:p.id,nickname:p.nickname,characterId:p.characterId||1,x:q.x,y:q.z,a:q.a,speed:p.speed,energy:p.energy,boost:p.boost,
      alive:p.alive,trail:p.trail.slice(-80),kills:p.kills,color:p.color,lap:p.lap,finish:p.finish,progress:p.progress,lane:p.lane,drift:p.drift,driftLevel:p.driftLevel,itemReady:(p.energy>=30&&Date.now()-p.lastSab>8000),cosmetics:p.cosmetics||[]
    }})};
}
function start(r){
  if(r.running)return;
  clearTimeout(r.startTimer);clearTimeout(r.maxRaceTimer);
  r.running=true;r.finishing=false;r.started=Date.now();r.finishOrder=[];r.countdownUntil=Date.now()+3600;
  let i=0;
  // Reinicia apenas a física. Identidade, autenticação, IA e cosméticos precisam sobreviver.
  for(const p of r.players.values()){
    const persistent={
      id:p.id,userId:p.userId||null,nickname:p.nickname,color:p.color,characterId:p.characterId||((i)%8)+1,
      bot:!!p.bot,botSkill:Number(p.botSkill)||1,cosmetics:Array.isArray(p.cosmetics)?p.cosmetics:[],
      disconnectedAt:Number(p.disconnectedAt)||0,disconnectTimer:p.disconnectTimer||null,ceo:!!p.ceo
    };
    Object.assign(p,spawn(i++),persistent);
    if(p.disconnectedAt){p.throttle=false;p.brake=true;p.steer=0;}
  }
  io.to(r.code).emit('race:loading',{track:r.track});
  [3,2,1].forEach((v,i)=>setTimeout(()=>io.to(r.code).emit('race:countdown',{value:v}),i*1000));
  setTimeout(()=>io.to(r.code).emit('race:countdown',{value:'GO'}),3000);
  setTimeout(()=>io.to(r.code).emit('start',{code:r.code,track:r.track}),120);
  r.maxRaceTimer=setTimeout(()=>finishRace(r),4.5*60*1000);
}
function finishPlayer(p,r){
  if(p.finish)return;
  p.finish=r.finishOrder.length+1;
  r.finishOrder.push(p.id);
  p.alive=false;
  if(r.finishOrder.length===r.players.size) setTimeout(()=>finishRace(r),900);
}
async function awardRace(r,p,position){
  const reward=core.calculateRaceRewards(position,r.mode,p.kills);
  if(!db||!p.userId)return{rewards:{...reward,prestigeUp:false,persisted:false},profile:null};
  let client=null, advanced=null, dailyBonus=0, prestigeCoinBonus=0, totalCoins=reward.coins;
  try{
    client=await db.connect();
    await client.query('BEGIN');
    await client.query('INSERT INTO player_profiles(user_id) VALUES($1) ON CONFLICT DO NOTHING',[p.userId]);
    const old=(await client.query('SELECT level,xp,lifetime_xp,prestige FROM player_profiles WHERE user_id=$1 FOR UPDATE',[p.userId])).rows[0];
    advanced=core.advanceProfile(old,reward.xp);
    const daily=(await client.query(`UPDATE player_profiles SET
      level=$2,xp=$3,lifetime_xp=$4,prestige=$5,total_wins=total_wins+$6,total_races=total_races+1,
      ph=GREATEST(0,ph+$7),daily_races=CASE WHEN daily_races_date=CURRENT_DATE THEN daily_races+1 ELSE 1 END,
      daily_races_date=CURRENT_DATE,updated_at=NOW() WHERE user_id=$1 RETURNING daily_races`,
      [p.userId,advanced.level,advanced.xp,advanced.lifetime_xp,advanced.prestige,position===1?1:0,reward.ph])).rows[0];
    dailyBonus=Number(daily?.daily_races)===3?450:0;
    prestigeCoinBonus=Number(old.prestige)<2&&advanced.prestige>=2?1500:0;
    totalCoins=reward.coins+dailyBonus+prestigeCoinBonus;
    const prestigeDrops=[[1,'prestige_spark'],[3,'prestige_phantom'],[4,'prestige_crown'],[5,'immortal_protocol']];
    for(const [required,code] of prestigeDrops)if(Number(old.prestige)<required&&advanced.prestige>=required){
      await client.query(`INSERT INTO neon_player_items(user_id,item_id) SELECT $1,id FROM neon_shop_items WHERE code=$2 ON CONFLICT DO NOTHING`,[p.userId,code]);
    }
    await client.query(`UPDATE users SET wins=wins+$2,kills=kills+$3,races=races+1,ph=GREATEST(0,ph+$4),bruto_coins=bruto_coins+$5,last_seen_at=NOW() WHERE id=$1`,
      [p.userId,position===1?1:0,Math.max(0,Number(p.kills)||0),reward.ph,totalCoins]);
    await client.query(`INSERT INTO race_results(user_id,nickname,position,kills,ph_delta,map,xp_earned,coins_earned,duration_ms,mode,character_id)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,[p.userId,p.nickname,position,p.kills||0,reward.ph,r.track,reward.xp,totalCoins,Math.max(0,Date.now()-r.started),r.mode,p.characterId||1]);
    await client.query('COMMIT');
  }catch(error){
    if(client)await client.query('ROLLBACK').catch(()=>{});
    console.error('race reward:',error);
    return{rewards:{...reward,prestigeUp:false,persisted:false},profile:null};
  }finally{client?.release();}
  // O prêmio já foi confirmado no banco. Uma falha ao recarregar o perfil não pode
  // transformar um COMMIT bem-sucedido em "não salvo" nem quebrar o fim da corrida.
  let profile=null;
  try{profile=await getProfile(p.userId);}catch(error){console.warn('race profile refresh:',error.message);}
  return{rewards:{...reward,coins:totalCoins,dailyBonus,prestigeCoinBonus,prestigeUp:!!advanced?.prestigeUp,persisted:true},profile};
}
async function finishRace(r){
  if(!r.running||r.finishing)return;
  r.finishing=true;r.running=false;clearTimeout(r.maxRaceTimer);
  const ordered=[...r.players.values()].sort((a,b)=>(a.finish||99)-(b.finish||99)||(b.lap-a.lap)||(b.progress-a.progress));
  const results=ordered.map((p,i)=>({id:p.id,nickname:p.nickname,position:i+1,color:p.color,kills:p.kills,characterId:p.characterId||1}));
  await Promise.all(ordered.filter(p=>!p.bot).map(async(p,i)=>{
    const award=await awardRace(r,p,i+1);
    io.to(p.id).emit('race:finish',{results,track:r.track,...award});
  }));
  r.finishing=false;r.finishedAt=Date.now();
}
function removePlayerFromRoom(r,playerId){
  if(!r||!r.players.has(playerId))return;
  const player=r.players.get(playerId);clearTimeout(player?.disconnectTimer);r.players.delete(playerId);
  if(r.ownerId===playerId){
    const next=[...r.players.values()].find(p=>!p.bot);r.ownerId=next?.id||null;
    for(const [sid] of r.players){const sock=io.sockets.sockets.get(sid);if(sock)sock.data.roomOwner=sid===r.ownerId;}
  }
  if(!r.players.size||![...r.players.values()].some(p=>!p.bot)){clearTimeout(r.startTimer);clearTimeout(r.maxRaceTimer);rooms.delete(r.code);}
  else{
    io.to(r.code).emit('state',snap(r));
    if(r.running&&[...r.players.values()].every(p=>!p.alive))finishRace(r);
  }
}
function detachSocket(s){
  const r=rooms.get(s.data.room);
  if(!r)return;
  const roomCode=r.code;removePlayerFromRoom(r,s.id);s.leave(roomCode);
  s.data.room=null;s.data.roomOwner=false;s.data.soloOwner=false;
}
const DISCONNECT_GRACE_MS=12_000;
function holdDisconnectedSocket(s){
  const r=rooms.get(s.data.room),p=r?.players.get(s.id);
  if(!r||!p)return;
  if(!p.userId){detachSocket(s);return;}
  const oldId=s.id;
  p.disconnectedAt=Date.now();p.throttle=false;p.brake=true;p.steer=0;p.drift=false;
  p.disconnectTimer=setTimeout(()=>{
    const current=rooms.get(r.code)?.players.get(oldId);
    if(current===p&&current.disconnectedAt)removePlayerFromRoom(rooms.get(r.code),oldId);
  },DISCONNECT_GRACE_MS);
  p.disconnectTimer.unref?.();
  s.data.room=null;s.data.roomOwner=false;s.data.soloOwner=false;
  io.to(r.code).emit('state',snap(r));
}
function resumePreviousSession(s){
  if(!s.data.userId)return false;
  for(const r of rooms.values()){
    const found=[...r.players.entries()].find(([,p])=>p.userId===s.data.userId&&p.disconnectedAt);
    if(!found)continue;
    const [oldId,p]=found;clearTimeout(p.disconnectTimer);r.players.delete(oldId);
    p.id=s.id;p.disconnectedAt=0;p.disconnectTimer=null;p.brake=false;
    r.players.set(s.id,p);if(r.ownerId===oldId)r.ownerId=s.id;
    s.join(r.code);s.data.room=r.code;s.data.roomOwner=r.ownerId===s.id;s.data.soloOwner=r.mode==='solo'&&s.data.roomOwner;s.data.ceo=!!p.ceo;
    s.emit('room',{code:r.code,ceo:r.ceo,mode:r.mode,solo:r.mode==='solo',roomName:r.roomName,track:r.track,canStart:s.data.roomOwner});
    s.emit('state',snap(r));
    if(r.running)s.emit('race:resume',{track:r.track,started:r.started});
    return true;
  }
  return false;
}
async function canUseTrack(s,id,ceo=false){
  const track=trackById(id);if(!track.prestige||ceo)return true;
  if(!db||!s.data.userId)return false;
  try{const row=(await db.query('SELECT prestige FROM player_profiles WHERE user_id=$1',[s.data.userId])).rows[0];return Number(row?.prestige)>=track.prestige;}catch{return false;}
}
async function resolveCharacter(s,requested){
  const id=Math.max(1,Math.min(8,Number(requested)||1));
  if(id===1)return 1;if(!db||!s.data.userId)return 1;
  try{const row=(await db.query('SELECT unlocked FROM player_characters WHERE user_id=$1 AND character_id=$2',[s.data.userId,id])).rows[0];return row?.unlocked?id:1;}catch{return 1;}
}
async function loadEquippedCosmetics(userId){
  if(!db||!userId)return[];
  try{const rows=(await db.query(`SELECT s.code,s.type,s.data FROM neon_player_items p JOIN neon_shop_items s ON s.id=p.item_id WHERE p.user_id=$1 AND p.owned=TRUE AND p.equipped=TRUE ORDER BY s.type`,[userId])).rows;return rows.slice(0,8).map(row=>({code:String(row.code).slice(0,64),type:String(row.type).slice(0,32),data:row.data&&typeof row.data==='object'?row.data:{}}));}catch{return[];}
}
async function addHumanToRoom(s,r,nickname,characterId){
  const index=r.players.size,p=spawn(index);
  const safeCharacter=await resolveCharacter(s,characterId);
  const cosmetics=await loadEquippedCosmetics(s.data.userId);
  Object.assign(p,{id:s.id,userId:s.data.userId||null,nickname:s.data.authNickname||cleanNick(nickname)||'Piloto',bot:false,color:colors[index%colors.length],characterId:safeCharacter,cosmetics});
  r.players.set(s.id,p);s.join(r.code);s.data.room=r.code;
  return p;
}
function fillBots(r){
  let index=r.players.size,botIndex=0;
  while(r.players.size<MAX){
    const b=spawn(index++),name=BOT_NAMES[botIndex%BOT_NAMES.length];
    Object.assign(b,{id:`bot-${crypto.randomUUID()}`,nickname:name,bot:true,botSkill:BOT_SKILLS[botIndex%BOT_SKILLS.length],characterId:((index-1)%8)+1,color:colors[(index-1)%colors.length]});
    r.players.set(b.id,b);botIndex++;
  }
}
io.on('connection',s=>{
  resumePreviousSession(s);
  s.on('room:create',async({nickname,ceo,key,track,mode,roomName,password,characterId}={})=>{
    detachSocket(s);nickname=s.data.authNickname||cleanNick(nickname)||'Piloto';
    mode=mode==='solo'?'solo':'room';
    if(ceo&&key!==CEO_KEY)return s.emit('error:game','Chave CEO inválida');
    if(ceo)mode='room';
    let name='', passwordHash='';
    if(!ceo && mode==='room'){
      name=cleanRoomName(roomName);
      if(!name)return s.emit('error:game','Nome da sala inválido. Use de 2 a 30 caracteres.');
      if(typeof password!=='string'||password.length<4||password.length>64)return s.emit('error:game','A senha da sala deve ter de 4 a 64 caracteres.');
      passwordHash=roomPasswordHash(password);
    }
    if(!(await canUseTrack(s,track,!!ceo)))return s.emit('error:game','O Protocolo Imortal exige Prestígio 5.');
    const code=ceo?'VELHO202026':mode==='solo'?soloCode():roomCode();
    const r=makeRoom(code,!!ceo,mode,name,passwordHash);r.ownerId=s.id;r.track=trackById(track).id;rooms.set(code,r);
    const human=await addHumanToRoom(s,r,nickname,characterId);human.ceo=!!ceo;
    if(mode==='solo'){
      fillBots(r);
    }
    s.data.ceo=!!ceo;s.data.soloOwner=mode==='solo';s.data.roomOwner=true;
    s.emit('room',{code,ceo:r.ceo,mode:r.mode,solo:r.mode==='solo',roomName:r.roomName,track:r.track,canStart:true});
    io.to(code).emit('state',snap(r));
  });
  s.on('room:join',async({code,nickname,password,characterId}={})=>{
    code=String(code||'').trim().toUpperCase();
    if(!code||code.length>15)return s.emit('error:game','Código da sala deve ter no máximo 15 caracteres');
    const r=rooms.get(code);
    if(!r)return s.emit('error:game','Sala não encontrada');
    if(r.mode==='solo')return s.emit('error:game','Essa corrida não aceita entrada de outros jogadores. Crie sua própria corrida.');
    if(r.running||r.players.size>=MAX)return s.emit('error:game','Sala cheia ou corrida já iniciada');
    if(!r.ceo && (!password||roomPasswordHash(password)!==r.passwordHash))return s.emit('error:game','Senha da sala incorreta');
    if(!(await canUseTrack(s,r.track,false)))return s.emit('error:game','Esta sala corre no Protocolo Imortal e exige Prestígio 5.');
    detachSocket(s);await addHumanToRoom(s,r,nickname,characterId);s.data.ceo=false;s.data.roomOwner=false;s.data.soloOwner=false;
    s.emit('room',{code:r.code,ceo:r.ceo,mode:r.mode,solo:false,roomName:r.roomName,track:r.track,canStart:r.ownerId===s.id});io.to(r.code).emit('state',snap(r));
  });
  s.on('room:matchmake',async({nickname,track,characterId}={})=>{
    detachSocket(s);
    if(!(await canUseTrack(s,track,false)))return s.emit('error:game','O Protocolo Imortal exige Prestígio 5.');
    const requestedTrack=trackById(track).id;
    let r=[...rooms.values()].find(x=>x.mode==='public'&&x.track===requestedTrack&&!x.running&&!x.finishing&&x.players.size<MAX&&Date.now()-x.created<30_000);
    if(!r){const code='PUB-'+roomCode().slice(0,8);r=makeRoom(code,false,'public','MATCH GLOBAL','');r.track=requestedTrack;rooms.set(code,r);}
    await addHumanToRoom(s,r,nickname,characterId);if(!r.ownerId)r.ownerId=s.id;
    s.data.ceo=false;s.data.roomOwner=false;s.data.soloOwner=false;
    s.emit('room',{code:r.code,ceo:false,mode:'public',solo:false,roomName:'MATCH GLOBAL',track:r.track,canStart:false});io.to(r.code).emit('state',snap(r));
    if(r.players.size>=4){fillBots(r);start(r);}
    else if(!r.startTimer)r.startTimer=setTimeout(()=>{if(!r.running&&r.players.size){fillBots(r);start(r);}},2800);
  });
  s.on('room:track',id=>{
    const r=rooms.get(s.data.room);
    if(!r||r.running||!s.data.ceo)return;
    r.track=trackById(id).id;io.to(r.code).emit('state',snap(r));
  });
  s.on('room:start',()=>{
    const r=rooms.get(s.data.room);
    if(!r||!r.players.get(s.id))return;
    if(r.ceo&&s.data.ceo){fillBots(r);start(r);}
    else if(r.mode==='solo'&&s.data.soloOwner)start(r);
    else if(r.mode==='room'&&r.ownerId===s.id){fillBots(r);start(r);}
  });
  s.on('room:leave',()=>{
    detachSocket(s);
  });
  s.on('input',m=>{
    const r=rooms.get(s.data.room),p=r?.players.get(s.id);
    if(!r||!p||!p.alive||!r.running)return;
    const now=Date.now(); if(now-p.lastInput<45)return;
    const type=String(m?.type||'');
    if(type==='left')p.steer=-1;
    if(type==='right')p.steer=1;
    if(type==='neutral')p.steer=0;
    if(type==='throttle')p.throttle=m?.active!==false;
    if(type==='brake')p.brake=m?.active===true;
    if(type==='drift'){p.drift=!!m?.active;if(!p.drift&&p.driftCharge>=18){p.boostTimer=p.driftLevel>=2?1.25:0.75;p.boost=1.25;}if(!p.drift){p.driftCharge=0;p.driftLevel=0;}}
    if(type==='turbo'&&now<=(r.countdownUntil||0)+250&&now>=(r.countdownUntil||0)-2400){p.rocketBoost=1;p.energy=Math.max(0,p.energy-20);p.boost=1.65;p.lastTurbo=now;} else if(type==='turbo'&&p.energy>=20&&now-p.lastTurbo>850){p.energy-=20;p.boost=1.55;p.lastTurbo=now;}
    if(type==='sabotage'&&p.energy>=30&&now-p.lastSab>8000){
      p.energy-=30;p.lastSab=now;
      let target=null,best=999;
      for(const q of r.players.values())if(q.alive&&q.id!==p.id){
        const d=Math.abs(q.progress-p.progress);
        if(d<best){best=d;target=q;}
      }
      if(target&&best<.025){target.speed*=.72;target.boost=.15;s.to(r.code).emit('hit',{from:p.nickname,to:target.nickname});}
    }
    p.lastInput=now;
  });
  s.on('disconnect',()=>{
    holdDisconnectedSocket(s);
  });
});
setInterval(()=>{
  const now=Date.now();
  for(const r of rooms.values()){
    if(!r.running)continue;
    const t=trackById(r.track),dt=TICK/1000;
    for(const p of r.players.values()){
      if(!p.alive)continue;
      // Ninguém se move antes do GO: evita a largada atravessada e sincroniza todos os clientes.
      if(now < (r.countdownUntil||0)) continue;
      if(p.bot){
        p.throttle=true;p.brake=false;
        // Bots follow the racing line with bounded variation, then make tactical lane changes.
        const phase=(now-r.started)/1100+p.id.length*0.73;
        const targetLane=Math.sin(phase)*2.6+Math.sin(phase*0.47)*1.2;
        p.steer=Math.max(-1,Math.min(1,(targetLane-p.lane)*0.9));
        if(p.energy>=20 && Math.random()<0.024){p.energy-=20;p.boost=1.55;}
      }
      const rubber=(p.bot?1+Math.max(-.045,Math.min(.045,(0.5-p.progress))*0.35):1);
      if(p.drift && Math.abs(p.steer)>0){p.driftCharge++;p.driftLevel=p.driftCharge>=70?2:p.driftCharge>=30?1:0;}
      const offroad=Math.abs(p.lane)>5.7;
      const driftBonus=p.driftLevel>=2?1.8:p.driftLevel>=1?.8:0;
      const throttleFactor=p.bot?1:(p.throttle?1:(p.brake?.18:.58));
      const target=((p.bot?13.7*p.botSkill:13.5)*rubber+(p.boost>0?7.5:0)+driftBonus)*throttleFactor;
      if(offroad)p.speed*=.92;
      p.speed+=(target-p.speed)*.12;
      p.lane+=p.steer*dt*8;
      p.lane*=.986;
      p.lane=Math.max(-7.5,Math.min(7.5,p.lane));
      p.progress+=p.speed*dt/(2*Math.PI*Math.max(t.rx,t.rz)*1.05);
      if(p.progress>=1){
        p.progress-=1;
        if(p.checkpoint>=3){p.lap++;p.checkpoint=0;if(p.lap>3)finishPlayer(p,r);}
      }
      const cp=Math.min(3,Math.floor(p.progress*4));
      if(cp>=p.checkpoint)p.checkpoint=cp;
      p.energy=Math.min(100,p.energy+5*dt);p.boost=Math.max(0,p.boost-dt);p.boostTimer=Math.max(0,p.boostTimer-dt);if(p.boostTimer>0)p.boost=Math.max(p.boost,1.1);
      const q=posFor(p,t);p.trail.push([+q.x.toFixed(2),+q.z.toFixed(2)]);if(p.trail.length>80)p.trail.shift();
    }
    io.to(r.code).emit('state',snap(r));
  }
},TICK).unref();

setInterval(()=>{
  const now=Date.now();
  for(const [code,r] of rooms){
    if(!r.running && now-(r.finishedAt||r.created)>2*60*1000){clearTimeout(r.startTimer);clearTimeout(r.maxRaceTimer);rooms.delete(code);}
  }
},30_000).unref();

function transientDatabaseError(error){
  const code=String(error?.code||'');
  return /^08/.test(code)||['57P01','57P02','57P03','53300'].includes(code)||/ECONNRESET|ECONNREFUSED|ETIMEDOUT|timeout|connection terminated|server closed/i.test(String(error?.message||''));
}
async function initDatabaseResilient(){
  if(!db)return;
  for(let attempt=1;attempt<=4;attempt++){
    try{return await initDatabase();}
    catch(error){
      if(attempt===4||!transientDatabaseError(error))throw error;
      const delay=Math.min(4000,700*2**(attempt-1));
      console.warn(`NEON PATH database: conexão instável no boot; nova tentativa ${attempt+1}/4 em ${delay}ms`);
      await new Promise(resolve=>setTimeout(resolve,delay));
    }
  }
}
async function boot(){
  await initDatabaseResilient();
  console.log(`NEON PATH database: ${db?'ready':'disabled (DATABASE_URL not set)'}`);
  server.listen(PORT,()=>console.log(`NEON PATH 12.0.4 listening on ${PORT}`));
}
boot().catch(err=>{console.error('NEON PATH boot failed:',err);process.exitCode=1;});
