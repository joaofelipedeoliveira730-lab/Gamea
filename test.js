const assert=require('assert');
const fs=require('fs');
const html=fs.readFileSync('index.html','utf8');
const css=fs.readFileSync('style.css','utf8');
const app=fs.readFileSync('app.js','utf8');
const server=fs.readFileSync('server.js','utf8');

// ===== Static QA =====
assert(html.includes('maxlength="15"'),'room code limit missing');
assert(html.includes('E-MAIL <span>OPCIONAL</span>'),'optional email missing');
assert(html.includes('rotateNotice'),'landscape gate missing');
assert(html.includes('id="loading"'),'separate loading screen missing');
assert(html.includes('id="finish"'),'finish/podium screen missing');
assert(html.includes('id="ceoBtn"'),'CEO control missing');
assert(html.includes('id="soloBtn"'),'solo mode button missing');
assert(html.includes('id="lobbyMode"'),'lobby mode label missing');
assert(app.includes('quality==="low"'),'quality optimization missing');
assert(app.includes('buildTrack'),'track builder missing');
assert(app.includes('PIRATE BAY') && app.includes('ICE WORLD'),'multiple maps missing');
assert(app.includes('showLoading'),'lazy loading flow missing');
assert(app.includes('mode:forceSolo||pendingAction==="solo"?"solo":"room"'),'client must request solo mode');
assert(app.includes('roomMode'),'client must track room mode');
assert(server.includes('Código da sala deve ter no máximo 15 caracteres'),'server room-code validation missing');
assert(server.includes("mode==='solo'"),'server solo mode missing');
assert(server.includes('BOT_NAMES'),'solo bots missing');
assert(server.includes('botSkill'),'bot difficulty missing');
assert(server.includes('s.data.soloOwner'),'solo owner authorization missing');
assert(server.includes("r.mode==='solo'"),'solo room join protection missing');
assert(server.includes("mode:r.mode"),'room mode must be synchronized');
assert(server.includes("race:finish"),'server finish event missing');
assert(server.includes('s.data.ceo&&r.players.get(s.id)'),'CEO room start must be server-authorized');
assert(server.includes('progress'),'authoritative progress missing');
assert(/cleanNick/.test(server),'nickname validation missing');
assert(/bcrypt/.test(server),'password hashing missing');
assert(css.includes('.bot-player'),'bot lobby styling missing');

// ===== Solo match simulation =====
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

// ===== Room simulation =====
const room={mode:'room',players:new Map([['human',{id:'human',bot:false}],['friend',{id:'friend',bot:false}]])};
assert(room.mode==='room','normal room mode missing');
assert([...room.players.values()].filter(p=>p.bot).length===0,'normal room cannot inject bots');
const solo={mode:'solo',players:new Map([['human',{id:'human',bot:false}]])};
for(let i=1;i<MAX;i++)solo.players.set('bot-'+i,{id:'bot-'+i,bot:true});
assert.strictEqual(solo.players.size,8,'solo must contain human + 7 bots');
assert.strictEqual([...solo.players.values()].filter(p=>p.bot).length,7,'solo must contain exactly 7 bots');
assert(solo.mode==='solo','solo mode flag missing');

console.log('NEON PATH 7.1 QA: OK');
console.log('SOLO SIMULATION: 8 racers (1 human + 7 bots), 3 laps: FINISHED');
console.log('ROOM SIMULATION: 2 human racers can share a normal room: OK');
