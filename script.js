// ============================================================
// Zombie Survival — vanilla JS game logic
// Coordinate system: all positions are PERCENTAGES (0-100) of
// the #gameArea box, so the whole game scales responsively
// without any extra resize math.
// ============================================================

// ---- Prevent arrow keys / space from scrolling the page ----
document.addEventListener("keydown", (event) => {
  if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", " "].includes(event.key)) {
    event.preventDefault();
  }
});

// ---- Level configuration ----
function getLevelConfig(level) {
  if (level <= 1) return { zombies: 5, speed: 10, time: 60, walls: 2, startAmmo: 10 };
  if (level === 2) return { zombies: 8, speed: 13, time: 60, walls: 3, startAmmo: 9 };
  if (level === 3) return { zombies: 12, speed: 16, time: 60, walls: 4, startAmmo: 8 };
  const extra = level - 3;
  return {
    zombies: 12 + extra * 3,
    speed: 16 + extra * 2,
    time: 60,
    walls: Math.min(4 + extra, 8),
    startAmmo: Math.max(6, 8 - extra),
  };
}

// ---- Central game state ----
const gameState = {
  level: 1,
  hp: 100,
  ammo: 10,
  score: 0,
  zombies: [],
  bullets: [],
  items: [],
  walls: [],
  zombiesToDefeat: 5,
  player: { x: 50, y: 50, facing: "right", invincibleUntil: 0 },
  gameRunning: false,
  gameOver: false,
  gameWon: false,
  timeLeft: 60,
};

const keysPressed = new Set();
let nextEntityId = 1;
let rafId = null;
let timerIntervalId = null;
let itemIntervalId = null;
let lastFrameTime = 0;

const PLAYER_SPEED = 28; // % of width per second
const BULLET_SPEED = 70; // % per second
const PLAYER_RADIUS = 3.2;
const ZOMBIE_RADIUS = 3.2;
const ITEM_RADIUS = 3.2;
const BULLET_RADIUS = 1.2;
const INVINCIBLE_MS = 800;

// ---- DOM references ----
const el = {
  gameArea: document.getElementById("gameArea"),
  hudLevel: document.getElementById("hudLevel"),
  hudHp: document.getElementById("hudHp"),
  hpBar: document.getElementById("hpBar"),
  hudAmmo: document.getElementById("hudAmmo"),
  hudScore: document.getElementById("hudScore"),
  hudZombies: document.getElementById("hudZombies"),
  hudTime: document.getElementById("hudTime"),
  statusMessage: document.getElementById("statusMessage"),
  startOverlay: document.getElementById("startOverlay"),
  winOverlay: document.getElementById("winOverlay"),
  gameOverOverlay: document.getElementById("gameOverOverlay"),
  startBtn: document.getElementById("startBtn"),
  nextLevelBtn: document.getElementById("nextLevelBtn"),
  restartFromWinBtn: document.getElementById("restartFromWinBtn"),
  restartFromLoseBtn: document.getElementById("restartFromLoseBtn"),
  restartBtn: document.getElementById("restartBtn"),
  increaseLevelBtn: document.getElementById("increaseLevelBtn"),
  howToPlayBtn: document.getElementById("howToPlayBtn"),
  howToPlayDialog: document.getElementById("howToPlayDialog"),
  closeHowToPlayBtn: document.getElementById("closeHowToPlayBtn"),
  darkModeToggle: document.getElementById("darkModeToggle"),
  shootBtnMobile: document.getElementById("shootBtnMobile"),
};

// ============================================================
// Level / map setup
// ============================================================

function buildWalls(count) {
  const walls = [];
  let attempts = 0;
  while (walls.length < count && attempts < 200) {
    attempts++;
    const w = 10 + Math.random() * 8;
    const h = 4 + Math.random() * 6;
    const x = 5 + Math.random() * (90 - w);
    const y = 5 + Math.random() * (90 - h);
    // keep a safe zone clear around the player's spawn point (50,50)
    const overlapsSafeZone = x < 65 && x + w > 35 && y < 65 && y + h > 35;
    const overlapsOther = walls.some(
      (wall) => x < wall.x + wall.w + 3 && x + w + 3 > wall.x && y < wall.y + wall.h + 3 && y + h + 3 > wall.y
    );
    if (!overlapsSafeZone && !overlapsOther) {
      walls.push({ x, y, w, h });
    }
  }
  return walls;
}

