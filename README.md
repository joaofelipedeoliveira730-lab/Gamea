# NEON PATH RACING 9.7 — FLAT EDITION

Versão preparada para GitHub/Render sem pastas de recursos. Todos os arquivos de imagens e SVG ficam na raiz do projeto.

## Estrutura

- `index.html` — interface
- `style.css` — visual/HUD/controles
- `app.js` — cliente 3D e controles
- `server.js` — servidor autoritativo + Socket.IO
- `test.js` — QA estático + simulação de 300 corridas
- `assets-manifest.json` — catálogo de recursos
- `*.jpg`, `*.svg`, `*.png` — recursos achatados na raiz

## Rodar

```bash
npm install
npm test
npm start
```

Render: Runtime Node, Build `npm install`, Start `npm start`. Defina `DATABASE_URL`, `JWT_SECRET` (32+ caracteres recomendado) e `CEO_ROOM_KEY`.

## Corrida

O servidor continua autoritativo para velocidade, posição, checkpoints, voltas, turbo, drift e sabotagem. O cliente envia intenção de controle. O modo SOLO preenche a corrida automaticamente com oponentes controlados pelo servidor, sem expor a marcação de bot na interface.

## Recursos

O jogo não cria gigabytes artificiais para parecer maior. Os recursos existentes são preservados e carregados sob demanda. Isso mantém o download rápido e evita desperdício de RAM/GPU.

## Three.js

A versão do Three.js fica fixada no import map do `index.html`, usando CDN oficial de distribuição. O motor 3D possui fallback procedural para o cenário e recuperação de contexto WebGL.
