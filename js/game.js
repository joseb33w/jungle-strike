import * as THREE from 'three';
import { WEAPONS, MISSIONS, WORLD_CONFIG } from './data.js';
import { Auth } from './auth.js';
import { supabase, TABLES } from './supabaseClient.js';

let renderer, scene, camera, clock;
let player, controls, weaponMesh, muzzleFlash;
let enemies = [], obstacles = [], remoteMeshes = new Map();
let bullets = [];
let canvas;

let gameState = null;
let onExit = null;
let raf = null;
let worldChannel = null;
let worldSyncInterval = null;
let worldOnComplete = null;

const keys = {};
const mouse = { dx: 0, dy: 0, locked: false, fireDown: false };
const touch = { active: false, x: 0, y: 0, dx: 0, dy: 0, lookLeft: false, lookRight: false };

const tmpVec = new THREE.Vector3();
const tmpDir = new THREE.Vector3();
const ARENA = 80;

export function startMission(mission, exitCallback) {
  onExit = exitCallback;
  showGameScreen();
  setupRenderer();
  buildJungleScene();
  initPlayer();
  spawnObstacles();

  gameState = {
    mode: 'mission',
    mission,
    kills: 0,
    coinsEarned: 0,
    startTime: performance.now(),
    health: 100,
    weapon: { ...WEAPONS[Auth.profile.equipped_weapon] },
    ammo: WEAPONS[Auth.profile.equipped_weapon].magazine,
    reserve: WEAPONS[Auth.profile.equipped_weapon].reserve,
    reloading: false,
    lastShot: 0,
    over: false,
    waveIndex: 0,
    bossSpawned: false,
    bossDefeated: false,
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
  buildJungleScene();
  initPlayer();
  spawnObstacles();

  gameState = {
    mode: 'world',
    kills: 0,
    coinsEarned: 0,
    startTime: performance.now(),
    health: 100,
    weapon: { ...WEAPONS[Auth.profile.equipped_weapon] },
    ammo: WEAPONS[Auth.profile.equipped_weapon].magazine,
    reserve: WEAPONS[Auth.profile.equipped_weapon].reserve,
    reloading: false,
    lastShot: 0,
    over: false,
  };

  buildWeaponView();
  setMissionHUD({ name: 'Open World', objective: 'Eliminate enemies & rival operatives' });
  setObjective('Open jungle — kill bots & rivals to earn coins');
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
  scene.background = new THREE.Color(0x355c2c);
  scene.fog = new THREE.Fog(0x355c2c, 18, 90);

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

function buildJungleScene() {
  // sky/ambient
  const hemi = new THREE.HemisphereLight(0xa8d979, 0x224c1f, 0.85);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfffaf0, 0.85);
  sun.position.set(40, 60, 30);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = -50;
  sun.shadow.camera.right = 50;
  sun.shadow.camera.top = 50;
  sun.shadow.camera.bottom = -50;
  scene.add(sun);

  // ground
  const groundGeo = new THREE.PlaneGeometry(ARENA * 4, ARENA * 4, 60, 60);
  const groundMat = new THREE.MeshStandardMaterial({
    color: 0x2d5a23,
    roughness: 1,
    metalness: 0,
  });
  // gentle bumps
  const pos = groundGeo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i);
    pos.setZ(i, Math.sin(x * 0.08) * 0.3 + Math.cos(y * 0.07) * 0.3);
  }
  groundGeo.computeVertexNormals();
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // boundary walls (stone-ish)
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x1a2c14, roughness: 1 });
  const halfArena = ARENA;
  const wallH = 8;
  [[0, halfArena], [0, -halfArena]].forEach(([x, z]) => {
    const w = new THREE.Mesh(new THREE.BoxGeometry(ARENA * 2, wallH, 1), wallMat);
    w.position.set(x, wallH / 2, z);
    w.castShadow = true;
    scene.add(w);
  });
  [[halfArena, 0], [-halfArena, 0]].forEach(([x, z]) => {
    const w = new THREE.Mesh(new THREE.BoxGeometry(1, wallH, ARENA * 2), wallMat);
    w.position.set(x, wallH / 2, z);
    w.castShadow = true;
    scene.add(w);
  });
}

