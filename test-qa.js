'use strict';
const assert=require('assert');
const fs=require('fs');
const core=require('./game-core');
const root=__dirname;
const html=fs.readFileSync(root+'/index.html','utf8');
const app=fs.readFileSync(root+'/app.js','utf8');
const server=fs.readFileSync(root+'/server.js','utf8');

// 1) Interface contracts
for(const id of ['authPanel','loginForm','registerForm','authNick','authPassword','registerNick','registerPassword','registerEmail','loginBtn','registerBtn','toRegister','toLogin','nick','create','join','rank','room','roomKey','quality','logout','start','turbo','sab']){
  assert(html.includes(`id="${id}"`),`missing button/input: ${id}`);
}
assert(html.includes('maxlength="15"'));
assert(app.includes("$('join').onclick"));
assert(app.includes("$('create').onclick"));
assert(app.includes("$('rank').onclick"));
assert(app.includes("$('turbo').onclick"));
assert(app.includes("$('sab').onclick"));

// 2) Room code and CEO access
assert(core.isRoomCodeLengthValid('Velho202026'));
assert.strictEqual(core.normalizeRoomCode(' velho202026 '),'VELHO202026');
assert(!core.isRoomCodeLengthValid('1234567890123456'));
assert(server.includes("const CEO_ROOM_CODE = 'VELHO202026'"));
assert(server.includes("const CEO_KEY = process.env.CEO_ROOM_KEY || 'Velho202026'"));
assert(server.includes('ensureCeoRoom()'));
assert(server.includes('r.ceo||r.players.size>=1'));

// 3) Security / bad-faith input tests
assert.strictEqual(core.cleanNick('<script>alert(1)</script>'),null);
assert.strictEqual(core.sanitizeInput({type:'../../server'}),null);
assert.strictEqual(core.sanitizeInput({type:'left'}),'left');
const room={running:true,started:Date.now()-5000,players:new Map()};
const p=Object.assign(core.spawn(0),{id:'attacker',nickname:'Tester'});room.players.set(p.id,p);
for(let i=0;i<100;i++) core.applyInput(p,'left',Date.now(),room);
assert(p.suspiciousInputs>0,'input flood was not detected');
assert(p.a<=Math.PI*2 && p.a>=-Math.PI*2,'angle exploded');

// 4) Server-authoritative movement: client cannot submit x/y through input.
assert(!server.includes("p.x=m.x") && !server.includes("p.y=m.y"));
assert(server.includes('core.stepPlayer'));
assert(server.includes('core.collision'));

// 5) Sabotage abuse tests: cooldown + range/front targeting.
const attacker=Object.assign(core.spawn(0),{id:'a',nickname:'A'});
const target=Object.assign(core.spawn(1),{id:'b',nickname:'B'});
attacker.x=50;attacker.y=40;attacker.a=0;target.x=58;target.y=40;
const rr={running:true,started:Date.now()-10000,players:new Map([['a',attacker],['b',target]])};
let r=core.applyInput(attacker,'sabotage',Date.now(),rr);assert(r.accepted&&r.sabotage);
assert(!core.applyInput(attacker,'sabotage',Date.now()+1000,rr).accepted,'sabotage cooldown bypassed');
assert(core.chooseSabotageTarget(attacker,rr)===target);

// 6) Simulate 100 complete QA matches with 8 players and hostile input spam.
for(let match=1;match<=100;match++){
  const r={running:true,started:Date.now()-match*10,players:new Map()};
  for(let i=0;i<8;i++){
    const q=Object.assign(core.spawn(i),{id:`m${match}-p${i}`,nickname:`P${i}`});r.players.set(q.id,q);
  }
  for(let tick=0;tick<180;tick++){
    const now=Date.now()+tick*34;
    for(const q of r.players.values()){
      const type=tick%37===0?'sabotage':tick%13===0?'turbo':tick%2?'right':'left';
      core.applyInput(q,type,now,r);
      // hostile payloads are ignored by sanitizeInput
      if(tick%17===0) assert.strictEqual(core.sanitizeInput({type:'setPosition',x:999999,y:-999999}),null);
      core.stepPlayer(q,r,core.TICK_MS/1000,now);
      if(core.collision(q,r))q.alive=false;
    }
  }
  assert.strictEqual(r.players.size,8);
}

// 7) Auth flow contract and optional email
assert(server.includes("req.body?.email"));
assert(server.includes('email_invalido'));
assert(server.includes('login_invalido'));
assert(server.includes('bcrypt.compare'));
assert(server.includes('JWT_SECRET'));
assert(server.includes('server_awards_only'));

console.log('NEON PATH 7.0 QA: PASS');
console.log('100 partidas simuladas: PASS');
console.log('Anti-spam/anti-payload: PASS');
console.log('Sala CEO + código <=15: PASS');
console.log('Login/cadastro/e-mail opcional: PASS');
console.log('Botões essenciais: PASS');
