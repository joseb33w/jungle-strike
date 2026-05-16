// =============================================================
// Jungle Strike — Game Engine
// Self-contained: only imports `three`, `./worlds.js`, `./characters.js`,
// and `./sound.js`. Auth/Supabase come from window globals set by index.html.
// =============================================================
import * as THREE from 'three';
import { buildWorld } from './worlds.js';
import { buildHumanoid, animateHumanoid } from './characters.js';
import { sound } from './sound.js';

// ---- Auth bridge (set by index.html inline script) ----
const Auth = window.__JUNGLE_AUTH_BRIDGE || {
  user: null,
  profile: { equipped_weapon: 'pistol', coins: 0, kills_total: 0, missions_completed: 0 },
  saveProfile: async () => {},
};

// ---- Supabase global (loaded as UMD by index.html) ----
function getSupabase() {
  if (!window.supabase || !window.supabase.createClient) return null;
  if (!window.__JUNGLE_SUPA) {
    window.__JUNGLE_SUPA = window.supabase.createClient(
      'https://xhhmxabftbyxrirvvihn.supabase.co',
      'sb_publishable_NZHoIxqqpSvVBP8MrLHCYA_gmg1AbN-'
    );
  }
  return window.__JUNGLE_SUPA;
}

const TABLES = {
  worldPlayers: 'uNMexs7BYTXQ2_jungle_strike_world_players',
  missionRuns:  'uNMexs7BYTXQ2_jungle_strike_mission_runs',
};

// ---- Inlined game data ----
const WEAPONS = {
  pistol:  { id: 'pistol',  name: 'Sidearm M9',   icon: '🔫', cost: 0,    damage: 22,  fireRate: 380, magazine: 12, reserve: 60,  reload: 1100, spread: 0.012, range: 80,  auto: false },
  shotgun: { id: 'shotgun', name: 'Boar Buster',  icon: '💥', cost: 350,  damage: 18,  fireRate: 700, magazine: 6,  reserve: 24,  reload: 1500, spread: 0.08,  range: 35,  auto: false, pellets: 6 },
  rifle:   { id: 'rifle',   name: 'Canopy AR-15', icon: '🎯', cost: 600,  damage: 28,  fireRate: 110, magazine: 30, reserve: 120, reload: 1700, spread: 0.018, range: 120, auto: true },
  sniper:  { id: 'sniper',  name: 'Vine Hunter',  icon: '🪶', cost: 1100, damage: 110, fireRate: 1000,magazine: 5,  reserve: 20,  reload: 2200, spread: 0.003, range: 240, auto: false },
  rocket:  { id: 'rocket',  name: 'Howler RPG',   icon: '🚀', cost: 2200, damage: 180, fireRate: 1400,magazine: 1,  reserve: 6,   reload: 2600, spread: 0.005, range: 160, auto: false, splash: 6 },
};

const MISSION_CONFIGS = {
  recon:    { enemyHealth: 60, enemySpeed: 1.6, rewardPerKill: 12, enemyPreset: 'enemy' },
  boss:     { enemyHealth: 75, enemySpeed: 1.9, rewardPerKill: 18, enemyPreset: 'cartel', boss: { health: 600, damage: 22, speed: 1.8 } },
  survival: { waves: [
    { count: 6, health: 50, speed: 1.6 },
    { count: 9, health: 70, speed: 1.9 },
    { count: 12, health: 90, speed: 2.2 },
  ], rewardPerKill: 15, enemyPreset: 'enemy' },
};

const WORLD_CONFIG = {
  enemyBots: 6, botHealth: 70, botSpeed: 1.5,
  rewardPerBotKill: 8, rewardPerPlayerKill: 30,
  enemyPreset: 'cartel',
};

// =============================================================
// Engine state
// =============================================================
let renderer, scene, camera, clock;
let player, weaponMesh, muzzleFlash;
let enemies = [], obstacles = [], remoteMeshes = new Map();
let bullets = [];
let worldProps = null;
let ambient = null;
let canvas;

let gameState = null;
let onExit = null;
let raf = null;
let worldChannel = null;
let worldSyncInterval = null;
let stepTimer = 0;

const keys = {};
const mouse = { dx: 0, dy: 0, locked: false, fireDown: false };
const moveStick = { pointerId: null, cx: 0, cy: 0, dx: 0, dy: 0 };
const lookStick = { pointerId: null, cx: 0, cy: 0, dx: 0, dy: 0 };
const stickListeners = [];

const tmpVec = new THREE.Vector3();
const tmpDir = new THREE.Vector3();
const ARENA = 80;

// =============================================================
// PUBLIC API
// =============================================================
export function startMission(mission, exitCallback) {
  onExit = exitCallback;
  showGameScreen();
  setupRenderer();
  initSound();
  const world = buildWorld(scene, mission.id);
  obstacles = world.obstacles;
  worldProps = world.props;
  ambient = world.ambient;
  initPlayer();

  const cfg = MISSION_CONFIGS[mission.id] || MISSION_CONFIGS.recon;
  const equippedWeapon = Auth.profile?.equipped_weapon || 'pistol';
  const weapon = WEAPONS[equippedWeapon] || WEAPONS.pistol;

  gameState = {
    mode: 'mission',
    mission: { ...mission, ...cfg },
    kills: 0,
    coinsEarned: 0,
    startTime: performance.now(),
    health: 100,
    maxHealth: 100,
    weapon: { ...weapon },
    ammo: weapon.magazine,
    reserve: weapon.reserve,
    reloading: false,
    lastShot: 0,
    over: false,
    waveIndex: 0,
    bossSpawned: false,
    bossDefeated: false,
    spawnInvulnUntil: performance.now() + 1500,
    captureProgress: 0,
    enemyPreset: cfg.enemyPreset || 'enemy',
  };

  buildWeaponView();
  setMissionHUD(mission);
  if (mission.id === 'survival') {
    spawnWave(cfg.waves[0]);
    setObjective(`Wave 1 of ${cfg.waves.length} — Hold the line`);
  } else if (mission.id === 'boss') {
    spawnEnemies(mission.enemies, cfg.enemyHealth, cfg.enemySpeed);
    setObjective(`Take out the guards · ${mission.enemies} left`);
  } else {
    spawnEnemies(mission.enemies, cfg.enemyHealth, cfg.enemySpeed);
    setObjective(`Enemies left: ${mission.enemies}`);
  }

  attachInput();
  startLoop();
}