function randomEdgePosition() {
  const edge = Math.floor(Math.random() * 4);
  if (edge === 0) return { x: 3 + Math.random() * 94, y: 3 };
  if (edge === 1) return { x: 3 + Math.random() * 94, y: 97 };
  if (edge === 2) return { x: 3, y: 3 + Math.random() * 94 };
  return { x: 97, y: 3 + Math.random() * 94 };
}

function spawnZombie(speed) {
  const pos = randomEdgePosition();
  gameState.zombies.push({
    id: nextEntityId++,
    x: pos.x,
    y: pos.y,
    hp: 1,
    speed: speed * (0.85 + Math.random() * 0.3),
  });
}

function positionIsInsideAnyWall(x, y, margin) {
  return gameState.walls.some(
    (wall) => x > wall.x - margin && x < wall.x + wall.w + margin && y > wall.y - margin && y < wall.y + wall.h + margin
  );
}

function randomFreePosition() {
  let x, y, attempts = 0;
  do {
    x = 8 + Math.random() * 84;
    y = 8 + Math.random() * 84;
    attempts++;
  } while (positionIsInsideAnyWall(x, y, 4) && attempts < 50);
  return { x, y };
}

function spawnItems(count) {
  const types = ["ammo", "health", "coin"];
  for (let i = 0; i < count; i++) {
    if (gameState.items.length >= 8) break;
    const type = types[Math.floor(Math.random() * types.length)];
    const pos = randomFreePosition();
    gameState.items.push({ id: nextEntityId++, type, x: pos.x, y: pos.y });
  }
}

function initLevel(level) {
  const config = getLevelConfig(level);
  gameState.level = level;
  gameState.ammo = config.startAmmo;
  gameState.timeLeft = config.time;
  gameState.zombiesToDefeat = config.zombies;
  gameState.walls = buildWalls(config.walls);
  gameState.zombies = [];
  gameState.bullets = [];
  gameState.items = [];
  gameState.player.x = 50;
  gameState.player.y = 50;
  gameState.player.facing = "right";
  gameState.player.invincibleUntil = 0;

  for (let i = 0; i < config.zombies; i++) spawnZombie(config.speed);
  spawnItems(5);

  renderWalls();
  updateHUD();
}

function renderWalls() {
  el.gameArea.querySelectorAll(".wall-block").forEach((n) => n.remove());
  gameState.walls.forEach((wall) => {
    const div = document.createElement("div");
    div.className =
      "wall-block absolute bg-neutral-600 dark:bg-neutral-700 border-2 border-neutral-900 forced-colors:border forced-colors:bg-[GrayText]";
    div.style.left = wall.x + "%";
    div.style.top = wall.y + "%";
    div.style.width = wall.w + "%";
    div.style.height = wall.h + "%";
    el.gameArea.appendChild(div);
  });
  if (!el.gameArea.querySelector("#dynamicLayer")) {
    const layer = document.createElement("div");
    layer.id = "dynamicLayer";
    layer.className = "absolute inset-0";
    el.gameArea.appendChild(layer);
  }
}

// ============================================================
// Game flow: start / reset / restart / level up
// ============================================================

function startGame() {
  el.startOverlay.classList.add("hidden");
  gameState.gameRunning = true;
  gameState.gameOver = false;
  gameState.gameWon = false;
  updateStatus("🧟 ระวังตัว! ซอมบี้กำลังมา...");
  startTimer();
  startItemReplenish();
  lastFrameTime = performance.now();
  rafId = requestAnimationFrame(gameLoop);
}

function resetGame() {
  stopLoops();
  el.winOverlay.classList.add("hidden");
  el.winOverlay.classList.remove("flex");
  el.gameOverOverlay.classList.add("hidden");
  el.gameOverOverlay.classList.remove("flex");
  gameState.score = 0;
  gameState.hp = 100;
  initLevel(1);
  el.startOverlay.classList.remove("hidden");
  updateStatus("พร้อมเริ่มเกม! กด \"เริ่มเกม\" เพื่อเข้าสู่สนามรบ");
  updateHUD();
}

function restartGame() {
  resetGame();
  startGame();
}

function increaseLevel() {
  el.winOverlay.classList.add("hidden");
  el.winOverlay.classList.remove("flex");
  stopLoops();
  initLevel(gameState.level + 1);
  gameState.gameRunning = true;
  gameState.gameOver = false;
  gameState.gameWon = false;
  updateStatus(`⬆️ เข้าสู่ Level ${gameState.level}! ระวังให้ดี ซอมบี้เยอะขึ้นแล้ว`);
  startTimer();
  startItemReplenish();
  lastFrameTime = performance.now();
  rafId = requestAnimationFrame(gameLoop);
}

