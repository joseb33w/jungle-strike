import * as THREE from 'three';
import { WEAPONS, MISSIONS, WORLD_CONFIG } from './data.js';
import { Auth } from './auth.js';
import { supabase, TABLES } from './supabaseClient.js';
import { buildWorld } from './worlds.js';

let renderer, scene, camera, clock;
let player, controls, weaponMesh, muzzleFlash;
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
let worldOnComplete = null;

const keys = {};
const mouse = { dx: 0, dy: 0, locked: false, fireDown: false };

// Dual joystick state. moveStick = left (WASD), lookStick = right (mouselook).
const moveStick = { pointerId: null, cx: 0, cy: 0, dx: 0, dy: 0 };
const lookStick = { pointerId: null, cx: 0, cy: 0, dx: 0, dy: 0 };

// Track event listeners we attach so we can detach cleanly on exit.
const stickListeners = [];

const tmpVec = new THREE.Vector3();
const tmpDir = new THREE.Vector3();
const ARENA = 80;

export function startMission(mission, exitCallback) {
  onExit = exitCallback;
  showGameScreen();
  setupRenderer();
  const world = buildWorld(scene, mission.id);
  obstacles = world.obstacles;
  worldProps = world.props;
  ambient = world.ambient;
  initPlayer();

  gameState = {
    mode: 'mission',
    mission,
    kills: 0,
    coinsEarned: 0,
    startTime: performance.now(),
    health: 100,
    maxHealth: 100,
    weapon: { ...WEAPONS[Auth.profile.equipped_weapon] },
    ammo: WEAPONS[Auth.profile.equipped_weapon].magazine,
    reserve: WEAPONS[Auth.profile.equipped_weapon].reserve,
    reloading: false,
    lastShot: 0,
    over: false,
    waveIndex: 0,
    bossSpawned: false,
    bossDefeated: false,
    spawnInvulnUntil: performance.now() + 1500,
    captureProgress: 0,
  };

  buildWeaponView();
  setMissionHUD(mission);
  if (mission.id === 'survival') {
    spawnWave(mission.waves[0]);
    setObjective(`Wave 1 / ${mission.waves.length} — Hold the line`);
  } else if (mission.id === 'boss') {
    spawnEnemies(mission.enemies, mission.enemyHealth, mission.enemySpeed);
    setObjective(`Eliminate guards · ${mission.enemies} left`);
  } else {
    spawnEnemies(mission.enemies, mission.enemyHealth, mission.enemySpeed);
    setObjective(`Targets remaining: ${mission.enemies}`);
  }

  attachInput();
  startLoop();
}

export function startWorld(exitCallback) {
  onExit = exitCallback;
  showGameScreen();
  setupRenderer();
  const world = buildWorld(scene, 'world');
  obstacles = world.obstacles;
  worldProps = world.props;
  ambient = world.ambient;
  initPlayer();

  gameState = {
    mode: 'world',
    kills: 0,
    coinsEarned: 0,
    startTime: performance.now(),
    health: 100,
    maxHealth: 100,
    weapon: { ...WEAPONS[Auth.profile.equipped_weapon] },
    ammo: WEAPONS[Auth.profile.equipped_weapon].magazine,
    reserve: WEAPONS[Auth.profile.equipped_weapon].reserve,
    reloading: false,
    lastShot: 0,
    over: false,
    spawnInvulnUntil: performance.now() + 1500,
    captureProgress: 0,
  };

  buildWeaponView();
  setMissionHUD({ name: 'Open World', objective: 'Eliminate enemies & hold the flag' });
  setObjective('Capture the flag at center for bonus coins!');
  spawnEnemies(WORLD_CONFIG.enemyBots, WORLD_CONFIG.botHealth, WORLD_CONFIG.botSpeed);

  attachInput();
  subscribeWorld();
  startLoop();
}

function showGameScreen() {
  document.getElementById('lobbyScreen').classList.remove('active');
  document.getElementById('authScreen').classList.remove('active');
  document.getElementById('gameScreen').classList.add('active');
  document.getElementById('gameOverlay').classList.add('hidden');
}

