'use strict';

const MAX_ROOM_CODE_LENGTH = 15;
const MAX_NICK_LENGTH = 20;
const WORLD_W = 120;
const WORLD_H = 80;
const MAX_PLAYERS = 8;
const MAX_SPEED = 18;
const BOOST_MULTIPLIER = 1.65;
const TICK_MS = 1000 / 30;
const TURN_COOLDOWN_MS = 100;
const TURBO_COOLDOWN_MS = 900;
const SABOTAGE_COOLDOWN_MS = 8000;
const INPUT_WINDOW_MS = 1000;
const MAX_INPUTS_PER_WINDOW = 14;

function cleanNick(value) {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  return /^[A-Za-z0-9_À-ÿ ]{2,20}$/.test(v) ? v : null;
}

function cleanEmail(value) {
  if (value == null || value === '') return null;
  if (typeof value !== 'string') return null;
  const v = value.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? v : null;
}

function validPassword(value) {
  return typeof value === 'string' && value.length >= 8 && value.length <= 200;
}

function normalizeRoomCode(value) {
  return String(value || '').trim().toUpperCase().slice(0, MAX_ROOM_CODE_LENGTH);
}

function isRoomCodeLengthValid(value) {
  const raw = String(value || '').trim();
  return raw.length >= 1 && raw.length <= MAX_ROOM_CODE_LENGTH;
}

function sanitizeInput(message) {
  const type = message && typeof message.type === 'string' ? message.type : '';
  return ['left', 'right', 'turbo', 'sabotage'].includes(type) ? type : null;
}

function spawn(index) {
  const starts = [
    [15,15,0],[105,15,Math.PI],[15,65,0],[105,65,Math.PI],
    [60,12,Math.PI/2],[60,68,-Math.PI/2],[25,40,0],[95,40,Math.PI]
  ];
  const a = starts[index % starts.length];
  return { x:a[0], y:a[1], a:a[2], speed:9, energy:100, boost:0, alive:true,
    trail:[], kills:0, lastTurn:0, lastTurbo:0, lastSab:0,
    inputWindowStart:0, inputCount:0, suspiciousInputs:0 };
}

function canAcceptInput(player, now) {
  if (!player) return false;
  if (now - player.inputWindowStart >= INPUT_WINDOW_MS) {
    player.inputWindowStart = now;
    player.inputCount = 0;
  }
  if (player.inputCount >= MAX_INPUTS_PER_WINDOW) {
    player.suspiciousInputs = Math.min(100, (player.suspiciousInputs || 0) + 1);
    return false;
  }
  player.inputCount++;
  return true;
}

function applyInput(player, type, now, room) {
  if (!player || !player.alive || !room || !room.running) return { accepted:false, reason:'not_running' };
  if (!canAcceptInput(player, now)) return { accepted:false, reason:'rate_limit' };
  if (type === 'left' || type === 'right') {
    if (now - player.lastTurn < TURN_COOLDOWN_MS) return { accepted:false, reason:'turn_cooldown' };
    player.a += type === 'left' ? -Math.PI/2 : Math.PI/2;
    player.lastTurn = now;
    return { accepted:true };
  }
  if (type === 'turbo') {
    if (player.energy < 20) return { accepted:false, reason:'energy' };
    if (now - player.lastTurbo < TURBO_COOLDOWN_MS) return { accepted:false, reason:'turbo_cooldown' };
    player.energy -= 20;
    player.boost = 1;
    player.lastTurbo = now;
    return { accepted:true };
  }
  if (type === 'sabotage') {
    if (player.energy < 30) return { accepted:false, reason:'energy' };
    if (now - player.lastSab < SABOTAGE_COOLDOWN_MS) return { accepted:false, reason:'sabotage_cooldown' };
    player.energy -= 30;
    player.lastSab = now;
    return { accepted:true, sabotage:true };
  }
  return { accepted:false, reason:'invalid_input' };
}

function chooseSabotageTarget(player, room) {
  let target = null;
  let best = Infinity;
  for (const q of room.players.values()) {
    if (!q.alive || q.id === player.id) continue;
    const dx = q.x - player.x;
    const dy = q.y - player.y;
    const d = Math.hypot(dx,dy);
    if (d > 14) continue;
    const dot = (Math.cos(player.a)*dx + Math.sin(player.a)*dy) / Math.max(d, 0.001);
    if (dot < 0.15) continue;
    if (d < best) { best=d; target=q; }
  }
  return target;
}

function stepPlayer(player, room, dt, now) {
  if (!player.alive) return;
  const base = 9 + Math.min(6, Math.max(0, (now - room.started) / 30000));
  const max = MAX_SPEED * (player.boost > 0 ? BOOST_MULTIPLIER : 1);
  player.speed += (base - player.speed) * 0.08;
  player.speed = Math.max(0, Math.min(player.speed, max));
  player.x += Math.cos(player.a) * player.speed * dt;
  player.y += Math.sin(player.a) * player.speed * dt;
  player.energy = Math.min(100, player.energy + 4 * dt);
  player.boost = Math.max(0, player.boost - dt);
  player.trail.push([Number(player.x.toFixed(2)), Number(player.y.toFixed(2))]);
  if (player.trail.length > 180) player.trail.shift();
}

function collision(player, room) {
  if (player.x < 2 || player.y < 2 || player.x > WORLD_W-2 || player.y > WORLD_H-2) return true;
  for (const q of room.players.values()) {
    if (q.id !== player.id && q.alive && Math.hypot(player.x-q.x, player.y-q.y) < 1.6) return true;
  }
  return false;
}

module.exports = {
  MAX_ROOM_CODE_LENGTH, MAX_NICK_LENGTH, WORLD_W, WORLD_H, MAX_PLAYERS, MAX_SPEED,
  BOOST_MULTIPLIER, TICK_MS, TURN_COOLDOWN_MS, TURBO_COOLDOWN_MS, SABOTAGE_COOLDOWN_MS,
  cleanNick, cleanEmail, validPassword, normalizeRoomCode, isRoomCodeLengthValid,
  sanitizeInput, spawn, canAcceptInput, applyInput, chooseSabotageTarget, stepPlayer, collision
};