function stopLoops() {
  if (rafId !== null) cancelAnimationFrame(rafId);
  if (timerIntervalId !== null) clearInterval(timerIntervalId);
  if (itemIntervalId !== null) clearInterval(itemIntervalId);
  rafId = null;
  timerIntervalId = null;
  itemIntervalId = null;
}

function startTimer() {
  if (timerIntervalId !== null) clearInterval(timerIntervalId);
  timerIntervalId = setInterval(() => {
    if (!gameState.gameRunning) return;
    gameState.timeLeft -= 1;
    if (gameState.timeLeft <= 0) {
      gameState.timeLeft = 0;
      updateHUD();
      checkGameOver();
    } else {
      updateHUD();
    }
  }, 1000);
}

function startItemReplenish() {
  if (itemIntervalId !== null) clearInterval(itemIntervalId);
  itemIntervalId = setInterval(() => {
    if (!gameState.gameRunning) return;
    if (gameState.items.length < 4) spawnItems(2);
  }, 9000);
}

// ============================================================
// Main loop
// ============================================================

function gameLoop(timestamp) {
  if (!gameState.gameRunning) return;
  const dt = Math.min((timestamp - lastFrameTime) / 1000, 0.05);
  lastFrameTime = timestamp;

  movePlayer(dt);
  updateBullets(dt);
  updateZombies(dt);
  checkCollisions();
  render();

  rafId = requestAnimationFrame(gameLoop);
}

// ============================================================
// Player movement
// ============================================================

