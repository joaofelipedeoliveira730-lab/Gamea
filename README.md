# NEON PATH

Multiplayer survival game for the browser. Up to 10 players per room.

## Stack
- Frontend: HTML/CSS/JavaScript + Canvas
- Backend: Node.js + Express + WebSocket
- Database: PostgreSQL
- Hosting: GitHub Pages for the frontend, Render for the backend/database

## Local
1. `npm install`
2. Copy `.env.example` to `.env`
3. Put your PostgreSQL connection in `DATABASE_URL`
4. `npm start`
5. Open `http://localhost:3000`

## GitHub Pages
All files are in the repository root. GitHub Pages can publish `index.html` directly.
Set the Render backend URL in `config.js`.

## Render
Create a PostgreSQL database and a Web Service.
- Runtime: Node
- Build: `npm install`
- Start: `npm start`
- Environment: `DATABASE_URL`, `PUBLIC_ORIGIN`

The backend also serves `client/`, so the Render service itself is a playable fallback.

## Gameplay
- W/A/D or Left/Right: steer
- Space: Turbo
- E: Sopro
- Enter: send chat
- Last survivor wins


## Anti-cheat / anti-abuse
The client is never trusted for movement, collisions, kills, PH, wins, or final results. The server is authoritative.
Implemented protections include:
- server-side movement and collision simulation;
- bounded tick rate and input rate;
- monotonic input sequence numbers;
- rejection of oversized/malformed packets;
- server-side energy/breath/turbo cooldowns;
- server-side room/player limits;
- server-side ranking updates;
- chat rate limiting;
- nickname sanitization;
- automatic cleanup of stale rooms;
- WebSocket error handling and session lifetime limits.

No browser game can make cheating absolutely impossible, but this prevents the common forms of DevTools/console manipulation from directly awarding wins, kills, speed, PH or teleporting the player.
