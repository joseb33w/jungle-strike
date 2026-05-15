// World builders — each mission gets a distinct, themed environment
// with interactive props (ammo crates, medkits, explosive barrels, torches).
import * as THREE from 'three';

const ARENA = 80;

// ============================================================
// PUBLIC: build a world for a given mission id ("recon", "boss",
// "survival", "world"). Returns { obstacles, props, ambient }
// where:
//   obstacles  = solid blockers used for collision
//   props      = { ammoCrates, medkits, barrels, torches, flags }
//   ambient    = { update(dt) }  // per-frame env animation
// ============================================================
export function buildWorld(scene, missionId) {
  const config = THEMES[missionId] || THEMES.world;
  configureSceneAtmosphere(scene, config);
  const obstacles = [];
  const props = {
    ammoCrates: [],
    medkits: [],
    barrels: [],
    torches: [],
    flags: [],
    capturePoints: [],
  };

  // Ground (varies per theme)
  buildGround(scene, config);

  // Boundary walls
  buildBoundary(scene, config);

  // Foliage / rocks (density and palette per theme)
  scatterFoliage(scene, obstacles, config);

  // Theme-specific landmarks
  if (missionId === 'recon') {
    buildRiver(scene, obstacles, props);
    buildWatchTower(scene, obstacles, props, -25, 15);
    buildAmmoCrate(scene, props, 8, -8);
    buildMedkit(scene, props, -8, 8);
    buildTorch(scene, props, 14, 14);
  } else if (missionId === 'boss') {
    buildCartelCamp(scene, obstacles, props);
    buildAmmoCrate(scene, props, -10, 4);
    buildAmmoCrate(scene, props, 12, -6);
    buildBarrel(scene, obstacles, props, 6, 10);
    buildBarrel(scene, obstacles, props, -4, 14);
    buildBarrel(scene, obstacles, props, 18, -2);
    buildTorch(scene, props, 0, -16);
    buildTorch(scene, props, -16, -2);
    buildTorch(scene, props, 16, -2);
    buildMedkit(scene, props, 0, 20);
  } else if (missionId === 'survival') {
    buildOutpost(scene, obstacles, props);
    // outpost has lots of ammo/med supplies
    buildAmmoCrate(scene, props, -5, -3);
    buildAmmoCrate(scene, props, 5, -3);
    buildMedkit(scene, props, 0, -5);
    buildMedkit(scene, props, -8, 4);
    buildMedkit(scene, props, 8, 4);
    buildBarrel(scene, obstacles, props, -14, 0);
    buildBarrel(scene, obstacles, props, 14, 0);
    buildTorch(scene, props, -6, -6);
    buildTorch(scene, props, 6, -6);
  } else {
    // Open World — multi-biome
    buildTempleRuins(scene, obstacles, props);
    buildCartelOutpost(scene, obstacles, props);
    buildWatchTower(scene, obstacles, props, 30, -25);
    buildWatchTower(scene, obstacles, props, -30, 25);
    buildRiver(scene, obstacles, props);
    buildAmmoCrate(scene, props, 12, -8);
    buildAmmoCrate(scene, props, -18, 14);
    buildAmmoCrate(scene, props, 22, 22);
    buildMedkit(scene, props, -12, -18);
    buildMedkit(scene, props, 20, 6);
    buildBarrel(scene, obstacles, props, 4, 20);
    buildBarrel(scene, obstacles, props, -20, -8);
    buildTorch(scene, props, 0, 30);
    buildTorch(scene, props, -30, 0);
    buildTorch(scene, props, 30, 0);
    // capture flag
    buildCaptureFlag(scene, props, 0, 0);
  }

  // animated ambient updater
  const ambient = makeAmbient(config, props);
  return { obstacles, props, ambient, config };
}