function movePlayer(dt) {
  let dx = 0;
  let dy = 0;
  if (keysPressed.has("w") || keysPressed.has("arrowup")) dy -= 1;
  if (keysPressed.has("s") || keysPressed.has("arrowdown")) dy += 1;
  if (keysPressed.has("a") || keysPressed.has("arrowleft")) dx -= 1;
  if (keysPressed.has("d") || keysPressed.has("arrowright")) dx += 1;

  if (dx === 0 && dy === 0) return;

  const len = Math.hypot(dx, dy);
  dx /= len;
  dy /= len;

  if (Math.abs(dx) >= Math.abs(dy)) {
    gameState.player.facing = dx > 0 ? "right" : "left";
  } else {
    gameState.player.facing = dy > 0 ? "down" : "up";
  }

  const step = PLAYER_SPEED * dt;
  const nextX = gameState.player.x + dx * step;
  const nextY = gameState.player.y + dy * step;

  if (!collidesWithWall(nextX, gameState.player.y, PLAYER_RADIUS)) {
    gameState.player.x = clamp(nextX, 2, 98);
  }
  if (!collidesWithWall(gameState.player.x, nextY, PLAYER_RADIUS)) {
    gameState.player.y = clamp(nextY, 2, 98);
  }
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function collidesWithWall(x, y, radius) {
  return gameState.walls.some(
    (wall) =>
      x + radius > wall.x && x - radius < wall.x + wall.w && y + radius > wall.y && y - radius < wall.y + wall.h
  );
}

// ============================================================
// Shooting
// ============================================================

function shoot() {
  if (!gameState.gameRunning) return;
  if (gameState.ammo <= 0) {
    updateStatus("กระสุนหมด! หา Ammo เพิ่ม");
    return;
  }
  const dirMap = {
    right: { dx: 1, dy: 0 },
    left: { dx: -1, dy: 0 },
    up: { dx: 0, dy: -1 },
    down: { dx: 0, dy: 1 },
  };
  const dir = dirMap[gameState.player.facing];
  gameState.bullets.push({
    id: nextEntityId++,
    x: gameState.player.x,
    y: gameState.player.y,
    dx: dir.dx,
    dy: dir.dy,
  });
  gameState.ammo -= 1;
  updateHUD();
}

function updateBullets(dt) {
  const step = BULLET_SPEED * dt;
  gameState.bullets = gameState.bullets.filter((bullet) => {
    bullet.x += bullet.dx * step;
    bullet.y += bullet.dy * step;
    if (bullet.x < 0 || bullet.x > 100 || bullet.y < 0 || bullet.y > 100) return false;
    if (collidesWithWall(bullet.x, bullet.y, BULLET_RADIUS)) return false;
    return true;
  });
}

// ============================================================
// Zombies
// ============================================================

function updateZombies(dt) {
  gameState.zombies.forEach((zombie) => {
    const toX = gameState.player.x - zombie.x;
    const toY = gameState.player.y - zombie.y;
    const dist = Math.hypot(toX, toY) || 1;
    const step = zombie.speed * dt;
    zombie.x += (toX / dist) * step;
    zombie.y += (toY / dist) * step;
  });
}

// ============================================================
// Collision detection (dispatcher)
// ============================================================

function checkCollisions() {
  checkPlayerZombieCollisions();
  checkBulletZombieCollisions();
  checkPlayerItemCollisions();
}

function checkPlayerZombieCollisions() {
  const now = performance.now();
  const touching = gameState.zombies.some(
    (zombie) => Math.hypot(zombie.x - gameState.player.x, zombie.y - gameState.player.y) < PLAYER_RADIUS + ZOMBIE_RADIUS
  );
  if (touching && now > gameState.player.invincibleUntil) {
    takeDamage(15);
    gameState.player.invincibleUntil = now + INVINCIBLE_MS;
    updateStatus("⚠️ Zombie กำลังโจมตี!");
  }
}

function checkBulletZombieCollisions() {
  const survivingBullets = [];
  let killedThisFrame = 0;
  gameState.bullets.forEach((bullet) => {
    let hit = false;
    gameState.zombies = gameState.zombies.filter((zombie) => {
      if (!hit && Math.hypot(zombie.x - bullet.x, zombie.y - bullet.y) < ZOMBIE_RADIUS + BULLET_RADIUS) {
        hit = true;
        killedThisFrame++;
        return false;
      }
      return true;
    });
    if (!hit) survivingBullets.push(bullet);
  });
  gameState.bullets = survivingBullets;
  if (killedThisFrame > 0) {
    gameState.score += 10 * killedThisFrame;
    updateStatus("🔫 ยิง Zombie สำเร็จ!");
    updateHUD();
    checkWin();
  }
}

function checkPlayerItemCollisions() {
  const remaining = [];
  gameState.items.forEach((item) => {
    const dist = Math.hypot(item.x - gameState.player.x, item.y - gameState.player.y);
    if (dist < PLAYER_RADIUS + ITEM_RADIUS) {
      collectItem(item);
    } else {
      remaining.push(item);
    }
  });
  gameState.items = remaining;
}

function collectItem(item) {
  if (item.type === "ammo") {
    gameState.ammo += 5;
    updateStatus("🔫 ได้รับกระสุน +5");
  } else if (item.type === "health") {
    gameState.hp = Math.min(100, gameState.hp + 20);
    updateStatus("❤️ ได้รับ Health Pack +20");
  } else if (item.type === "coin") {
    gameState.score += 10;
    updateStatus("⭐ ได้รับ Coin +10");
  }
  updateHUD();
}

// ============================================================
// Damage / win / lose
// ============================================================

function takeDamage(amount) {
  gameState.hp = Math.max(0, gameState.hp - amount);
  updateHUD();
  if (gameState.hp <= 5 && gameState.hp > 0) {
    updateStatus("⚠️ HP เหลือน้อย!");
  }
  checkGameOver();
}

function checkWin() {
  if (gameState.gameOver || gameState.gameWon) return;
  if (gameState.zombies.length === 0) {
    gameState.gameWon = true;
    gameState.gameRunning = false;
    stopLoops();
    updateStatus("🎉 คุณรอดชีวิต!");
    el.winOverlay.classList.remove("hidden");
    el.winOverlay.classList.add("flex");
  }
}

function checkGameOver() {
  if (gameState.gameOver || gameState.gameWon) return;
  if (gameState.hp <= 0 || gameState.timeLeft <= 0) {
    gameState.gameOver = true;
    gameState.gameRunning = false;
    stopLoops();
    updateStatus("💀 Game Over");
    el.gameOverOverlay.classList.remove("hidden");
    el.gameOverOverlay.classList.add("flex");
  }
}

// ============================================================
// Rendering
// ============================================================

function render() {
  const layer = document.getElementById("dynamicLayer");
  if (!layer) return;

  let html = "";

  html += `<div class="entity absolute text-2xl -translate-x-1/2 -translate-y-1/2" style="left:${gameState.player.x}%; top:${gameState.player.y}%;" aria-hidden="true">🧑</div>`;

  gameState.zombies.forEach((z) => {
    html += `<div class="entity absolute text-2xl -translate-x-1/2 -translate-y-1/2" style="left:${z.x}%; top:${z.y}%;" aria-hidden="true">🧟</div>`;
  });

  gameState.bullets.forEach((b) => {
    html += `<div class="entity absolute text-sm -translate-x-1/2 -translate-y-1/2" style="left:${b.x}%; top:${b.y}%;" aria-hidden="true">•</div>`;
  });

  gameState.items.forEach((item) => {
    const icon = item.type === "ammo" ? "🔫" : item.type === "health" ? "❤️" : "💰";
    html += `<div class="entity absolute text-xl -translate-x-1/2 -translate-y-1/2" style="left:${item.x}%; top:${item.y}%;" aria-hidden="true">${icon}</div>`;
  });

  layer.innerHTML = html;
}

// ============================================================
// HUD / status
// ============================================================

function updateHUD() {
  el.hudLevel.textContent = gameState.level;
  el.hudHp.textContent = gameState.hp;
  el.hudAmmo.textContent = gameState.ammo;
  el.hudScore.textContent = gameState.score;
  el.hudZombies.textContent = gameState.zombies.length;
  el.hudTime.textContent = gameState.timeLeft;

  el.hpBar.style.width = gameState.hp + "%";
  el.hpBar.classList.remove("bg-green-500", "bg-yellow-500", "bg-red-500");
  if (gameState.hp > 60) {
    el.hpBar.classList.add("bg-green-500");
  } else if (gameState.hp > 30) {
    el.hpBar.classList.add("bg-yellow-500");
  } else {
    el.hpBar.classList.add("bg-red-500");
  }
}

function updateStatus(message) {
  el.statusMessage.textContent = message;
}

// ============================================================
// How-to-play dialog
// ============================================================

function showHowToPlay() {
  el.howToPlayDialog.showModal();
}

function closeHowToPlay() {
  el.howToPlayDialog.close();
}

// ============================================================
// Dark mode
// ============================================================

function toggleDarkMode() {
  const isDark = document.documentElement.classList.toggle("dark");
  localStorage.setItem("zombieSurvivalDarkMode", isDark ? "1" : "0");
  el.darkModeToggle.textContent = isDark ? "☀️" : "🌙";
}

function applyStoredDarkModePreference() {
  const stored = localStorage.getItem("zombieSurvivalDarkMode");
  const prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  const shouldBeDark = stored === "1" || (stored === null && prefersDark);
  document.documentElement.classList.toggle("dark", shouldBeDark);
  el.darkModeToggle.textContent = shouldBeDark ? "☀️" : "🌙";
}

// ============================================================
// Input wiring
// ============================================================

document.addEventListener("keydown", (event) => {
  const key = event.key.toLowerCase();
  if (["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(key)) {
    keysPressed.add(key);
  }
  if (key === " " && !event.repeat) {
    shoot();
  }
  if (key === "r" && !event.repeat) {
    restartGame();
  }
});

document.addEventListener("keyup", (event) => {
  const key = event.key.toLowerCase();
  keysPressed.delete(key);
});

// Mobile D-pad: press-and-hold support via pointer events
document.querySelectorAll(".dpad-btn").forEach((btn) => {
  const dirKeyMap = { up: "arrowup", down: "arrowdown", left: "arrowleft", right: "arrowright" };
  const key = dirKeyMap[btn.dataset.dir];
  btn.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    keysPressed.add(key);
  });
  const release = () => keysPressed.delete(key);
  btn.addEventListener("pointerup", release);
  btn.addEventListener("pointerleave", release);
  btn.addEventListener("pointercancel", release);
});

el.shootBtnMobile.addEventListener("click", () => shoot());

el.startBtn.addEventListener("click", () => startGame());
el.restartBtn.addEventListener("click", () => restartGame());
el.restartFromWinBtn.addEventListener("click", () => restartGame());
el.restartFromLoseBtn.addEventListener("click", () => restartGame());
el.nextLevelBtn.addEventListener("click", () => increaseLevel());
el.increaseLevelBtn.addEventListener("click", () => increaseLevel());
el.howToPlayBtn.addEventListener("click", () => showHowToPlay());
el.closeHowToPlayBtn.addEventListener("click", () => closeHowToPlay());
el.darkModeToggle.addEventListener("click", () => toggleDarkMode());

// ============================================================
// Boot
// ============================================================

applyStoredDarkModePreference();
initLevel(1);
updateHUD();