export function startWorld(exitCallback) {
  onExit = exitCallback;
  showGameScreen();
  setupRenderer();
  initSound();
  const world = buildWorld(scene, 'world');
  obstacles = world.obstacles;
  worldProps = world.props;
  ambient = world.ambient;
  initPlayer();

  const equippedWeapon = Auth.profile?.equipped_weapon || 'pistol';
  const weapon = WEAPONS[equippedWeapon] || WEAPONS.pistol;

  gameState = {
    mode: 'world',
    kills: 0,
    coinsEarned: 0,
    startTime: performance.now(),
    health: 100,
    maxHealth: 100,
    weapon: { ...weapon },
    ammo: weapon.magazine,
    reserve: weapon.reserve,
    reloading: false,
    lastShot: 0,
    over: false,
    spawnInvulnUntil: performance.now() + 1500,
    captureProgress: 0,
    enemyPreset: WORLD_CONFIG.enemyPreset,
  };

  buildWeaponView();
  setMissionHUD({ name: 'Open World', objective: 'Take out enemies and capture the flag' });
  setObjective('Capture the flag at center for bonus coins!');
  spawnEnemies(WORLD_CONFIG.enemyBots, WORLD_CONFIG.botHealth, WORLD_CONFIG.botSpeed);

  attachInput();
  subscribeWorld();
  startLoop();
}

function initSound() {
  sound.ensureContext();
  sound.resume();
  sound.unlock();
  sound.startAmbient();
}

function showGameScreen() {
  document.getElementById('lobbyScreen').classList.remove('active');
  document.getElementById('authScreen').classList.remove('active');
  document.getElementById('gameScreen').classList.add('active');
  document.getElementById('gameOverlay').classList.add('hidden');
  document.body.classList.add('game-active');
}

function setupRenderer() {
  canvas = document.getElementById('gameCanvas');
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.1, 400);
  camera.position.set(0, 1.7, 0);

  clock = new THREE.Clock();
  window.addEventListener('resize', onResize);
}

function onResize() {
  if (!renderer) return;
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
}

function initPlayer() {
  player = {
    pos: new THREE.Vector3(0, 1.7, 0),
    vel: new THREE.Vector3(),
    yaw: 0, pitch: 0,
    radius: 0.5,
    speed: 7,
    sprintMul: 1.4,
  };
}

function buildWeaponView() {
  if (weaponMesh) camera.remove(weaponMesh);
  const wg = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x222020, roughness: 0.35, metalness: 0.7 });
  const accentMat = new THREE.MeshStandardMaterial({ color: 0x3a3a3a, roughness: 0.3, metalness: 0.8 });
  const w = gameState.weapon;

  // Hands gripping weapon (first-person view)
  const handMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.7 });
  const skinMat = new THREE.MeshStandardMaterial({ color: 0xc9a37c, roughness: 0.7 });
  const sleeveMat = new THREE.MeshStandardMaterial({ color: 0x3d5a2a, roughness: 0.9 });

  if (w.id === 'shotgun') {
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.14, 0.7), bodyMat);
    body.position.set(0.28, -0.28, -0.55); wg.add(body);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.6, 12), accentMat);
    barrel.rotation.x = Math.PI / 2; barrel.position.set(0.28, -0.21, -0.95); wg.add(barrel);
    const pump = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.08, 0.18), bodyMat);
    pump.position.set(0.28, -0.27, -0.78); wg.add(pump);
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.13, 0.28), new THREE.MeshStandardMaterial({ color: 0x3a2010, roughness: 0.8 }));
    stock.position.set(0.28, -0.3, -0.16); wg.add(stock);
  } else if (w.id === 'sniper') {
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.12, 0.9), bodyMat);
    body.position.set(0.28, -0.28, -0.55); wg.add(body);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.75, 12), accentMat);
    barrel.rotation.x = Math.PI / 2; barrel.position.set(0.28, -0.22, -1.05); wg.add(barrel);
    const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.2, 12), new THREE.MeshStandardMaterial({ color: 0x0a0a0a, roughness: 0.3, metal: 0.7 }));
    scope.rotation.x = Math.PI / 2; scope.position.set(0.28, -0.15, -0.55); wg.add(scope);
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.13, 0.32), new THREE.MeshStandardMaterial({ color: 0x2a1a0a, roughness: 0.8 }));
    stock.position.set(0.28, -0.32, -0.06); wg.add(stock);
  } else if (w.id === 'rocket') {
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 1.0, 16), new THREE.MeshStandardMaterial({ color: 0x4a4a2a, roughness: 0.7 }));
    tube.rotation.x = Math.PI / 2; tube.position.set(0.28, -0.22, -0.65); wg.add(tube);
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.18, 0.1), bodyMat);
    grip.position.set(0.28, -0.38, -0.35); wg.add(grip);
    const sight = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.06), accentMat);
    sight.position.set(0.28, -0.05, -0.45); wg.add(sight);
  } else if (w.id === 'rifle') {
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.12, 0.7), bodyMat);
    body.position.set(0.28, -0.28, -0.5); wg.add(body);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.038, 0.038, 0.55, 12), accentMat);
    barrel.rotation.x = Math.PI / 2; barrel.position.set(0.28, -0.22, -0.95); wg.add(barrel);
    const mag = new THREE.Mesh(new THREE.BoxGeometry(0.065, 0.18, 0.1), new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.5 }));
    mag.position.set(0.28, -0.42, -0.45); wg.add(mag);
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.1, 0.24), new THREE.MeshStandardMaterial({ color: 0x2a1a0a, roughness: 0.8 }));
    stock.position.set(0.28, -0.28, -0.05); wg.add(stock);
    const sight = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.06, 0.04), accentMat);
    sight.position.set(0.28, -0.14, -0.55); wg.add(sight);
  } else {
    // pistol
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.14, 0.28), bodyMat);
    body.position.set(0.32, -0.28, -0.45); wg.add(body);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.22, 10), accentMat);
    barrel.rotation.x = Math.PI / 2; barrel.position.set(0.32, -0.22, -0.6); wg.add(barrel);
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.16, 0.1), bodyMat);
    grip.position.set(0.32, -0.4, -0.36); grip.rotation.x = 0.15; wg.add(grip);
  }

  // First-person hands holding the gun
  const rightForearm = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.06, 0.32, 10), sleeveMat);
  rightForearm.position.set(0.34, -0.46, -0.22);
  rightForearm.rotation.set(-1.0, 0, 0);
  wg.add(rightForearm);
  const rightHand = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.12, 0.08), handMat);
  rightHand.position.set(0.32, -0.4, -0.4);
  wg.add(rightHand);

  const leftForearm = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.06, 0.34, 10), sleeveMat);
  leftForearm.position.set(0.15, -0.42, -0.7);
  leftForearm.rotation.set(-1.3, 0.5, 0);
  wg.add(leftForearm);
  const leftHand = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.1, 0.08), handMat);
  leftHand.position.set(0.22, -0.3, -0.85);
  wg.add(leftHand);

  muzzleFlash = new THREE.Mesh(
    new THREE.SphereGeometry(0.12, 8, 8),
    new THREE.MeshBasicMaterial({ color: 0xffd84d, transparent: true, opacity: 0 })
  );
  // Place flash at end of barrel (rough)
  const muzzlePos = { pistol: -0.75, rifle: -1.25, shotgun: -1.3, sniper: -1.45, rocket: -1.2 };
  muzzleFlash.position.set(0.3, -0.22, muzzlePos[w.id] || -1.25);
  wg.add(muzzleFlash);

  weaponMesh = wg;
  camera.add(weaponMesh);
  if (!scene.children.includes(camera)) scene.add(camera);
}