function spawnObstacles() {
  obstacles = [];
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x4a2e1a, roughness: 1 });
  const leafMat = new THREE.MeshStandardMaterial({ color: 0x2e7c33, roughness: 0.9 });
  const rockMat = new THREE.MeshStandardMaterial({ color: 0x4d4a44, roughness: 1 });
  const bushMat = new THREE.MeshStandardMaterial({ color: 0x357d3a, roughness: 1 });

  for (let i = 0; i < 60; i++) {
    const x = (Math.random() - 0.5) * ARENA * 1.7;
    const z = (Math.random() - 0.5) * ARENA * 1.7;
    if (Math.hypot(x, z) < 6) continue;
    const trunkH = 5 + Math.random() * 4;
    const trunkR = 0.3 + Math.random() * 0.3;
    const tree = new THREE.Group();
    const trunk = new THREE.Mesh(
      new THREE.CylinderGeometry(trunkR * 0.7, trunkR, trunkH, 6),
      trunkMat
    );
    trunk.position.y = trunkH / 2;
    trunk.castShadow = true;
    tree.add(trunk);
    const leaves = new THREE.Mesh(
      new THREE.IcosahedronGeometry(2 + Math.random() * 1.4, 0),
      leafMat
    );
    leaves.position.y = trunkH + 0.6;
    leaves.scale.set(1, 0.8, 1);
    leaves.castShadow = true;
    tree.add(leaves);
    tree.position.set(x, 0, z);
    scene.add(tree);
    obstacles.push({ mesh: tree, radius: trunkR + 0.4, x, z });
  }

  for (let i = 0; i < 25; i++) {
    const x = (Math.random() - 0.5) * ARENA * 1.6;
    const z = (Math.random() - 0.5) * ARENA * 1.6;
    if (Math.hypot(x, z) < 6) continue;
    const r = 0.6 + Math.random() * 1.2;
    const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(r, 0), rockMat);
    rock.position.set(x, r * 0.5, z);
    rock.castShadow = true;
    rock.receiveShadow = true;
    scene.add(rock);
    obstacles.push({ mesh: rock, radius: r + 0.2, x, z });
  }

  for (let i = 0; i < 80; i++) {
    const x = (Math.random() - 0.5) * ARENA * 1.8;
    const z = (Math.random() - 0.5) * ARENA * 1.8;
    const r = 0.4 + Math.random() * 0.5;
    const bush = new THREE.Mesh(new THREE.SphereGeometry(r, 6, 6), bushMat);
    bush.position.set(x, r * 0.5, z);
    bush.scale.set(1.4, 0.7, 1.4);
    scene.add(bush);
  }

  // a small outpost / hut
  const hutMat = new THREE.MeshStandardMaterial({ color: 0x6b4a2a, roughness: 1 });
  const hut = new THREE.Group();
  const base = new THREE.Mesh(new THREE.BoxGeometry(6, 3, 6), hutMat);
  base.position.y = 1.5;
  base.castShadow = true;
  hut.add(base);
  const roof = new THREE.Mesh(new THREE.ConeGeometry(5, 2.5, 4), new THREE.MeshStandardMaterial({ color: 0x3a2a18 }));
  roof.position.y = 4.25;
  roof.rotation.y = Math.PI / 4;
  hut.add(roof);
  hut.position.set(15, 0, -10);
  scene.add(hut);
  obstacles.push({ mesh: hut, radius: 4, x: 15, z: -10 });
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

  // muzzle flash
  muzzleFlash = new THREE.Mesh(
    new THREE.SphereGeometry(0.08, 8, 8),
    new THREE.MeshBasicMaterial({ color: 0xffd84d, transparent: true, opacity: 0 })
  );
  muzzleFlash.position.set(0.3, -0.22, -1.4);
  wg.add(muzzleFlash);

  // tweak per weapon
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

  // gun
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

function attachInput() {
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  canvas.addEventListener('click', onCanvasClick);
  document.addEventListener('pointerlockchange', onPointerLock);
  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mousedown', onMouseDown);
  document.addEventListener('mouseup', onMouseUp);

  // mobile
  const stick = document.getElementById('moveStick');
  if (stick) {
    stick.addEventListener('touchstart', onStickStart);
    stick.addEventListener('touchmove', onStickMove);
    stick.addEventListener('touchend', onStickEnd);
  }
  const fireBtn = document.getElementById('fireBtn');
  if (fireBtn) {
    fireBtn.addEventListener('touchstart', e => { e.preventDefault(); mouse.fireDown = true; tryFire(); });
    fireBtn.addEventListener('touchend', e => { e.preventDefault(); mouse.fireDown = false; });
  }
  const reload = document.getElementById('reloadTBtn');
  if (reload) reload.addEventListener('touchstart', e => { e.preventDefault(); reloadWeapon(); });
  const lookL = document.getElementById('lookLeftBtn');
  const lookR = document.getElementById('lookRightBtn');
  if (lookL) {
    lookL.addEventListener('touchstart', e => { e.preventDefault(); touch.lookLeft = true; });
    lookL.addEventListener('touchend', e => { e.preventDefault(); touch.lookLeft = false; });
  }
  if (lookR) {
    lookR.addEventListener('touchstart', e => { e.preventDefault(); touch.lookRight = true; });
    lookR.addEventListener('touchend', e => { e.preventDefault(); touch.lookRight = false; });
  }

  document.getElementById('exitGameBtn').onclick = () => endGame(false, true);
  document.getElementById('overlayBack').onclick = () => returnToBase();
}

