'use strict';

const assert=require('assert');
const fs=require('fs');
const path=require('path');
const {spawnSync}=require('child_process');
const root=__dirname;
const read=name=>fs.readFileSync(path.join(root,name),'utf8');
const html=read('index.html'),css=read('style.css'),app=read('app.js'),sw=read('service-worker.js');
const manifest=JSON.parse(read('assets-manifest.json'));
const pwa=JSON.parse(read('manifest.webmanifest'));

// Sintaxe de todos os scripts executáveis.
for(const file of ['app.js','server.js','game-core.js','service-worker.js']){
  const result=spawnSync(process.execPath,['--check',file],{cwd:root,encoding:'utf8'});
  assert.strictEqual(result.status,0,`${file}: ${result.stderr}`);
}

// Três famílias de viewport + controles de toque grandes e retrato funcional.
for(const contract of ['@media(max-width:1100px)','@media(max-width:820px)','@media(max-width:520px)','@media(pointer:coarse)','orientation:landscape','orientation:portrait','prefers-reduced-motion:reduce'])assert(css.includes(contract),`CSS responsivo ausente: ${contract}`);
const portrait=css.slice(css.indexOf('@media(pointer:coarse) and (orientation:portrait)'),css.indexOf('@media(max-width:520px)'));
assert(portrait.includes('width:72px;height:72px'),'alvos de toque em retrato ficaram pequenos');
assert(!/body\s*\{[^}]*display\s*:\s*none/.test(portrait),'o jogo desaparece em retrato');
assert(css.includes('safe-area-inset-bottom'),'safe area de celular ausente');
assert(css.includes('overscroll-behavior:none'),'gesto da página pode disputar com a corrida');
assert(html.includes('viewport-fit=cover'),'viewport sem suporte a notch');
assert(html.includes('Continuar em retrato'),'orientação virou bloqueio obrigatório');
assert(app.includes('DEVICE_LOW'),'detecção de aparelho fraco ausente');
assert(app.includes('fps<29'),'fallback automático de FPS ausente');

// O pacote Essencial respeita o orçamento de 3 MiB; o HD permanece opcional.
const liteBytes=manifest.packs.lite.reduce((sum,file)=>sum+fs.statSync(path.join(root,file)).size,0);
assert(liteBytes<=3*1024*1024,`pacote essencial passou de 3 MiB: ${liteBytes}`);
const shell=['index.html','style.css','app.js','config.js','loading-hero.webp','prestige-emblem.webp','1-spark.svg'];
const shellBytes=shell.reduce((sum,file)=>sum+fs.statSync(path.join(root,file)).size,0);
assert(shellBytes<=450*1024,`shell inicial passou de 450 KiB: ${shellBytes}`);
assert(sw.includes("request.headers.has('range')"),'service worker intercepta Range de vídeo');
assert(sw.includes("/api/")&&sw.includes("/socket.io/"),'service worker pode cachear dados vivos');
assert(sw.includes("const CACHE_VERSION='v12-0-4'")&&sw.includes('neon-path-resources-v12'),'versões de cache inconsistentes');

// PWA instalável e sem orientação forçada.
assert.strictEqual(pwa.display,'fullscreen');
assert.strictEqual(pwa.orientation,'any');
assert.strictEqual(pwa.lang,'pt-BR');
assert(Array.isArray(pwa.icons)&&pwa.icons.length>0);
assert(html.includes('rel="manifest" href="manifest.webmanifest"'));
assert.strictEqual(pwa.start_url,'./','PWA ainda depende da raiz do domínio');
assert.strictEqual(pwa.scope,'./','escopo PWA ainda depende da raiz do domínio');
assert(!sw.includes("const SHELL=['/'"),'service worker ainda usa caminhos absolutos');

function probe(file){
  const result=spawnSync('ffprobe',['-v','error','-show_entries','format=duration:stream=codec_name,width,height','-of','json',file],{cwd:root,encoding:'utf8'});
  assert.strictEqual(result.status,0,`ffprobe falhou em ${file}: ${result.stderr}`);return JSON.parse(result.stdout);
}
const video=probe('loading-cinematic.mp4'),videoStream=video.streams.find(x=>x.codec_name==='h264');
assert(videoStream,'cinemática não está em H.264');
assert.strictEqual(videoStream.width,1280);assert.strictEqual(videoStream.height,720);
assert(Number(video.format.duration)>=8&&Number(video.format.duration)<=10,'duração inesperada da cinemática');
const music=probe('velocity-protocol.mp3');
assert(music.streams.some(x=>x.codec_name==='mp3'),'trilha não está em MP3');
assert(Number(music.format.duration)>=28&&Number(music.format.duration)<=31,'duração inesperada da trilha');
assert(fs.statSync(path.join(root,'loading-cinematic.mp4')).size<1.5*1024*1024,'MP4 pesado demais');
assert(fs.statSync(path.join(root,'velocity-protocol.mp3')).size<600*1024,'trilha pesada demais');

// Fontes locais referenciadas por HTML/CSS precisam existir (rotas dinâmicas são ignoradas).
const refs=new Set();
for(const m of html.matchAll(/(?:src|href)=["']([^"'#?]+)["']/g))refs.add(m[1]);
for(const m of css.matchAll(/url\(["']?([^"')]+)["']?\)/g))refs.add(m[1]);
for(const ref of refs){
  if(ref.startsWith('http')||ref.startsWith('data:')||ref.startsWith('/socket.io/'))continue;
  const local=ref.replace(/^\//,'');assert(fs.existsSync(path.join(root,local)),`referência quebrada: ${ref}`);
}

console.log(`NEON PATH 12.0.4 QA VISUAL: PASS · shell ${(shellBytes/1024).toFixed(0)} KiB · essencial ${(liteBytes/1048576).toFixed(2)} MiB · MP4 ${Number(video.format.duration).toFixed(1)}s`);