function spawnEnemies(count, health, speed) {
  for (let i = 0; i < count; i++) spawnEnemy(health, speed);
}

function spawnWave(wave) {
  setObjective(`Wave ${gameState.waveIndex + 1} — ${wave.count} enemies coming`);
  for (let i = 0; i < wave.count; i++) spawnEnemy(wave.health, wave.speed);
}

function spawnEnemy(health, speed, opts = {}) {
  const preset = opts.boss ? 'boss' : (gameState?.enemyPreset || 'enemy');
  const group = buildHumanoid(preset);
  group.userData.basePelvisY = group.userData.rig.pelvis.position.y;

  let x, z, ok = false, tries = 0;
  while (!ok && tries++ < 30) {
    const angle = Math.random() * Math.PI * 2;
    const dist = 18 + Math.random() * 30;
    x = Math.cos(angle) * dist; z = Math.sin(angle) * dist;
    if (Math.hypot(x - player.pos.x, z - player.pos.z) > 12) ok = true;
  }
  group.position.set(x, 0, z);
  scene.add(group);

  if (opts.boss) {
    sound.bossRoar();
  }

  enemies.push({
    mesh: group,
    health: opts.boss ? opts.bossHealth : health,
    maxHealth: opts.boss ? opts.bossHealth : health,
    speed: opts.boss ? opts.bossSpeed : speed,
    boss: !!opts.boss,
    damage: opts.boss ? opts.bossDamage : 8,
    lastShot: 0,
    cooldown: opts.boss ? 700 : 1200,
    radius: group.userData.rig.radius,
    height: group.userData.rig.totalHeight,
    walking: false,
    firing: false,
    fireFlashUntil: 0,
  });
}

function setMissionHUD(mission) {
  const t = document.getElementById('missionTitle');
  const o = document.getElementById('missionObjective');
  if (t) t.textContent = mission.name || 'Open World';
  if (o) o.textContent = mission.objective || '';
}
function setObjective(text) {
  const o = document.getElementById('missionObjective');
  if (o) o.textContent = text;
}

// =============================================================
// INPUT
// =============================================================
function attachInput() {
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  canvas.addEventListener('click', onCanvasClick);
  document.addEventListener('pointerlockchange', onPointerLock);
  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mousedown', onMouseDown);
  document.addEventListener('mouseup', onMouseUp);

  const blockCtx = (e) => e.preventDefault();
  const gs = document.getElementById('gameScreen');
  if (gs) {
    gs.addEventListener('contextmenu', blockCtx);
    stickListeners.push({ el: gs, type: 'contextmenu', fn: blockCtx });
  }

  setupStick(document.getElementById('moveStick'), moveStick);
  setupStick(document.getElementById('lookStick'), lookStick);

  const fireBtn = document.getElementById('fireBtn');
  if (fireBtn) {
    const onFireDown = (e) => { e.preventDefault(); mouse.fireDown = true; tryFire(); };
    const onFireUp   = (e) => { e.preventDefault(); mouse.fireDown = false; };
    fireBtn.addEventListener('pointerdown', onFireDown);
    fireBtn.addEventListener('pointerup', onFireUp);
    fireBtn.addEventListener('pointercancel', onFireUp);
    fireBtn.addEventListener('pointerleave', onFireUp);
    fireBtn.addEventListener('contextmenu', blockCtx);
    stickListeners.push({ el: fireBtn, type: 'pointerdown', fn: onFireDown });
    stickListeners.push({ el: fireBtn, type: 'pointerup', fn: onFireUp });
    stickListeners.push({ el: fireBtn, type: 'pointercancel', fn: onFireUp });
    stickListeners.push({ el: fireBtn, type: 'pointerleave', fn: onFireUp });
    stickListeners.push({ el: fireBtn, type: 'contextmenu', fn: blockCtx });
  }
  const reload = document.getElementById('reloadTBtn');
  if (reload) {
    const onReload = (e) => { e.preventDefault(); reloadWeapon(); };
    reload.addEventListener('pointerdown', onReload);
    reload.addEventListener('contextmenu', blockCtx);
    stickListeners.push({ el: reload, type: 'pointerdown', fn: onReload });
    stickListeners.push({ el: reload, type: 'contextmenu', fn: blockCtx });
  }

  document.getElementById('exitGameBtn').onclick = () => { sound.uiClick(); endGame(false, true); };
  document.getElementById('overlayBack').onclick = () => { sound.uiClick(); returnToBase(); };
}

function setupStick(el, state) {
  if (!el) return;
  const onDown = (e) => {
    if (state.pointerId !== null) return;
    e.preventDefault(); e.stopPropagation();
    const r = el.getBoundingClientRect();
    state.cx = r.left + r.width / 2;
    state.cy = r.top + r.height / 2;
    state.pointerId = e.pointerId;
    try { el.setPointerCapture(e.pointerId); } catch (_) {}
    updateStickPos(el, state, e.clientX, e.clientY);
  };
  const onMove = (e) => {
    if (state.pointerId !== e.pointerId) return;
    e.preventDefault();
    updateStickPos(el, state, e.clientX, e.clientY);
  };
  const onUp = (e) => {
    if (state.pointerId !== e.pointerId) return;
    e.preventDefault();
    state.pointerId = null; state.dx = 0; state.dy = 0;
    try { el.releasePointerCapture(e.pointerId); } catch (_) {}
    const knob = el.querySelector('.stick-knob');
    if (knob) knob.style.transform = 'translate(-50%, -50%)';
  };
  const onCtx = (e) => e.preventDefault();
  const blockTouch = (e) => { e.preventDefault(); };

  el.addEventListener('pointerdown', onDown);
  el.addEventListener('pointermove', onMove);
  el.addEventListener('pointerup', onUp);
  el.addEventListener('pointercancel', onUp);
  el.addEventListener('pointerleave', onUp);
  el.addEventListener('contextmenu', onCtx);
  el.addEventListener('touchstart', blockTouch, { passive: false });
  el.addEventListener('touchmove', blockTouch, { passive: false });
  stickListeners.push({ el, type: 'pointerdown', fn: onDown });
  stickListeners.push({ el, type: 'pointermove', fn: onMove });
  stickListeners.push({ el, type: 'pointerup', fn: onUp });
  stickListeners.push({ el, type: 'pointercancel', fn: onUp });
  stickListeners.push({ el, type: 'pointerleave', fn: onUp });
  stickListeners.push({ el, type: 'contextmenu', fn: onCtx });
  stickListeners.push({ el, type: 'touchstart', fn: blockTouch });
  stickListeners.push({ el, type: 'touchmove', fn: blockTouch });
}