function setupRenderer() {
  canvas = document.getElementById('gameCanvas');
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

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

  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x222020, roughness: 0.4, metalness: 0.6 });
  const accentMat = new THREE.MeshStandardMaterial({ color: 0x444, roughness: 0.4, metalness: 0.7 });

  const body = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.18, 0.7), bodyMat);
  body.position.set(0.3, -0.28, -0.6);
  wg.add(body);

  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.7, 12), accentMat);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0.3, -0.22, -1.0);
  wg.add(barrel);

  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.25, 0.14), bodyMat);
  grip.position.set(0.3, -0.45, -0.45);
  wg.add(grip);

  muzzleFlash = new THREE.Mesh(
    new THREE.SphereGeometry(0.08, 8, 8),
    new THREE.MeshBasicMaterial({ color: 0xffd84d, transparent: true, opacity: 0 })
  );
  muzzleFlash.position.set(0.3, -0.22, -1.4);
  wg.add(muzzleFlash);

  const w = gameState.weapon;
  if (w.id === 'shotgun') { body.scale.set(1.2, 1.2, 0.8); barrel.scale.set(1.4, 1.4, 0.7); }
  if (w.id === 'sniper') { barrel.scale.set(0.9, 0.9, 1.5); body.scale.set(1, 1, 1.3); }
  if (w.id === 'rocket') { barrel.scale.set(2.5, 2.5, 0.9); barrel.material = new THREE.MeshStandardMaterial({ color: 0x556b2f }); }
  if (w.id === 'rifle') { body.scale.set(1, 1, 1.2); }

  weaponMesh = wg;
  camera.add(weaponMesh);
  if (!scene.children.includes(camera)) scene.add(camera);
}

function spawnEnemies(count, health, speed) {
  for (let i = 0; i < count; i++) spawnEnemy(health, speed);
}

function spawnWave(wave) {
  setObjective(`Wave ${gameState.waveIndex + 1} — ${wave.count} hostiles incoming`);
  for (let i = 0; i < wave.count; i++) spawnEnemy(wave.health, wave.speed);
}

function spawnEnemy(health, speed, opts = {}) {
  const group = new THREE.Group();
  const skinMat = new THREE.MeshStandardMaterial({ color: opts.boss ? 0x8a1414 : 0x4a3520, roughness: 0.8 });
  const accentMat = new THREE.MeshStandardMaterial({ color: opts.boss ? 0x222 : 0x2d4a1a, roughness: 0.7 });
  const scale = opts.boss ? 1.6 : 1;

  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.4 * scale, 1.2 * scale, 4, 8), accentMat);
  body.position.y = 1.0 * scale;
  body.castShadow = true;
  group.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.3 * scale, 12, 12), skinMat);
  head.position.y = 1.9 * scale;
  head.castShadow = true;
  group.add(head);

  const eyeMat = new THREE.MeshBasicMaterial({ color: 0xff2828 });
  const eyeL = new THREE.Mesh(new THREE.SphereGeometry(0.05 * scale, 6, 6), eyeMat);
  eyeL.position.set(-0.1 * scale, 1.92 * scale, 0.27 * scale);
  group.add(eyeL);
  const eyeR = eyeL.clone();
  eyeR.position.x = 0.1 * scale;
  group.add(eyeR);

  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.1 * scale, 0.1 * scale, 0.6 * scale), new THREE.MeshStandardMaterial({ color: 0x111 }));
  gun.position.set(0.3 * scale, 1.1 * scale, 0.3 * scale);
  group.add(gun);

  let x, z, ok = false, tries = 0;
  while (!ok && tries++ < 30) {
    const angle = Math.random() * Math.PI * 2;
    const dist = 18 + Math.random() * 30;
    x = Math.cos(angle) * dist;
    z = Math.sin(angle) * dist;
    if (Math.hypot(x - player.pos.x, z - player.pos.z) > 12) ok = true;
  }
  group.position.set(x, 0, z);
  scene.add(group);
  enemies.push({
    mesh: group,
    health: opts.boss ? opts.bossHealth : health,
    maxHealth: opts.boss ? opts.bossHealth : health,
    speed: opts.boss ? opts.bossSpeed : speed,
    boss: !!opts.boss,
    damage: opts.boss ? opts.bossDamage : 8,
    lastShot: 0,
    cooldown: opts.boss ? 700 : 1200,
    radius: 0.6 * scale,
    height: 2 * scale,
  });
}

function setMissionHUD(mission) {
  document.getElementById('missionTitle').textContent = mission.name || 'Open World';
  document.getElementById('missionObjective').textContent = mission.objective || '';
}
function setObjective(text) {
  document.getElementById('missionObjective').textContent = text;
}

