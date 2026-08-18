# NEON PATH 3.0
Arcade multiplayer futurista para navegador.

## Deploy
Render: Runtime Node, Build `npm install`, Start `npm start`.
Defina `DATABASE_URL`, `JWT_SECRET` (32+ caracteres), `CEO_ROOM_KEY`.

## Filosofia
O servidor é autoridade sobre corrida, posição, velocidade, colisões, turbo e sabotagem.
O cliente renderiza e envia somente intenção de controle.

## Performance
Geometria procedural, materiais simples, instancing quando possível, billboards,
pixel ratio limitado e quatro presets de qualidade. O banco não recebe telemetria por frame.