function updateStickPos(el, state, x, y) {
  const dx = x - state.cx, dy = y - state.cy;
  const mag = Math.min(50, Math.hypot(dx, dy));
  const ang = Math.atan2(dy, dx);
  state.dx = Math.cos(ang) * (mag / 50);
  state.dy = Math.sin(ang) * (mag / 50);
  const knob = el.querySelector('.stick-knob');
  if (knob) {
    const kx = Math.cos(ang) * mag, ky = Math.sin(ang) * mag;
    knob.style.transform = `translate(calc(-50% + ${kx}px), calc(-50% + ${ky}px))`;
  }
}

function detachInput() {
  window.removeEventListener('keydown', onKeyDown);
  window.removeEventListener('keyup', onKeyUp);
  if (canvas) { try { canvas.removeEventListener('click', onCanvasClick); } catch (_) {} }
  document.removeEventListener('pointerlockchange', onPointerLock);
  document.removeEventListener('mousemove', onMouseMove);
  document.removeEventListener('mousedown', onMouseDown);
  document.removeEventListener('mouseup', onMouseUp);
  for (const { el, type, fn } of stickListeners) {
    try { el.removeEventListener(type, fn); } catch (_) {}
  }
  stickListeners.length = 0;
  moveStick.pointerId = null; moveStick.dx = 0; moveStick.dy = 0;
  lookStick.pointerId = null; lookStick.dx = 0; lookStick.dy = 0;
  mouse.fireDown = false;
  document.querySelectorAll('#moveStick .stick-knob, #lookStick .stick-knob').forEach(k => {
    k.style.transform = 'translate(-50%, -50%)';
  });
  for (const k of Object.keys(keys)) delete keys[k];
}

function onKeyDown(e) {
  keys[e.code] = true;
  if (e.code === 'KeyR') reloadWeapon();
  if (e.code === 'Escape' && document.pointerLockElement) document.exitPointerLock();
}
function onKeyUp(e) { keys[e.code] = false; }
function onCanvasClick() {
  if (!mouse.locked && canvas && canvas.requestPointerLock) canvas.requestPointerLock();
}
function onPointerLock() { mouse.locked = document.pointerLockElement === canvas; }
function onMouseMove(e) {
  if (!mouse.locked || !player) return;
  player.yaw -= e.movementX * 0.0024;
  player.pitch -= e.movementY * 0.0024;
  player.pitch = Math.max(-1.4, Math.min(1.4, player.pitch));
}
function onMouseDown(e) { if (e.button === 0) { mouse.fireDown = true; tryFire(); } }
function onMouseUp(e)   { if (e.button === 0) mouse.fireDown = false; }

// =============================================================
// MAIN LOOP
// =============================================================
function startLoop() {
  cancelAnimationFrame(raf);
  const tick = () => {
    if (!renderer || !scene || !camera || !gameState) { raf = null; return; }
    raf = requestAnimationFrame(tick);
    const dt = Math.min(0.05, clock.getDelta());
    try {
      update(dt);
      if (ambient) ambient.update(dt);
      renderer.render(scene, camera);
    } catch (err) {
      console.error('Game loop error:', err.message, err.stack);
    }
  };
  tick();
}

