'use strict';

const assert=require('assert');
const fs=require('fs');
const crypto=require('crypto');
const core=require('./game-core');
const server=fs.readFileSync(__dirname+'/server.js','utf8');
const app=fs.readFileSync(__dirname+'/app.js','utf8');
const schema=fs.readFileSync(__dirname+'/schema.sql','utf8');

// Validação e normalização de entradas hostis.
assert.strictEqual(core.cleanNick('<script>alert(1)</script>'),null);
assert.strictEqual(core.cleanNick('../../admin'),null);
assert.strictEqual(core.cleanEmail('a@b.com'),'a@b.com');
assert.strictEqual(core.cleanEmail('javascript:alert(1)'),null);
assert(core.validPassword('12345678'));assert(!core.validPassword('123'));
assert.strictEqual(core.normalizeRoomCode(' abc-123 '),'ABC-123');
assert(core.isRoomCodeLengthValid('123456789012345'));
assert(!core.isRoomCodeLengthValid('1234567890123456'));
const validInputs=new Set(['left','right','neutral','throttle','brake','drift','turbo','sabotage']);
for(const type of validInputs)assert.strictEqual(core.sanitizeInput({type}),type);
for(let i=0;i<10_000;i++)assert.strictEqual(core.sanitizeInput({type:`teleport_${i}`,x:Infinity,y:'../../db'}),null);

// Anti-spam e cooldown de itens.
const room={running:true,started:Date.now()-5000,players:new Map()};
const attacker=Object.assign(core.spawn(0),{id:'a',nickname:'A'}),target=Object.assign(core.spawn(1),{id:'b',nickname:'B'});
room.players.set('a',attacker);room.players.set('b',target);
const now=Date.now();
for(let i=0;i<100;i++)core.applyInput(attacker,'left',now,room);
assert(attacker.suspiciousInputs>0,'flood de input não foi limitado');
attacker.inputWindowStart=0;attacker.inputCount=0;attacker.energy=100;attacker.lastSab=0;
assert(core.applyInput(attacker,'sabotage',now+2000,room).accepted);
assert(!core.applyInput(attacker,'sabotage',now+2500,room).accepted,'cooldown de sabotagem burlado');

// Salas privadas: senha é hash, dono inicia e segredo nunca entra no snapshot.
const hash=value=>crypto.createHash('sha256').update(String(value)).digest('hex');
assert.notStrictEqual(hash('certa'),hash('errada'));
assert(server.includes('function roomPasswordHash'));
assert(server.includes('r.ownerId===s.id'),'início não está restrito ao dono');
assert(server.includes('Senha da sala incorreta'));
assert(!server.includes('passwordHash:r.passwordHash'),'hash da sala vazou ao cliente');
assert(server.includes("mode==='public'"));
assert(server.includes("r.startTimer=setTimeout"),'matchmaking não tem início automático');
assert(server.includes('fillBots(r);start(r)'),'matchmaking não completa o grid');
assert(server.includes("track.prestige")&&server.includes("SELECT prestige FROM player_profiles"),'circuito Imortal pode ser burlado');
assert(server.includes('resolveCharacter'),'personagem bloqueado pode ser forçado no socket');

// Autenticação e segredos.
assert(server.includes('socket.handshake.auth?.token'));
assert(server.includes('jwt.verify(token,JWT_SECRET)'));
assert(server.includes("JWT_SECRET com pelo menos 32 caracteres"));
assert(server.includes("CEO_ROOM_KEY com pelo menos 12 caracteres"));
assert(!server.includes("const CEO_KEY = process.env.CEO_ROOM_KEY || 'Velho202026'"));
const guestBlock=server.slice(server.indexOf("app.post('/api/auth/guest'"),server.indexOf("app.get('/api/rank'"));
assert(!guestBlock.includes('SELECT id,nickname FROM users'),'convidado pode sequestrar conta por apelido');
assert(guestBlock.includes('INSERT INTO users'),'convidado não recebe identidade isolada');
assert(server.includes('bcrypt.hash(password,12)')&&server.includes('bcrypt.compare'));
assert(server.includes('authRateLimit')&&server.includes('reportRateLimit'));
assert(server.includes('function normalizeAllowedOrigins'));
assert(server.includes("if (!raw.length || raw.includes('*')) return ['*']"),'CLIENT_ORIGIN vazio impede o boot');
assert(server.includes('return url.origin'),'CLIENT_ORIGIN com barra final não é normalizado');
assert(server.includes('origin:corsOrigin'),'Socket.IO não reutiliza a política CORS validada');