function detachInput() {
  window.removeEventListener('keydown', onKeyDown);
  window.removeEventListener('keyup', onKeyUp);
  canvas.removeEventListener('click', onCanvasClick);
  document.removeEventListener('pointerlockchange', onPointerLock);
  document.removeEventListener('mousemove', onMouseMove);
  document.removeEventListener('mousedown', onMouseDown);
  document.removeEventListener('mouseup', onMouseUp);
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

function onStickStart(e) {
  e.preventDefault();
  const t = e.touches[0];
  const r = e.currentTarget.getBoundingClientRect();
  touch.cx = r.left + r.width / 2;
  touch.cy = r.top + r.height / 2;
  touch.active = true;
  updateStick(t.clientX, t.clientY);
}
function onStickMove(e) {
  e.preventDefault();
  if (!touch.active) return;
  const t = e.touches[0];
  updateStick(t.clientX, t.clientY);
}
function onStickEnd(e) {
  e.preventDefault();
  touch.active = false; touch.dx = 0; touch.dy = 0;
  const knob = document.querySelector('#moveStick .stick-knob');
  if (knob) knob.style.transform = 'translate(-50%, -50%)';
}
function updateStick(x, y) {
  const dx = x - touch.cx;
  const dy = y - touch.cy;
  const mag = Math.min(50, Math.hypot(dx, dy));
  const ang = Math.atan2(dy, dx);
  touch.dx = Math.cos(ang) * (mag / 50);
  touch.dy = Math.sin(ang) * (mag / 50);
  const knob = document.querySelector('#moveStick .stick-knob');
  if (knob) {
    const kx = Math.cos(ang) * mag;
    const ky = Math.sin(ang) * mag;
    knob.style.transform = `translate(calc(-50% + ${kx}px), calc(-50% + ${ky}px))`;
  }
}

function startLoop() {
  cancelAnimationFrame(raf);
  const tick = () => {
    raf = requestAnimationFrame(tick);
    const dt = Math.min(0.05, clock.getDelta());
    update(dt);
    renderer.render(scene, camera);
  };
  tick();
}

function update(dt) {
  if (!gameState || gameState.over) return;

  // touch look
  const lookSpeed = 1.6;
  if (touch.lookLeft) player.yaw += lookSpeed * dt;
  if (touch.lookRight) player.yaw -= lookSpeed * dt;

  // movement
  const forward = (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0);
  const strafe = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0);
  const mvF = forward + (-touch.dy);
  const mvS = strafe + (touch.dx);
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

  // collide
  const nextX = player.pos.x + dx;
  const nextZ = player.pos.z + dz;
  if (canMoveTo(nextX, player.pos.z)) player.pos.x = nextX;
  if (canMoveTo(player.pos.x, nextZ)) player.pos.z = nextZ;

  // arena bounds
  const limit = ARENA - 1.5;
  player.pos.x = Math.max(-limit, Math.min(limit, player.pos.x));
  player.pos.z = Math.max(-limit, Math.min(limit, player.pos.z));

  // bob
  const speed2 = (dx * dx + dz * dz);
  const bob = speed2 > 0 ? Math.sin(performance.now() * 0.01) * 0.04 : 0;
  camera.position.set(player.pos.x, player.pos.y + bob, player.pos.z);
  camera.rotation.set(player.pitch, player.yaw, 0, 'YXZ');

  // weapon sway
  if (weaponMesh) {
    weaponMesh.rotation.x = Math.sin(performance.now() * 0.005) * 0.005 + (gameState.reloading ? -0.5 : 0);
    weaponMesh.position.y = -0.02 + Math.sin(performance.now() * 0.008) * 0.01;
  }
  if (muzzleFlash) muzzleFlash.material.opacity *= 0.85;

  // fire (auto)
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

  // enemies
  for (const e of enemies) {
    if (e.dead) continue;
    const dxe = player.pos.x - e.mesh.position.x;
    const dze = player.pos.z - e.mesh.position.z;
    const dist = Math.hypot(dxe, dze);
    e.mesh.lookAt(player.pos.x, e.mesh.position.y + 1, player.pos.z);

    // approach until in range
    if (dist > (e.boss ? 8 : 14)) {
      const stepX = (dxe / (dist || 1)) * e.speed * dt;
      const stepZ = (dze / (dist || 1)) * e.speed * dt;
      const nx2 = e.mesh.position.x + stepX;
      const nz2 = e.mesh.position.z + stepZ;
      if (canMoveTo(nx2, e.mesh.position.z, e.radius)) e.mesh.position.x = nx2;
      if (canMoveTo(e.mesh.position.x, nz2, e.radius)) e.mesh.position.z = nz2;
    }

    // shoot at player
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
    // respawn bots when low
    if (aliveEnemies < 3) spawnEnemy(WORLD_CONFIG.botHealth, WORLD_CONFIG.botSpeed);
  }

  updateHUD();
}

