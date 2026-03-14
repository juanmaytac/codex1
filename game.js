
const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
ctx.imageSmoothingEnabled = false;

const scoreEl = document.getElementById("score");
const coinsEl = document.getElementById("coins");
const livesEl = document.getElementById("lives");
const worldEl = document.getElementById("world");
const timeEl = document.getElementById("time");
const messageEl = document.getElementById("message");

const TILE = 32;
const ROWS = 18;
const COLS = 220;
const GROUND = 15;
const WIDTH = canvas.width;
const HEIGHT = canvas.height;
const WORLD_W = COLS * TILE;
const WORLD_H = ROWS * TILE;
const START_TIME = 300;

const GRAVITY = 0.52;
const MAX_FALL = 13;
const JUMP_VELOCITY = -12.6;
const RUN_JUMP_VELOCITY = -13.4;
const SOLID = new Set(["T", "D", "B", "Q", "U", "S", "L", "R", "l", "r"]);

const keys = new Set();
let jumpQueued = false;
let cameraX = 0;
let frame = 0;
let timerMs = 0;
let state = "playing";
let flagPause = 0;
let winBonusGiven = false;

const stats = {
  score: 0,
  coins: 0,
  lives: 3,
  world: "1-1",
  time: START_TIME
};

let tiles = [];
let questionBlocks = {};
let coins = [];
let enemies = [];
let powerups = [];
let popCoins = [];
let particles = [];
const ambient = [];
const bumps = new Map();
let cameraShake = 0;
let shakeX = 0;
let shakeY = 0;
let landingCooldown = 0;

const grainCanvas = document.createElement("canvas");
const grainCtx = grainCanvas.getContext("2d");
let grainReady = false;

const player = {
  x: TILE * 2,
  y: GROUND * TILE - 30,
  w: 24,
  h: 30,
  vx: 0,
  vy: 0,
  onGround: false,
  facing: 1,
  form: "small",
  invul: 0,
  coyote: 0,
  jumpBuffer: 0
};

const audio = { ctx: null };

function ensureAudio() {
  if (audio.ctx) {
    if (audio.ctx.state === "suspended") {
      audio.ctx.resume().catch(() => {});
    }
    return;
  }
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) {
    return;
  }
  audio.ctx = new Ctx();
}

function tone(freq, dur, type = "square", vol = 0.05, glide = 0) {
  if (!audio.ctx) {
    return;
  }
  const now = audio.ctx.currentTime;
  const osc = audio.ctx.createOscillator();
  const gain = audio.ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, now);
  if (glide > 0) {
    osc.frequency.exponentialRampToValueAtTime(glide, now + dur);
  }
  gain.gain.setValueAtTime(vol, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + dur);
  osc.connect(gain);
  gain.connect(audio.ctx.destination);
  osc.start(now);
  osc.stop(now + dur);
}

