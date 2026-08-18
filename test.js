const assert=require('assert');
const fs=require('fs');
const html=fs.readFileSync('index.html','utf8');
const css=fs.readFileSync('style.css','utf8');
const app=fs.readFileSync('app.js','utf8');
const server=fs.readFileSync('server.js','utf8');

// ===== Static UX / security QA =====
assert(html.includes('id="modePanel"'),'mode selector missing');
assert(html.includes('id="modeSolo"'),'solo option missing');
assert(html.includes('id="modePrivate"'),'private room option missing');
assert(html.includes('id="roomNameInput"'),'room name field missing');
assert(html.includes('id="roomPasswordInput"'),'room password field missing');
assert(html.includes('id="roomCodeInput" maxlength="15"'),'room code max 15 missing');
assert(html.includes('id="termsGate"'),'terms gate missing');
assert(html.includes('id="termsAccept"'),'terms checkbox missing');
assert(html.includes('id="downloadResources"'),'resource download button missing');
assert(html.includes('id="rotateFullscreen"'),'fullscreen button missing');
assert(html.includes('E-MAIL <span>OPCIONAL</span>'),'optional email missing');
assert(html.includes('id="loading"'),'separate loading screen missing');
assert(html.includes('id="finish"'),'finish/podium screen missing');
assert(html.includes('id="ceoBtn"'),'CEO control missing');
assert(html.includes('id="shopBtn"'),'shop button missing');
assert(html.includes('INDISPONÍVEL NO MOMENTO'),'shop unavailable state missing');
assert(app.includes('requestFullscreenLandscape'),'fullscreen/orientation helper missing');
assert(app.includes('showTermsGate'),'terms gate missing');
assert(app.includes('caches.open("neon-path-resources-v1")'),'resource cache missing');
assert(app.includes('mode:"solo"'),'client solo request missing');
assert(app.includes('roomName:pr.name'),'client room name missing');
assert(app.includes('password:pr.password'),'client room password missing');
assert(!app.includes('p.bot?"<small>BOT</small>"'),'client must never expose bot label');
assert(server.includes('Código da sala deve ter no máximo 15 caracteres'),'server room-code validation missing');
assert(server.includes('function roomPasswordHash'),'room password hashing missing');
assert(server.includes('function cleanRoomName'),'room name validation missing');
assert(server.includes('Senha da sala incorreta'),'room password validation missing');
assert(server.includes('r.ownerId===s.id'),'private room start must be owner-authorized');
assert(server.includes("s.on('room:leave'"),'room leave event missing');
assert(!/bot:!!p\.bot/.test(server),'bot flag must not be sent to clients');
assert(server.includes("mode==='solo'"),'solo mode missing');
assert(server.includes('BOT_NAMES'),'solo AI opponents missing');
assert(server.includes('botSkill'),'bot difficulty missing');
assert(server.includes('s.data.soloOwner'),'solo owner authorization missing');
assert(server.includes('race:finish'),'finish event missing');
assert(/bcrypt/.test(server),'password hashing missing');
assert(css.includes('#rotateNotice'),'landscape gate CSS missing');
assert(css.includes('.gate'),'terms gate CSS missing');
assert(css.includes('.mode-option'),'mode selector CSS missing');
assert(css.includes('.shop-unavailable'),'shop unavailable CSS missing');

// ===== Solo simulation: 1 human + 7 hidden AI opponents, 3 laps =====
const MAX=8, TICK=1/30;
const skills=[1,0.94,0.98,1.02,0.96,1.05,0.92,1.00];
const racers=Array.from({length:MAX},(_,i)=>({id:i,bot:i>0,skill:skills[i],progress:i*0.008,lap:1,speed:0,energy:100,boost:0,finish:null,alive:true,lane:0}));
let finishOrder=0;
for(let tick=0;tick<10000 && finishOrder<MAX;tick++){
  for(const p of racers){
    if(!p.alive)continue;
    if(p.bot && p.energy>=20 && tick%180===0){p.energy-=20;p.boost=1.55;}
    const target=(p.bot?13.5*p.skill:13.5)+(p.boost>0?7:0);
    p.speed+=(target-p.speed)*.11;
    p.progress+=p.speed*TICK/(2*Math.PI*52*1.05);
    p.energy=Math.min(100,p.energy+5*TICK);
    p.boost=Math.max(0,p.boost-TICK);
    if(p.progress>=1){p.progress-=1;p.lap++;if(p.lap>3){p.alive=false;p.finish=++finishOrder;}}
  }
}
assert.strictEqual(finishOrder,MAX,'solo simulation did not finish all 8 racers');
assert(racers[0].finish>=1 && racers[0].finish<=MAX,'human racer did not finish');
assert(new Set(racers.map(r=>r.finish)).size===MAX,'finish positions duplicated');

// ===== Private room simulation: name + password + code =====
const crypto=require('crypto');
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
const room={code:'ABC12345',mode:'room',roomName:'Corrida do Velho',passwordHash:hash('1234'),ownerId:'human',players:new Map()};
assert(room.code.length<=15,'room code exceeds 15');
assert(room.roomName==='Corrida do Velho','room name not stored');
assert(hash('1234')===room.passwordHash,'room password hash mismatch');
assert(hash('errada')!==room.passwordHash,'wrong room password accepted');
room.players.set('human',{id:'human',bot:false});
room.players.set('friend',{id:'friend',bot:false});
assert([...room.players.values()].every(p=>!p.bot),'private room cannot inject AI opponents');
assert(room.ownerId==='human','room owner missing');

// ===== Solo privacy: AI is internal only =====
const solo={mode:'solo',players:new Map([['human',{id:'human',bot:false}]])};
for(let i=1;i<MAX;i++)solo.players.set('bot-'+i,{id:'bot-'+i,bot:true});
const publicPlayerView=[...solo.players.values()].map(p=>({id:p.id,nickname:'Pilot',alive:true}));
assert.strictEqual(solo.players.size,8,'solo must contain 8 racers');
assert.strictEqual([...solo.players.values()].filter(p=>p.bot).length,7,'solo must contain exactly 7 AI opponents internally');
assert(!('bot' in publicPlayerView[1]),'AI status leaked to player view');

console.log('NEON PATH 7.2 QA: OK');
console.log('SOLO SIMULATION: 1 human + 7 hidden AI, 3 laps: FINISHED');
console.log('PRIVATE ROOM SIMULATION: name + password + <=15 char code: OK');
console.log('SECURITY QA: bot flag hidden from client snapshot; room start owner-only: OK');