// =============================================================
// INPUT — keyboard, mouse, dual-joystick touch (Pointer Events)
// =============================================================
function attachInput() {
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  canvas.addEventListener('click', onCanvasClick);
  document.addEventListener('pointerlockchange', onPointerLock);
  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mousedown', onMouseDown);
  document.addEventListener('mouseup', onMouseUp);

  // Block iOS long-press magnifier / copy menu globally on the game screen
  const blockCtx = (e) => e.preventDefault();
  document.getElementById('gameScreen').addEventListener('contextmenu', blockCtx);
  stickListeners.push({ el: document.getElementById('gameScreen'), type: 'contextmenu', fn: blockCtx });

  // ---- Dual joysticks via Pointer Events ----
  setupStick(document.getElementById('moveStick'), moveStick);
  setupStick(document.getElementById('lookStick'), lookStick);

  // Fire button (use pointer events so it doesn't fight with joysticks)
  const fireBtn = document.getElementById('fireBtn');
  if (fireBtn) {
    const onFireDown = (e) => { e.preventDefault(); mouse.fireDown = true; tryFire(); };
    const onFireUp = (e) => { e.preventDefault(); mouse.fireDown = false; };
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

  document.getElementById('exitGameBtn').onclick = () => endGame(false, true);
  document.getElementById('overlayBack').onclick = () => returnToBase();
}

function setupStick(el, state) {
  if (!el) return;

  const onDown = (e) => {
    if (state.pointerId !== null) return;          // already tracking a finger
    e.preventDefault();
    e.stopPropagation();
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
    state.pointerId = null;
    state.dx = 0;
    state.dy = 0;
    try { el.releasePointerCapture(e.pointerId); } catch (_) {}
    const knob = el.querySelector('.stick-knob');
    if (knob) knob.style.transform = 'translate(-50%, -50%)';
  };

  const onCtx = (e) => e.preventDefault();

  el.addEventListener('pointerdown', onDown);
  el.addEventListener('pointermove', onMove);
  el.addEventListener('pointerup', onUp);
  el.addEventListener('pointercancel', onUp);
  el.addEventListener('pointerleave', onUp);
  el.addEventListener('contextmenu', onCtx);
  // Belt-and-suspenders: block legacy touch events that iOS might still fire
  const blockTouch = (e) => { e.preventDefault(); };
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
  const dx = x - state.cx;
  const dy = y - state.cy;
  const mag = Math.min(50, Math.hypot(dx, dy));
  const ang = Math.atan2(dy, dx);
  state.dx = Math.cos(ang) * (mag / 50);
  state.dy = Math.sin(ang) * (mag / 50);
  const knob = el.querySelector('.stick-knob');
  if (knob) {
    const kx = Math.cos(ang) * mag;
    const ky = Math.sin(ang) * mag;
    knob.style.transform = `translate(calc(-50% + ${kx}px), calc(-50% + ${ky}px))`;
  }
}

function detachInput() {
  window.removeEventListener('keydown', onKeyDown);
  window.removeEventListener('keyup', onKeyUp);
  if (canvas) canvas.removeEventListener('click', onCanvasClick);
  document.removeEventListener('pointerlockchange', onPointerLock);
  document.removeEventListener('mousemove', onMouseMove);
  document.removeEventListener('mousedown', onMouseDown);
  document.removeEventListener('mouseup', onMouseUp);

  for (const { el, type, fn } of stickListeners) {
    try { el.removeEventListener(type, fn); } catch (_) {}
  }
  stickListeners.length = 0;

  // Reset stick state
  moveStick.pointerId = null; moveStick.dx = 0; moveStick.dy = 0;
  lookStick.pointerId = null; lookStick.dx = 0; lookStick.dy = 0;
}

function onKeyDown(e) {
  keys[e.code] = true;
  if (e.code === 'KeyR') reloadWeapon();
  if (e.code === 'Escape' && document.pointerLockElement) document.exitPointerLock();
}
function onKeyUp(e) { keys[e.code] = false; }
function onCanvasClick() {
  if (!mouse.locked && canvas.requestPointerLock) canvas.requestPointerLock();
}
function onPointerLock() {
  mouse.locked = document.pointerLockElement === canvas;
}
function onMouseMove(e) {
  if (!mouse.locked) return;
  player.yaw -= e.movementX * 0.0024;
  player.pitch -= e.movementY * 0.0024;
  player.pitch = Math.max(-1.4, Math.min(1.4, player.pitch));
}
function onMouseDown(e) {
  if (e.button === 0) { mouse.fireDown = true; tryFire(); }
}
function onMouseUp(e) {
  if (e.button === 0) mouse.fireDown = false;
}

function startLoop() {
  cancelAnimationFrame(raf);
  const tick = () => {
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

  // Right joystick = look. Horizontal yaws camera, vertical pitches it.
  const lookYawSpeed = 2.4;   // rad/sec at full deflection
  const lookPitchSpeed = 1.8;
  if (lookStick.dx || lookStick.dy) {
    player.yaw -= lookStick.dx * lookYawSpeed * dt;
    player.pitch -= lookStick.dy * lookPitchSpeed * dt;
    player.pitch = Math.max(-1.4, Math.min(1.4, player.pitch));
  }

  // movement
  const forward = (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0);
  const strafe = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0);
  const mvF = forward + (-moveStick.dy);
  const mvS = strafe + (moveStick.dx);
  const sprint = keys.ShiftLeft || keys.ShiftRight ? player.sprintMul : 1;

  const yawCos = Math.cos(player.yaw);
  const yawSin = Math.sin(player.yaw);
  const wishX = (-yawSin * mvF + yawCos * mvS);
  const wishZ = (-yawCos * mvF - yawSin * mvS);
  const len = Math.hypot(wishX, wishZ) || 1;
  const nx = wishX / len, nz = wishZ / len;
  const moveMag = Math.min(1, Math.hypot(mvF, mvS));

  const dx = nx * player.speed * sprint * moveMag * dt;
  const dz = nz * player.speed * sprint * moveMag * dt;

  const nextX = player.pos.x + dx;
  const nextZ = player.pos.z + dz;
  if (canMoveTo(nextX, player.pos.z)) player.pos.x = nextX;
  if (canMoveTo(player.pos.x, nextZ)) player.pos.z = nextZ;

  const limit = ARENA - 1.5;
  player.pos.x = Math.max(-limit, Math.min(limit, player.pos.x));
  player.pos.z = Math.max(-limit, Math.min(limit, player.pos.z));

  const speed2 = (dx * dx + dz * dz);
  const bob = speed2 > 0 ? Math.sin(performance.now() * 0.01) * 0.04 : 0;
  camera.position.set(player.pos.x, player.pos.y + bob, player.pos.z);
  camera.rotation.set(player.pitch, player.yaw, 0, 'YXZ');

  if (weaponMesh) {
    weaponMesh.rotation.x = Math.sin(performance.now() * 0.005) * 0.005 + (gameState.reloading ? -0.5 : 0);
    weaponMesh.position.y = -0.02 + Math.sin(performance.now() * 0.008) * 0.01;
  }
  if (muzzleFlash) muzzleFlash.material.opacity *= 0.85;

  if (mouse.fireDown && gameState.weapon.auto) tryFire();

  // bullets
  for (const b of bullets) {
    b.mesh.position.addScaledVector(b.vel, dt);
    b.life -= dt;
  }
  bullets = bullets.filter(b => {
    if (b.life <= 0) { scene.remove(b.mesh); return false; }
    return true;
  });

  // ====== PICKUPS (ammo crates, medkits) ======
  checkPickups();

  // ====== CAPTURE FLAG (open world only) ======
  if (gameState.mode === 'world' && worldProps?.flags?.length) {
    updateCaptureFlag(dt);
  }

  // enemies
  for (const e of enemies) {
    if (e.dead) continue;
    const dxe = player.pos.x - e.mesh.position.x;
    const dze = player.pos.z - e.mesh.position.z;
    const dist = Math.hypot(dxe, dze);
    e.mesh.lookAt(player.pos.x, e.mesh.position.y + 1, player.pos.z);

    if (dist > (e.boss ? 8 : 14)) {
      const stepX = (dxe / (dist || 1)) * e.speed * dt;
      const stepZ = (dze / (dist || 1)) * e.speed * dt;
      const nx2 = e.mesh.position.x + stepX;
      const nz2 = e.mesh.position.z + stepZ;
      if (canMoveTo(nx2, e.mesh.position.z, e.radius)) e.mesh.position.x = nx2;
      if (canMoveTo(e.mesh.position.x, nz2, e.radius)) e.mesh.position.z = nz2;
    }

    const now = performance.now();
    if (dist < (e.boss ? 30 : 22) && now - e.lastShot > e.cooldown && hasLineOfSight(e.mesh.position, player.pos)) {
      e.lastShot = now;
      enemyShoot(e);
    }
  }

  // mission progression
  const aliveEnemies = enemies.filter(e => !e.dead).length;
  if (gameState.mode === 'mission') {
    const m = gameState.mission;
    if (m.id === 'recon') {
      setObjective(`Targets remaining: ${aliveEnemies}`);
      if (aliveEnemies === 0) endGame(true);
    } else if (m.id === 'boss') {
      const guardsAlive = enemies.filter(e => !e.dead && !e.boss).length;
      const bossAlive = enemies.find(e => !e.dead && e.boss);
      if (guardsAlive === 0 && !gameState.bossSpawned) {
        gameState.bossSpawned = true;
        spawnEnemy(0, 0, 0, { boss: true, bossHealth: m.boss.health, bossDamage: m.boss.damage, bossSpeed: m.boss.speed });
        setObjective(`⚠️ WARLORD APPROACHING`);
      } else if (gameState.bossSpawned && !bossAlive) {
        endGame(true);
      } else if (gameState.bossSpawned) {
        setObjective(`Warlord HP: ${Math.max(0, Math.round(bossAlive?.health || 0))}`);
      } else {
        setObjective(`Guards left: ${guardsAlive}`);
      }
    } else if (m.id === 'survival') {
      if (aliveEnemies === 0) {
        gameState.waveIndex += 1;
        if (gameState.waveIndex >= m.waves.length) {
          endGame(true);
        } else {
          spawnWave(m.waves[gameState.waveIndex]);
        }
      } else {
        setObjective(`Wave ${gameState.waveIndex + 1}/${m.waves.length} · ${aliveEnemies} hostiles`);
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
    if (c.used && now < c.cooldownUntil) {
      if (c.mesh.visible) c.mesh.visible = false;
      continue;
    }
    if (c.used && now >= c.cooldownUntil) {
      c.used = false;
      c.mesh.visible = true;
    }
    const d = Math.hypot(player.pos.x - c.x, player.pos.z - c.z);
    if (d < c.radius + 0.6) {
      // restock reserve to max
      const max = gameState.weapon.reserve;
      const before = gameState.reserve;
      gameState.reserve = Math.max(gameState.reserve, max);
      // top up by at least one full mag of reserve
      gameState.reserve = before + gameState.weapon.magazine * 3;
      c.used = true;
      c.cooldownUntil = now + 15000;
      flashPickup('🔫 +Ammo crate restocked');
    }
  }

  for (const m of worldProps.medkits) {
    if (m.used && now < m.cooldownUntil) {
      if (m.mesh.visible) m.mesh.visible = false;
      continue;
    }
    if (m.used && now >= m.cooldownUntil) {
      m.used = false;
      m.mesh.visible = true;
    }
    if (gameState.health >= gameState.maxHealth) continue;
    const d = Math.hypot(player.pos.x - m.x, player.pos.z - m.z);
    if (d < m.radius + 0.6) {
      gameState.health = Math.min(gameState.maxHealth, gameState.health + 50);
      m.used = true;
      m.cooldownUntil = now + 20000;
      flashPickup('❤️ +50 Health');
    }
  }
}

function updateCaptureFlag(dt) {
  const f = worldProps.flags[0];
  if (!f) return;
  const d = Math.hypot(player.pos.x - f.x, player.pos.z - f.z);
  const enemiesNear = enemies.some(e => !e.dead && Math.hypot(e.mesh.position.x - f.x, e.mesh.position.z - f.z) < 6);
  if (d < f.radius && !enemiesNear) {
    gameState.captureProgress = Math.min(100, gameState.captureProgress + dt * 14);
    if (gameState.captureProgress >= 100) {
      gameState.captureProgress = 0;
      gameState.coinsEarned += 50;
      flashPickup('🚩 Flag captured! +50 coins');
      // move flag to a new random spot
      const nx = (Math.random() - 0.5) * 50;
      const nz = (Math.random() - 0.5) * 50;
      f.x = nx; f.z = nz; f.mesh.position.set(nx, 0, nz);
    } else {
      setObjective(`🚩 Capturing flag… ${Math.round(gameState.captureProgress)}%`);
    }
  } else if (d < f.radius && enemiesNear) {
    setObjective(`⚠️ Enemies near flag — clear them out!`);
  } else if (gameState.captureProgress > 0) {
    gameState.captureProgress = Math.max(0, gameState.captureProgress - dt * 8);
  }
}

function flashPickup(text) {
  const feed = document.getElementById('killFeed');
  const item = document.createElement('div');
  item.className = 'feed-item';
  item.textContent = text;
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
  const dirX = to.x - from.x;
  const dirZ = to.z - from.z;
  const dist = Math.hypot(dirX, dirZ);
  const steps = Math.ceil(dist / 1.5);
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const px = from.x + dirX * t;
    const pz = from.z + dirZ * t;
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
  if (gameState.ammo <= 0) {
    reloadWeapon();
    return;
  }
  gameState.lastShot = now;
  gameState.ammo -= 1;
  if (muzzleFlash) muzzleFlash.material.opacity = 1;

  const w = gameState.weapon;
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

  // check enemies
  for (const e of enemies) {
    if (e.dead) continue;
    const d = rayHitsEnemy(origin, tmpDir, e);
    if (d != null && d < hitDist && d < w.range) { hitDist = d; hitEnemy = e; hitBarrel = null; }
  }
  // check barrels (also raycastable)
  if (worldProps?.barrels) {
    for (const b of worldProps.barrels) {
      if (b.exploded) continue;
      const d = rayHitsCylinder(origin, tmpDir, b.x, b.z, 0, 1.5, b.radius);
      if (d != null && d < hitDist && d < w.range) { hitDist = d; hitBarrel = b; hitEnemy = null; }
    }
  }

  if (hitBarrel) {
    damageBarrel(hitBarrel, w.damage);
    return;
  }
  if (hitEnemy) {
    let dmg = w.damage;
    if (w.splash) {
      const explosion = origin.clone().addScaledVector(tmpDir, hitDist);
      for (const e of enemies) {
        if (e.dead) continue;
        const d = e.mesh.position.distanceTo(explosion);
        if (d < w.splash) damageEnemy(e, dmg * (1 - d / w.splash));
      }
      // splash also damages barrels
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
  e.mesh.children[0].material.color.lerp(new THREE.Color(0xff4d4d), 0.3);
  setTimeout(() => {
    if (!e.dead && e.mesh.children[0])
      e.mesh.children[0].material.color.set(e.boss ? 0x222 : 0x2d4a1a);
  }, 100);
  if (e.health <= 0 && !e.dead) {
    e.dead = true;
    scene.remove(e.mesh);
    onEnemyKilled(e);
  }
}

function damageBarrel(b, dmg) {
  b.health -= dmg;
  if (b.health <= 0 && !b.exploded) {
    explodeBarrel(b);
  }
}

function explodeBarrel(b) {
  b.exploded = true;
  // visual: orange flash sphere expanding
  const flashGeo = new THREE.SphereGeometry(1, 16, 16);
  const flashMat = new THREE.MeshBasicMaterial({ color: 0xffb84d, transparent: true, opacity: 1 });
  const flash = new THREE.Mesh(flashGeo, flashMat);
  flash.position.set(b.x, 1, b.z);
  scene.add(flash);
  // hide the barrel
  if (b.mesh.parent) b.mesh.parent.remove(b.mesh);

  let t = 0;
  const expand = () => {
    t += 0.05;
    if (t > 1) { scene.remove(flash); return; }
    flash.scale.setScalar(1 + t * b.splashRadius);
    flash.material.opacity = 1 - t;
    requestAnimationFrame(expand);
  };
  expand();

  // damage enemies in radius
  for (const e of enemies) {
    if (e.dead) continue;
    const d = Math.hypot(e.mesh.position.x - b.x, e.mesh.position.z - b.z);
    if (d < b.splashRadius) damageEnemy(e, b.splashDamage * (1 - d / b.splashRadius));
  }
  // damage other barrels (chain reaction)
  if (worldProps?.barrels) {
    for (const other of worldProps.barrels) {
      if (other === b || other.exploded) continue;
      const d = Math.hypot(other.x - b.x, other.z - b.z);
      if (d < b.splashRadius) {
        setTimeout(() => damageBarrel(other, b.splashDamage), 120);
      }
    }
  }
  // damage player if too close
  const dPlayer = Math.hypot(player.pos.x - b.x, player.pos.z - b.z);
  if (dPlayer < b.splashRadius && performance.now() > gameState.spawnInvulnUntil) {
    const dmg = b.splashDamage * 0.6 * (1 - dPlayer / b.splashRadius);
    gameState.health -= dmg;
    flashHit();
    if (gameState.health <= 0) endGame(false);
  }
  flashPickup('💥 Barrel detonated');
}

function onEnemyKilled(e) {
  gameState.kills += 1;
  const reward = gameState.mode === 'world'
    ? WORLD_CONFIG.rewardPerBotKill
    : (gameState.mission.rewardPerKill || 10);
  const bonus = e.boss ? 200 : 0;
  gameState.coinsEarned += reward + bonus;
  feedKill(e.boss ? '☠️ WARLORD ELIMINATED' : '🎯 Hostile down');

  // chance to drop a medkit at the enemy's position
  if (!e.boss && Math.random() < 0.18 && worldProps) {
    spawnDroppedMedkit(e.mesh.position.x, e.mesh.position.z);
  }
  updateHUD();
}

function spawnDroppedMedkit(x, z) {
  const g = new THREE.Group();
  const box = new THREE.Mesh(
    new THREE.BoxGeometry(0.6, 0.5, 0.4),
    new THREE.MeshStandardMaterial({ color: 0xf3eddc }),
  );
  box.position.y = 0.25;
  g.add(box);
  const v = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.35, 0.04), new THREE.MeshBasicMaterial({ color: 0xff4d5e }));
  v.position.set(0, 0.25, 0.22);
  g.add(v);
  const h = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.1, 0.04), new THREE.MeshBasicMaterial({ color: 0xff4d5e }));
  h.position.set(0, 0.25, 0.22);
  g.add(h);
  g.position.set(x, 0.1, z);
  scene.add(g);
  worldProps.medkits.push({
    mesh: g, x, z, radius: 0.8,
    used: false, cooldownUntil: 0,
    dropped: true,
    type: 'medkit',
  });
}

function feedKill(text) {
  const feed = document.getElementById('killFeed');
  const item = document.createElement('div');
  item.className = 'feed-item';
  item.textContent = text;
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
  const accuracy = 0.55 + Math.random() * 0.2;
  if (Math.random() < accuracy && performance.now() > gameState.spawnInvulnUntil) {
    gameState.health -= e.damage;
    flashHit();
    if (gameState.health <= 0) endGame(false);
  }
  const start = e.mesh.position.clone(); start.y += 1;
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
  const f = document.getElementById('hitFlash');
  f.classList.add('show');
  setTimeout(() => f.classList.remove('show'), 120);
}

function reloadWeapon() {
  if (gameState.reloading || gameState.ammo === gameState.weapon.magazine || gameState.reserve <= 0) return;
  gameState.reloading = true;
  document.getElementById('ammoText').textContent = 'Reloading…';
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
  document.getElementById('healthBar').style.width = Math.max(0, gameState.health) + '%';
  if (!gameState.reloading) {
    document.getElementById('ammoText').textContent = `${gameState.ammo} / ${gameState.reserve}`;
  }
  document.getElementById('killsText').textContent = gameState.kills;
  document.getElementById('gameCoins').textContent = (Auth.profile?.coins || 0) + gameState.coinsEarned;
}

async function endGame(victory, aborted = false) {
  if (!gameState || gameState.over) return;
  gameState.over = true;
  cancelAnimationFrame(raf);

  const totalCoins = gameState.coinsEarned + (victory && gameState.mission ? (gameState.mission.bonus || 0) : 0);
  const dur = Math.round((performance.now() - gameState.startTime) / 1000);

  try {
    await Auth.saveProfile({
      coins: (Auth.profile.coins || 0) + totalCoins,
      kills_total: (Auth.profile.kills_total || 0) + gameState.kills,
      missions_completed: (Auth.profile.missions_completed || 0) + (victory && gameState.mode === 'mission' ? 1 : 0),
    });
  } catch (e) { console.error('Save profile failed:', e); }

  if (gameState.mode === 'mission') {
    try {
      await supabase.from(TABLES.missionRuns).insert({
        mission_id: gameState.mission.id,
        kills: gameState.kills,
        completed: victory,
        coins_earned: totalCoins,
        duration_seconds: dur,
      });
    } catch (e) { console.error('Save run failed:', e); }
  }

  const ov = document.getElementById('gameOverlay');
  document.getElementById('overlayTitle').textContent = aborted
    ? 'Mission Aborted'
    : (victory ? '🏆 Victory' : '💀 You were eliminated');
  document.getElementById('overlaySub').textContent = aborted
    ? 'You retreated to base.'
    : (victory ? 'Outstanding work, operative.' : 'Better luck next deployment.');
  document.getElementById('resKills').textContent = gameState.kills;
  document.getElementById('resCoins').textContent = totalCoins;
  document.getElementById('resTime').textContent = dur + 's';
  ov.classList.remove('hidden');

  if (worldChannel) {
    supabase.removeChannel(worldChannel);
    worldChannel = null;
  }
  if (worldSyncInterval) clearInterval(worldSyncInterval);
  worldSyncInterval = null;
}

function returnToBase() {
  detachInput();
  cancelAnimationFrame(raf);
  if (worldChannel) {
    supabase.removeChannel(worldChannel);
    worldChannel = null;
  }
  if (worldSyncInterval) { clearInterval(worldSyncInterval); worldSyncInterval = null; }
  if (renderer) renderer.dispose();
  if (scene) {
    while (scene.children.length) scene.remove(scene.children[0]);
  }
  enemies = [];
  obstacles = [];
  bullets = [];
  worldProps = null;
  ambient = null;
  gameState = null;
  remoteMeshes.forEach(m => scene && scene.remove(m));
  remoteMeshes.clear();
  document.exitPointerLock?.();
  if (onExit) onExit();
}

/* ----- world realtime sync ----- */
function subscribeWorld() {
  if (worldChannel) supabase.removeChannel(worldChannel);
  worldChannel = supabase
    .channel('jungle-world')
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: TABLES.worldPlayers,
    }, payload => {
      if (payload.eventType === 'DELETE') {
        const id = payload.old?.user_id;
        const m = remoteMeshes.get(id);
        if (m) { scene.remove(m); remoteMeshes.delete(id); }
      } else {
        const p = payload.new;
        if (p.user_id !== Auth.user.id) renderRemote(p);
      }
    })
    .subscribe();

  worldSyncInterval = setInterval(async () => {
    if (!gameState || gameState.over) return;
    try {
      await supabase.from(TABLES.worldPlayers)
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
  const cutoff = new Date(Date.now() - 60_000).toISOString();
  const { data } = await supabase.from(TABLES.worldPlayers)
    .select('*').gte('last_seen', cutoff);
  (data || []).forEach(p => { if (p.user_id !== Auth.user.id) renderRemote(p); });
}

function renderRemote(p) {
  let m = remoteMeshes.get(p.user_id);
  if (!m) {
    m = makeRemoteMesh(p.username || 'agent');
    scene.add(m);
    remoteMeshes.set(p.user_id, m);
  }
  m.position.set(p.x || 0, 0, p.z || 0);
  m.rotation.y = p.ry || 0;
}

function makeRemoteMesh(name) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.4, 1.2, 4, 8),
    new THREE.MeshStandardMaterial({ color: 0x2a4f8a, roughness: 0.7 })
  );
  body.position.y = 1.0;
  g.add(body);
  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.3, 12, 12),
    new THREE.MeshStandardMaterial({ color: 0xc9a37c })
  );
  head.position.y = 1.9;
  g.add(head);

  const cnv = document.createElement('canvas');
  cnv.width = 256; cnv.height = 64;
  const ctx = cnv.getContext('2d');
  ctx.fillStyle = 'rgba(8,16,12,0.7)'; ctx.fillRect(0, 0, 256, 64);
  ctx.fillStyle = '#c8ff5d'; ctx.font = 'bold 30px Rajdhani, sans-serif'; ctx.textAlign = 'center';
  ctx.fillText(name, 128, 42);
  const tex = new THREE.CanvasTexture(cnv);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true }));
  sprite.scale.set(2, 0.5, 1);
  sprite.position.y = 2.6;
  g.add(sprite);
  return g;
}