function update(dt) {
  if (!gameState || gameState.over) return;

  const lookYawSpeed = 2.4, lookPitchSpeed = 1.8;
  if (lookStick.dx || lookStick.dy) {
    player.yaw -= lookStick.dx * lookYawSpeed * dt;
    player.pitch -= lookStick.dy * lookPitchSpeed * dt;
    player.pitch = Math.max(-1.4, Math.min(1.4, player.pitch));
  }

  const forward = (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0);
  const strafe  = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0);
  const mvF = forward + (-moveStick.dy);
  const mvS = strafe + moveStick.dx;
  const sprint = keys.ShiftLeft || keys.ShiftRight ? player.sprintMul : 1;

  const yawCos = Math.cos(player.yaw), yawSin = Math.sin(player.yaw);
  const wishX = (-yawSin * mvF + yawCos * mvS);
  const wishZ = (-yawCos * mvF - yawSin * mvS);
  const len = Math.hypot(wishX, wishZ) || 1;
  const nx = wishX / len, nz = wishZ / len;
  const moveMag = Math.min(1, Math.hypot(mvF, mvS));

  const dx = nx * player.speed * sprint * moveMag * dt;
  const dz = nz * player.speed * sprint * moveMag * dt;
  const nextX = player.pos.x + dx, nextZ = player.pos.z + dz;
  if (canMoveTo(nextX, player.pos.z)) player.pos.x = nextX;
  if (canMoveTo(player.pos.x, nextZ)) player.pos.z = nextZ;

  const limit = ARENA - 1.5;
  player.pos.x = Math.max(-limit, Math.min(limit, player.pos.x));
  player.pos.z = Math.max(-limit, Math.min(limit, player.pos.z));

  const speed2 = (dx * dx + dz * dz);
  const moving = speed2 > 0.0001;
  const bob = moving ? Math.sin(performance.now() * 0.01) * 0.04 : 0;
  camera.position.set(player.pos.x, player.pos.y + bob, player.pos.z);
  camera.rotation.set(player.pitch, player.yaw, 0, 'YXZ');

  // Footstep sound while moving
  if (moving) {
    stepTimer += dt;
    const stepInterval = sprint > 1 ? 0.28 : 0.42;
    if (stepTimer > stepInterval) { sound.footstep(); stepTimer = 0; }
  } else {
    stepTimer = 0;
  }

  if (weaponMesh) {
    weaponMesh.rotation.x = Math.sin(performance.now() * 0.005) * 0.005 + (gameState.reloading ? -0.5 : 0);
    weaponMesh.position.y = -0.02 + Math.sin(performance.now() * 0.008) * 0.01;
  }
  if (muzzleFlash) muzzleFlash.material.opacity *= 0.82;
  if (mouse.fireDown && gameState.weapon.auto) tryFire();

  for (const b of bullets) {
    b.mesh.position.addScaledVector(b.vel, dt);
    b.life -= dt;
  }
  bullets = bullets.filter(b => {
    if (b.life <= 0) { scene.remove(b.mesh); return false; }
    return true;
  });

  checkPickups();
  if (gameState.mode === 'world' && worldProps?.flags?.length) updateCaptureFlag(dt);

  const now = performance.now();
  for (const e of enemies) {
    if (e.dead) continue;
    const dxe = player.pos.x - e.mesh.position.x;
    const dze = player.pos.z - e.mesh.position.z;
    const dist = Math.hypot(dxe, dze);

    // Smooth body rotation toward player
    const targetYaw = Math.atan2(dxe, dze);
    let curYaw = e.mesh.rotation.y;
    let diff = targetYaw - curYaw;
    while (diff > Math.PI) diff -= 2 * Math.PI;
    while (diff < -Math.PI) diff += 2 * Math.PI;
    e.mesh.rotation.y += diff * Math.min(1, dt * 4);

    let stillWalking = false;
    if (dist > (e.boss ? 8 : 14)) {
      const stepX = (dxe / (dist || 1)) * e.speed * dt;
      const stepZ = (dze / (dist || 1)) * e.speed * dt;
      const nx2 = e.mesh.position.x + stepX, nz2 = e.mesh.position.z + stepZ;
      if (canMoveTo(nx2, e.mesh.position.z, e.radius)) { e.mesh.position.x = nx2; stillWalking = true; }
      if (canMoveTo(e.mesh.position.x, nz2, e.radius)) { e.mesh.position.z = nz2; stillWalking = true; }
    }
    e.walking = stillWalking;

    if (dist < (e.boss ? 30 : 22) && now - e.lastShot > e.cooldown && hasLineOfSight(e.mesh.position, player.pos)) {
      e.lastShot = now;
      enemyShoot(e);
      e.firing = true;
      e.fireFlashUntil = now + 180;
    }
    if (e.firing && now > e.fireFlashUntil) e.firing = false;

    // Animate humanoid rig
    animateHumanoid(e.mesh, dt, { walking: e.walking, firing: e.firing, speed: 6, lookAt: player.pos });
  }

  const aliveEnemies = enemies.filter(e => !e.dead).length;
  if (gameState.mode === 'mission') {
    const m = gameState.mission;
    if (m.id === 'recon') {
      setObjective(`Enemies left: ${aliveEnemies}`);
      if (aliveEnemies === 0) endGame(true);
    } else if (m.id === 'boss') {
      const guardsAlive = enemies.filter(e => !e.dead && !e.boss).length;
      const bossAlive = enemies.find(e => !e.dead && e.boss);
      if (guardsAlive === 0 && !gameState.bossSpawned) {
        gameState.bossSpawned = true;
        spawnEnemy(0, 0, { boss: true, bossHealth: m.boss.health, bossDamage: m.boss.damage, bossSpeed: m.boss.speed });
        setObjective(`⚠️ The warlord is here!`);
      } else if (gameState.bossSpawned && !bossAlive) {
        endGame(true);
      } else if (gameState.bossSpawned) {
        setObjective(`Warlord health: ${Math.max(0, Math.round(bossAlive?.health || 0))}`);
      } else {
        setObjective(`Guards left: ${guardsAlive}`);
      }
    } else if (m.id === 'survival') {
      if (aliveEnemies === 0) {
        gameState.waveIndex += 1;
        if (gameState.waveIndex >= m.waves.length) endGame(true);
        else spawnWave(m.waves[gameState.waveIndex]);
      } else {
        setObjective(`Wave ${gameState.waveIndex + 1}/${m.waves.length} · ${aliveEnemies} enemies left`);
      }
    }
  } else if (gameState.mode === 'world') {
    if (aliveEnemies < 3) spawnEnemy(WORLD_CONFIG.botHealth, WORLD_CONFIG.botSpeed);
  }

  updateHUD();
}

function checkPickups() {
  if (!worldProps) return;
  const now = performance.now();
  for (const c of worldProps.ammoCrates) {
    if (c.used && now < c.cooldownUntil) { if (c.mesh.visible) c.mesh.visible = false; continue; }
    if (c.used && now >= c.cooldownUntil) { c.used = false; c.mesh.visible = true; }
    const d = Math.hypot(player.pos.x - c.x, player.pos.z - c.z);
    if (d < c.radius + 0.6) {
      gameState.reserve = gameState.reserve + gameState.weapon.magazine * 3;
      c.used = true; c.cooldownUntil = now + 15000;
      flashPickup('🔫 Ammo crate picked up');
      sound.pickup();
    }
  }
  for (const m of worldProps.medkits) {
    if (m.used && now < m.cooldownUntil) { if (m.mesh.visible) m.mesh.visible = false; continue; }
    if (m.used && now >= m.cooldownUntil) { m.used = false; m.mesh.visible = true; }
    if (gameState.health >= gameState.maxHealth) continue;
    const d = Math.hypot(player.pos.x - m.x, player.pos.z - m.z);
    if (d < m.radius + 0.6) {
      gameState.health = Math.min(gameState.maxHealth, gameState.health + 50);
      m.used = true; m.cooldownUntil = now + 20000;
      flashPickup('❤️ +50 Health');
      sound.pickup();
    }
  }
}

function updateCaptureFlag(dt) {
  const f = worldProps.flags[0]; if (!f) return;
  const d = Math.hypot(player.pos.x - f.x, player.pos.z - f.z);
  const enemiesNear = enemies.some(e => !e.dead && Math.hypot(e.mesh.position.x - f.x, e.mesh.position.z - f.z) < 6);
  if (d < f.radius && !enemiesNear) {
    gameState.captureProgress = Math.min(100, gameState.captureProgress + dt * 14);
    if (gameState.captureProgress >= 100) {
      gameState.captureProgress = 0;
      gameState.coinsEarned += 50;
      flashPickup('🚩 Flag captured! +50 coins');
      sound.victory();
      const nx = (Math.random() - 0.5) * 50, nz = (Math.random() - 0.5) * 50;
      f.x = nx; f.z = nz; f.mesh.position.set(nx, 0, nz);
    } else {
      setObjective(`🚩 Capturing flag… ${Math.round(gameState.captureProgress)}%`);
    }
  } else if (d < f.radius && enemiesNear) {
    setObjective(`⚠️ Enemies near the flag — clear them out!`);
  } else if (gameState.captureProgress > 0) {
    gameState.captureProgress = Math.max(0, gameState.captureProgress - dt * 8);
  }
}

