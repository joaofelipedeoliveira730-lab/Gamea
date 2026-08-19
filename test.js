'use strict';

const assert=require('assert');
const fs=require('fs');
const path=require('path');
const core=require('./game-core');
const root=__dirname;
const read=name=>fs.readFileSync(path.join(root,name),'utf8');
const html=read('index.html'),css=read('style.css'),app=read('app.js'),server=read('server.js');
const manifest=JSON.parse(read('assets-manifest.json'));

// Contratos de interface: todo ID acessado pelo JavaScript precisa existir uma única vez.
const htmlIds=[...html.matchAll(/\bid=["']([^"']+)["']/g)].map(m=>m[1]);
const usedIds=new Set([...app.matchAll(/\$\(["']([^"']+)["']\)/g)].map(m=>m[1]));
for(const m of app.matchAll(/getElementById\(["']([^"']+)["']\)/g))usedIds.add(m[1]);
assert.strictEqual(new Set(htmlIds).size,htmlIds.length,'há IDs HTML duplicados');
for(const id of usedIds)assert(htmlIds.includes(id),`ID usado no app não existe: ${id}`);
for(const id of ['bootSplash','termsGate','resourceLite','resourceHd','playQuick','modeOnline','prestigeBtn','shopBtn','inventoryBtn','rank','touchLeft','touchRight','touchDrift','touchAccelerate','touchBrake','touchTurbo','touchItem','loadingVideo','pausePanel','finish'])assert(htmlIds.includes(id),`contrato visual ausente: ${id}`);

// Recursos e formatos reais.
assert.strictEqual(manifest.version,'12.0.1-prestige');
assert.strictEqual(manifest.hd_scenes.length,8);
assert.strictEqual(manifest.portraits.length,8);
assert(manifest.packs.lite.includes('loading-cinematic.mp4'));
assert(manifest.packs.lite.includes('velocity-protocol.mp3'));
for(const group of ['environment_textures','sky_billboards','arena_detail','hd_scenes','portraits']){
  for(const file of manifest[group]){assert(!file.includes('/'),`layout não é plano: ${file}`);assert(fs.existsSync(path.join(root,file)),`recurso ausente: ${file}`);}
}
for(const file of manifest.packs.lite)assert(fs.existsSync(path.join(root,file)),`pacote essencial incompleto: ${file}`);
const mp4=fs.readFileSync(path.join(root,'loading-cinematic.mp4'));
assert.strictEqual(mp4.subarray(4,8).toString(),'ftyp','MP4 inválido');
const mp3=fs.readFileSync(path.join(root,'velocity-protocol.mp3'));
assert(mp3.subarray(0,3).toString()==='ID3'||mp3[0]===0xff,'MP3 inválido');
for(const file of ['loading-hero.webp','map-porto-fantasma.webp','prestige-emblem.webp']){
  const data=fs.readFileSync(path.join(root,file));assert.strictEqual(data.subarray(0,4).toString(),'RIFF',`${file} inválido`);assert.strictEqual(data.subarray(8,12).toString(),'WEBP',`${file} inválido`);
}

// Motor, recuperação, conectividade e backend persistente.
assert(app.includes('gameRunning=true'),'regressão: motor inicia marcado como parado');
assert(app.includes('webglcontextlost'),'recuperação WebGL ausente');
assert(app.includes('adaptiveReduced'),'qualidade adaptativa ausente');
assert(app.includes('room:matchmake'),'matchmaking global ausente');
assert(app.includes('neon-path-resources-v12'),'cache de recursos v12 ausente');
assert(server.includes('process.env.DATABASE_URL'),'PostgreSQL desconectado');
assert(server.includes('server_awards_only'),'cliente ainda pode fabricar XP');
assert(server.includes('async function awardRace'),'recompensas autoritativas ausentes');
assert(server.includes('FOR UPDATE'),'economia sem trava transacional');
assert(server.includes("mode==='public'"),'sala pública ausente');
assert(server.includes('canUseTrack'),'bloqueio do circuito de Prestígio ausente');
assert(server.includes('immortal_protocol'),'recompensa final de Prestígio ausente');
assert(!server.includes("'Velho202026'"),'segredo antigo embutido no servidor');
assert(!server.includes('p.x=m.x')&&!server.includes('p.y=m.y'),'cliente controla coordenadas do servidor');
assert(html.includes('three@0.178.0'),'versão do motor Three.js não está fixada');
assert(css.includes('@media(pointer:coarse)'),'controles móveis não detectados');
for(const track of ['neon-city','pirate-bay','desert-run','mountain-peak','space-station','jungle-falls','volcano-rush','ice-world','immortal-grid']){assert(app.includes(`id:"${track}"`),`pista ausente no cliente: ${track}`);assert(server.includes(`id:'${track}'`),`pista ausente no servidor: ${track}`);}