function canMoveTo(x, z, r = 0.5) {
  for (const o of obstacles) {
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
  // spread
  tmpDir.x += (Math.random() - 0.5) * w.spread;
  tmpDir.y += (Math.random() - 0.5) * w.spread;
  tmpDir.z += (Math.random() - 0.5) * w.spread;
  tmpDir.normalize();
  const origin = camera.position.clone();

  let hitEnemy = null, hitDist = Infinity;
  for (const e of enemies) {
    if (e.dead) continue;
    const d = rayHitsEnemy(origin, tmpDir, e);
    if (d != null && d < hitDist && d < w.range) { hitDist = d; hitEnemy = e; }
  }
  if (hitEnemy) {
    let dmg = w.damage;
    if (w.splash) {
      // splash damages nearby
      const explosion = origin.clone().addScaledVector(tmpDir, hitDist);
      for (const e of enemies) {
        if (e.dead) continue;
        const d = e.mesh.position.distanceTo(explosion);
        if (d < w.splash) damageEnemy(e, dmg * (1 - d / w.splash));
      }
    } else {
      damageEnemy(hitEnemy, dmg);
    }
  }
}

function rayHitsEnemy(origin, dir, enemy) {
  // approximate enemy as vertical capsule
  const ex = enemy.mesh.position.x;
  const ez = enemy.mesh.position.z;
  const eyTop = enemy.mesh.position.y + enemy.height;
  const eyBot = enemy.mesh.position.y;
  // intersect with vertical cylinder of given radius
  const ox = origin.x, oz = origin.z;
  const dx = dir.x, dz = dir.z;
  const a = dx * dx + dz * dz;
  const b = 2 * ((ox - ex) * dx + (oz - ez) * dz);
  const c = (ox - ex) ** 2 + (oz - ez) ** 2 - enemy.radius * enemy.radius;
  const disc = b * b - 4 * a * c;
  if (disc < 0 || a === 0) return null;
  const t = (-b - Math.sqrt(disc)) / (2 * a);
  if (t <= 0) return null;
  const hitY = origin.y + dir.y * t;
  if (hitY < eyBot || hitY > eyTop) return null;
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

function onEnemyKilled(e) {
  gameState.kills += 1;
  const reward = gameState.mode === 'world'
    ? WORLD_CONFIG.rewardPerBotKill
    : (gameState.mission.rewardPerKill || 10);
  const bonus = e.boss ? 200 : 0;
  gameState.coinsEarned += reward + bonus;
  feedKill(e.boss ? '☠️ WARLORD ELIMINATED' : '🎯 Hostile down');
  updateHUD();
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
  // hitscan with chance to miss
  const accuracy = 0.55 + Math.random() * 0.2;
  if (Math.random() < accuracy) {
    gameState.health -= e.damage;
    flashHit();
    if (gameState.health <= 0) endGame(false);
  }
  // visual tracer from enemy to player
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

  // persist
  await Auth.saveProfile({
    coins: (Auth.profile.coins || 0) + totalCoins,
    kills_total: (Auth.profile.kills_total || 0) + gameState.kills,
    missions_completed: (Auth.profile.missions_completed || 0) + (victory && gameState.mode === 'mission' ? 1 : 0),
  });

  if (gameState.mode === 'mission') {
    await supabase.from(TABLES.missionRuns).insert({
      mission_id: gameState.mission.id,
      kills: gameState.kills,
      completed: victory,
      coins_earned: totalCoins,
      duration_seconds: dur,
    });
  }

  // overlay
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
  if (renderer) renderer.dispose();
  if (scene) {
    while (scene.children.length) scene.remove(scene.children[0]);
  }
  enemies = [];
  obstacles = [];
  bullets = [];
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

  // sync our pos every 600ms
  worldSyncInterval = setInterval(async () => {
    if (!gameState || gameState.over) return;
    await supabase.from(TABLES.worldPlayers)
      .update({
        x: player.pos.x, y: player.pos.y, z: player.pos.z, ry: player.yaw,
        last_seen: new Date().toISOString(),
        world_kills: (Auth.profile.kills_total || 0) + gameState.kills,
      })
      .eq('user_id', Auth.user.id);
  }, 600);

  // initial fetch
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

  // name tag (sprite)
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