// ============================================================
// THEMES
// ============================================================
const THEMES = {
  recon: {
    name: 'River Basin',
    sky: 0x4ea3c8,         // light teal sky
    fog: 0x9dc8b0,
    fogNear: 30, fogFar: 110,
    groundColor: 0x4d7a3c,
    foliageDensity: 1.0,
    foliagePalette: { trunk: 0x4a2e1a, leaves: 0x4ea632, bush: 0x357d3a },
    ambientPower: 1.0,
    sunColor: 0xfff4d0,
  },
  boss: {
    name: 'Deep Canopy',
    sky: 0x1a0a0a,
    fog: 0x3a1a1a,
    fogNear: 12, fogFar: 65,
    groundColor: 0x1d3019,
    foliageDensity: 1.4,
    foliagePalette: { trunk: 0x2b1a0e, leaves: 0x1f4422, bush: 0x1f4424 },
    ambientPower: 0.45,
    sunColor: 0xff7a4d,
  },
  survival: {
    name: 'Ranger Outpost',
    sky: 0x5c4a2a,         // dusk
    fog: 0x6b4f2a,
    fogNear: 20, fogFar: 90,
    groundColor: 0x4a3b22,
    foliageDensity: 0.7,
    foliagePalette: { trunk: 0x3a2818, leaves: 0x5a6b2a, bush: 0x4a5a26 },
    ambientPower: 0.7,
    sunColor: 0xffb368,
  },
  world: {
    name: 'Open Jungle',
    sky: 0x355c2c,
    fog: 0x355c2c,
    fogNear: 18, fogFar: 100,
    groundColor: 0x2d5a23,
    foliageDensity: 1.1,
    foliagePalette: { trunk: 0x4a2e1a, leaves: 0x2e7c33, bush: 0x357d3a },
    ambientPower: 0.85,
    sunColor: 0xfffaf0,
  },
};

function configureSceneAtmosphere(scene, config) {
  scene.background = new THREE.Color(config.sky);
  scene.fog = new THREE.Fog(config.fog, config.fogNear, config.fogFar);

  const hemi = new THREE.HemisphereLight(0xa8d979, 0x224c1f, 0.85 * config.ambientPower);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(config.sunColor, config.ambientPower);
  sun.position.set(40, 60, 30);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = -50;
  sun.shadow.camera.right = 50;
  sun.shadow.camera.top = 50;
  sun.shadow.camera.bottom = -50;
  scene.add(sun);
}

function buildGround(scene, config) {
  const g = new THREE.PlaneGeometry(ARENA * 4, ARENA * 4, 60, 60);
  const m = new THREE.MeshStandardMaterial({
    color: config.groundColor,
    roughness: 1,
    metalness: 0,
  });
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i);
    pos.setZ(i, Math.sin(x * 0.08) * 0.3 + Math.cos(y * 0.07) * 0.3);
  }
  g.computeVertexNormals();
  const ground = new THREE.Mesh(g, m);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
}

function buildBoundary(scene, config) {
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x1a2c14, roughness: 1 });
  const wallH = 8;
  [[0, ARENA], [0, -ARENA]].forEach(([x, z]) => {
    const w = new THREE.Mesh(new THREE.BoxGeometry(ARENA * 2, wallH, 1), wallMat);
    w.position.set(x, wallH / 2, z);
    w.castShadow = true;
    scene.add(w);
  });
  [[ARENA, 0], [-ARENA, 0]].forEach(([x, z]) => {
    const w = new THREE.Mesh(new THREE.BoxGeometry(1, wallH, ARENA * 2), wallMat);
    w.position.set(x, wallH / 2, z);
    w.castShadow = true;
    scene.add(w);
  });
}