function flashPickup(text) {
  const feed = document.getElementById('killFeed'); if (!feed) return;
  const item = document.createElement('div');
  item.className = 'feed-item'; item.textContent = text;
  item.style.borderColor = 'rgba(255,200,87,0.6)';
  feed.appendChild(item);
  setTimeout(() => item.remove(), 2000);
}

function canMoveTo(x, z, r = 0.5) {
  for (const o of obstacles) {
    if (o.barrelRef?.exploded) continue;
    if (Math.hypot(x - o.x, z - o.z) < (o.radius + r)) return false;
  }
  return true;
}

function hasLineOfSight(from, to) {
  const dirX = to.x - from.x, dirZ = to.z - from.z;
  const dist = Math.hypot(dirX, dirZ);
  const steps = Math.ceil(dist / 1.5);
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const px = from.x + dirX * t, pz = from.z + dirZ * t;
    for (const o of obstacles) {
      if (o.barrelRef?.exploded) continue;
      if (Math.hypot(px - o.x, pz - o.z) < o.radius) return false;
    }
  }
  return true;
}

function tryFire() {
  if (!gameState || gameState.over || gameState.reloading) return;
  const now = performance.now();
  if (now - gameState.lastShot < gameState.weapon.fireRate) return;
  if (gameState.ammo <= 0) { reloadWeapon(); return; }
  gameState.lastShot = now;
  gameState.ammo -= 1;
  if (muzzleFlash) muzzleFlash.material.opacity = 1;
  const w = gameState.weapon;
  sound.shoot(w.id);
  const pellets = w.pellets || 1;
  for (let i = 0; i < pellets; i++) shootRay(w);
  spawnBulletTracer();
  updateHUD();
  if (gameState.ammo === 0) reloadWeapon();
}

function shootRay(w) {
  tmpDir.set(0, 0, -1).applyEuler(camera.rotation);
  tmpDir.x += (Math.random() - 0.5) * w.spread;
  tmpDir.y += (Math.random() - 0.5) * w.spread;
  tmpDir.z += (Math.random() - 0.5) * w.spread;
  tmpDir.normalize();
  const origin = camera.position.clone();
  let hitEnemy = null, hitDist = Infinity, hitBarrel = null;
  for (const e of enemies) {
    if (e.dead) continue;
    const d = rayHitsEnemy(origin, tmpDir, e);
    if (d != null && d < hitDist && d < w.range) { hitDist = d; hitEnemy = e; hitBarrel = null; }
  }
  if (worldProps?.barrels) {
    for (const b of worldProps.barrels) {
      if (b.exploded) continue;
      const d = rayHitsCylinder(origin, tmpDir, b.x, b.z, 0, 1.5, b.radius);
      if (d != null && d < hitDist && d < w.range) { hitDist = d; hitBarrel = b; hitEnemy = null; }
    }
  }
  if (hitBarrel) { damageBarrel(hitBarrel, w.damage); return; }
  if (hitEnemy) {
    let dmg = w.damage;
    if (w.splash) {
      const explosion = origin.clone().addScaledVector(tmpDir, hitDist);
      sound.explosion();
      for (const e of enemies) {
        if (e.dead) continue;
        const d = e.mesh.position.distanceTo(explosion);
        if (d < w.splash) damageEnemy(e, dmg * (1 - d / w.splash));
      }
      if (worldProps?.barrels) {
        for (const b of worldProps.barrels) {
          if (b.exploded) continue;
          if (Math.hypot(b.x - explosion.x, b.z - explosion.z) < w.splash) damageBarrel(b, dmg);
        }
      }
    } else {
      damageEnemy(hitEnemy, dmg);
    }
  }
}

function rayHitsEnemy(origin, dir, enemy) {
  return rayHitsCylinder(origin, dir, enemy.mesh.position.x, enemy.mesh.position.z, enemy.mesh.position.y, enemy.height, enemy.radius);
}

function rayHitsCylinder(origin, dir, cx, cz, cyBot, cyHeight, cr) {
  const ox = origin.x, oz = origin.z;
  const dx = dir.x, dz = dir.z;
  const a = dx * dx + dz * dz;
  const b = 2 * ((ox - cx) * dx + (oz - cz) * dz);
  const c = (ox - cx) ** 2 + (oz - cz) ** 2 - cr * cr;
  const disc = b * b - 4 * a * c;
  if (disc < 0 || a === 0) return null;
  const t = (-b - Math.sqrt(disc)) / (2 * a);
  if (t <= 0) return null;
  const hitY = origin.y + dir.y * t;
  if (hitY < cyBot || hitY > cyBot + cyHeight) return null;
  return t;
}

function damageEnemy(e, dmg) {
  e.health -= dmg;
  // Flash the humanoid red briefly
  const rig = e.mesh.userData.rig;
  if (rig) {
    const flashTargets = [rig.torso, rig.head];
    flashTargets.forEach(target => {
      target?.traverse?.((obj) => {
        if (obj.isMesh && obj.material?.color) {
          if (!obj.userData.origColor) obj.userData.origColor = obj.material.color.getHex();
          obj.material.color.setHex(0xff5050);
          setTimeout(() => {
            if (obj.userData.origColor !== undefined) obj.material.color.setHex(obj.userData.origColor);
          }, 90);
        }
      });
    });
  }
  if (e.health <= 0 && !e.dead) {
    e.dead = true;
    scene.remove(e.mesh);
    onEnemyKilled(e);
  }
}

function damageBarrel(b, dmg) {
  b.health -= dmg;
  if (b.health <= 0 && !b.exploded) explodeBarrel(b);
}