// Limites exatos do Caminho do Prestígio.
const thresholds=[0,1250,3000,6000,10000,15000];
thresholds.forEach((xp,index)=>assert.strictEqual(core.prestigeForXp(xp),index));
thresholds.slice(1).forEach((xp,index)=>assert.strictEqual(core.prestigeForXp(xp-1),index));
assert.strictEqual(core.prestigeForXp(99_999_999),5);

// 1.200 concessões sequenciais: XP total e prestígio jamais podem regredir.
let profile={level:1,xp:0,lifetime_xp:0,prestige:0},lastPrestige=0,totalGranted=0;
for(let i=0;i<1200;i++){
  const reward=core.calculateRaceRewards(i%8+1,i%3===0?'solo':'public',i%4);
  assert(reward.xp>0&&reward.coins>0&&Number.isFinite(reward.ph));
  const next=core.advanceProfile(profile,reward.xp);
  totalGranted+=reward.xp;
  assert(next.lifetime_xp>=profile.lifetime_xp,'XP total regrediu');
  assert(next.prestige>=lastPrestige&&next.prestige<=5,'prestígio inválido');
  assert(next.level>=profile.level&&next.level<=100,'nível inválido');
  assert(next.xp>=0&&next.xp<=next.xp_needed,'XP de nível fora do limite');
  profile=next;lastPrestige=next.prestige;
}
assert.strictEqual(profile.lifetime_xp,totalGranted);
assert.strictEqual(profile.prestige,5);
for(let position=1;position<8;position++)assert(core.calculateRaceRewards(position).xp>=core.calculateRaceRewards(position+1).xp,'recompensa de posição invertida');
assert(core.calculateRaceRewards(1,'solo').xp<core.calculateRaceRewards(1,'public').xp,'solo deveria ter multiplicador reduzido');

// Simulação determinística de 540 corridas completas: 3 modos, 9 mapas e 20 seeds.
const tracks=[[48,27],[50,28],[52,29],[46,30],[50,27],[48,29],[52,28],[49,30],[54,31]];
const skills=[1,.94,.98,1.02,.96,1.05,.92,1];
function simulateRace(trackIndex,seed){
  let state=seed>>>0;const random=()=>{state=(state*1664525+1013904223)>>>0;return state/4294967296};
  const [rx,rz]=tracks[trackIndex],dt=1/30;
  const racers=Array.from({length:8},(_,i)=>({id:i,skill:skills[i],progress:i*.008,lap:1,speed:0,energy:100,boost:0,lane:(i%4-1.5)*2.1,alive:true,finish:0}));
  let finished=0;
  for(let tick=0;tick<5000&&finished<8;tick++)for(const p of racers){
    if(!p.alive)continue;
    const steer=Math.max(-1,Math.min(1,Math.sin(tick/31+p.id)*.7+(random()-.5)*.1));
    if(p.energy>=20&&random()<.009){p.energy-=20;p.boost=1.55;}
    const target=13.7*p.skill+(p.boost>0?7.5:0);p.speed+=(target-p.speed)*.12;
    p.lane=Math.max(-7.5,Math.min(7.5,(p.lane+steer*dt*8)*.986));
    p.progress+=p.speed*dt/(2*Math.PI*Math.max(rx,rz)*1.05);
    if(p.progress>=1){p.progress-=1;p.lap++;if(p.lap>3){p.finish=++finished;p.alive=false;}}
    p.energy=Math.min(100,p.energy+5*dt);p.boost=Math.max(0,p.boost-dt);
    assert(Number.isFinite(p.progress)&&Number.isFinite(p.speed)&&Number.isFinite(p.lane),'NaN na física');
  }
  assert.strictEqual(finished,8,'corrida não terminou');
  assert.strictEqual(new Set(racers.map(p=>p.finish)).size,8,'posição final duplicada');
  assert(racers.every(p=>Math.abs(p.lane)<=7.5),'piloto escapou do limite da pista');
}
let races=0;
for(let mode=0;mode<3;mode++)for(let map=0;map<tracks.length;map++)for(let seed=0;seed<20;seed++){simulateRace(map,0xabc000+mode*1000+map*100+seed);races++;}
assert.strictEqual(races,540);

console.log(`NEON PATH 12.0.1 CORE: PASS · ${races} corridas · 1.200 progressões · ${htmlIds.length} IDs validados`);