function scatterFoliage(scene, obstacles, config) {
  const trunkMat = new THREE.MeshStandardMaterial({ color: config.foliagePalette.trunk, roughness: 1 });
  const leafMat = new THREE.MeshStandardMaterial({ color: config.foliagePalette.leaves, roughness: 0.9 });
  const rockMat = new THREE.MeshStandardMaterial({ color: 0x4d4a44, roughness: 1 });
  const bushMat = new THREE.MeshStandardMaterial({ color: config.foliagePalette.bush, roughness: 1 });

  const treeCount = Math.round(60 * config.foliageDensity);
  for (let i = 0; i < treeCount; i++) {
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

  const bushCount = Math.round(80 * config.foliageDensity);
  for (let i = 0; i < bushCount; i++) {
    const x = (Math.random() - 0.5) * ARENA * 1.8;
    const z = (Math.random() - 0.5) * ARENA * 1.8;
    const r = 0.4 + Math.random() * 0.5;
    const bush = new THREE.Mesh(new THREE.SphereGeometry(r, 6, 6), bushMat);
    bush.position.set(x, r * 0.5, z);
    bush.scale.set(1.4, 0.7, 1.4);
    scene.add(bush);
  }
}

// ============================================================
// LANDMARKS
// ============================================================
function buildRiver(scene, obstacles, props) {
  // Blue water plane crossing the arena
  const riverGeo = new THREE.PlaneGeometry(ARENA * 2.4, 14, 1, 1);
  const riverMat = new THREE.MeshStandardMaterial({
    color: 0x2a8fb0, roughness: 0.2, metalness: 0.4,
    transparent: true, opacity: 0.85,
  });
  const river = new THREE.Mesh(riverGeo, riverMat);
  river.rotation.x = -Math.PI / 2;
  river.position.set(0, 0.02, 22);
  river.userData.isRiver = true;
  scene.add(river);
  props.river = river;

  // Bridge across
  const bridgeMat = new THREE.MeshStandardMaterial({ color: 0x6b4a2a, roughness: 1 });
  const deck = new THREE.Mesh(new THREE.BoxGeometry(6, 0.4, 16), bridgeMat);
  deck.position.set(0, 0.4, 22);
  deck.castShadow = true;
  scene.add(deck);
  for (let i = -1; i <= 1; i += 2) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.2, 1, 16), bridgeMat);
    rail.position.set(i * 2.8, 1, 22);
    scene.add(rail);
  }
}

function buildWatchTower(scene, obstacles, props, x, z) {
  const tower = new THREE.Group();
  const woodMat = new THREE.MeshStandardMaterial({ color: 0x6b4a2a, roughness: 1 });
  // 4 legs
  for (let i = 0; i < 4; i++) {
    const ang = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.4, 6, 0.4), woodMat);
    leg.position.set(Math.cos(ang) * 1.8, 3, Math.sin(ang) * 1.8);
    leg.castShadow = true;
    tower.add(leg);
  }
  // platform
  const platform = new THREE.Mesh(new THREE.BoxGeometry(5, 0.4, 5), woodMat);
  platform.position.y = 6;
  platform.castShadow = true;
  tower.add(platform);
  // roof
  const roof = new THREE.Mesh(new THREE.ConeGeometry(4, 2.5, 4), new THREE.MeshStandardMaterial({ color: 0x3a2a18 }));
  roof.position.y = 7.5;
  roof.rotation.y = Math.PI / 4;
  tower.add(roof);
  tower.position.set(x, 0, z);
  scene.add(tower);
  obstacles.push({ mesh: tower, radius: 2.4, x, z });
}

function buildCartelCamp(scene, obstacles, props) {
  // central tent / warlord throne
  const tent = new THREE.Group();
  const tentMat = new THREE.MeshStandardMaterial({ color: 0x4a1c1c, roughness: 1 });
  const peak = new THREE.Mesh(new THREE.ConeGeometry(5, 5, 6), tentMat);
  peak.position.y = 2.5;
  peak.castShadow = true;
  tent.add(peak);
  tent.position.set(0, 0, -25);
  scene.add(tent);
  obstacles.push({ mesh: tent, radius: 4.5, x: 0, z: -25 });

  // crates scattered around
  const crateMat = new THREE.MeshStandardMaterial({ color: 0x6b4a2a, roughness: 1 });
  const crateSpots = [[-6, -18], [-10, -22], [-8, -14], [10, -20], [12, -16], [6, -22]];
  for (const [cx, cz] of crateSpots) {
    const crate = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.4, 1.4), crateMat);
    crate.position.set(cx, 0.7, cz);
    crate.castShadow = true;
    scene.add(crate);
    obstacles.push({ mesh: crate, radius: 1.0, x: cx, z: cz });
  }
}

