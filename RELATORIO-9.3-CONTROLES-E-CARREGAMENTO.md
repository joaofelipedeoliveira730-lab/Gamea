# NEON PATH 9.3 — CONTROLES + CORREÇÃO DO JOGO NÃO CARREGAR

## Correções principais

### 1. Jogo travando / não iniciando
O loop de renderização usava `lastFrameTime` sem inicialização em módulo JavaScript. Como módulos são executados em strict mode, isso podia gerar `ReferenceError` no primeiro frame e deixar a corrida parada/sem renderização.

Agora `lastFrameTime` é inicializado e reinicializado ao iniciar a corrida.

Também foi adicionado tratamento de erro no boot do motor 3D. Se a criação da cena/renderizador falhar, a tela não fica simplesmente congelada: o jogo mostra recuperação e tenta reconstruir a corrida.

### 2. Controles de celular
Adicionados controles grandes e próprios para toque:
- ACELERAR
- FREIO
- esquerda
- direita
- DRIFT
- TURBO
- ITEM

Os botões de esquerda/direita foram aumentados para facilitar o controle em celular.

### 3. Aceleração e freio reais
O servidor agora entende `throttle` e `brake`.
- Sem acelerar, o kart reduz a velocidade.
- Freio reduz fortemente a velocidade.
- Bots continuam acelerando automaticamente.
- Teclas W/Seta para cima aceleram.
- S/Seta para baixo freiam.

### 4. Item utilizável visualmente
O botão ITEM agora possui dois estados:
- **ITEM PRONTO:** cor forte, brilho e animação leve.
- **ITEM INDISPONÍVEL:** mesma identidade visual, porém escurecido e sem brilho.

O servidor envia `itemReady` no estado da partida. O cliente não precisa adivinhar a disponibilidade.

### 5. HUD de partida
A lista de pilotos foi reduzida para ocupar menos espaço e não atrapalhar a visão da pista.

## Recursos
Nenhum arquivo existente da pasta `resources/` foi removido nesta revisão.