function explodeBarrel(b) {
  b.exploded = true;
  sound.explosion();
  const flashGeo = new THREE.SphereGeometry(1, 16, 16);
  const flashMat = new THREE.MeshBasicMaterial({ color: 0xffb84d, transparent: true, opacity: 1 });
  const flash = new THREE.Mesh(flashGeo, flashMat);
  flash.position.set(b.x, 1, b.z); scene.add(flash);
  if (b.mesh.parent) b.mesh.parent.remove(b.mesh);
  let t = 0;
  const expand = () => {
    if (!scene) return;
    t += 0.05;
    if (t > 1) { scene.remove(flash); return; }
    flash.scale.setScalar(1 + t * b.splashRadius);
    flash.material.opacity = 1 - t;
    requestAnimationFrame(expand);
  };
  expand();
  for (const e of enemies) {
    if (e.dead) continue;
    const d = Math.hypot(e.mesh.position.x - b.x, e.mesh.position.z - b.z);
    if (d < b.splashRadius) damageEnemy(e, b.splashDamage * (1 - d / b.splashRadius));
  }
  if (worldProps?.barrels) {
    for (const other of worldProps.barrels) {
      if (other === b || other.exploded) continue;
      const d = Math.hypot(other.x - b.x, other.z - b.z);
      if (d < b.splashRadius) setTimeout(() => damageBarrel(other, b.splashDamage), 120);
    }
  }
  const dPlayer = Math.hypot(player.pos.x - b.x, player.pos.z - b.z);
  if (dPlayer < b.splashRadius && performance.now() > gameState.spawnInvulnUntil) {
    const dmg = b.splashDamage * 0.6 * (1 - dPlayer / b.splashRadius);
    gameState.health -= dmg;
    flashHit();
    sound.hit();
    if (gameState.health <= 0) endGame(false);
  }
  flashPickup('💥 Barrel exploded');
}

function onEnemyKilled(e) {
  gameState.kills += 1;
  sound.kill();
  const reward = gameState.mode === 'world'
    ? WORLD_CONFIG.rewardPerBotKill
    : (gameState.mission.rewardPerKill || 10);
  const bonus = e.boss ? 200 : 0;
  gameState.coinsEarned += reward + bonus;
  feedKill(e.boss ? '☠️ Warlord defeated!' : '🎯 Enemy down');
  if (!e.boss && Math.random() < 0.18 && worldProps) {
    spawnDroppedMedkit(e.mesh.position.x, e.mesh.position.z);
  }
  updateHUD();
}

function spawnDroppedMedkit(x, z) {
  const g = new THREE.Group();
  const box = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.5, 0.4), new THREE.MeshStandardMaterial({ color: 0xf3eddc }));
  box.position.y = 0.25; g.add(box);
  const v = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.35, 0.04), new THREE.MeshBasicMaterial({ color: 0xff4d5e }));
  v.position.set(0, 0.25, 0.22); g.add(v);
  const h = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.1, 0.04), new THREE.MeshBasicMaterial({ color: 0xff4d5e }));
  h.position.set(0, 0.25, 0.22); g.add(h);
  g.position.set(x, 0.1, z); scene.add(g);
  worldProps.medkits.push({ mesh: g, x, z, radius: 0.8, used: false, cooldownUntil: 0, dropped: true, type: 'medkit' });
}

function feedKill(text) {
  const feed = document.getElementById('killFeed'); if (!feed) return;
  const item = document.createElement('div');
  item.className = 'feed-item'; item.textContent = text;
  feed.appendChild(item);
  setTimeout(() => item.remove(), 2200);
}

function spawnBulletTracer() {
  const start = camera.position.clone();
  tmpDir.set(0, 0, -1).applyEuler(camera.rotation).normalize();
  const geo = new THREE.CylinderGeometry(0.02, 0.02, 1.5, 6);
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xffe07a, transparent: true, opacity: 0.6 }));
  mesh.position.copy(start).addScaledVector(tmpDir, 1.6);
  mesh.lookAt(start.clone().addScaledVector(tmpDir, 5));
  mesh.rotateX(Math.PI / 2);
  scene.add(mesh);
  bullets.push({ mesh, vel: tmpDir.clone().multiplyScalar(120), life: 0.3 });
}

function enemyShoot(e) {
  sound.enemyShoot();
  const accuracy = 0.55 + Math.random() * 0.2;
  if (Math.random() < accuracy && performance.now() > gameState.spawnInvulnUntil) {
    gameState.health -= e.damage;
    flashHit();
    sound.hit();
    if (gameState.health <= 0) endGame(false);
  }
  const start = e.mesh.position.clone(); start.y += 1.5;
  const dir = player.pos.clone().sub(start).normalize();
  const geo = new THREE.CylinderGeometry(0.02, 0.02, 1, 6);
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xff6a3d, transparent: true, opacity: 0.7 }));
  mesh.position.copy(start).addScaledVector(dir, 1);
  mesh.lookAt(start.clone().addScaledVector(dir, 5));
  mesh.rotateX(Math.PI / 2);
  scene.add(mesh);
  bullets.push({ mesh, vel: dir.multiplyScalar(80), life: 0.25 });
}

function flashHit() {
  const f = document.getElementById('hitFlash'); if (!f) return;
  f.classList.add('show');
  setTimeout(() => f.classList.remove('show'), 120);
}

function reloadWeapon() {
  if (!gameState || gameState.reloading || gameState.ammo === gameState.weapon.magazine || gameState.reserve <= 0) return;
  gameState.reloading = true;
  sound.reload();
  const a = document.getElementById('ammoText');
  if (a) a.textContent = 'Reloading…';
  setTimeout(() => {
    if (!gameState) return;
    const need = gameState.weapon.magazine - gameState.ammo;
    const take = Math.min(need, gameState.reserve);
    gameState.ammo += take;
    gameState.reserve -= take;
    gameState.reloading = false;
    updateHUD();
  }, gameState.weapon.reload);
}

function updateHUD() {
  if (!gameState) return;
  const hb = document.getElementById('healthBar');
  if (hb) hb.style.width = Math.max(0, gameState.health) + '%';
  if (!gameState.reloading) {
    const a = document.getElementById('ammoText');
    if (a) a.textContent = `${gameState.ammo} / ${gameState.reserve}`;
  }
  const k = document.getElementById('killsText'); if (k) k.textContent = gameState.kills;
  const gc = document.getElementById('gameCoins'); if (gc) gc.textContent = (Auth.profile?.coins || 0) + gameState.coinsEarned;
}

