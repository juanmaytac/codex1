
const canvas = document.getElementById("game");
const VIEW_W = 960;
const VIEW_H = 576;
const DPR = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
canvas.width = VIEW_W * DPR;
canvas.height = VIEW_H * DPR;
canvas.style.width = `${VIEW_W}px`;
canvas.style.height = `${VIEW_H}px`;
const ctx = canvas.getContext("2d");
ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
ctx.imageSmoothingEnabled = true;
ctx.lineCap = "round";
ctx.lineJoin = "round";

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
const WIDTH = VIEW_W;
const HEIGHT = VIEW_H;
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

function tone(freq, dur, type = "square", vol = 0.05, glide = 0, delay = 0) {
  if (!audio.ctx) {
    return;
  }
  const now = audio.ctx.currentTime;
  const start = now + delay;
  const osc = audio.ctx.createOscillator();
  const gain = audio.ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);
  if (glide > 0) {
    osc.frequency.exponentialRampToValueAtTime(glide, start + dur);
  }
  gain.gain.setValueAtTime(vol, start);
  gain.gain.exponentialRampToValueAtTime(0.001, start + dur);
  osc.connect(gain);
  gain.connect(audio.ctx.destination);
  osc.start(start);
  osc.stop(start + dur);
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
      tone(261.63, 0.22, "triangle", 0.02, 392, 0);
      tone(523.25, 0.07, "square", 0.034, 0, 0);
      tone(659.25, 0.08, "square", 0.038, 0, 0.08);
      tone(783.99, 0.08, "square", 0.04, 0, 0.16);
      tone(1046.5, 0.16, "triangle", 0.046, 1320, 0.24);
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

  const enemy = (tx, ty, type = "oddish") => {
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

  enemy(22, 14, "oddish");
  enemy(25, 14, "diglett");
  enemy(33, 14, "poliwag");
  enemy(41, 14, "vulpix");
  enemy(55, 14, "sandshrew");
  enemy(68, 14, "oddish");
  enemy(72, 14, "poliwag");
  enemy(81, 14, "diglett");
  enemy(86, 14, "vulpix");
  enemy(98, 14, "oddish");
  enemy(104, 14, "poliwag");
  enemy(115, 14, "sandshrew");
  enemy(121, 14, "vulpix");
  enemy(133, 14, "diglett");
  enemy(140, 14, "oddish");
  enemy(149, 14, "vulpix");
  enemy(156, 14, "poliwag");
  enemy(166, 14, "sandshrew");
  enemy(182, 14, "diglett");
  enemy(188, 14, "oddish");
  enemy(190, 12, "vulpix");
  enemy(198, 12, "poliwag");

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

    const baseSpeed = e.type === "sandshrew" ? 1.35 : 1.15;
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
  ctx.save();
  ctx.globalAlpha = 0.96;
  ctx.shadowColor = "rgba(70, 110, 170, 0.15)";
  ctx.shadowBlur = 18 * s;

  const puffs = [
    [20, 22, 24, 16],
    [38, 14, 28, 18],
    [58, 18, 24, 15],
    [46, 28, 28, 15],
    [14, 29, 18, 11]
  ];

  for (const [px, py, rx, ry] of puffs) {
    const grad = ctx.createRadialGradient(
      x + (px - rx * 0.25) * s,
      y + (py - ry * 0.4) * s,
      2,
      x + px * s,
      y + py * s,
      rx * 1.15 * s
    );
    grad.addColorStop(0, "rgba(255,255,255,0.98)");
    grad.addColorStop(0.55, "rgba(247,250,255,0.96)");
    grad.addColorStop(1, "rgba(203,224,247,0.85)");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.ellipse(x + px * s, y + py * s, rx * s, ry * s, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.shadowBlur = 0;
  ctx.fillStyle = "rgba(255,255,255,0.38)";
  ctx.beginPath();
  ctx.ellipse(x + 34 * s, y + 16 * s, 17 * s, 6 * s, -0.18, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawMountainBand(parallax, baseY, amplitude, topColor, bottomColor, offsetSeed) {
  const shift = -((cameraX * parallax) % 170);
  const grad = ctx.createLinearGradient(0, baseY - amplitude - 40, 0, HEIGHT);
  grad.addColorStop(0, topColor);
  grad.addColorStop(1, bottomColor);
  ctx.fillStyle = grad;

  ctx.beginPath();
  ctx.moveTo(-220, HEIGHT);
  ctx.lineTo(-220, baseY + 40);
  let lastX = -220;
  for (let i = -2; i < Math.ceil((WIDTH + 440) / 170) + 3; i += 1) {
    const x = i * 170 + shift;
    const peakY = baseY
      - amplitude * (0.45 + ((Math.sin(i * 1.07 + offsetSeed) + 1) * 0.24))
      - (i % 3) * amplitude * 0.08;
    const dipY = baseY + Math.sin(i * 0.78 + offsetSeed * 0.6) * 18;
    ctx.quadraticCurveTo(x + 85, peakY, x + 170, dipY);
    lastX = x + 170;
  }
  ctx.lineTo(lastX, HEIGHT);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = "rgba(255,255,255,0.08)";
  ctx.lineWidth = 2;
  ctx.stroke();
}

function drawBackground() {
  const progress = clamp(cameraX / Math.max(1, WORLD_W - WIDTH), 0, 1);
  const skyTopHue = Math.round(214 - progress * 18);
  const skyMidHue = Math.round(210 - progress * 7);
  const skyTop = `hsl(${skyTopHue}, 54%, ${Math.round(18 + progress * 4)}%)`;
  const skyMid = `hsl(${skyMidHue}, 72%, ${Math.round(48 - progress * 6)}%)`;
  const skyBottom = `hsl(${198 - progress * 4}, 70%, ${Math.round(71 - progress * 4)}%)`;

  const sky = ctx.createLinearGradient(0, 0, 0, HEIGHT);
  sky.addColorStop(0, skyTop);
  sky.addColorStop(0.36, skyMid);
  sky.addColorStop(1, skyBottom);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  const sunX = WIDTH - 150 + Math.sin(frame / 180) * 18;
  const sunY = 108 + Math.cos(frame / 240) * 6;
  const sunBloom = ctx.createRadialGradient(sunX, sunY, 26, sunX, sunY, 250);
  sunBloom.addColorStop(0, "rgba(255,236,173,0.58)");
  sunBloom.addColorStop(0.18, "rgba(255,210,120,0.28)");
  sunBloom.addColorStop(0.42, "rgba(255,200,96,0.12)");
  sunBloom.addColorStop(1, "rgba(255,220,120,0)");
  ctx.fillStyle = sunBloom;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  ctx.fillStyle = "rgba(255,234,163,0.95)";
  ctx.beginPath();
  ctx.arc(sunX, sunY, 48, 0, Math.PI * 2);
  ctx.fill();

  ctx.save();
  ctx.globalAlpha = 0.15;
  ctx.strokeStyle = "rgba(255,220,172,0.8)";
  ctx.lineWidth = 2;
  for (let i = -2; i <= 2; i += 1) {
    ctx.beginPath();
    ctx.moveTo(sunX + i * 10, sunY + 14);
    ctx.lineTo(WIDTH * (0.14 + i * 0.03), HEIGHT * 0.78);
    ctx.stroke();
  }
  ctx.restore();

  drawMountainBand(0.12, HEIGHT * 0.57, 120, "rgba(29,49,88,0.85)", "rgba(58,92,134,0.7)", 0.4);
  drawMountainBand(0.24, HEIGHT * 0.65, 92, "rgba(56,91,120,0.82)", "rgba(73,129,129,0.72)", 1.4);
  drawMountainBand(0.38, HEIGHT * 0.74, 70, "rgba(52,112,90,0.82)", "rgba(92,152,110,0.86)", 2.3);

  const horizonHaze = ctx.createLinearGradient(0, HEIGHT * 0.34, 0, HEIGHT * 0.9);
  horizonHaze.addColorStop(0, "rgba(160,214,255,0)");
  horizonHaze.addColorStop(0.7, "rgba(192,232,255,0.18)");
  horizonHaze.addColorStop(1, "rgba(255,229,170,0.2)");
  ctx.fillStyle = horizonHaze;
  ctx.fillRect(0, HEIGHT * 0.34, WIDTH, HEIGHT * 0.56);

  for (const c of clouds) {
    const x = c.x - cameraX * 0.2;
    if (x < -120 || x > WIDTH + 120) continue;
    ctx.save();
    ctx.globalAlpha = 0.12;
    drawCloud(x + 12, c.y + 10, c.s * 1.08);
    ctx.restore();
    drawCloud(x, c.y, c.s);
  }

  for (const h of hills) {
    const x = h.x - cameraX * 0.46;
    if (x + h.w < -40 || x > WIDTH + 40) continue;

    const hillGrad = ctx.createLinearGradient(0, h.y - h.h, 0, h.y + h.h + 30);
    hillGrad.addColorStop(0, "#6ee693");
    hillGrad.addColorStop(0.45, "#2f9f63");
    hillGrad.addColorStop(1, "#1f6d3d");
    ctx.fillStyle = hillGrad;
    ctx.beginPath();
    ctx.ellipse(x + h.w / 2, h.y + 10, h.w / 2, h.h, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "rgba(20,63,43,0.22)";
    ctx.beginPath();
    ctx.ellipse(x + h.w / 2, h.y + 26, h.w / 3.4, h.h / 1.5, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "rgba(255,255,255,0.16)";
    ctx.beginPath();
    ctx.ellipse(x + h.w * 0.38, h.y - h.h * 0.12, h.w * 0.22, h.h * 0.3, -0.25, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "rgba(14,32,18,0.7)";
    ctx.beginPath();
    ctx.ellipse(x + h.w / 2 - 14, h.y - 8, 5, 8, 0, 0, Math.PI * 2);
    ctx.ellipse(x + h.w / 2 + 12, h.y - 8, 5, 8, 0, 0, Math.PI * 2);
    ctx.fill();
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

function roundedRectPath(x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

function fillRoundedRect(x, y, w, h, r, fillStyle) {
  if (fillStyle) ctx.fillStyle = fillStyle;
  roundedRectPath(x, y, w, h, r);
  ctx.fill();
}

function strokeRoundedRect(x, y, w, h, r, strokeStyle, lineWidth = 1) {
  if (strokeStyle) ctx.strokeStyle = strokeStyle;
  ctx.lineWidth = lineWidth;
  roundedRectPath(x, y, w, h, r);
  ctx.stroke();
}

function drawGlossyOrb(x, y, rx, ry, colors) {
  const grad = ctx.createRadialGradient(x - rx * 0.25, y - ry * 0.35, 2, x, y, Math.max(rx, ry));
  grad.addColorStop(0, colors[0]);
  grad.addColorStop(0.55, colors[1]);
  grad.addColorStop(1, colors[2]);
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
}

function drawLeaf(x, y, len, angle, fillA, fillB) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  const grad = ctx.createLinearGradient(0, -len * 0.5, 0, len * 0.6);
  grad.addColorStop(0, fillA);
  grad.addColorStop(1, fillB);
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.moveTo(0, -len * 0.55);
  ctx.quadraticCurveTo(len * 0.42, -len * 0.22, 0, len * 0.58);
  ctx.quadraticCurveTo(-len * 0.42, -len * 0.22, 0, -len * 0.55);
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.18)";
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(0, -len * 0.48);
  ctx.quadraticCurveTo(len * 0.05, 0, 0, len * 0.48);
  ctx.stroke();
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
    ctx.save();
    ctx.globalAlpha = 0.18;
    ctx.fillStyle = "#000000";
    ctx.beginPath();
    ctx.ellipse(b.x + b.w * 0.52, b.y + 22, b.w * 0.42, 7, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    const grad = ctx.createLinearGradient(0, b.y - b.h * 0.2, 0, b.y + b.h);
    grad.addColorStop(0, "#7cf7a7");
    grad.addColorStop(0.55, "#35a55f");
    grad.addColorStop(1, "#165632");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.ellipse(b.x + b.w * 0.2, b.y + 9, b.w * 0.22, b.h * 0.56, -0.2, 0, Math.PI * 2);
    ctx.ellipse(b.x + b.w * 0.45, b.y + 2, b.w * 0.25, b.h * 0.64, 0, 0, Math.PI * 2);
    ctx.ellipse(b.x + b.w * 0.7, b.y + 10, b.w * 0.22, b.h * 0.56, 0.2, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "rgba(255,255,255,0.18)";
    ctx.beginPath();
    ctx.ellipse(b.x + b.w * 0.35, b.y + 2, b.w * 0.12, b.h * 0.16, -0.15, 0, Math.PI * 2);
    ctx.ellipse(b.x + b.w * 0.62, b.y + 8, b.w * 0.11, b.h * 0.14, 0.1, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawQuestionGlyph(x, y, color) {
  ctx.save();
  ctx.fillStyle = color;
  ctx.font = "bold 18px Rajdhani, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.shadowColor = "rgba(0,0,0,0.2)";
  ctx.shadowBlur = 3;
  ctx.fillText("?", x + 7, y + 7);
  ctx.restore();
}

function drawPipe(tile, x, y) {
  const top = tile === "L" || tile === "R";
  const left = tile === "L" || tile === "l";
  const body = ctx.createLinearGradient(x, y, x + TILE, y);
  body.addColorStop(0, "#0f6a37");
  body.addColorStop(0.3, "#27ad5d");
  body.addColorStop(0.62, "#78eda0");
  body.addColorStop(1, "#0d5d33");
  fillRoundedRect(x + 1, y + 1, TILE - 2, TILE - 2, 6, body);
  strokeRoundedRect(x + 1, y + 1, TILE - 2, TILE - 2, 6, "rgba(4,35,18,0.45)", 1.2);

  ctx.fillStyle = "rgba(255,255,255,0.18)";
  ctx.fillRect(x + 5, y + 3, 4, TILE - 6);
  ctx.fillRect(x + TILE - 9, y + 4, 2, TILE - 8);

  if (top) {
    const cap = ctx.createLinearGradient(x, y, x + TILE, y);
    cap.addColorStop(0, "#2fd171");
    cap.addColorStop(0.45, "#8af7b0");
    cap.addColorStop(1, "#1a8549");
    fillRoundedRect(x - 2, y, TILE + 4, 10, 6, cap);
    ctx.fillStyle = "rgba(0,0,0,0.12)";
    ctx.fillRect(x - 1, y + 6, TILE + 2, 2);
    if (left) ctx.fillRect(x + TILE - 2, y + 1, 2, 8);
    else ctx.fillRect(x, y + 1, 2, 8);
  }
}

function drawTile(tile, tx, ty) {
  const x = tx * TILE;
  const y = ty * TILE - bumpOffset(tx, ty);

  if (tile === "T") {
    const dirt = ctx.createLinearGradient(x, y + 8, x, y + TILE);
    dirt.addColorStop(0, "#8a5330");
    dirt.addColorStop(0.55, "#6c3b22");
    dirt.addColorStop(1, "#402010");
    fillRoundedRect(x, y + 4, TILE, TILE - 4, 6, dirt);
    fillRoundedRect(x - 1, y, TILE + 2, 11, 6, "#34c66a");
    ctx.fillStyle = "#8ef3a8";
    ctx.beginPath();
    ctx.moveTo(x + 3, y + 8);
    ctx.quadraticCurveTo(x + 10, y + 1, x + 18, y + 7);
    ctx.quadraticCurveTo(x + 24, y + 0.5, x + 30, y + 8);
    ctx.lineTo(x + 30, y + 10);
    ctx.lineTo(x + 3, y + 10);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.1)";
    ctx.fillRect(x + 4, y + 12, 6, 10);
    ctx.fillStyle = "#b57f52";
    ctx.beginPath();
    ctx.ellipse(x + 8, y + 18, 3.5, 2.5, 0.2, 0, Math.PI * 2);
    ctx.ellipse(x + 18, y + 24, 4, 2.8, -0.2, 0, Math.PI * 2);
    ctx.ellipse(x + 25, y + 16, 2.8, 2.1, 0, 0, Math.PI * 2);
    ctx.fill();
    return;
  }

  if (tile === "D") {
    const dirt = ctx.createLinearGradient(x, y, x, y + TILE);
    dirt.addColorStop(0, "#7a4a2d");
    dirt.addColorStop(0.65, "#5f341f");
    dirt.addColorStop(1, "#372010");
    fillRoundedRect(x, y, TILE, TILE, 5, dirt);
    ctx.fillStyle = "rgba(255,255,255,0.07)";
    ctx.fillRect(x + 3, y + 4, 5, 9);
    ctx.fillStyle = "#ab7a4b";
    ctx.beginPath();
    ctx.ellipse(x + 8, y + 10, 4, 3, 0.2, 0, Math.PI * 2);
    ctx.ellipse(x + 20, y + 16, 5, 4, 0, 0, Math.PI * 2);
    ctx.ellipse(x + 25, y + 24, 3, 2.3, 0, 0, Math.PI * 2);
    ctx.fill();
    return;
  }

  if (tile === "B") {
    const brick = ctx.createLinearGradient(x, y, x, y + TILE);
    brick.addColorStop(0, "#d88b53");
    brick.addColorStop(0.55, "#b55d2d");
    brick.addColorStop(1, "#7f3b1b");
    fillRoundedRect(x + 1, y + 1, TILE - 2, TILE - 2, 5, brick);
    strokeRoundedRect(x + 1, y + 1, TILE - 2, TILE - 2, 5, "rgba(82,31,10,0.75)", 1.2);
    ctx.strokeStyle = "rgba(92,38,15,0.8)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x + 1, y + 11);
    ctx.lineTo(x + TILE - 1, y + 11);
    ctx.moveTo(x + 1, y + 22);
    ctx.lineTo(x + TILE - 1, y + 22);
    ctx.moveTo(x + 16, y + 1);
    ctx.lineTo(x + 16, y + TILE - 1);
    ctx.stroke();
    ctx.fillStyle = "rgba(255,255,255,0.12)";
    ctx.fillRect(x + 4, y + 4, TILE - 8, 4);
    return;
  }

  if (tile === "Q") {
    const flash = Math.sin(frame / 8) > 0 ? "#ffd66f" : "#ffbf3f";
    const block = ctx.createLinearGradient(x, y, x, y + TILE);
    block.addColorStop(0, "#ffe18b");
    block.addColorStop(0.58, flash);
    block.addColorStop(1, "#b7761f");
    fillRoundedRect(x, y, TILE, TILE, 6, block);
    strokeRoundedRect(x, y, TILE, TILE, 6, "rgba(103,61,4,0.7)", 1.2);
    ctx.fillStyle = "rgba(255,255,255,0.18)";
    ctx.beginPath();
    ctx.moveTo(x + 4, y + 7);
    ctx.lineTo(x + 18, y + 4);
    ctx.lineTo(x + 28, y + 9);
    ctx.lineTo(x + 28, y + 12);
    ctx.lineTo(x + 4, y + 12);
    ctx.closePath();
    ctx.fill();
    drawQuestionGlyph(x + 9, y + 8, "#7a4a12");
    return;
  }

  if (tile === "U") {
    const used = ctx.createLinearGradient(x, y, x + TILE, y + TILE);
    used.addColorStop(0, "#84705a");
    used.addColorStop(0.6, "#6b5847");
    used.addColorStop(1, "#4f4033");
    fillRoundedRect(x + 1, y + 1, TILE - 2, TILE - 2, 5, used);
    strokeRoundedRect(x + 1, y + 1, TILE - 2, TILE - 2, 5, "rgba(39,25,17,0.72)", 1.2);
    ctx.fillStyle = "rgba(255,255,255,0.1)";
    ctx.fillRect(x + 5, y + 5, TILE - 10, 3);
    ctx.fillStyle = "rgba(51,33,20,0.55)";
    ctx.beginPath();
    ctx.ellipse(x + 9, y + 10, 3, 3, 0, 0, Math.PI * 2);
    ctx.ellipse(x + 23, y + 10, 3, 3, 0, 0, Math.PI * 2);
    ctx.ellipse(x + 16, y + 22, 4, 4, 0, 0, Math.PI * 2);
    ctx.fill();
    return;
  }

  if (tile === "S") {
    const stone = ctx.createLinearGradient(x, y, x, y + TILE);
    stone.addColorStop(0, "#b8c1cb");
    stone.addColorStop(0.58, "#8d98a7");
    stone.addColorStop(1, "#667181");
    fillRoundedRect(x + 0.5, y + 0.5, TILE - 1, TILE - 1, 5, stone);
    strokeRoundedRect(x + 0.5, y + 0.5, TILE - 1, TILE - 1, 5, "rgba(60,67,75,0.75)", 1.1);
    ctx.fillStyle = "rgba(255,255,255,0.12)";
    ctx.fillRect(x + 4, y + 4, TILE - 8, 3);
    ctx.strokeStyle = "rgba(89,96,108,0.65)";
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(x + 4, y + 12);
    ctx.lineTo(x + TILE - 5, y + 12);
    ctx.moveTo(x + 7, y + 22);
    ctx.lineTo(x + TILE - 8, y + 22);
    ctx.stroke();
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
    const rx = 3.2 + spin * 6.6;

    ctx.save();
    ctx.globalAlpha = 0.18;
    ctx.fillStyle = "#000000";
    ctx.beginPath();
    ctx.ellipse(c.x, c.y + bob + 14, rx * 0.9, 3.4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    drawGlossyOrb(c.x, c.y + bob, rx, 11, ["#fff5c2", "#ffd34c", "#cc8a12"]);
    ctx.strokeStyle = "rgba(154,90,8,0.8)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.ellipse(c.x, c.y + bob, rx, 11, 0, 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = "rgba(255,255,255,0.35)";
    ctx.beginPath();
    ctx.ellipse(c.x - 2, c.y + bob - 4, rx * 0.38, 3.6, -0.2, 0, Math.PI * 2);
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
    drawGlossyOrb(c.x, c.y, rx, 11, ["#fffde2", "#ffe878", "#db9713"]);
    ctx.restore();
  }
}

function drawPowerups() {
  for (const p of powerups) {
    drawSoftShadow(p.x, p.y, p.w, p.h, 0.2);
    ctx.save();
    const halo = ctx.createRadialGradient(p.x + p.w / 2, p.y + p.h / 2, 3, p.x + p.w / 2, p.y + p.h / 2, 26);
    halo.addColorStop(0, "rgba(255,246,211,0.24)");
    halo.addColorStop(1, "rgba(255,246,211,0)");
    ctx.fillStyle = halo;
    ctx.fillRect(p.x - 10, p.y - 10, p.w + 20, p.h + 20);
    ctx.restore();

    const stem = ctx.createLinearGradient(p.x + 10, p.y + 12, p.x + 10, p.y + 26);
    stem.addColorStop(0, "#fff5ea");
    stem.addColorStop(1, "#d7b48f");
    fillRoundedRect(p.x + 8, p.y + 13, 12, 14, 5, stem);

    ctx.fillStyle = "#2b2018";
    ctx.beginPath();
    ctx.ellipse(p.x + 11.5, p.y + 20.5, 1.6, 2.4, 0, 0, Math.PI * 2);
    ctx.ellipse(p.x + 18.5, p.y + 20.5, 1.6, 2.4, 0, 0, Math.PI * 2);
    ctx.fill();

    const cap = ctx.createLinearGradient(p.x + 2, p.y + 3, p.x + 2, p.y + 15);
    cap.addColorStop(0, "#ff7b72");
    cap.addColorStop(0.55, "#e2433e");
    cap.addColorStop(1, "#972521");
    ctx.fillStyle = cap;
    ctx.beginPath();
    ctx.moveTo(p.x + 2, p.y + 14);
    ctx.quadraticCurveTo(p.x + 5, p.y + 2, p.x + 14, p.y + 2);
    ctx.quadraticCurveTo(p.x + 23, p.y + 2, p.x + 26, p.y + 14);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.16)";
    ctx.beginPath();
    ctx.moveTo(p.x + 5, p.y + 10);
    ctx.quadraticCurveTo(p.x + 14, p.y + 4, p.x + 22, p.y + 9);
    ctx.lineTo(p.x + 22, p.y + 11);
    ctx.lineTo(p.x + 5, p.y + 12);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = "#fff6f1";
    ctx.beginPath();
    ctx.ellipse(p.x + 8, p.y + 9, 3.8, 3.2, 0, 0, Math.PI * 2);
    ctx.ellipse(p.x + 20, p.y + 9, 3.8, 3.2, 0, 0, Math.PI * 2);
    ctx.ellipse(p.x + 14, p.y + 7, 3.3, 2.8, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawOddishEnemy(e, ey, step) {
  const cx = e.x + e.w / 2;
  const footShift = step === 0 ? 0 : 1.8;
  const leafLift = step === 0 ? 0 : 1.2;

  if (e.state === "dead") {
    drawLeaf(cx - 6, ey + 7, 10, -1.1, "#77dd79", "#2f8d41");
    drawLeaf(cx, ey + 5, 11, -1.57, "#83e88a", "#348748");
    drawLeaf(cx + 6, ey + 7, 10, -2.05, "#77dd79", "#2f8d41");
    drawGlossyOrb(cx, ey + 15, 10.5, 7.2, ["#67b8e2", "#2f7ea6", "#1d4e67"]);
    return;
  }

  drawLeaf(cx - 8, ey + 6 + leafLift, 14, -1.02, "#8dff9c", "#33a84b");
  drawLeaf(cx, ey + 2, 16, -1.57, "#9affaa", "#379f49");
  drawLeaf(cx + 8, ey + 6 + leafLift, 14, -2.12, "#8dff9c", "#33a84b");

  drawGlossyOrb(cx, ey + 17, 10.8, 11.8, ["#8ad8ff", "#3b96bd", "#204f68"]);
  ctx.fillStyle = "rgba(255,255,255,0.18)";
  ctx.beginPath();
  ctx.ellipse(cx - 3, ey + 12, 4.5, 2.5, -0.25, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#13232b";
  ctx.beginPath();
  ctx.ellipse(cx - 3.8, ey + 16, 1.3, 2.2, 0, 0, Math.PI * 2);
  ctx.ellipse(cx + 3.8, ey + 16, 1.3, 2.2, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.ellipse(cx - 4.2, ey + 15.2, 0.45, 0.65, 0, 0, Math.PI * 2);
  ctx.ellipse(cx + 3.4, ey + 15.2, 0.45, 0.65, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = "#173f53";
  ctx.lineWidth = 1.3;
  ctx.beginPath();
  ctx.arc(cx, ey + 18.8, 2.4, 0.25, Math.PI - 0.25);
  ctx.stroke();

  ctx.fillStyle = "#6a436d";
  ctx.beginPath();
  ctx.ellipse(cx - 5.2 - footShift, ey + e.h - 2.3, 3.4, 1.9, 0, 0, Math.PI * 2);
  ctx.ellipse(cx + 5.2 + footShift, ey + e.h - 2.3, 3.4, 1.9, 0, 0, Math.PI * 2);
  ctx.fill();
}

function drawSandshrewEnemy(e, ey, step) {
  const cx = e.x + e.w / 2;
  const pawShift = step === 0 ? 0 : 1.6;

  if (e.state === "dead") {
    drawGlossyOrb(cx, ey + 14, 11.5, 6.5, ["#e5cf96", "#b89353", "#7a5a2a"]);
    return;
  }

  const shell = ctx.createRadialGradient(cx - 3, ey + 10, 3, cx, ey + 14, 15);
  shell.addColorStop(0, "#f4dd9f");
  shell.addColorStop(0.55, "#cfac66");
  shell.addColorStop(1, "#825f2e");
  ctx.fillStyle = shell;
  ctx.beginPath();
  ctx.ellipse(cx, ey + 15, 11.5, 10, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#b58545";
  for (let i = -2; i <= 2; i += 1) {
    const spikeX = cx + i * 4.2;
    ctx.beginPath();
    ctx.moveTo(spikeX - 2.5, ey + 9 + Math.abs(i));
    ctx.quadraticCurveTo(spikeX, ey + 4 - Math.abs(i) * 0.5, spikeX + 2.5, ey + 9 + Math.abs(i));
    ctx.fill();
  }

  ctx.fillStyle = "#f0d8a2";
  ctx.beginPath();
  ctx.ellipse(cx, ey + 18, 7.5, 5.8, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#1a130a";
  ctx.beginPath();
  ctx.ellipse(cx - 3.4, ey + 15, 1.2, 1.8, 0, 0, Math.PI * 2);
  ctx.ellipse(cx + 3.1, ey + 15, 1.2, 1.8, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.ellipse(cx - 3.8, ey + 14.5, 0.45, 0.55, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#5a3f1c";
  ctx.lineWidth = 1.1;
  ctx.beginPath();
  ctx.arc(cx, ey + 18.5, 2.1, 0.2, Math.PI - 0.2);
  ctx.stroke();

  ctx.fillStyle = "#ddb769";
  ctx.beginPath();
  ctx.ellipse(cx - 5.3 - pawShift, ey + 23, 3.1, 1.8, 0, 0, Math.PI * 2);
  ctx.ellipse(cx + 5.3 + pawShift, ey + 23, 3.1, 1.8, 0, 0, Math.PI * 2);
  ctx.fill();
}

function drawDiglettEnemy(e, ey, step) {
  const cx = e.x + e.w / 2;
  const moundWidth = 13 + (step === 0 ? 0 : 1);

  const mound = ctx.createLinearGradient(e.x, ey + 18, e.x, ey + e.h);
  mound.addColorStop(0, e.state === "dead" ? "#8f633c" : "#7d5735");
  mound.addColorStop(1, "#4b321e");
  ctx.fillStyle = mound;
  ctx.beginPath();
  ctx.ellipse(cx, ey + e.h - 3, moundWidth, 5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.08)";
  ctx.beginPath();
  ctx.ellipse(cx - 4, ey + e.h - 5, 5, 1.6, 0, 0, Math.PI * 2);
  ctx.fill();

  if (e.state === "dead") {
    drawGlossyOrb(cx, ey + 12, 7.8, 5.6, ["#c48a66", "#995d3d", "#6a3d28"]);
    return;
  }

  const rise = step === 0 ? 0 : 1;
  drawGlossyOrb(cx, ey + 13 - rise, 7.2, 8.6, ["#d39a74", "#a86846", "#6c412a"]);
  ctx.fillStyle = "rgba(255,255,255,0.12)";
  ctx.beginPath();
  ctx.ellipse(cx - 2.4, ey + 9 - rise, 3, 1.8, -0.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#1b1209";
  ctx.beginPath();
  ctx.ellipse(cx - 3, ey + 12 - rise, 1.1, 1.8, 0, 0, Math.PI * 2);
  ctx.ellipse(cx + 3, ey + 12 - rise, 1.1, 1.8, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#e6a3a1";
  ctx.beginPath();
  ctx.ellipse(cx, ey + 16 - rise, 2.6, 1.8, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#f8d3d0";
  ctx.beginPath();
  ctx.ellipse(cx, ey + 15.5 - rise, 1.2, 0.7, 0, 0, Math.PI * 2);
  ctx.fill();
}

function drawPoliwagEnemy(e, ey, step) {
  const cx = e.x + 14;
  const tailWave = step === 0 ? 0 : 1;
  ctx.strokeStyle = e.state === "dead" ? "#2a6d92" : "#2e80ac";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(cx + 7, ey + 16);
  ctx.quadraticCurveTo(cx + 14, ey + 12 - tailWave, cx + 11, ey + 6 + tailWave);
  ctx.stroke();

  if (e.state === "dead") {
    drawGlossyOrb(cx, ey + 10, 11, 5, ["#8fdcff", "#4d97be", "#25516b"]);
    return;
  }

  const footShift = step === 0 ? 0 : 1.8;
  drawGlossyOrb(cx, ey + 15, 11, 10, ["#8ddcff", "#4ca3cc", "#1d5573"]);
  ctx.fillStyle = "#f6fbff";
  ctx.beginPath();
  ctx.ellipse(cx, ey + 15, 6.2, 6.2, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = "#2a4b75";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cx, ey + 15, 4.5, -Math.PI * 0.1, Math.PI * 1.7, false);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, ey + 15, 1.8, 0, Math.PI * 2);
  ctx.stroke();

  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.ellipse(cx - 5, ey + 9.5, 3.5, 3.5, 0, 0, Math.PI * 2);
  ctx.ellipse(cx + 5, ey + 9.5, 3.5, 3.5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#1b1b1b";
  ctx.beginPath();
  ctx.ellipse(cx - 5, ey + 10, 1.3, 1.3, 0, 0, Math.PI * 2);
  ctx.ellipse(cx + 5, ey + 10, 1.3, 1.3, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#366d90";
  ctx.beginPath();
  ctx.ellipse(cx - 6 - footShift, ey + e.h - 2.2, 2.7, 1.8, 0, 0, Math.PI * 2);
  ctx.ellipse(cx + 6 + footShift, ey + e.h - 2.2, 2.7, 1.8, 0, 0, Math.PI * 2);
  ctx.fill();
}

function drawVulpixEnemy(e, ey, step) {
  const cx = e.x + e.w / 2;
  if (e.state === "dead") {
    drawGlossyOrb(cx, ey + 13, 11, 5.5, ["#ffc680", "#d97830", "#8b421d"]);
    return;
  }

  const pawShift = step === 0 ? 0 : 1.5;
  const tailLift = step === 0 ? 0 : 1;

  for (let i = 0; i < 4; i += 1) {
    const tx = cx + 4 + i * 2;
    const ty = ey + 15 - (i % 2) * 2 - tailLift;
    ctx.save();
    ctx.translate(tx, ty);
    ctx.rotate(0.25 + i * 0.18);
    const tail = ctx.createLinearGradient(0, -6, 0, 10);
    tail.addColorStop(0, "#ffe2a9");
    tail.addColorStop(0.55, "#ffb453");
    tail.addColorStop(1, "#d06a26");
    ctx.fillStyle = tail;
    ctx.beginPath();
    ctx.moveTo(0, -6);
    ctx.quadraticCurveTo(6, -3, 5, 4);
    ctx.quadraticCurveTo(2, 9, -3, 7);
    ctx.quadraticCurveTo(-5, 2, 0, -6);
    ctx.fill();
    ctx.restore();
  }

  const body = ctx.createLinearGradient(e.x + 5, ey + 7, e.x + 5, ey + 21);
  body.addColorStop(0, "#ffbe69");
  body.addColorStop(0.55, "#e67e31");
  body.addColorStop(1, "#9d4d22");
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.ellipse(cx - 2, ey + 15, 7.5, 6.5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(cx - 5.5, ey + 10, 5.2, 4.7, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#f8e6c9";
  ctx.beginPath();
  ctx.ellipse(cx - 0.8, ey + 17, 4.8, 3.6, 0, 0, Math.PI * 2);
  ctx.ellipse(cx - 4.4, ey + 11.7, 3.1, 2.2, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#6a2f16";
  ctx.beginPath();
  ctx.moveTo(cx - 8.8, ey + 7);
  ctx.lineTo(cx - 7.3, ey + 3.6);
  ctx.lineTo(cx - 5.2, ey + 7.4);
  ctx.closePath();
  ctx.moveTo(cx - 3.7, ey + 6.2);
  ctx.lineTo(cx - 2.3, ey + 2.8);
  ctx.lineTo(cx - 0.5, ey + 6.4);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = "#1a1009";
  ctx.beginPath();
  ctx.ellipse(cx - 6, ey + 10.8, 1.1, 1.5, 0, 0, Math.PI * 2);
  ctx.ellipse(cx - 1.8, ey + 10.8, 1.1, 1.5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#f09da0";
  ctx.beginPath();
  ctx.ellipse(cx - 4, ey + 13.2, 1.4, 1, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#8c431e";
  ctx.beginPath();
  ctx.ellipse(cx - 5.7 - pawShift, ey + e.h - 2.3, 2.2, 1.6, 0, 0, Math.PI * 2);
  ctx.ellipse(cx - 0.8 + pawShift * 0.4, ey + e.h - 2.4, 2.2, 1.6, 0, 0, Math.PI * 2);
  ctx.fill();
}

function drawEnemies() {
  const step = Math.floor(frame / 8) % 2;

  for (const e of enemies) {
    const bob = e.state === "dead" ? 0 : Math.abs(Math.sin((frame + e.x * 0.15) / 8)) * 1.6;
    const ey = e.y + bob;
    drawSoftShadow(e.x, ey, e.w, e.h, 0.2);

    switch (e.type) {
      case "sandshrew":
        drawSandshrewEnemy(e, ey, step);
        break;
      case "diglett":
        drawDiglettEnemy(e, ey, step);
        break;
      case "poliwag":
        drawPoliwagEnemy(e, ey, step);
        break;
      case "vulpix":
        drawVulpixEnemy(e, ey, step);
        break;
      case "oddish":
      default:
        drawOddishEnemy(e, ey, step);
        break;
    }
  }
}

function drawFlagAndCastle() {
  const f = LEVEL.flag;
  const pole = ctx.createLinearGradient(f.x - 3, 0, f.x + 3, 0);
  pole.addColorStop(0, "#d6dde8");
  pole.addColorStop(0.5, "#ffffff");
  pole.addColorStop(1, "#9ea8b7");
  ctx.fillStyle = pole;
  fillRoundedRect(f.x - 2.5, f.top, 5, f.bottom - f.top, 3, pole);
  drawGlossyOrb(f.x, f.top - 6, 6, 6, ["#ffffff", "#d3dbe8", "#909fb0"]);

  const wave = Math.sin(frame / 6) * 3;
  const y = (state === "flag-slide" || state === "flag-walk" || state === "won")
    ? clamp(player.y + 8, f.top + 16, f.bottom - 42)
    : f.top + 26;

  const flag = ctx.createLinearGradient(f.x + 2, y, f.x + 58, y + 20);
  flag.addColorStop(0, "#74ff9d");
  flag.addColorStop(0.6, "#19c55f");
  flag.addColorStop(1, "#0b7637");
  ctx.fillStyle = flag;
  ctx.beginPath();
  ctx.moveTo(f.x + 2, y);
  ctx.lineTo(f.x + 56 + wave, y + 8);
  ctx.lineTo(f.x + 2, y + 16);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.18)";
  ctx.beginPath();
  ctx.moveTo(f.x + 5, y + 4);
  ctx.lineTo(f.x + 33 + wave * 0.35, y + 7);
  ctx.lineTo(f.x + 5, y + 9);
  ctx.closePath();
  ctx.fill();

  const c = LEVEL.castle;
  const wall = ctx.createLinearGradient(c.x, c.y, c.x, c.y + TILE * 5);
  wall.addColorStop(0, "#bdbbc7");
  wall.addColorStop(0.55, "#8f93a6");
  wall.addColorStop(1, "#666b7e");
  fillRoundedRect(c.x, c.y + TILE, TILE * 5, TILE * 4, 8, wall);

  ctx.fillStyle = "rgba(255,255,255,0.14)";
  ctx.fillRect(c.x + 6, c.y + TILE + 8, TILE * 5 - 12, 5);

  ctx.fillStyle = "#767b90";
  for (let row = 0; row < 7; row += 1) {
    for (let col = 0; col < 10; col += 1) {
      fillRoundedRect(c.x + col * 16 + (row % 2 ? 8 : 0), c.y + TILE + row * 14, 14, 6, 2, "#7b8095");
    }
  }

  const door = ctx.createLinearGradient(c.x + TILE * 2 - 12, c.y + TILE * 3, c.x + TILE * 2 - 12, c.y + TILE * 5);
  door.addColorStop(0, "#5a3425");
  door.addColorStop(1, "#27150f");
  fillRoundedRect(c.x + TILE * 2 - 12, c.y + TILE * 3, 24, TILE * 2, 10, door);
  ctx.fillStyle = "#101319";
  fillRoundedRect(c.x + TILE * 2 - 8, c.y + TILE * 3 + 8, 16, TILE * 2 - 8, 7, "#101319");

  ctx.fillStyle = "#9398ad";
  for (let i = 0; i < 6; i += 1) {
    fillRoundedRect(c.x - 2 + i * 28, c.y + 10, 20, 14, 3, "#9398ad");
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

function drawPikachuHd(baseX, baseY, form, runFrame, airborne) {
  const tall = form === "big";
  const scale = tall ? 1.08 : 0.82;
  const headR = 10.5 * scale;
  const bodyRx = 8.8 * scale;
  const bodyRy = tall ? 12.4 * scale : 9.8 * scale;
  const headCx = baseX + 12.5;
  const headCy = baseY + (tall ? 15 : 11);
  const bodyCx = headCx;
  const bodyCy = baseY + (tall ? 31 : 21);
  const legShift = airborne ? 0 : (runFrame === 0 ? -2 : 2) * scale;
  const blink = Math.floor(frame / (tall ? 68 : 74)) % 14 === 0;
  const cheekColor = Math.sin(frame / 8) > 0 ? "#ff6274" : "#ff7a86";

  ctx.save();
  ctx.translate(bodyCx + 8 * scale, bodyCy - 2 * scale);
  ctx.rotate(-0.35);
  const tail = ctx.createLinearGradient(0, -18 * scale, 0, 20 * scale);
  tail.addColorStop(0, "#fff2a0");
  tail.addColorStop(0.55, "#ffd84f");
  tail.addColorStop(1, "#b87d28");
  ctx.fillStyle = tail;
  ctx.beginPath();
  ctx.moveTo(-3 * scale, 16 * scale);
  ctx.lineTo(4 * scale, 4 * scale);
  ctx.lineTo(0, -8 * scale);
  ctx.lineTo(7 * scale, -18 * scale);
  ctx.lineTo(17 * scale, -13 * scale);
  ctx.lineTo(9 * scale, -2 * scale);
  ctx.lineTo(14 * scale, 10 * scale);
  ctx.lineTo(3 * scale, 15 * scale);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#8f5a1c";
  ctx.fillRect(-2 * scale, 12 * scale, 5 * scale, 5 * scale);
  ctx.restore();

  ctx.fillStyle = "#d99b2f";
  ctx.beginPath();
  ctx.ellipse(bodyCx - 6 * scale, bodyCy - 1 * scale, 3.1 * scale, 5.4 * scale, 0.3, 0, Math.PI * 2);
  ctx.ellipse(bodyCx + 6 * scale, bodyCy - 1 * scale, 3.1 * scale, 5.4 * scale, -0.3, 0, Math.PI * 2);
  ctx.fill();

  const body = ctx.createRadialGradient(bodyCx - 4 * scale, bodyCy - 7 * scale, 3, bodyCx, bodyCy, 18 * scale);
  body.addColorStop(0, "#fff2a4");
  body.addColorStop(0.55, "#ffd74f");
  body.addColorStop(1, "#d89b1f");
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.ellipse(bodyCx, bodyCy, bodyRx, bodyRy, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#ffe98c";
  ctx.beginPath();
  ctx.ellipse(bodyCx - 2 * scale, bodyCy - 5 * scale, bodyRx * 0.6, bodyRy * 0.45, -0.2, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#7a4c16";
  ctx.fillRect(bodyCx - 5.4 * scale, bodyCy + 2 * scale, 2.3 * scale, 6.2 * scale);
  ctx.fillRect(bodyCx - 1.2 * scale, bodyCy, 2.2 * scale, 6.6 * scale);
  ctx.fillRect(bodyCx + 3 * scale, bodyCy + 2 * scale, 2.3 * scale, 6.2 * scale);

  ctx.fillStyle = "#ffd34a";
  ctx.beginPath();
  ctx.ellipse(bodyCx - 5.5 * scale, bodyCy + bodyRy - 2 + legShift, 3.3 * scale, 4.7 * scale, 0.12, 0, Math.PI * 2);
  ctx.ellipse(bodyCx + 5.5 * scale, bodyCy + bodyRy - 2 - legShift, 3.3 * scale, 4.7 * scale, -0.12, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#8f5a1c";
  ctx.beginPath();
  ctx.ellipse(bodyCx - 5.5 * scale, bodyCy + bodyRy + 2 + legShift, 3 * scale, 1.6 * scale, 0, 0, Math.PI * 2);
  ctx.ellipse(bodyCx + 5.5 * scale, bodyCy + bodyRy + 2 - legShift, 3 * scale, 1.6 * scale, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#dba431";
  ctx.beginPath();
  ctx.ellipse(bodyCx - 8.5 * scale, bodyCy + 1 * scale, 2.4 * scale, 4.4 * scale, 0.5, 0, Math.PI * 2);
  ctx.ellipse(bodyCx + 8.5 * scale, bodyCy + 1 * scale, 2.4 * scale, 4.4 * scale, -0.5, 0, Math.PI * 2);
  ctx.fill();

  const head = ctx.createRadialGradient(headCx - 4 * scale, headCy - 4 * scale, 3, headCx, headCy, 18 * scale);
  head.addColorStop(0, "#fff3ac");
  head.addColorStop(0.6, "#ffd74b");
  head.addColorStop(1, "#d3911f");
  ctx.fillStyle = head;
  ctx.beginPath();
  ctx.ellipse(headCx, headCy, headR, headR * 0.98, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.save();
  ctx.translate(headCx - 7.4 * scale, headCy - 9.5 * scale);
  ctx.rotate(-0.22);
  ctx.fillStyle = "#ffd84f";
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(-3.5 * scale, -13 * scale);
  ctx.lineTo(3 * scale, -11.5 * scale);
  ctx.lineTo(5.4 * scale, 1 * scale);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#1c1711";
  ctx.beginPath();
  ctx.moveTo(-2.4 * scale, -9.8 * scale);
  ctx.lineTo(-3.1 * scale, -13.3 * scale);
  ctx.lineTo(2 * scale, -12 * scale);
  ctx.lineTo(2.9 * scale, -8.4 * scale);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.translate(headCx + 7.4 * scale, headCy - 9.4 * scale);
  ctx.rotate(0.22);
  ctx.fillStyle = "#ffd84f";
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(-5.4 * scale, 1 * scale);
  ctx.lineTo(-3 * scale, -11.5 * scale);
  ctx.lineTo(3.5 * scale, -13 * scale);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#1c1711";
  ctx.beginPath();
  ctx.moveTo(-2.9 * scale, -8.4 * scale);
  ctx.lineTo(-2 * scale, -12 * scale);
  ctx.lineTo(3.1 * scale, -13.3 * scale);
  ctx.lineTo(2.4 * scale, -9.8 * scale);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  ctx.fillStyle = cheekColor;
  ctx.beginPath();
  ctx.ellipse(headCx - 7.2 * scale, headCy + 1.8 * scale, 2.6 * scale, 2.3 * scale, 0, 0, Math.PI * 2);
  ctx.ellipse(headCx + 7.2 * scale, headCy + 1.8 * scale, 2.6 * scale, 2.3 * scale, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#1a1209";
  if (blink) {
    ctx.fillRect(headCx - 5.5 * scale, headCy - 3 * scale, 3 * scale, 1.1 * scale);
    ctx.fillRect(headCx + 2.5 * scale, headCy - 3 * scale, 3 * scale, 1.1 * scale);
  } else {
    ctx.beginPath();
    ctx.ellipse(headCx - 4.4 * scale, headCy - 2.6 * scale, 1.6 * scale, 2.6 * scale, 0, 0, Math.PI * 2);
    ctx.ellipse(headCx + 4.4 * scale, headCy - 2.6 * scale, 1.6 * scale, 2.6 * scale, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.ellipse(headCx - 4.9 * scale, headCy - 3.6 * scale, 0.55 * scale, 0.8 * scale, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.fillStyle = "#3b260f";
  ctx.beginPath();
  ctx.ellipse(headCx, headCy + 1.4 * scale, 1.15 * scale, 0.85 * scale, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#5f3915";
  ctx.lineWidth = 1.1;
  ctx.beginPath();
  ctx.arc(headCx, headCy + 2.1 * scale, 2.2 * scale, 0.2, Math.PI - 0.2);
  ctx.stroke();
}

function drawPikaSmall(baseX, baseY, runFrame, airborne) {
  drawPikachuHd(baseX, baseY + 1, "small", runFrame, airborne);
}

function drawPikaBig(baseX, baseY, runFrame, airborne) {
  drawPikachuHd(baseX - 1, baseY + 1, "big", runFrame, airborne);

  if (Math.sin(frame / 5) > 0.2) {
    ctx.fillStyle = "rgba(255,240,157,0.75)";
    ctx.beginPath();
    ctx.ellipse(baseX - 2, baseY + 22, 1.3, 1.3, 0, 0, Math.PI * 2);
    ctx.ellipse(baseX + 25, baseY + 27, 1.3, 1.3, 0, 0, Math.PI * 2);
    ctx.ellipse(baseX + 22, baseY + 14, 1.1, 1.1, 0, 0, Math.PI * 2);
    ctx.fill();
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
