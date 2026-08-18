# NEON PATH 9.4 — ULTRA RACE FIX

## Bug crítico corrigido
A partida ficava presa em **CARREGANDO PISTA...** porque `buildEnvironment()` atribuía `environmentGroup` e `environmentSeed` sem declaração. Como `app.js` é um ES Module, isso gera `ReferenceError` e interrompe `startGame()`.

Correção: as duas variáveis agora são declaradas no estado do motor 3D.

## Carregamento resiliente
- O cenário HD nunca mais bloqueia a partida indefinidamente.
- A textura de fundo tem um orçamento de 1,8 s; depois disso o jogo segue usando o cenário 3D procedural.
- O indicador de carregamento continua visível enquanto recursos lentos são preparados.
- O carregador antigo não acumula vários `setInterval` quando ocorre uma recuperação.

## Upgrade visual
- Asfalto recebeu textura procedural leve com microvariações para eliminar o aspecto de superfície lisa/chapada.
- Mantidos iluminação, fog, sombras, guard rails, zebras, prédios, vegetação, rochas, nuvens, estrelas e itens.
- O cenário continua sendo geometria 3D real, com fallback independente de imagens externas.
- Qualidade `low/medium/high/auto` continua disponível para adaptar GPU, sombras, antialias e densidade de efeitos.

## Recursos
Nenhum arquivo existente da pasta `resources/` foi removido.

## Testes executados
- `node --check app.js` — OK
- `node --check server.js` — OK
- `npm test` — OK
- 300 corridas simuladas: OK
- 3 modos x 8 mapas: OK
- testes de sala/senha/autoridade/input: OK
- teste de preservação de recursos: OK

## Sobre tamanho de 14–40 GB
Não foi adicionada massa artificial de arquivos para atingir 14 GB. Em um jogo Web, isso pioraria drasticamente download, memória, tempo de carregamento e celulares. A arquitetura foi mantida **asset-streaming/lazy-load**, permitindo adicionar futuramente pacotes HD/4K opcionais sem obrigar todos os jogadores a baixarem dezenas de GB.