function buildOutpost(scene, obstacles, props) {
  // central hut
  const hutMat = new THREE.MeshStandardMaterial({ color: 0x6b4a2a, roughness: 1 });
  const hut = new THREE.Group();
  const base = new THREE.Mesh(new THREE.BoxGeometry(8, 4, 8), hutMat);
  base.position.y = 2;
  base.castShadow = true;
  hut.add(base);
  const roof = new THREE.Mesh(new THREE.ConeGeometry(6, 3, 4), new THREE.MeshStandardMaterial({ color: 0x3a2a18 }));
  roof.position.y = 5.5;
  roof.rotation.y = Math.PI / 4;
  hut.add(roof);
  hut.position.set(0, 0, 0);
  scene.add(hut);
  obstacles.push({ mesh: hut, radius: 5, x: 0, z: 0 });

  // sandbag perimeter
  const sandMat = new THREE.MeshStandardMaterial({ color: 0x8a7842, roughness: 1 });
  for (let i = 0; i < 16; i++) {
    const ang = (i / 16) * Math.PI * 2;
    const r = 11;
    const sx = Math.cos(ang) * r;
    const sz = Math.sin(ang) * r;
    const sb = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.8, 0.8), sandMat);
    sb.position.set(sx, 0.4, sz);
    sb.rotation.y = ang + Math.PI / 2;
    sb.castShadow = true;
    scene.add(sb);
    obstacles.push({ mesh: sb, radius: 0.9, x: sx, z: sz });
  }
}

function buildTempleRuins(scene, obstacles, props) {
  // Stone pillars in a circle
  const stoneMat = new THREE.MeshStandardMaterial({ color: 0x9e9484, roughness: 1 });
  for (let i = 0; i < 6; i++) {
    const ang = (i / 6) * Math.PI * 2;
    const r = 12;
    const px = -30 + Math.cos(ang) * r;
    const pz = -30 + Math.sin(ang) * r;
    const h = 6 + Math.random() * 2;
    const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.9, h, 8), stoneMat);
    pillar.position.set(px, h / 2, pz);
    pillar.castShadow = true;
    scene.add(pillar);
    obstacles.push({ mesh: pillar, radius: 1.0, x: px, z: pz });
  }
  // Central altar
  const altar = new THREE.Mesh(new THREE.BoxGeometry(4, 1.4, 4), stoneMat);
  altar.position.set(-30, 0.7, -30);
  altar.castShadow = true;
  scene.add(altar);
  obstacles.push({ mesh: altar, radius: 2.5, x: -30, z: -30 });
}

function buildCartelOutpost(scene, obstacles, props) {
  const woodMat = new THREE.MeshStandardMaterial({ color: 0x4a2e1a, roughness: 1 });
  // shack
  const shack = new THREE.Mesh(new THREE.BoxGeometry(7, 4, 5), woodMat);
  shack.position.set(25, 2, 20);
  shack.castShadow = true;
  scene.add(shack);
  obstacles.push({ mesh: shack, radius: 4, x: 25, z: 20 });
  // truck (suggestion of)
  const truckBody = new THREE.Mesh(new THREE.BoxGeometry(2.5, 1.4, 5), new THREE.MeshStandardMaterial({ color: 0x3a4a3a }));
  truckBody.position.set(20, 1.2, 14);
  truckBody.castShadow = true;
  scene.add(truckBody);
  obstacles.push({ mesh: truckBody, radius: 2.4, x: 20, z: 14 });
}