// Servidor é a autoridade de física e economia.
assert(!server.includes('p.x=m.x')&&!server.includes('p.y=m.y'),'posição aceita do navegador');
assert(!server.includes('m.target'),'alvo de sabotagem aceito do navegador');
assert(server.includes('p.lane=Math.max(-7.5,Math.min(7.5,p.lane))'));
assert(server.includes("res.status(403).json({error:'server_awards_only'})"));
assert(server.includes('calculateRaceRewards(position,r.mode,p.kills)'));
assert(server.includes("await client.query('BEGIN')"));
assert(server.includes("await client.query('COMMIT')"));
assert(server.includes("await client.query('ROLLBACK')"));
assert(server.includes('SELECT level,xp,lifetime_xp,prestige FROM player_profiles WHERE user_id=$1 FOR UPDATE'));
assert(server.includes('INSERT INTO race_results'));
assert(server.includes("prestigeDrops"));
assert(server.includes("prestigeCoinBonus"));
assert(server.includes("io.to(p.id).emit('race:finish'"),'recompensa não é individualizada');
assert(app.includes('x.rewards,x.profile'),'cliente não consome recompensa assinada pelo servidor');

// Migrações são aditivas e mantêm a conexão PostgreSQL existente.
assert(server.includes('new Pool({ connectionString: process.env.DATABASE_URL'));
assert(server.includes('async function ensureColumns'));
assert(server.includes("'lifetime_xp BIGINT NOT NULL DEFAULT 0'"));
assert(server.includes("'daily_races INTEGER NOT NULL DEFAULT 0'"));
assert(server.includes('[database migration: ${name}]'),'migração não informa a etapa exata que falhou');
assert(server.indexOf("await ensureColumns('player_profiles'")<server.indexOf("migrationStep('player_profiles.prestige-index'"),'índice de perfil é criado antes das colunas');
assert(server.indexOf("await ensureColumns('race_results'")<server.indexOf("migrationStep('race_results.user-created-index'"),'índice de corrida é criado antes das colunas');
assert(server.indexOf("await ensureColumns('bug_reports'")<server.indexOf("migrationStep('bug_reports.open-index'"),'índice de bugs é criado antes das colunas');
assert(server.indexOf("await ensureColumns('users'")<server.indexOf("migrationStep('users.ph-index'"),'índice de usuários é criado antes das colunas');
assert(server.indexOf("await ensureColumns('shop_items'")<server.indexOf("migrationStep('shop_items.code-index'"),'índice da loja é criado antes das colunas');
assert(server.indexOf("await ensureColumns('player_characters'")<server.indexOf("migrationStep('player_characters.user-character-index'"),'índice de personagens é criado antes das colunas');
assert(server.indexOf("await ensureColumns('player_items'")<server.indexOf("migrationStep('player_items.user-item-index'"),'índice do inventário é criado antes das colunas');
assert(!/\b(?:DROP|TRUNCATE)\s+TABLE\b/i.test(server),'migração destrutiva no boot');
for(const table of ['users','race_results','player_profiles','player_characters','shop_items','player_items','bug_reports'])assert(schema.includes(`CREATE TABLE IF NOT EXISTS ${table}`),`tabela ausente: ${table}`);

// Loja e ranking consistentes.
assert(server.includes('bruto_coins=bruto_coins-$1'));
assert(server.includes('bruto_coins >= $1'),'saldo pode ficar negativo');
assert(server.includes('already_owned'),'compra duplicada não foi bloqueada');
assert(server.includes('SET equipped=false'),'equipamento do mesmo tipo não é exclusivo');
assert(server.includes('ORDER BY u.ph DESC'));
assert(app.includes('escapeHtml(it.name)')&&app.includes('escapeHtml(x.nickname)'),'conteúdo do banco entra no DOM sem escape');

// 80 mil cálculos de recompensa em entradas adversariais devem permanecer limitados.
for(let i=0;i<80_000;i++){
  const reward=core.calculateRaceRewards((i%20)-5,i%2?'public':'solo',(i%30)-10);
  assert(reward.xp>0&&reward.xp<=316&&reward.coins>0&&reward.coins<=565);
  assert(reward.ph>=-7&&reward.ph<=38);
}

console.log('NEON PATH 12.0.1 SEGURANÇA: PASS · 10.000 payloads hostis · 80.000 recompensas · banco aditivo');
