# NEON PATH 6.4 — Correção da Sala CEO

## Correções
- Sala `VELHO202026` criada automaticamente no boot do servidor.
- Código exibido ao jogador como `Velho202026` e comparação sem diferenciar maiúsculas/minúsculas.
- Chave `Velho202026` obrigatória para entrar na sala CEO.
- Sala CEO não é apagada quando o último jogador sai.
- CEO pode iniciar com apenas um jogador.
- Código limitado a 15 caracteres no cliente e servidor.
- Campo separado para chave da sala.
- Mensagens de erro mais claras.

## QA executado
- `node --check server.js` — PASS
- `node --check app.js` — PASS
- `node test.js` — PASS
- `node test-room.js` — PASS
- Simulação: sala vazia → entrada CEO com chave → 1 jogador → início — PASS
- Simulação: código com maiúsculas/minúsculas — PASS
- Simulação: código acima de 15 caracteres — PASS

Observação: o teste local não substitui o teste final no Render. Depois do deploy, o endpoint `/health` e a entrada real na sala devem ser conferidos.