function sfx(name) {
  switch (name) {
    case "jump":
      tone(350, 0.09, "square", 0.04, 520);
      break;
    case "coin":
      tone(960, 0.07, "triangle", 0.055, 1200);
      break;
    case "stomp":
      tone(170, 0.07, "square", 0.045, 120);
      break;
    case "bump":
      tone(220, 0.06, "square", 0.03, 170);
      break;
    case "break":
      tone(120, 0.09, "square", 0.04, 70);
      break;
    case "power":
      tone(420, 0.12, "triangle", 0.045, 820);
      break;
    case "hurt":
      tone(220, 0.12, "sawtooth", 0.045, 120);
      break;
    case "flag":
      tone(520, 0.14, "triangle", 0.04, 780);
      break;
    case "win":
      tone(880, 0.16, "triangle", 0.04, 1320);
      break;
    case "gameover":
      tone(240, 0.25, "square", 0.04, 120);
      break;
    case "1up":
      tone(680, 0.12, "triangle", 0.045, 980);
      break;
    default:
      break;
  }
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function rand(min, max) {
  return min + Math.random() * (max - min);
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function approach(value, target, amount) {
  if (value < target) {
    return Math.min(value + amount, target);
  }
  return Math.max(value - amount, target);
}

function overlap(ax, ay, aw, ah, bx, by, bw, bh) {
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

function setMessage(text) {
  messageEl.textContent = text;
}

function updateHud() {
  scoreEl.textContent = String(stats.score).padStart(6, "0");
  coinsEl.textContent = `x${String(stats.coins).padStart(2, "0")}`;
  livesEl.textContent = String(stats.lives);
  worldEl.textContent = stats.world;
  timeEl.textContent = String(stats.time).padStart(3, "0");
}

function addScore(points) {
  stats.score += points;
  updateHud();
}

function addCoins(amount) {
  stats.coins += amount;
  while (stats.coins >= 100) {
    stats.coins -= 100;
    stats.lives += 1;
    sfx("1up");
    setMessage("1UP!");
  }
  updateHud();
}

function buildGrainTexture() {
  if (!grainCtx) return;
  grainCanvas.width = 160;
  grainCanvas.height = 160;
  const image = grainCtx.createImageData(grainCanvas.width, grainCanvas.height);
  const data = image.data;
  for (let i = 0; i < data.length; i += 4) {
    const v = Math.floor(rand(120, 255));
    data[i] = v;
    data[i + 1] = v;
    data[i + 2] = v;
    data[i + 3] = Math.floor(rand(18, 48));
  }
  grainCtx.putImageData(image, 0, 0);
  grainReady = true;
}

function seedAmbient() {
  ambient.length = 0;
  for (let i = 0; i < 85; i += 1) {
    ambient.push({
      x: rand(0, WIDTH),
      y: rand(0, HEIGHT),
      r: rand(0.7, 2.4),
      vx: rand(-0.14, -0.03),
      vy: rand(-0.04, 0.04),
      alpha: rand(0.06, 0.24),
      twinkle: rand(0, Math.PI * 2)
    });
  }
}

function initVisualFx() {
  buildGrainTexture();
  seedAmbient();
}

function addCameraShake(intensity = 1.4) {
  cameraShake = Math.max(cameraShake, intensity);
}

function spawnParticle(opts) {
  particles.push({
    x: opts.x ?? 0,
    y: opts.y ?? 0,
    vx: opts.vx ?? 0,
    vy: opts.vy ?? 0,
    gravity: opts.gravity ?? 0.2,
    drag: opts.drag ?? 0.94,
    size: opts.size ?? 3,
    shrink: opts.shrink ?? 0.98,
    life: opts.life ?? 24,
    maxLife: opts.life ?? 24,
    color: opts.color || "#ffffff",
    layer: opts.layer || "front",
    glow: opts.glow || 0
  });
}

function spawnDustBurst(x, y, intensity = 1) {
  const count = Math.floor(10 + intensity * 8);
  for (let i = 0; i < count; i += 1) {
    spawnParticle({
      x: x + rand(-10, 10),
      y: y + rand(-2, 2),
      vx: rand(-2.8, 2.8) * intensity,
      vy: rand(-2.4, -0.4) * intensity,
      gravity: 0.26,
      drag: 0.91,
      size: rand(2.2, 5.4),
      shrink: 0.96,
      life: rand(13, 27),
      color: Math.random() > 0.5 ? "#e8c488" : "#d69d5e",
      layer: "back"
    });
  }
}

function spawnSparkBurst(x, y, intensity = 1) {
  const count = Math.floor(8 + intensity * 9);
  for (let i = 0; i < count; i += 1) {
    const electric = Math.random() > 0.52;
    spawnParticle({
      x: x + rand(-6, 6),
      y: y + rand(-8, 8),
      vx: rand(-3.2, 3.2) * intensity,
      vy: rand(-3.8, 1.2) * intensity,
      gravity: electric ? 0.16 : 0.22,
      drag: 0.9,
      size: rand(1.5, 3.2),
      shrink: 0.94,
      life: rand(10, 22),
      color: electric ? "#ffe977" : "#fff2b8",
      layer: "front",
      glow: electric ? 8 : 4
    });
  }
}

function updateParticles(dt) {
  for (const p of particles) {
    p.life -= dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vx *= Math.pow(p.drag, dt);
    p.vy += p.gravity * dt;
    p.size *= Math.pow(p.shrink, dt);
  }
  particles = particles.filter((p) => p.life > 0 && p.size > 0.25);
}

function updateAmbient(dt) {
  const windBoost = clamp(Math.abs(player.vx) / 8, 0, 1.2);
  for (const p of ambient) {
    p.twinkle += 0.03 * dt;
    p.x += (p.vx - windBoost * 0.04) * dt;
    p.y += p.vy * dt;

    if (p.x < -12) p.x = WIDTH + 12;
    if (p.x > WIDTH + 12) p.x = -12;
    if (p.y < -12) p.y = HEIGHT + 12;
    if (p.y > HEIGHT + 12) p.y = -12;
  }
}

function updateScreenFx(dt) {
  landingCooldown = Math.max(0, landingCooldown - dt);
  if (cameraShake <= 0) {
    shakeX = 0;
    shakeY = 0;
    return;
  }

  cameraShake = Math.max(0, cameraShake - 0.2 * dt);
  const mag = cameraShake * 1.35;
  shakeX = rand(-mag, mag);
  shakeY = rand(-mag * 0.7, mag * 0.7);
}

function buildLevel() {
  const grid = Array.from({ length: ROWS }, () => Array(COLS).fill("."));
  const coinSpawns = [];
  const enemySpawns = [];
  const q = {};

  const spawn = { x: TILE * 2, y: GROUND * TILE - 30 };
  const flagCol = COLS - 12;
  const castleCol = COLS - 6;

  const set = (tx, ty, tile) => {
    if (tx >= 0 && tx < COLS && ty >= 0 && ty < ROWS) {
      grid[ty][tx] = tile;
    }
  };

  const fill = (tx, ty, w, h, tile) => {
    for (let y = ty; y < ty + h; y += 1) {
      for (let x = tx; x < tx + w; x += 1) {
        set(x, y, tile);
      }
    }
  };

  const qBlock = (tx, ty, content = "coin") => {
    set(tx, ty, "Q");
    q[`${tx},${ty}`] = content;
  };

  const pattern = (sx, ty, str) => {
    for (let i = 0; i < str.length; i += 1) {
      const ch = str[i];
      const tx = sx + i;
      if (ch === "B") set(tx, ty, "B");
      if (ch === "Q") qBlock(tx, ty, "coin");
      if (ch === "M") qBlock(tx, ty, "mushroom");
      if (ch === "S") set(tx, ty, "S");
    }
  };

  const pipe = (tx, h) => {
    const top = GROUND - h + 1;
    for (let y = top; y < ROWS; y += 1) {
      set(tx, y, y === top ? "L" : "l");
      set(tx + 1, y, y === top ? "R" : "r");
    }
  };

  const coin = (tx, ty) => {
    coinSpawns.push({ x: tx * TILE + TILE / 2, y: ty * TILE + TILE / 2 });
  };

  const enemy = (tx, ty, type = "goomba") => {
    enemySpawns.push({ x: tx * TILE + 2, y: ty * TILE + 4, type });
  };

  for (let x = 0; x < COLS; x += 1) {
    set(x, GROUND, "T");
    for (let y = GROUND + 1; y < ROWS; y += 1) {
      set(x, y, "D");
    }
  }

  const pits = [[28, 29], [58, 59], [92, 94], [126, 128], [170, 172]];
  for (const [start, end] of pits) {
    for (let x = start; x <= end; x += 1) {
      for (let y = GROUND; y < ROWS; y += 1) {
        set(x, y, ".");
      }
    }
  }

  pipe(14, 3);
  pipe(38, 4);
  pipe(46, 4);
  pipe(74, 4);
  pipe(110, 4);
  pipe(146, 3);
  pipe(162, 4);

  pattern(20, 11, "BBQBB");
  pattern(34, 10, "BMBQBB");
  pattern(52, 9, "BBQBBQBB");
  pattern(66, 11, "QQBQQ");
  pattern(84, 10, "BBBBQQ");
  pattern(102, 8, "BBQBB");
  pattern(116, 11, "BQQQB");
  pattern(138, 10, "BBMBB");
  pattern(154, 9, "BQQBQQB");
  pattern(176, 11, "BBBBB");
  pattern(184, 10, "BQQB");

  fill(70, 7, 2, 1, "S");
  fill(90, 7, 3, 1, "S");
  fill(120, 8, 2, 1, "S");
  fill(144, 7, 2, 1, "S");

  for (let i = 0; i < 6; i += 1) {
    for (let h = 0; h <= i; h += 1) set(186 + i, GROUND - h, "S");
  }
  for (let i = 0; i < 6; i += 1) {
    for (let h = 0; h < 6 - i; h += 1) set(192 + i, GROUND - h, "S");
  }
  fill(castleCol - 2, GROUND - 2, 8, 2, "S");

  for (let x = 7; x <= 12; x += 1) coin(x, 12);
  for (let x = 19; x <= 25; x += 1) coin(x, 8);
  for (let x = 29; x <= 30; x += 1) coin(x, 11);
  for (let x = 35; x <= 40; x += 1) coin(x, 7);
  for (let x = 52; x <= 57; x += 1) coin(x, 6 + (x % 2));
  for (let x = 66; x <= 70; x += 1) coin(x, 8);
  for (let x = 83; x <= 88; x += 1) coin(x, 7);
  for (let x = 93; x <= 95; x += 1) coin(x, 11);
  for (let x = 102; x <= 106; x += 1) coin(x, 5);
  for (let x = 116; x <= 120; x += 1) coin(x, 8);
  for (let x = 126; x <= 129; x += 1) coin(x, 11);
  for (let x = 138; x <= 142; x += 1) coin(x, 7);
  for (let x = 154; x <= 160; x += 1) coin(x, 6 + (x % 2));
  for (let x = 170; x <= 173; x += 1) coin(x, 10);
  for (let x = 184; x <= 191; x += 1) coin(x, 8);
  for (let x = 196; x <= 202; x += 1) coin(x, 12);

  enemy(22, 14, "goomba");
  enemy(33, 14, "goomba");
  enemy(41, 14, "goomba");
  enemy(55, 14, "beetle");
  enemy(68, 14, "goomba");
  enemy(81, 14, "goomba");
  enemy(98, 14, "goomba");
  enemy(115, 14, "beetle");
  enemy(133, 14, "goomba");
  enemy(149, 14, "goomba");
  enemy(166, 14, "beetle");
  enemy(182, 14, "goomba");
  enemy(190, 12, "goomba");

  return {
    grid,
    coinSpawns,
    enemySpawns,
    questionBlocks: q,
    spawn,
    flag: {
      x: flagCol * TILE + TILE / 2,
      top: 4 * TILE,
      bottom: GROUND * TILE
    },
    castle: {
      x: (castleCol - 1) * TILE,
      y: (GROUND - 5) * TILE,
      doorX: castleCol * TILE + 20
    }
  };
}

const LEVEL = buildLevel();

const clouds = Array.from({ length: 28 }, (_, i) => ({
  x: 120 + i * 250 + (i % 3) * 42,
  y: 50 + (i % 4) * 24,
  s: 0.7 + (i % 3) * 0.22
}));

const hills = Array.from({ length: 17 }, (_, i) => ({
  x: i * 430 + 20,
  y: GROUND * TILE + 15,
  w: 170 + (i % 3) * 30,
  h: 92 + (i % 2) * 20
}));

const bushes = Array.from({ length: 35 }, (_, i) => ({
  x: i * 210 + 60 + (i % 3) * 14,
  y: GROUND * TILE - 10,
  w: 64 + (i % 2) * 22,
  h: 30 + (i % 2) * 10
}));

function resetPlayer(form = "small") {
  player.form = form;
  player.w = 24;
  player.h = form === "big" ? 54 : 30;
  player.x = LEVEL.spawn.x;
  player.y = GROUND * TILE - player.h;
  player.vx = 0;
  player.vy = 0;
  player.onGround = false;
  player.facing = 1;
  player.invul = 0;
  player.coyote = 0;
  player.jumpBuffer = 0;
}

function loadLevel() {
  tiles = LEVEL.grid.map((row) => row.slice());
  questionBlocks = { ...LEVEL.questionBlocks };
  coins = LEVEL.coinSpawns.map((c, i) => ({ ...c, collected: false, phase: i * 7 }));
  enemies = LEVEL.enemySpawns.map((e) => ({
    type: e.type,
    x: e.x,
    y: e.y,
    w: 28,
    h: 28,
    vx: -1.1,
    vy: 0,
    onGround: false,
    facing: -1,
    state: "walk",
    timer: 0
  }));
  powerups = [];
  popCoins = [];
  particles = [];
  bumps.clear();
  stats.time = START_TIME;
  timerMs = 0;
  state = "playing";
  flagPause = 0;
  winBonusGiven = false;
  cameraX = 0;
  cameraShake = 0;
  shakeX = 0;
  shakeY = 0;
  landingCooldown = 0;
  resetPlayer("small");
  updateHud();
}

function restartGame() {
  stats.score = 0;
  stats.coins = 0;
  stats.lives = 3;
  loadLevel();
  setMessage("Llega a la bandera!");
}

function loseLife(msg) {
  addCameraShake(3.2);
  spawnDustBurst(player.x + player.w / 2, player.y + player.h, 1.2);
  stats.lives -= 1;
  updateHud();
  if (stats.lives <= 0) {
    state = "gameover";
    setMessage("Game Over. Presiona R para reiniciar.");
    sfx("gameover");
    return;
  }
  loadLevel();
  setMessage(msg || "Perdiste una vida.");
  sfx("hurt");
}
function growPlayer() {
  if (player.form === "big") {
    return true;
  }
  const oldY = player.y;
  const oldH = player.h;
  const bottom = player.y + player.h;
  player.form = "big";
  player.h = 54;
  player.y = bottom - player.h;
  if (collidesSolid(player)) {
    player.form = "small";
    player.h = oldH;
    player.y = oldY;
    return false;
  }
  return true;
}

function shrinkPlayer() {
  if (player.form === "small") {
    return;
  }
  const bottom = player.y + player.h;
  player.form = "small";
  player.h = 30;
  player.y = bottom - player.h;
}

function tileAt(tx, ty) {
  if (ty < 0) return ".";
  if (ty >= ROWS) return ".";
  if (tx < 0) return "D";
  if (tx >= COLS) return ".";
  return tiles[ty][tx];
}

function setTile(tx, ty, tile) {
  if (tx < 0 || tx >= COLS || ty < 0 || ty >= ROWS) {
    return;
  }
  tiles[ty][tx] = tile;
}

function collidesSolid(body) {
  const minX = Math.floor(body.x / TILE);
  const maxX = Math.floor((body.x + body.w - 1) / TILE);
  const minY = Math.floor(body.y / TILE);
  const maxY = Math.floor((body.y + body.h - 1) / TILE);

  for (let ty = minY; ty <= maxY; ty += 1) {
    for (let tx = minX; tx <= maxX; tx += 1) {
      const tile = tileAt(tx, ty);
      if (!SOLID.has(tile)) continue;
      if (overlap(body.x, body.y, body.w, body.h, tx * TILE, ty * TILE, TILE, TILE)) {
        return true;
      }
    }
  }
  return false;
}

function moveX(body, dt) {
  body.x += body.vx * dt;
  let hitWall = false;

  const minX = Math.floor(body.x / TILE);
  const maxX = Math.floor((body.x + body.w - 1) / TILE);
  const minY = Math.floor(body.y / TILE);
  const maxY = Math.floor((body.y + body.h - 1) / TILE);

  for (let ty = minY; ty <= maxY; ty += 1) {
    for (let tx = minX; tx <= maxX; tx += 1) {
      const tile = tileAt(tx, ty);
      if (!SOLID.has(tile)) continue;
      const x = tx * TILE;
      const y = ty * TILE;
      if (!overlap(body.x, body.y, body.w, body.h, x, y, TILE, TILE)) continue;
      if (body.vx > 0) body.x = x - body.w;
      if (body.vx < 0) body.x = x + TILE;
      body.vx = 0;
      hitWall = true;
    }
  }

  return hitWall;
}

function moveY(body, dt, onHeadHit) {
  body.onGround = false;
  const movingUp = body.vy < 0;
  body.y += body.vy * dt;

  const minX = Math.floor(body.x / TILE);
  const maxX = Math.floor((body.x + body.w - 1) / TILE);
  const minY = Math.floor(body.y / TILE);
  const maxY = Math.floor((body.y + body.h - 1) / TILE);

  for (let ty = minY; ty <= maxY; ty += 1) {
    for (let tx = minX; tx <= maxX; tx += 1) {
      const tile = tileAt(tx, ty);
      if (!SOLID.has(tile)) continue;
      const x = tx * TILE;
      const y = ty * TILE;
      if (!overlap(body.x, body.y, body.w, body.h, x, y, TILE, TILE)) continue;

      if (body.vy > 0) {
        body.y = y - body.h;
        body.vy = 0;
        body.onGround = true;
      } else if (movingUp) {
        body.y = y + TILE;
        if (onHeadHit) onHeadHit(tx, ty, tile);
        body.vy = 0;
      }
    }
  }
}

function bump(tx, ty) {
  bumps.set(`${tx},${ty}`, 0);
}

function bumpOffset(tx, ty) {
  const t = bumps.get(`${tx},${ty}`);
  if (typeof t !== "number") return 0;
  return Math.sin((t / 10) * Math.PI) * 8;
}

function spawnPopCoin(tx, ty) {
  popCoins.push({
    x: tx * TILE + TILE / 2,
    y: ty * TILE - 8,
    vy: -5.5,
    life: 26,
    age: 0
  });
}

function spawnMushroom(tx, ty) {
  powerups.push({
    x: tx * TILE + 2,
    y: ty * TILE + 2,
    targetY: ty * TILE - 30,
    w: 28,
    h: 28,
    vx: 1.2,
    vy: 0,
    onGround: false,
    state: "emerge",
    collected: false
  });
}

function hitBlock(tx, ty, tile) {
  if (state !== "playing") return;

  if (tile === "B") {
    bump(tx, ty);
    if (player.form === "big") {
      setTile(tx, ty, ".");
      addScore(50);
      spawnDustBurst(tx * TILE + TILE / 2, ty * TILE + TILE / 2, 1.1);
      spawnSparkBurst(tx * TILE + TILE / 2, ty * TILE + TILE / 2, 0.7);
      addCameraShake(1.8);
      sfx("break");
    } else {
      spawnDustBurst(tx * TILE + TILE / 2, ty * TILE + TILE, 0.45);
      sfx("bump");
    }
    return;
  }

  if (tile === "Q") {
    bump(tx, ty);
    setTile(tx, ty, "U");
    const key = `${tx},${ty}`;
    const content = questionBlocks[key] || "coin";
    delete questionBlocks[key];

    if (content === "mushroom") {
      spawnMushroom(tx, ty);
      addScore(200);
      spawnSparkBurst(tx * TILE + TILE / 2, ty * TILE + 2, 0.9);
      sfx("power");
    } else {
      spawnPopCoin(tx, ty);
      addCoins(1);
      addScore(200);
      spawnSparkBurst(tx * TILE + TILE / 2, ty * TILE + 2, 0.5);
      sfx("coin");
    }
    return;
  }

  if (tile === "U" || tile === "S") {
    sfx("bump");
  }
}

function hurtPlayer(sourceX) {
  if (state !== "playing" || player.invul > 0) return;
  addCameraShake(2.3);
  spawnSparkBurst(player.x + player.w / 2, player.y + player.h * 0.45, 1.1);

  if (player.form === "big") {
    shrinkPlayer();
    player.invul = 95;
    player.vy = -7;
    player.vx = sourceX < player.x ? 3 : -3;
    setMessage("Te hiciste pequeno!");
    sfx("hurt");
    return;
  }

  loseLife("Te golpearon.");
}

function checkFlagTouch() {
  if (state !== "playing") return;

  const f = LEVEL.flag;
  if (!overlap(player.x, player.y, player.w, player.h, f.x - 10, f.top, 20, f.bottom - f.top)) {
    return;
  }

  state = "flag-slide";
  player.vx = 0;
  player.vy = 0;
  player.x = f.x - player.w + 4;
  spawnSparkBurst(player.x + player.w / 2, player.y + player.h * 0.45, 0.7);
  addCameraShake(1.2);
  addScore(clamp(Math.floor((f.bottom - player.y) / 32), 1, 10) * 100);
  setMessage("Bandera capturada!");
  sfx("flag");
}

function updateTimer(dtMs) {
  timerMs += dtMs;
  while (timerMs >= 1000) {
    timerMs -= 1000;
    stats.time = Math.max(0, stats.time - 1);
    updateHud();
    if (stats.time === 0) {
      loseLife("Tiempo agotado.");
      break;
    }
  }
}

function updateBumps(dt) {
  for (const [key, value] of [...bumps.entries()]) {
    const next = value + dt;
    if (next >= 10) bumps.delete(key);
    else bumps.set(key, next);
  }
}

function updatePopCoins(dt) {
  for (const c of popCoins) {
    c.age += dt;
    c.life -= dt;
    c.y += c.vy * dt;
    c.vy += 0.2 * dt;
  }
  popCoins = popCoins.filter((c) => c.life > 0);
}

function updatePlayer(dt) {
  const wasGrounded = player.onGround;
  const left = keys.has("a") || keys.has("arrowleft");
  const right = keys.has("d") || keys.has("arrowright");
  const jumpHeld = keys.has("space") || keys.has("w") || keys.has("arrowup");
  const run = keys.has("shift");

  const maxSpeed = run ? 6.3 : 4.8;
  const accel = player.onGround ? (run ? 0.68 : 0.58) : 0.34;

  if (left === right) {
    const drag = player.onGround ? 0.78 : 0.94;
    player.vx *= Math.pow(drag, dt);
    if (Math.abs(player.vx) < 0.03) player.vx = 0;
  } else if (left) {
    player.vx = approach(player.vx, -maxSpeed, accel * dt);
    player.facing = -1;
  } else {
    player.vx = approach(player.vx, maxSpeed, accel * dt);
    player.facing = 1;
  }

  if (jumpQueued) player.jumpBuffer = 7;
  jumpQueued = false;

  if (player.onGround) player.coyote = 7;
  else player.coyote = Math.max(0, player.coyote - dt);
  player.jumpBuffer = Math.max(0, player.jumpBuffer - dt);

  if (player.jumpBuffer > 0 && player.coyote > 0) {
    player.vy = run ? RUN_JUMP_VELOCITY : JUMP_VELOCITY;
    player.jumpBuffer = 0;
    player.coyote = 0;
    player.onGround = false;
    sfx("jump");
  }

  if (!jumpHeld && player.vy < -3.2) player.vy += 0.78 * dt;
  player.vy = Math.min(player.vy + GRAVITY * dt, MAX_FALL);
  const fallSpeedBeforeMove = player.vy;

  moveX(player, dt);
  moveY(player, dt, hitBlock);

  if (!wasGrounded && player.onGround && fallSpeedBeforeMove > 5 && landingCooldown <= 0) {
    const impact = clamp(fallSpeedBeforeMove / 8, 0.5, 1.6);
    spawnDustBurst(player.x + player.w / 2, player.y + player.h - 1, impact);
    addCameraShake(impact * 1.25);
    landingCooldown = 8;
  }

  if (player.onGround && Math.abs(player.vx) > 5.4 && Math.random() < 0.1 * dt) {
    spawnDustBurst(player.x + player.w / 2, player.y + player.h - 1, 0.22);
  }

  if (!player.onGround && Math.abs(player.vx) > 5.9 && Math.random() < 0.12 * dt) {
    spawnSparkBurst(player.x + player.w / 2, player.y + player.h * 0.55, 0.24);
  }

  if (player.invul > 0) player.invul = Math.max(0, player.invul - dt);

  if (player.y > WORLD_H + 120) {
    loseLife("Te caes al vacio.");
    return;
  }

  checkFlagTouch();
}

function updateEnemies(dt) {
  const tension = clamp(player.x / Math.max(1, WORLD_W - WIDTH), 0, 1);
  const speedBoost = lerp(1, 1.42, tension);

  for (const e of enemies) {
    if (e.state === "dead") {
      e.timer -= dt;
      if (e.timer <= 0) e.state = "gone";
      continue;
    }

    const baseSpeed = e.type === "beetle" ? 1.35 : 1.15;
    const targetSpeed = baseSpeed * speedBoost;
    if (Math.abs(e.vx) < 0.03) {
      const dir = e.facing || -1;
      e.vx = dir * targetSpeed;
    } else {
      const dir = e.vx < 0 ? -1 : 1;
      e.vx = approach(e.vx, dir * targetSpeed, 0.09 * dt);
      e.facing = dir;
    }

    e.vy = Math.min(e.vy + GRAVITY * dt, MAX_FALL);
    const prevVx = e.vx;
    const wall = moveX(e, dt);
    if (wall) {
      const speed = Math.max(targetSpeed, 1);
      e.facing = prevVx >= 0 ? -1 : 1;
      e.vx = e.facing * speed;
      spawnDustBurst(e.x + e.w / 2, e.y + e.h, 0.18);
    }
    moveY(e, dt);

    if (e.y > WORLD_H + 120) {
      e.state = "gone";
      continue;
    }

    if (state !== "playing") continue;
    if (!overlap(player.x, player.y, player.w, player.h, e.x, e.y, e.w, e.h)) continue;

    const stomp = player.vy > 1.4 && player.y + player.h - e.y < 16;
    if (stomp) {
      e.state = "dead";
      e.timer = 26;
      e.y += 14;
      e.h = 14;
      e.vx = 0;
      e.vy = 0;
      player.vy = -8.4;
      spawnDustBurst(e.x + e.w / 2, e.y + e.h, 0.55);
      spawnSparkBurst(e.x + e.w / 2, e.y + e.h / 2, 0.35);
      addCameraShake(1.35);
      addScore(100);
      sfx("stomp");
    } else {
      hurtPlayer(e.x + e.w / 2);
    }
  }

  enemies = enemies.filter((e) => e.state !== "gone");
}

function updatePowerups(dt) {
  for (const p of powerups) {
    if (p.collected) continue;

    if (p.state === "emerge") {
      p.y -= 1.4 * dt;
      if (p.y <= p.targetY) {
        p.y = p.targetY;
        p.state = "walk";
      }
    } else {
      p.vy = Math.min(p.vy + GRAVITY * dt, MAX_FALL);
      const prevVx = p.vx;
      const wall = moveX(p, dt);
      if (wall) {
        const speed = Math.max(Math.abs(prevVx), 1);
        p.vx = prevVx >= 0 ? -speed : speed;
      }
      moveY(p, dt);
    }

    if (overlap(player.x, player.y, player.w, player.h, p.x, p.y, p.w, p.h)) {
      p.collected = true;
      const grew = growPlayer();
      player.invul = 50;
      spawnSparkBurst(p.x + p.w / 2, p.y + p.h / 2, 1.2);
      addCameraShake(1.4);
      addScore(1000);
      setMessage(grew ? "Super Pikachu activado!" : "Puntos extra!");
      sfx("power");
    }
  }

  powerups = powerups.filter((p) => !p.collected && p.y < WORLD_H + 120);
}

function updateCoins() {
  for (const c of coins) {
    if (c.collected) continue;
    const bob = Math.sin((frame + c.phase) / 9) * 3;
    if (overlap(player.x, player.y, player.w, player.h, c.x - 10, c.y + bob - 12, 20, 24)) {
      c.collected = true;
      addCoins(1);
      addScore(100);
      spawnSparkBurst(c.x, c.y + bob, 0.45);
      sfx("coin");
    }
  }
}

function updateFlag(dt) {
  if (state === "flag-slide") {
    player.y += 2.2 * dt;
    const floorY = LEVEL.flag.bottom - player.h;
    if (player.y >= floorY) {
      player.y = floorY;
      player.vx = 1.9;
      flagPause = 20;
      state = "flag-walk";
    }
    return;
  }

  if (state === "flag-walk") {
    if (flagPause > 0) {
      flagPause -= dt;
      return;
    }

    player.x += player.vx * dt;
    if (player.x >= LEVEL.castle.doorX) {
      if (!winBonusGiven) {
        addScore(stats.time * 20);
        winBonusGiven = true;
      }
      spawnSparkBurst(LEVEL.castle.doorX, LEVEL.castle.y + TILE * 2.5, 1.4);
      addCameraShake(2.2);
      state = "won";
      setMessage("Nivel completado! Presiona R para reiniciar.");
      sfx("win");
    }
  }
}

function updateCamera() {
  const target = clamp(player.x + player.w * 0.5 - WIDTH * 0.38, 0, WORLD_W - WIDTH);
  if (state === "playing") {
    if (target > cameraX) cameraX += (target - cameraX) * 0.18;
  } else {
    cameraX += (target - cameraX) * 0.12;
  }
  cameraX = clamp(cameraX, 0, WORLD_W - WIDTH);
}

function update(dt, dtMs) {
  frame += dt;
  updateBumps(dt);
  updatePopCoins(dt);
  updateAmbient(dt);
  updateParticles(dt);
  updateScreenFx(dt);

  if (state === "playing") {
    updateTimer(dtMs);
    updatePlayer(dt);
    updateCoins();
    updatePowerups(dt);
    updateEnemies(dt);
  } else if (state === "flag-slide" || state === "flag-walk") {
    updateFlag(dt);
    updatePowerups(dt);
    updateEnemies(dt);
  }

  player.x = clamp(player.x, 0, WORLD_W - player.w);
  updateCamera();
}
function drawCloud(x, y, s) {
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(x + 10 * s, y + 12 * s, 58 * s, 20 * s);
  ctx.fillRect(x, y + 18 * s, 20 * s, 14 * s);
  ctx.fillRect(x + 54 * s, y + 16 * s, 22 * s, 16 * s);
  ctx.fillRect(x + 16 * s, y, 18 * s, 14 * s);
  ctx.fillRect(x + 34 * s, y + 2 * s, 20 * s, 12 * s);

  ctx.fillStyle = "#d8eefe";
  ctx.fillRect(x + 14 * s, y + 18 * s, 50 * s, 3 * s);
}

function drawBackground() {
  const progress = clamp(cameraX / Math.max(1, WORLD_W - WIDTH), 0, 1);
  const skyTopHue = Math.round(212 - progress * 14);
  const skyMidHue = Math.round(216 - progress * 8);
  const skyTop = `hsl(${skyTopHue}, 88%, ${Math.round(68 - progress * 4)}%)`;
  const skyMid = `hsl(${skyMidHue}, 82%, ${Math.round(66 - progress * 3)}%)`;
  const skyBottom = `hsl(211, 88%, ${Math.round(73 - progress * 2)}%)`;

  const sky = ctx.createLinearGradient(0, 0, 0, HEIGHT);
  sky.addColorStop(0, skyTop);
  sky.addColorStop(0.52, skyMid);
  sky.addColorStop(1, skyBottom);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  const sunX = WIDTH - 108 + Math.sin(frame / 180) * 16;
  const sunY = 90 + Math.cos(frame / 235) * 8;
  const sunBloom = ctx.createRadialGradient(sunX, sunY, 20, sunX, sunY, 230);
  sunBloom.addColorStop(0, "rgba(255,241,173,0.34)");
  sunBloom.addColorStop(0.32, "rgba(255,228,150,0.16)");
  sunBloom.addColorStop(1, "rgba(255,220,120,0)");
  ctx.fillStyle = sunBloom;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  ctx.fillStyle = "rgba(255,238,160,0.9)";
  ctx.beginPath();
  ctx.arc(sunX, sunY, 40, 0, Math.PI * 2);
  ctx.fill();

  const horizonHaze = ctx.createLinearGradient(0, HEIGHT * 0.36, 0, HEIGHT * 0.82);
  horizonHaze.addColorStop(0, "rgba(170,225,255,0)");
  horizonHaze.addColorStop(1, "rgba(196,236,255,0.42)");
  ctx.fillStyle = horizonHaze;
  ctx.fillRect(0, HEIGHT * 0.36, WIDTH, HEIGHT * 0.5);

  for (const c of clouds) {
    const x = c.x - cameraX * 0.24;
    if (x < -120 || x > WIDTH + 120) continue;
    ctx.save();
    ctx.globalAlpha = 0.18;
    drawCloud(x + 8, c.y + 6, c.s * 1.02);
    ctx.restore();
    drawCloud(x, c.y, c.s);
  }

  for (const h of hills) {
    const x = h.x - cameraX * 0.42;
    if (x + h.w < -40 || x > WIDTH + 40) continue;

    const hillGrad = ctx.createLinearGradient(0, h.y - h.h, 0, h.y + h.h);
    hillGrad.addColorStop(0, "#7be06d");
    hillGrad.addColorStop(1, "#4db948");
    ctx.fillStyle = hillGrad;
    ctx.beginPath();
    ctx.ellipse(x + h.w / 2, h.y, h.w / 2, h.h, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "rgba(53,147,58,0.65)";
    ctx.beginPath();
    ctx.ellipse(x + h.w / 2, h.y + 12, h.w / 3, h.h / 1.55, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#101010";
    ctx.fillRect(x + h.w / 2 - 16, h.y - 15, 5, 9);
    ctx.fillRect(x + h.w / 2 + 11, h.y - 15, 5, 9);
  }
}

function drawAmbientMotes() {
  ctx.save();
  ctx.fillStyle = "#fff8d0";
  for (const p of ambient) {
    const pulse = 0.75 + Math.sin(frame * 0.02 + p.twinkle) * 0.25;
    ctx.globalAlpha = p.alpha * pulse;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function distanceToGround(x, y, w, h, maxTiles = 6) {
  const bottom = y + h;
  const minTx = Math.floor((x + 2) / TILE);
  const maxTx = Math.floor((x + w - 2) / TILE);
  const startTy = Math.floor(bottom / TILE);
  let nearest = maxTiles * TILE;

  for (let ty = startTy; ty <= Math.min(ROWS - 1, startTy + maxTiles); ty += 1) {
    for (let tx = minTx; tx <= maxTx; tx += 1) {
      if (!SOLID.has(tileAt(tx, ty))) continue;
      const dist = ty * TILE - bottom;
      if (dist >= 0 && dist < nearest) nearest = dist;
    }
  }

  return nearest;
}

function drawSoftShadow(x, y, w, h, baseAlpha = 0.24) {
  const dist = distanceToGround(x, y, w, h, 6);
  const alpha = clamp(baseAlpha - dist * 0.007, 0.04, baseAlpha);
  const stretch = clamp(1 + dist * 0.02, 1, 2.25);
  const rx = Math.max(8, w * 0.4 * stretch);
  const ry = Math.max(3, h * 0.11);

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = "#000000";
  ctx.beginPath();
  ctx.ellipse(x + w / 2, y + h + 3, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawParticles(layer = "front") {
  ctx.save();
  for (const p of particles) {
    if (p.layer !== layer) continue;
    const life = clamp(p.life / p.maxLife, 0, 1);
    const size = Math.max(0.7, p.size);
    ctx.globalAlpha = life;
    ctx.fillStyle = p.color;
    ctx.shadowColor = p.color;
    ctx.shadowBlur = p.glow || 0;
    ctx.fillRect(p.x - size * 0.5, p.y - size * 0.5, size, size);
  }
  ctx.restore();
}

function drawPostFx() {
  const progress = clamp(player.x / Math.max(1, WORLD_W - WIDTH), 0, 1);
  const wash = ctx.createLinearGradient(0, 0, WIDTH, HEIGHT);
  wash.addColorStop(0, `rgba(255,240,190,${lerp(0.05, 0.12, progress)})`);
  wash.addColorStop(1, "rgba(140,200,255,0.06)");
  ctx.fillStyle = wash;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  const vignette = ctx.createRadialGradient(
    WIDTH * 0.5,
    HEIGHT * 0.45,
    HEIGHT * 0.25,
    WIDTH * 0.5,
    HEIGHT * 0.45,
    HEIGHT * 0.86
  );
  vignette.addColorStop(0, "rgba(0,0,0,0)");
  vignette.addColorStop(1, "rgba(0,0,0,0.36)");
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  if (!grainReady) return;
  const xShift = Math.floor((frame * 0.65) % grainCanvas.width);
  const yShift = Math.floor((frame * 0.42) % grainCanvas.height);
  ctx.save();
  ctx.globalAlpha = 0.08;
  ctx.globalCompositeOperation = "overlay";
  for (let x = -grainCanvas.width + xShift; x < WIDTH; x += grainCanvas.width) {
    for (let y = -grainCanvas.height + yShift; y < HEIGHT; y += grainCanvas.height) {
      ctx.drawImage(grainCanvas, x, y);
    }
  }
  ctx.restore();
}

function drawBushes() {
  for (const b of bushes) {
    if (b.x + b.w < cameraX - 40 || b.x > cameraX + WIDTH + 40) continue;
    ctx.fillStyle = "#38b44f";
    ctx.beginPath();
    ctx.ellipse(b.x + b.w * 0.25, b.y + 10, b.w * 0.25, b.h * 0.55, 0, 0, Math.PI * 2);
    ctx.ellipse(b.x + b.w * 0.5, b.y + 5, b.w * 0.28, b.h * 0.62, 0, 0, Math.PI * 2);
    ctx.ellipse(b.x + b.w * 0.75, b.y + 10, b.w * 0.25, b.h * 0.55, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawQuestionGlyph(x, y, color) {
  const p = [
    "0111100",
    "1000010",
    "0000010",
    "0001100",
    "0001000",
    "0000000",
    "0001000"
  ];
  ctx.fillStyle = color;
  for (let row = 0; row < p.length; row += 1) {
    for (let col = 0; col < p[row].length; col += 1) {
      if (p[row][col] === "1") ctx.fillRect(x + col * 2, y + row * 2, 2, 2);
    }
  }
}

function drawPipe(tile, x, y) {
  const top = tile === "L" || tile === "R";
  const left = tile === "L" || tile === "l";

  ctx.fillStyle = "#2aba39";
  ctx.fillRect(x, y, TILE, TILE);
  ctx.fillStyle = "#1f8e2d";
  ctx.fillRect(x + 2, y + 2, 7, TILE - 4);
  ctx.fillStyle = "#6ae172";
  ctx.fillRect(x + 20, y + 2, 8, TILE - 4);

  if (top) {
    ctx.fillStyle = "#53d862";
    ctx.fillRect(x, y, TILE, 8);
    ctx.fillStyle = "#1f8e2d";
    ctx.fillRect(x, y + 6, TILE, 2);
    ctx.fillStyle = "#2aba39";
    if (left) ctx.fillRect(x + 30, y + 1, 2, 7);
    else ctx.fillRect(x, y + 1, 2, 7);
  }
}

function drawTile(tile, tx, ty) {
  const x = tx * TILE;
  const y = ty * TILE - bumpOffset(tx, ty);

  if (tile === "T") {
    ctx.fillStyle = "#c17d3b";
    ctx.fillRect(x, y, TILE, TILE);
    ctx.fillStyle = "#67c83e";
    ctx.fillRect(x, y, TILE, 8);
    ctx.fillStyle = "#4ea734";
    ctx.fillRect(x, y + 6, TILE, 2);
    ctx.fillStyle = "#d49957";
    ctx.fillRect(x + 4, y + 14, 4, 4);
    ctx.fillRect(x + 14, y + 19, 5, 5);
    ctx.fillRect(x + 24, y + 12, 4, 4);
    return;
  }

  if (tile === "D") {
    ctx.fillStyle = "#c17d3b";
    ctx.fillRect(x, y, TILE, TILE);
    ctx.fillStyle = "#ad682e";
    ctx.fillRect(x + 4, y + 6, 5, 5);
    ctx.fillRect(x + 16, y + 12, 6, 6);
    ctx.fillRect(x + 24, y + 21, 4, 4);
    return;
  }

  if (tile === "B") {
    ctx.fillStyle = "#7b3912";
    ctx.fillRect(x, y, TILE, TILE);
    ctx.fillStyle = "#b76122";
    ctx.fillRect(x + 1, y + 1, TILE - 2, TILE - 2);
    ctx.fillStyle = "#8d4317";
    ctx.fillRect(x, y + 10, TILE, 3);
    ctx.fillRect(x, y + 21, TILE, 3);
    ctx.fillRect(x + 15, y, 3, TILE);
    return;
  }

  if (tile === "Q") {
    const flash = Math.sin(frame / 8) > 0 ? "#f7c847" : "#edb733";
    ctx.fillStyle = "#8f5f17";
    ctx.fillRect(x, y, TILE, TILE);
    ctx.fillStyle = flash;
    ctx.fillRect(x + 1, y + 1, TILE - 2, TILE - 2);
    ctx.fillStyle = "#d09325";
    ctx.fillRect(x + 2, y + 2, TILE - 4, 4);
    drawQuestionGlyph(x + 9, y + 8, "#8d5117");
    return;
  }

  if (tile === "U") {
    ctx.fillStyle = "#6f4f2a";
    ctx.fillRect(x, y, TILE, TILE);
    ctx.fillStyle = "#85603a";
    ctx.fillRect(x + 1, y + 1, TILE - 2, TILE - 2);
    ctx.fillStyle = "#5b3e20";
    ctx.fillRect(x + 6, y + 6, 5, 5);
    ctx.fillRect(x + 20, y + 6, 5, 5);
    ctx.fillRect(x + 13, y + 18, 6, 6);
    return;
  }

  if (tile === "S") {
    ctx.fillStyle = "#6d6d6d";
    ctx.fillRect(x, y, TILE, TILE);
    ctx.fillStyle = "#8b8b8b";
    ctx.fillRect(x + 1, y + 1, TILE - 2, TILE - 2);
    ctx.fillStyle = "#565656";
    ctx.fillRect(x + 3, y + 5, TILE - 6, 3);
    ctx.fillRect(x + 3, y + 17, TILE - 6, 3);
    return;
  }

  if (tile === "L" || tile === "R" || tile === "l" || tile === "r") {
    drawPipe(tile, x, y);
  }
}

function drawTiles() {
  const startX = Math.max(0, Math.floor(cameraX / TILE) - 2);
  const endX = Math.min(COLS - 1, Math.floor((cameraX + WIDTH) / TILE) + 2);

  for (let ty = 0; ty < ROWS; ty += 1) {
    for (let tx = startX; tx <= endX; tx += 1) {
      const tile = tiles[ty][tx];
      if (tile !== ".") drawTile(tile, tx, ty);
    }
  }
}

function drawCoins() {
  for (const c of coins) {
    if (c.collected) continue;
    const bob = Math.sin((frame + c.phase) / 9) * 3;
    const spin = Math.abs(Math.sin((frame + c.phase) / 8));
    const rx = 2 + spin * 7;

    ctx.save();
    ctx.globalAlpha = 0.16;
    ctx.fillStyle = "#000000";
    ctx.beginPath();
    ctx.ellipse(c.x, c.y + bob + 14, rx * 0.85, 3.2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.globalAlpha = 0.17;
    ctx.fillStyle = "#fff0a6";
    ctx.beginPath();
    ctx.ellipse(c.x, c.y + bob, rx + 5, 13, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.fillStyle = "#f7d046";
    ctx.beginPath();
    ctx.ellipse(c.x, c.y + bob, rx, 10, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#fff3a8";
    ctx.beginPath();
    ctx.ellipse(c.x - 1.5, c.y + bob - 2, rx * 0.45, 4, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawPopCoins() {
  for (const c of popCoins) {
    const alpha = clamp(c.life / 26, 0, 1);
    const spin = Math.abs(Math.sin((frame + c.age) / 7));
    const rx = 3 + spin * 6;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = "#ffe878";
    ctx.beginPath();
    ctx.ellipse(c.x, c.y, rx, 11, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

function drawPowerups() {
  for (const p of powerups) {
    drawSoftShadow(p.x, p.y, p.w, p.h, 0.2);

    ctx.fillStyle = "rgba(255, 247, 211, 0.2)";
    ctx.fillRect(p.x - 2, p.y - 2, p.w + 4, p.h + 4);

    ctx.fillStyle = "#f5d5b3";
    ctx.fillRect(p.x + 8, p.y + 12, 12, 14);
    ctx.fillStyle = "#1a1a1a";
    ctx.fillRect(p.x + 10, p.y + 18, 3, 3);
    ctx.fillRect(p.x + 17, p.y + 18, 3, 3);

    ctx.fillStyle = "#d43d35";
    ctx.fillRect(p.x + 2, p.y + 4, 24, 10);
    ctx.fillStyle = "#ff6d5f";
    ctx.fillRect(p.x + 3, p.y + 5, 22, 3);
    ctx.fillStyle = "#f9f6f1";
    ctx.fillRect(p.x + 6, p.y + 7, 5, 4);
    ctx.fillRect(p.x + 18, p.y + 7, 5, 4);
    ctx.fillRect(p.x + 12, p.y + 6, 4, 4);
  }
}

function drawEnemies() {
  const step = Math.floor(frame / 8) % 2;

  for (const e of enemies) {
    const bob = e.state === "dead" ? 0 : Math.abs(Math.sin((frame + e.x * 0.15) / 8)) * 1.6;
    const ey = e.y + bob;
    drawSoftShadow(e.x, ey, e.w, e.h, 0.2);

    if (e.type === "beetle") {
      ctx.fillStyle = e.state === "dead" ? "#4a4f8d" : "#5565b6";
      ctx.fillRect(e.x + 2, ey + 5, e.w - 4, e.h - 5);
      ctx.fillStyle = e.state === "dead" ? "#6570b5" : "#7f8be3";
      ctx.fillRect(e.x + 4, ey + 7, e.w - 8, 4);
      ctx.fillStyle = "#e5d4b5";
      ctx.fillRect(e.x + 6, ey + 11, e.w - 12, 9);
      ctx.fillStyle = "#151515";
      ctx.fillRect(e.x + 8, ey + 13, 4, 4);
      ctx.fillRect(e.x + e.w - 12, ey + 13, 4, 4);
      ctx.fillStyle = "#2b2b2b";
      ctx.fillRect(e.x + 4, ey + e.h - 4, 8, 3);
      ctx.fillRect(e.x + e.w - 12, ey + e.h - 4, 8, 3);
      continue;
    }

    ctx.fillStyle = e.state === "dead" ? "#6f3d17" : "#8b4e20";
    ctx.fillRect(e.x, ey + 3, e.w, e.h - 3);
    ctx.fillStyle = "#a25f2a";
    ctx.fillRect(e.x + 2, ey + 5, e.w - 4, 4);
    ctx.fillStyle = "#f2ddb6";
    ctx.fillRect(e.x + 5, ey + 10, e.w - 10, 12);
    ctx.fillStyle = "#1b1108";
    ctx.fillRect(e.x + 8, ey + 13, 4, 4);
    ctx.fillRect(e.x + e.w - 12, ey + 13, 4, 4);

    const shift = step === 0 ? 0 : 2;
    ctx.fillStyle = "#5d2f12";
    ctx.fillRect(e.x + 3 + shift, ey + e.h - 4, 9, 3);
    ctx.fillRect(e.x + e.w - 12 - shift, ey + e.h - 4, 9, 3);
  }
}

function drawFlagAndCastle() {
  const f = LEVEL.flag;
  ctx.fillStyle = "#f4f4f4";
  ctx.fillRect(f.x - 2, f.top, 4, f.bottom - f.top);
  ctx.beginPath();
  ctx.arc(f.x, f.top - 5, 6, 0, Math.PI * 2);
  ctx.fill();

  const wave = Math.sin(frame / 6) * 3;
  const y = (state === "flag-slide" || state === "flag-walk" || state === "won")
    ? clamp(player.y + 8, f.top + 16, f.bottom - 42)
    : f.top + 26;

  ctx.fillStyle = "#43d967";
  ctx.beginPath();
  ctx.moveTo(f.x + 2, y);
  ctx.lineTo(f.x + 56 + wave, y + 8);
  ctx.lineTo(f.x + 2, y + 16);
  ctx.closePath();
  ctx.fill();

  const c = LEVEL.castle;
  ctx.fillStyle = "#874b35";
  ctx.fillRect(c.x, c.y + TILE, TILE * 5, TILE * 4);

  ctx.fillStyle = "#9e5a40";
  for (let row = 0; row < 7; row += 1) {
    for (let col = 0; col < 10; col += 1) {
      ctx.fillRect(c.x + col * 16 + (row % 2 ? 8 : 0), c.y + TILE + row * 14, 14, 6);
    }
  }

  ctx.fillStyle = "#6c3a27";
  ctx.fillRect(c.x + TILE * 2 - 12, c.y + TILE * 3, 24, TILE * 2);
  ctx.fillStyle = "#1e1e1e";
  ctx.fillRect(c.x + TILE * 2 - 8, c.y + TILE * 3 + 8, 16, TILE * 2 - 8);

  ctx.fillStyle = "#9e5a40";
  for (let i = 0; i < 6; i += 1) {
    ctx.fillRect(c.x - 2 + i * 28, c.y + 10, 20, 14);
  }
}

function pix(baseX, baseY, gx, gy, gw, gh, color, unit = 2) {
  ctx.fillStyle = color;
  ctx.fillRect(baseX + gx * unit, baseY + gy * unit, gw * unit, gh * unit);
}

function drawPikaTail(baseX, baseY, unit, wiggle, big) {
  const yOffset = big ? 10 : 5;
  const shape = [
    [-4, yOffset + 6, 2, 2, "#9c5f1a"],
    [-3, yOffset + 4, 2, 2, "#9c5f1a"],
    [-2, yOffset + 2, 2, 2, "#9c5f1a"],
    [-1, yOffset + 1, 2, 2, "#ffd84f"],
    [0, yOffset + 2, 2, 2, "#ffd84f"],
    [1, yOffset + 3, 2, 2, "#ffd84f"],
    [2, yOffset + 4, 2, 2, "#ffd84f"],
    [1, yOffset + 5, 2, 2, "#f4be2d"],
    [0, yOffset + 6, 2, 2, "#f4be2d"]
  ];

  for (const [gx, gy, gw, gh, color] of shape) {
    pix(baseX, baseY, gx, gy + wiggle, gw, gh, color, unit);
  }
}

function drawPikaSmall(baseX, baseY, runFrame, airborne) {
  const unit = 2;
  const legOffset = airborne ? -1 : (runFrame === 0 ? 0 : 1);
  const cheekPulse = Math.sin(frame / 6) > 0 ? "#ff5d6a" : "#ff7b85";
  const eyeBlink = Math.floor(frame / 70) % 14 === 0;

  drawPikaTail(baseX, baseY, unit, runFrame === 0 ? 0 : 1, false);

  pix(baseX, baseY, 1, 0, 2, 4, "#ffd84f", unit);
  pix(baseX, baseY, 1, 0, 2, 2, "#2d2310", unit);
  pix(baseX, baseY, 8, 0, 2, 4, "#ffd84f", unit);
  pix(baseX, baseY, 8, 0, 2, 2, "#2d2310", unit);

  pix(baseX, baseY, 2, 2, 8, 5, "#ffd84f", unit);
  pix(baseX, baseY, 2, 5, 8, 7, "#f8c92f", unit);
  pix(baseX, baseY, 3, 3, 6, 6, "#ffe075", unit);

  pix(baseX, baseY, 3, 5, 1, 1, cheekPulse, unit);
  pix(baseX, baseY, 8, 5, 1, 1, cheekPulse, unit);
  pix(baseX, baseY, 3, 9, 2, 1, "#8d5a1d", unit);
  pix(baseX, baseY, 7, 9, 2, 1, "#8d5a1d", unit);

  if (eyeBlink) {
    pix(baseX, baseY, 4, 4, 1, 1, "#1b1b1b", unit);
    pix(baseX, baseY, 7, 4, 1, 1, "#1b1b1b", unit);
  } else {
    pix(baseX, baseY, 4, 4, 1, 2, "#1b1b1b", unit);
    pix(baseX, baseY, 7, 4, 1, 2, "#1b1b1b", unit);
    pix(baseX, baseY, 4, 4, 1, 1, "#ffffff", unit);
  }

  pix(baseX, baseY, 5, 6, 1, 1, "#5b3a0f", unit);
  pix(baseX, baseY, 6, 6, 1, 1, "#5b3a0f", unit);

  pix(baseX, baseY, 3, 12 + legOffset, 2, 3, "#f4be2d", unit);
  pix(baseX, baseY, 7, 12 - legOffset, 2, 3, "#f4be2d", unit);
  pix(baseX, baseY, 3, 14 + legOffset, 2, 1, "#9c5f1a", unit);
  pix(baseX, baseY, 7, 14 - legOffset, 2, 1, "#9c5f1a", unit);
}

function drawPikaBig(baseX, baseY, runFrame, airborne) {
  const unit = 2;
  const legOffset = airborne ? -1 : (runFrame === 0 ? 0 : 1);
  const sparkPhase = Math.sin(frame / 5);
  const eyeBlink = Math.floor(frame / 65) % 13 === 0;

  drawPikaTail(baseX, baseY, unit, runFrame === 0 ? 0 : 1, true);

  pix(baseX, baseY, 1, 0, 2, 6, "#ffd84f", unit);
  pix(baseX, baseY, 1, 0, 2, 3, "#2d2310", unit);
  pix(baseX, baseY, 8, 0, 2, 6, "#ffd84f", unit);
  pix(baseX, baseY, 8, 0, 2, 3, "#2d2310", unit);

  pix(baseX, baseY, 2, 4, 8, 7, "#ffd84f", unit);
  pix(baseX, baseY, 2, 10, 8, 12, "#f8c92f", unit);
  pix(baseX, baseY, 3, 6, 6, 12, "#ffe075", unit);

  if (eyeBlink) {
    pix(baseX, baseY, 4, 7, 1, 1, "#1b1b1b", unit);
    pix(baseX, baseY, 7, 7, 1, 1, "#1b1b1b", unit);
  } else {
    pix(baseX, baseY, 4, 7, 1, 2, "#1b1b1b", unit);
    pix(baseX, baseY, 7, 7, 1, 2, "#1b1b1b", unit);
    pix(baseX, baseY, 4, 7, 1, 1, "#ffffff", unit);
  }

  pix(baseX, baseY, 3, 9, 1, 2, "#ff5d6a", unit);
  pix(baseX, baseY, 8, 9, 1, 2, "#ff5d6a", unit);
  pix(baseX, baseY, 5, 10, 2, 1, "#5b3a0f", unit);

  pix(baseX, baseY, 3, 16, 2, 1, "#8d5a1d", unit);
  pix(baseX, baseY, 7, 16, 2, 1, "#8d5a1d", unit);
  pix(baseX, baseY, 2, 19, 1, 3, "#f4be2d", unit);
  pix(baseX, baseY, 9, 19, 1, 3, "#f4be2d", unit);

  pix(baseX, baseY, 3, 22 + legOffset, 2, 5, "#f4be2d", unit);
  pix(baseX, baseY, 7, 22 - legOffset, 2, 5, "#f4be2d", unit);
  pix(baseX, baseY, 3, 26 + legOffset, 2, 1, "#9c5f1a", unit);
  pix(baseX, baseY, 7, 26 - legOffset, 2, 1, "#9c5f1a", unit);

  if (sparkPhase > 0.2) {
    pix(baseX, baseY, -1, 12, 1, 1, "#fff09d", unit);
    pix(baseX, baseY, 11, 14, 1, 1, "#fff09d", unit);
    pix(baseX, baseY, 10, 8, 1, 1, "#fff09d", unit);
  }
}

function drawPlayer() {
  if (player.invul > 0 && Math.floor(player.invul / 5) % 2 === 0) return;

  const x = Math.round(player.x);
  const y = Math.round(player.y);
  const moving = player.onGround && Math.abs(player.vx) > 0.15;
  const runFrame = moving ? Math.floor(frame / 6) % 2 : 0;
  const airborne = !player.onGround;
  const auraStrength = clamp((Math.abs(player.vx) - 3.6) / 4.2, 0, 1) * 0.18 + (player.form === "big" ? 0.08 : 0);

  drawSoftShadow(x, y, player.w, player.h, player.onGround ? 0.24 : 0.14);

  if (auraStrength > 0.02) {
    const cx = x + player.w / 2;
    const cy = y + player.h * 0.5;
    const glow = ctx.createRadialGradient(cx, cy, 4, cx, cy, player.h * 1.05);
    glow.addColorStop(0, `rgba(255,246,171,${auraStrength})`);
    glow.addColorStop(1, "rgba(255,246,171,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(x - player.h, y - player.h, player.h * 3, player.h * 3);
  }

  ctx.save();
  if (player.facing < 0) {
    ctx.translate(x + player.w / 2, 0);
    ctx.scale(-1, 1);
    ctx.translate(-(x + player.w / 2), 0);
  }

  if (player.form === "small") {
    drawPikaSmall(x, y, runFrame, airborne);
  } else {
    drawPikaBig(x, y, runFrame, airborne);
  }

  ctx.restore();

  if (airborne && Math.abs(player.vx) > 5.6) {
    ctx.save();
    ctx.globalAlpha = 0.32;
    ctx.strokeStyle = "#fff2a8";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x + player.w * 0.25, y + player.h * 0.6);
    ctx.lineTo(x - player.facing * 8, y + player.h * 0.5);
    ctx.lineTo(x + player.w * 0.55, y + player.h * 0.4);
    ctx.stroke();
    ctx.restore();
  }
}

function drawOverlay() {
  ctx.fillStyle = "rgba(0,0,0,0.48)";
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "center";
  ctx.font = "24px 'Lucida Console', monospace";
  ctx.fillText(state === "won" ? "NIVEL COMPLETADO" : "GAME OVER", WIDTH / 2, HEIGHT / 2 - 20);
  ctx.font = "14px 'Lucida Console', monospace";
  ctx.fillText("Presiona R para reiniciar", WIDTH / 2, HEIGHT / 2 + 16);
}

function render() {
  ctx.save();
  ctx.translate(shakeX, shakeY);
  drawBackground();
  drawAmbientMotes();

  ctx.save();
  ctx.translate(-cameraX, 0);
  drawParticles("back");
  drawBushes();
  drawTiles();
  drawCoins();
  drawPopCoins();
  drawFlagAndCastle();
  drawPowerups();
  drawEnemies();
  drawPlayer();
  drawParticles("front");
  ctx.restore();

  drawPostFx();
  ctx.restore();

  if (state === "gameover" || state === "won") {
    drawOverlay();
  }
}
function normKey(raw) {
  const k = raw.toLowerCase();
  return k === " " ? "space" : k;
}

function bindInput() {
  const blocked = new Set([
    "a",
    "d",
    "w",
    "arrowleft",
    "arrowright",
    "arrowup",
    "space",
    "shift",
    "r"
  ]);

  window.addEventListener("keydown", (event) => {
    const key = normKey(event.key);
    if (blocked.has(key)) event.preventDefault();

    if (key === "r") {
      ensureAudio();
      restartGame();
      return;
    }

    if ((key === "space" || key === "w" || key === "arrowup") && !keys.has(key)) {
      jumpQueued = true;
      ensureAudio();
    }

    if (
      key === "a" ||
      key === "d" ||
      key === "arrowleft" ||
      key === "arrowright" ||
      key === "shift"
    ) {
      ensureAudio();
    }

    keys.add(key);
  });

  window.addEventListener("keyup", (event) => {
    keys.delete(normKey(event.key));
  });

  window.addEventListener("blur", () => {
    keys.clear();
  });
}

function bindTouch() {
  document.querySelectorAll(".touch-btn").forEach((btn) => {
    const raw = btn.dataset.key;
    if (!raw) return;

    const key = raw === "jump" ? "space" : raw;

    const down = (event) => {
      event.preventDefault();
      ensureAudio();
      btn.setPointerCapture(event.pointerId);
      keys.add(key);
      if (key === "space") jumpQueued = true;
    };

    const up = (event) => {
      event.preventDefault();
      keys.delete(key);
      if (btn.hasPointerCapture(event.pointerId)) {
        btn.releasePointerCapture(event.pointerId);
      }
    };

    btn.addEventListener("pointerdown", down);
    btn.addEventListener("pointerup", up);
    btn.addEventListener("pointercancel", up);
    btn.addEventListener("pointerleave", up);
  });
}

function gameLoop() {
  let last = performance.now();

  const loop = (now) => {
    const dtMs = now - last;
    last = now;
    const dt = clamp(dtMs / 16.666, 0.5, 2.2);

    update(dt, dtMs);
    render();
    requestAnimationFrame(loop);
  };

  requestAnimationFrame(loop);
}

bindInput();
bindTouch();
initVisualFx();
restartGame();
gameLoop();