async function endGame(victory, aborted = false) {
  if (!gameState || gameState.over) return;
  gameState.over = true;
  if (raf) { cancelAnimationFrame(raf); raf = null; }

  if (!aborted) {
    if (victory) sound.victory(); else sound.defeat();
  }

  const totalCoins = gameState.coinsEarned + (victory && gameState.mission ? (gameState.mission.bonus || 0) : 0);
  const dur = Math.round((performance.now() - gameState.startTime) / 1000);

  try {
    await Auth.saveProfile({
      coins: (Auth.profile.coins || 0) + totalCoins,
      kills_total: (Auth.profile.kills_total || 0) + gameState.kills,
      missions_completed: (Auth.profile.missions_completed || 0) + (victory && gameState.mode === 'mission' ? 1 : 0),
    });
  } catch (e) { console.error('Save profile failed:', e); }

  const supa = getSupabase();
  if (supa && gameState.mode === 'mission') {
    try {
      await supa.from(TABLES.missionRuns).insert({
        mission_id: gameState.mission.id,
        kills: gameState.kills,
        completed: victory,
        coins_earned: totalCoins,
        duration_seconds: dur,
      });
    } catch (e) { /* table may not exist — non-fatal */ }
  }

  const ov = document.getElementById('gameOverlay');
  document.getElementById('overlayTitle').textContent = aborted
    ? 'Mission Ended'
    : (victory ? '🏆 Victory!' : '💀 You were taken down');
  document.getElementById('overlaySub').textContent = aborted
    ? 'You headed back to the menu.'
    : (victory ? 'Great job out there!' : 'Try again — you got this.');
  document.getElementById('resKills').textContent = gameState.kills;
  document.getElementById('resCoins').textContent = totalCoins;
  document.getElementById('resTime').textContent = dur + 's';
  ov.classList.remove('hidden');

  if (worldChannel && supa) { try { supa.removeChannel(worldChannel); } catch (_) {} worldChannel = null; }
  if (worldSyncInterval) clearInterval(worldSyncInterval);
  worldSyncInterval = null;
}

function returnToBase() {
  if (raf) { cancelAnimationFrame(raf); raf = null; }
  try { detachInput(); } catch (e) { console.error('detachInput error', e); }
  sound.stopAmbient();
  const supa = getSupabase();
  if (worldChannel && supa) { try { supa.removeChannel(worldChannel); } catch (_) {} worldChannel = null; }
  if (worldSyncInterval) { clearInterval(worldSyncInterval); worldSyncInterval = null; }
  try { document.exitPointerLock?.(); } catch (_) {}

  try {
    if (scene) {
      scene.traverse((obj) => {
        if (obj.geometry) { try { obj.geometry.dispose(); } catch (_) {} }
        if (obj.material) {
          const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
          mats.forEach(m => { try { if (m.map) m.map.dispose?.(); m.dispose?.(); } catch (_) {} });
        }
      });
      while (scene.children.length) scene.remove(scene.children[0]);
    }
    if (renderer) {
      try { renderer.dispose(); } catch (_) {}
      try { renderer.forceContextLoss?.(); } catch (_) {}
    }
  } catch (e) { console.error('GL cleanup error', e); }

  renderer = null; scene = null; camera = null; clock = null;
  player = null; weaponMesh = null; muzzleFlash = null; canvas = null;
  enemies = []; obstacles = []; bullets = [];
  worldProps = null; ambient = null; gameState = null;
  remoteMeshes.clear();

  moveStick.pointerId = null; moveStick.dx = 0; moveStick.dy = 0;
  lookStick.pointerId = null; lookStick.dx = 0; lookStick.dy = 0;
  mouse.fireDown = false;
  for (const k of Object.keys(keys)) delete keys[k];

  const ov = document.getElementById('gameOverlay');
  if (ov) ov.classList.add('hidden');
  document.getElementById('gameScreen').classList.remove('active');
  document.body.classList.remove('game-active');

  const cb = onExit; onExit = null;
  if (cb) setTimeout(() => { try { cb(); } catch (e) { console.error('onExit error', e); } }, 0);
}

// ===== world realtime sync =====
function subscribeWorld() {
  const supa = getSupabase(); if (!supa || !Auth.user) return;
  if (worldChannel) { try { supa.removeChannel(worldChannel); } catch (_) {} }
  try {
    worldChannel = supa
      .channel('jungle-world')
      .on('postgres_changes', { event: '*', schema: 'public', table: TABLES.worldPlayers }, payload => {
        if (payload.eventType === 'DELETE') {
          const id = payload.old?.user_id;
          const m = remoteMeshes.get(id);
          if (m && scene) { scene.remove(m); remoteMeshes.delete(id); }
        } else {
          const p = payload.new;
          if (p.user_id !== Auth.user.id) renderRemote(p);
        }
      })
      .subscribe();
  } catch (_) {}

  worldSyncInterval = setInterval(async () => {
    if (!gameState || gameState.over || !player) return;
    try {
      await supa.from(TABLES.worldPlayers)
        .update({
          x: player.pos.x, y: player.pos.y, z: player.pos.z, ry: player.yaw,
          last_seen: new Date().toISOString(),
          world_kills: (Auth.profile.kills_total || 0) + gameState.kills,
        })
        .eq('user_id', Auth.user.id);
    } catch (e) { /* offline ok */ }
  }, 600);

  fetchRemoteOnce();
}

async function fetchRemoteOnce() {
  const supa = getSupabase(); if (!supa) return;
  try {
    const cutoff = new Date(Date.now() - 60_000).toISOString();
    const { data } = await supa.from(TABLES.worldPlayers).select('*').gte('last_seen', cutoff);
    (data || []).forEach(p => { if (p.user_id !== Auth.user?.id) renderRemote(p); });
  } catch (_) {}
}

function renderRemote(p) {
  if (!scene) return;
  let m = remoteMeshes.get(p.user_id);
  if (!m) {
    m = buildHumanoid('remote');
    m.userData.basePelvisY = m.userData.rig.pelvis.position.y;
    // Add nametag sprite
    const cnv = document.createElement('canvas');
    cnv.width = 256; cnv.height = 64;
    const ctx = cnv.getContext('2d');
    ctx.fillStyle = 'rgba(8,16,12,0.7)'; ctx.fillRect(0, 0, 256, 64);
    ctx.fillStyle = '#c8ff5d'; ctx.font = 'bold 30px Rajdhani, sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(p.username || 'Player', 128, 42);
    const tex = new THREE.CanvasTexture(cnv);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true }));
    sprite.scale.set(2, 0.5, 1);
    sprite.position.y = 2.4;
    m.add(sprite);
    scene.add(m);
    remoteMeshes.set(p.user_id, m);
  }
  const prevX = m.position.x, prevZ = m.position.z;
  m.position.set(p.x || 0, 0, p.z || 0);
  m.rotation.y = p.ry || 0;
  const dist = Math.hypot(m.position.x - prevX, m.position.z - prevZ);
  animateHumanoid(m, 0.05, { walking: dist > 0.05, speed: 6 });
}
