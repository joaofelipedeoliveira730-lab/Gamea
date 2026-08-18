# NEON PATH 7.1 — SOLO + SALAS

## Modo Solo
- Novo modo `solo` real no servidor.
- Cada corrida solo recebe 1 jogador humano + 7 bots.
- Bots têm habilidades diferentes e usam turbo automaticamente.
- Movimento, progresso, voltas e chegada continuam autoritativos no servidor.
- Corrida solo não aceita entrada de outro jogador humano.
- O código da corrida solo é interno e não funciona como sala multiplayer.

## Salas multiplayer
- Modo normal continua separado do modo solo.
- Salas normais aceitam outros jogadores até o limite configurado.
- O início da corrida continua validado pelo servidor.
- CEO continua protegido por chave e autorização server-side.

## Testes
- `node --check server.js` — OK
- `node --check app.js` — OK
- `node test.js` — OK
- Simulação solo: 8 pilotos, 3 voltas — TODOS FINALIZARAM.
- Simulação de sala: 2 jogadores humanos — OK.