// ============================================================
// INTERACTIVE PROPS
// ============================================================
function buildAmmoCrate(scene, props, x, z) {
  const g = new THREE.Group();
  const box = new THREE.Mesh(
    new THREE.BoxGeometry(1.2, 1, 0.8),
    new THREE.MeshStandardMaterial({ color: 0x4a5a2e, roughness: 0.8 }),
  );
  box.position.y = 0.5;
  box.castShadow = true;
  g.add(box);
  // gold accent stripe
  const stripe = new THREE.Mesh(
    new THREE.BoxGeometry(1.22, 0.18, 0.82),
    new THREE.MeshStandardMaterial({ color: 0xffc857, emissive: 0xffc857, emissiveIntensity: 0.3 }),
  );
  stripe.position.y = 0.5;
  g.add(stripe);
  // glowing icon plate
  const plate = new THREE.Mesh(
    new THREE.PlaneGeometry(0.5, 0.5),
    new THREE.MeshBasicMaterial({ color: 0xffc857 }),
  );
  plate.position.set(0, 0.5, 0.42);
  g.add(plate);
  g.position.set(x, 0, z);
  scene.add(g);
  props.ammoCrates.push({
    mesh: g, x, z, radius: 1.0,
    used: false, cooldownUntil: 0,
    type: 'ammo',
  });
}

function buildMedkit(scene, props, x, z) {
  const g = new THREE.Group();
  const box = new THREE.Mesh(
    new THREE.BoxGeometry(0.9, 0.7, 0.6),
    new THREE.MeshStandardMaterial({ color: 0xf3eddc, roughness: 0.6 }),
  );
  box.position.y = 0.35;
  box.castShadow = true;
  g.add(box);
  // red cross
  const v = new THREE.Mesh(
    new THREE.BoxGeometry(0.15, 0.5, 0.05),
    new THREE.MeshBasicMaterial({ color: 0xff4d5e }),
  );
  v.position.set(0, 0.35, 0.32);
  g.add(v);
  const h = new THREE.Mesh(
    new THREE.BoxGeometry(0.5, 0.15, 0.05),
    new THREE.MeshBasicMaterial({ color: 0xff4d5e }),
  );
  h.position.set(0, 0.35, 0.32);
  g.add(h);
  // glow ring
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.8, 1.0, 24),
    new THREE.MeshBasicMaterial({ color: 0xff4d5e, transparent: true, opacity: 0.4, side: THREE.DoubleSide }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.05;
  g.add(ring);
  g.userData.ring = ring;
  g.position.set(x, 0, z);
  scene.add(g);
  props.medkits.push({
    mesh: g, x, z, radius: 1.0,
    used: false, cooldownUntil: 0,
    type: 'medkit',
  });
}

function buildBarrel(scene, obstacles, props, x, z) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(0.55, 0.55, 1.4, 12),
    new THREE.MeshStandardMaterial({ color: 0xa83a1c, roughness: 0.7, metalness: 0.3 }),
  );
  body.position.y = 0.7;
  body.castShadow = true;
  g.add(body);
  const top = new THREE.Mesh(
    new THREE.CylinderGeometry(0.58, 0.58, 0.08, 12),
    new THREE.MeshStandardMaterial({ color: 0x2a2a2a }),
  );
  top.position.y = 1.42;
  g.add(top);
  // hazard stripe
  const stripe = new THREE.Mesh(
    new THREE.CylinderGeometry(0.56, 0.56, 0.18, 12),
    new THREE.MeshBasicMaterial({ color: 0xffc857 }),
  );
  stripe.position.y = 0.7;
  g.add(stripe);
  g.position.set(x, 0, z);
  scene.add(g);
  const barrel = {
    mesh: g, x, z, radius: 0.7, health: 25,
    splashRadius: 7, splashDamage: 90,
    exploded: false,
  };
  props.barrels.push(barrel);
  obstacles.push({ mesh: g, radius: 0.7, x, z, barrelRef: barrel });
}

