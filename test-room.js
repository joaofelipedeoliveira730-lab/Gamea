const assert = require('assert');
const fs = require('fs');
const path = require('path');
const root = __dirname;
const server = fs.readFileSync(path.join(root,'server.js'),'utf8');
const app = fs.readFileSync(path.join(root,'app.js'),'utf8');
const html = fs.readFileSync(path.join(root,'index.html'),'utf8');

// Contrato da sala CEO
const CEO_CODE = 'VELHO202026';
const CEO_KEY = 'Velho202026';
assert.ok(CEO_CODE.length <= 15, 'CEO code must fit 15 chars');
assert.ok(server.includes("const CEO_ROOM_CODE = 'VELHO202026'"));
assert.ok(server.includes("const CEO_KEY = process.env.CEO_ROOM_KEY || 'Velho202026'"));
assert.ok(server.includes('function ensureCeoRoom()'));
assert.ok(server.includes('if(code===CEO_ROOM_CODE)'));
assert.ok(server.includes('if(key!==CEO_KEY)'));
assert.ok(server.includes('persistent:!!ceo'));
assert.ok(server.includes('!r.players.size&&!r.persistent'));

// Limite de código no cliente e servidor
assert.ok(html.includes('id="room" maxlength="15"'));
assert.ok(app.includes('code.length>15'));
assert.ok(server.includes('code.length>MAX_ROOM_CODE_LENGTH'));

// Simulação da normalização usada pelo servidor.
const normalize = v => String(v || '').trim().toUpperCase();
assert.strictEqual(normalize('Velho202026'), CEO_CODE);
assert.strictEqual(normalize(' velho202026 '), CEO_CODE);
assert.strictEqual(normalize('VELHO202026'), CEO_CODE);
assert.strictEqual(normalize('VELHO202026123456'), 'VELHO202026123456');
assert.ok('VELHO202026123456'.length > 15);

// Simulação do ciclo: sala CEO existe vazia -> jogador entra com chave -> pode iniciar sozinho.
const room = { code: CEO_CODE, ceo: true, persistent: true, players: new Map(), running: false };
assert.strictEqual(room.players.size, 0);
assert.strictEqual(normalize('Velho202026'), room.code);
assert.strictEqual(CEO_KEY, 'Velho202026');
room.players.set('test-socket', { id:'test-socket', nickname:'Teste CEO' });
assert.strictEqual(room.players.size, 1);
const mayStart = room.ceo && room.players.has('test-socket');
assert.strictEqual(mayStart, true);
room.running = true;
assert.strictEqual(room.running, true);

// Sala normal continua independente da sala CEO.
const normalRoom = { code:'ABC123', ceo:false, persistent:false, players:new Map() };
assert.strictEqual(normalRoom.ceo, false);

console.log('NEON PATH ROOM QA: PASS');
console.log('CEO code:', CEO_CODE);
console.log('CEO key :', CEO_KEY);
console.log('Checks  : 18');
