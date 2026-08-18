# NEON PATH 8.5 — MEGA RACE FIX

## Corrida refeita
- Pista oval real com centro, asfalto, acostamento, zebras, faixas e grid de largada.
- Cenário procedural por mapa com prédios, árvores, postes, iluminação, elementos temáticos e partículas.
- Uso das texturas já existentes em `resources/` para o asfalto e detalhes.
- Kart arredondado com piloto, capacete, visor, rodas, faróis, spoiler, escape e brilho de turbo.
- HUD inspirado no layout de kart arcade: classificação com retratos, minimapa, volta, tempo, velocidade e turbo.

## Celular
- Corrida continua obrigatoriamente em paisagem.
- Tentativa de fullscreen + `screen.orientation.lock("landscape")`.
- Controles touch grandes e persistentes: esquerda, direita, turbo e item.
- `pointerdown/pointerup/pointercancel` com repetição de direção para não depender de toque único.
- Botão SAIR da corrida.

## Carregamento
- A pista aparece primeiro em tela de carregamento.
- Se a preparação passar de 3 segundos, o carregamento fica explicitamente desfocado e mostra `AINDA CARREGANDO... OTIMIZANDO O CENÁRIO`.
- Cache e download de recursos existentes continuam preservados.

## Qualidade
- Auto, baixa, média e alta.
- Pixel ratio adaptativo conforme aparelho.
- Antialias, sombras e quantidade de partículas ajustados por perfil.
- Tone mapping ACES e correção de cor no renderer.

## Segurança / multiplayer
- Servidor continua autoritativo.
- Limite de input, limite de faixa, senha de sala e autorização do dono preservados.
- O cliente não recebe uma etiqueta dizendo que os adversários são bots.

## QA executado
- `node --check app.js`: OK
- `node --check server.js`: OK
- `node test.js`: OK
- 300 simulações completas: 100 SOLO + 100 SALA PRIVADA + 100 CEO, cobrindo os 8 mapas.
- Testes de limite de faixa, NaN/Infinity, ordem de chegada, inputs maliciosos, senha de sala e autorização: OK.

## Recursos
**IMPORTANTE:** nesta correção a pasta `resources/` NÃO foi alterada, apagada ou substituída. Os 75 arquivos existentes foram preservados. A correção apenas passou a utilizá-los melhor.