function buildTorch(scene, props, x, z) {
  const g = new THREE.Group();
  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.08, 0.1, 3, 6),
    new THREE.MeshStandardMaterial({ color: 0x2a1a0e }),
  );
  pole.position.y = 1.5;
  pole.castShadow = true;
  g.add(pole);
  const bowl = new THREE.Mesh(
    new THREE.CylinderGeometry(0.3, 0.2, 0.3, 8),
    new THREE.MeshStandardMaterial({ color: 0x2a2a2a }),
  );
  bowl.position.y = 3.15;
  g.add(bowl);
  const flame = new THREE.Mesh(
    new THREE.ConeGeometry(0.3, 0.7, 8),
    new THREE.MeshBasicMaterial({ color: 0xff9a3d, transparent: true, opacity: 0.95 }),
  );
  flame.position.y = 3.6;
  g.add(flame);
  const flameCore = new THREE.Mesh(
    new THREE.ConeGeometry(0.18, 0.5, 8),
    new THREE.MeshBasicMaterial({ color: 0xfff09a, transparent: true, opacity: 1 }),
  );
  flameCore.position.y = 3.55;
  g.add(flameCore);
  const light = new THREE.PointLight(0xff9a3d, 1.4, 14, 2);
  light.position.y = 3.5;
  g.add(light);
  g.position.set(x, 0, z);
  scene.add(g);
  props.torches.push({ mesh: g, flame, flameCore, light, x, z });
}

function buildCaptureFlag(scene, props, x, z) {
  const g = new THREE.Group();
  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.08, 0.08, 5, 6),
    new THREE.MeshStandardMaterial({ color: 0x2a2a2a, metalness: 0.5 }),
  );
  pole.position.y = 2.5;
  g.add(pole);
  const flag = new THREE.Mesh(
    new THREE.PlaneGeometry(2.2, 1.4),
    new THREE.MeshStandardMaterial({ color: 0xc8ff5d, side: THREE.DoubleSide, emissive: 0x4a6b1a, emissiveIntensity: 0.4 }),
  );
  flag.position.set(1.2, 4, 0);
  g.add(flag);
  // glow base
  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(2.5, 2.5, 0.1, 24),
    new THREE.MeshBasicMaterial({ color: 0xc8ff5d, transparent: true, opacity: 0.25 }),
  );
  base.position.y = 0.05;
  g.add(base);
  g.position.set(x, 0, z);
  scene.add(g);
  props.flags.push({ mesh: g, flag, base, x, z, radius: 2.5 });
}

// ============================================================
// AMBIENT ANIMATIONS (torches flicker, pickups bob, water moves)
// ============================================================
function makeAmbient(config, props) {
  return {
    update(dt) {
      const t = performance.now() * 0.001;
      // torch flicker
      for (const tr of props.torches) {
        tr.flame.scale.y = 1 + Math.sin(t * 14 + tr.x) * 0.18 + Math.random() * 0.08;
        tr.flameCore.scale.y = 1 + Math.sin(t * 18 + tr.z) * 0.22 + Math.random() * 0.08;
        tr.light.intensity = 1.2 + Math.sin(t * 12 + tr.x) * 0.4 + Math.random() * 0.2;
      }
      // ammo crate hover + spin
      for (const c of props.ammoCrates) {
        if (c.used && performance.now() < c.cooldownUntil) continue;
        c.mesh.position.y = Math.sin(t * 2 + c.x) * 0.15;
        c.mesh.rotation.y += dt * 0.6;
      }
      // medkit bob + ring pulse
      for (const m of props.medkits) {
        if (m.used && performance.now() < m.cooldownUntil) continue;
        m.mesh.position.y = 0.2 + Math.sin(t * 3 + m.z) * 0.15;
        m.mesh.rotation.y += dt * 0.4;
        const ring = m.mesh.userData.ring;
        if (ring) {
          const s = 1 + Math.sin(t * 4 + m.z) * 0.2;
          ring.scale.set(s, s, s);
          ring.material.opacity = 0.3 + Math.sin(t * 4 + m.z) * 0.2;
        }
      }
      // flag wave
      for (const f of props.flags) {
        f.flag.rotation.y = Math.sin(t * 2) * 0.2;
        const s = 1 + Math.sin(t * 3) * 0.05;
        f.base.scale.set(s, 1, s);
      }
      // river shimmer
      if (props.river) {
        props.river.material.opacity = 0.78 + Math.sin(t * 1.6) * 0.08;
      }
    },
  };
}
