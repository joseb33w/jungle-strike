// =============================================================
// Jungle Strike — Humanoid character builder
// Builds anatomically-proportioned soldier figures with full limbs,
// weapon, helmet, tactical gear, and animated walking/aiming.
// Each enemy is a Group with userData.rig pointing to the bone parts
// so the game loop can animate them.
// =============================================================
import * as THREE from 'three';

const MAT_CACHE = new Map();
function mat(color, opts = {}) {
  const key = color + ':' + JSON.stringify(opts);
  if (MAT_CACHE.has(key)) return MAT_CACHE.get(key);
  const m = new THREE.MeshStandardMaterial({
    color, roughness: opts.rough ?? 0.7, metalness: opts.metal ?? 0.05,
    emissive: opts.emissive || 0x000000, emissiveIntensity: opts.emissiveIntensity || 0,
  });
  MAT_CACHE.set(key, m);
  return m;
}

/**
 * Build a realistic-proportioned humanoid soldier.
 * preset: 'enemy' | 'boss' | 'remote' | 'cartel' | 'ranger'
 * Returns a THREE.Group with userData.rig = { leftLeg, rightLeg, leftArm, rightArm, torso, head, gun, gunMuzzle, breath }
 */
export function buildHumanoid(preset = 'enemy', opts = {}) {
  const cfg = PRESETS[preset] || PRESETS.enemy;
  const scale = opts.scale || cfg.scale || 1;
  const group = new THREE.Group();
  const rig = {};

  // ---- Skin tones & uniform colors ----
  const skin = cfg.skin;
  const uniform = cfg.uniform;
  const uniformDark = cfg.uniformDark;
  const boots = 0x1a1a1a;
  const gunBody = 0x202020;
  const gunMetal = 0x3a3a3a;

  // ---- Pelvis (root for legs) ----
  const pelvis = new THREE.Group();
  pelvis.position.y = 0.85 * scale;
  group.add(pelvis);
  rig.pelvis = pelvis;

  // ---- Torso ----
  const torso = new THREE.Group();
  torso.position.y = 0.15 * scale;
  pelvis.add(torso);
  rig.torso = torso;

  // Lower torso (waist/belt)
  const waist = new THREE.Mesh(
    new THREE.CylinderGeometry(0.22 * scale, 0.26 * scale, 0.18 * scale, 12),
    mat(uniformDark, { rough: 0.85 })
  );
  waist.position.y = 0;
  waist.castShadow = true;
  torso.add(waist);

  // Belt
  const belt = new THREE.Mesh(
    new THREE.CylinderGeometry(0.27 * scale, 0.27 * scale, 0.06 * scale, 12),
    mat(0x1a0f08, { rough: 0.6 })
  );
  belt.position.y = 0.04 * scale;
  torso.add(belt);

  // Belt buckle
  const buckle = new THREE.Mesh(
    new THREE.BoxGeometry(0.08 * scale, 0.05 * scale, 0.04 * scale),
    mat(0x9a7a3a, { rough: 0.4, metal: 0.7 })
  );
  buckle.position.set(0, 0.04 * scale, 0.26 * scale);
  torso.add(buckle);

  // Upper torso (chest) — slightly wider at shoulders
  const chest = new THREE.Mesh(
    new THREE.CylinderGeometry(0.32 * scale, 0.24 * scale, 0.55 * scale, 14),
    mat(uniform, { rough: 0.85 })
  );
  chest.position.y = 0.4 * scale;
  chest.castShadow = true;
  torso.add(chest);

  // Tactical vest (front)
  const vest = new THREE.Mesh(
    new THREE.BoxGeometry(0.5 * scale, 0.45 * scale, 0.18 * scale),
    mat(uniformDark, { rough: 0.9 })
  );
  vest.position.set(0, 0.4 * scale, 0.18 * scale);
  vest.castShadow = true;
  torso.add(vest);

  // Vest pouches
  for (let i = -1; i <= 1; i += 2) {
    const pouch = new THREE.Mesh(
      new THREE.BoxGeometry(0.14 * scale, 0.16 * scale, 0.07 * scale),
      mat(0x2a1a0a, { rough: 0.9 })
    );
    pouch.position.set(i * 0.14 * scale, 0.32 * scale, 0.27 * scale);
    torso.add(pouch);
    const strap = new THREE.Mesh(
      new THREE.BoxGeometry(0.02 * scale, 0.05 * scale, 0.02 * scale),
      mat(0x6a4a1a, { rough: 0.6 })
    );
    strap.position.set(i * 0.14 * scale, 0.41 * scale, 0.31 * scale);
    torso.add(strap);
  }

  // Shoulder pads
  for (let i = -1; i <= 1; i += 2) {
    const pad = new THREE.Mesh(
      new THREE.SphereGeometry(0.13 * scale, 10, 8, 0, Math.PI),
      mat(uniformDark, { rough: 0.85 })
    );
    pad.position.set(i * 0.3 * scale, 0.62 * scale, 0);
    pad.rotation.z = i * Math.PI / 2;
    pad.castShadow = true;
    torso.add(pad);
  }

  // Neck
  const neck = new THREE.Mesh(
    new THREE.CylinderGeometry(0.085 * scale, 0.1 * scale, 0.1 * scale, 10),
    mat(skin, { rough: 0.7 })
  );
  neck.position.y = 0.72 * scale;
  torso.add(neck);

  // ---- Head ----
  const head = new THREE.Group();
  head.position.y = 0.82 * scale;
  torso.add(head);
  rig.head = head;

  const skull = new THREE.Mesh(
    new THREE.SphereGeometry(0.16 * scale, 16, 14),
    mat(skin, { rough: 0.6 })
  );
  skull.scale.set(1, 1.15, 1.05);
  skull.castShadow = true;
  head.add(skull);

  // Jaw / chin
  const jaw = new THREE.Mesh(
    new THREE.SphereGeometry(0.13 * scale, 12, 10),
    mat(skin, { rough: 0.65 })
  );
  jaw.position.y = -0.06 * scale;
  jaw.scale.set(0.95, 0.7, 0.95);
  head.add(jaw);

  // Eyes
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const pupilMat = new THREE.MeshBasicMaterial({ color: cfg.eyeColor || 0x0a0a0a });
  for (let i = -1; i <= 1; i += 2) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.025 * scale, 8, 8), eyeMat);
    eye.position.set(i * 0.06 * scale, 0.02 * scale, 0.14 * scale);
    head.add(eye);
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.012 * scale, 6, 6), pupilMat);
    pupil.position.set(i * 0.06 * scale, 0.02 * scale, 0.16 * scale);
    head.add(pupil);
  }

  // Eyebrows (angry for enemies)
  if (cfg.angry) {
    for (let i = -1; i <= 1; i += 2) {
      const brow = new THREE.Mesh(
        new THREE.BoxGeometry(0.06 * scale, 0.015 * scale, 0.02 * scale),
        mat(0x1a0e08, { rough: 1 })
      );
      brow.position.set(i * 0.06 * scale, 0.07 * scale, 0.15 * scale);
      brow.rotation.z = -i * 0.4;
      head.add(brow);
    }
  }

  // Nose
  const nose = new THREE.Mesh(
    new THREE.ConeGeometry(0.025 * scale, 0.06 * scale, 6),
    mat(skin, { rough: 0.7 })
  );
  nose.position.set(0, 0, 0.17 * scale);
  nose.rotation.x = Math.PI / 2;
  head.add(nose);

  // Mouth
  const mouth = new THREE.Mesh(
    new THREE.BoxGeometry(0.05 * scale, 0.008 * scale, 0.01 * scale),
    mat(0x4a1a14, { rough: 0.8 })
  );
  mouth.position.set(0, -0.05 * scale, 0.16 * scale);
  head.add(mouth);

  // Ears
  for (let i = -1; i <= 1; i += 2) {
    const ear = new THREE.Mesh(
      new THREE.SphereGeometry(0.03 * scale, 8, 6),
      mat(skin, { rough: 0.7 })
    );
    ear.position.set(i * 0.16 * scale, 0, 0);
    ear.scale.set(0.5, 1, 0.7);
    head.add(ear);
  }

  // Helmet / hat
  if (cfg.helmet) {
    const helmet = new THREE.Mesh(
      new THREE.SphereGeometry(0.19 * scale, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.55),
      mat(cfg.helmetColor || 0x2a3a1a, { rough: 0.7, metal: 0.3 })
    );
    helmet.position.y = 0.04 * scale;
    helmet.castShadow = true;
    head.add(helmet);
    // Helmet rim
    const rim = new THREE.Mesh(
      new THREE.TorusGeometry(0.19 * scale, 0.012 * scale, 6, 20),
      mat(0x1a1a1a, { rough: 0.4, metal: 0.6 })
    );
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 0.04 * scale;
    head.add(rim);
    // NVG mount or strap
    if (cfg.helmetAccent) {
      const accent = new THREE.Mesh(
        new THREE.BoxGeometry(0.08 * scale, 0.03 * scale, 0.04 * scale),
        mat(cfg.helmetAccent, { rough: 0.4, metal: 0.6, emissive: cfg.helmetAccent, emissiveIntensity: 0.3 })
      );
      accent.position.set(0, 0.16 * scale, 0.16 * scale);
      head.add(accent);
    }
  } else if (cfg.bandana) {
    const band = new THREE.Mesh(
      new THREE.CylinderGeometry(0.165 * scale, 0.165 * scale, 0.07 * scale, 16),
      mat(cfg.bandana, { rough: 0.9 })
    );
    band.position.y = 0.05 * scale;
    head.add(band);
    // Knot tail
    const tail = new THREE.Mesh(
      new THREE.BoxGeometry(0.04 * scale, 0.12 * scale, 0.02 * scale),
      mat(cfg.bandana, { rough: 0.9 })
    );
    tail.position.set(0.12 * scale, 0.02 * scale, -0.1 * scale);
    tail.rotation.z = 0.3;
    head.add(tail);
  }

  // ---- Arms ----
  rig.leftArm = buildArm(scale, uniform, uniformDark, skin, +1);
  rig.rightArm = buildArm(scale, uniform, uniformDark, skin, -1);
  rig.leftArm.position.set(-0.34 * scale, 0.62 * scale, 0);
  rig.rightArm.position.set(0.34 * scale, 0.62 * scale, 0);
  torso.add(rig.leftArm);
  torso.add(rig.rightArm);

  // ---- Legs ----
  rig.leftLeg = buildLeg(scale, uniformDark, boots);
  rig.rightLeg = buildLeg(scale, uniformDark, boots);
  rig.leftLeg.position.set(-0.14 * scale, 0, 0);
  rig.rightLeg.position.set(0.14 * scale, 0, 0);
  pelvis.add(rig.leftLeg);
  pelvis.add(rig.rightLeg);

  // ---- Gun (held in right arm) ----
  const gun = buildGun(scale, cfg.weaponClass || 'rifle', gunBody, gunMetal);
  // Attach gun to right arm hand position so it follows arm rotation
  gun.position.set(0, -0.45 * scale, 0.08 * scale);
  rig.rightArm.add(gun);
  rig.gun = gun;
  rig.gunMuzzle = gun.userData.muzzle;

  // Pose arms forward holding gun (combat ready)
  rig.rightArm.rotation.x = -1.1;
  rig.leftArm.rotation.x = -0.95;
  rig.leftArm.rotation.z = 0.25;

  // Total height: pelvis at 0.85, head top at ~2.0 units scale=1
  rig.totalHeight = 2.0 * scale;
  rig.radius = 0.42 * scale;
  group.userData.rig = rig;
  group.userData.preset = preset;
  return group;
}

function buildArm(scale, sleeveColor, sleeveDark, skinColor, side) {
  const arm = new THREE.Group();
  // Upper arm (sleeve)
  const upper = new THREE.Mesh(
    new THREE.CylinderGeometry(0.08 * scale, 0.075 * scale, 0.32 * scale, 10),
    mat(sleeveColor, { rough: 0.85 })
  );
  upper.position.y = -0.16 * scale;
  upper.castShadow = true;
  arm.add(upper);
  // Elbow joint
  const elbow = new THREE.Mesh(
    new THREE.SphereGeometry(0.075 * scale, 10, 8),
    mat(sleeveColor, { rough: 0.85 })
  );
  elbow.position.y = -0.32 * scale;
  arm.add(elbow);
  // Forearm
  const fore = new THREE.Mesh(
    new THREE.CylinderGeometry(0.07 * scale, 0.065 * scale, 0.3 * scale, 10),
    mat(sleeveDark, { rough: 0.85 })
  );
  fore.position.y = -0.48 * scale;
  fore.castShadow = true;
  arm.add(fore);
  // Glove / hand
  const hand = new THREE.Mesh(
    new THREE.BoxGeometry(0.1 * scale, 0.12 * scale, 0.08 * scale),
    mat(0x1a1a1a, { rough: 0.7 })
  );
  hand.position.y = -0.66 * scale;
  hand.castShadow = true;
  arm.add(hand);
  return arm;
}

function buildLeg(scale, pantsColor, bootColor) {
  const leg = new THREE.Group();
  // Thigh
  const thigh = new THREE.Mesh(
    new THREE.CylinderGeometry(0.12 * scale, 0.1 * scale, 0.4 * scale, 10),
    mat(pantsColor, { rough: 0.9 })
  );
  thigh.position.y = -0.2 * scale;
  thigh.castShadow = true;
  leg.add(thigh);
  // Knee
  const knee = new THREE.Mesh(
    new THREE.SphereGeometry(0.1 * scale, 10, 8),
    mat(pantsColor, { rough: 0.9 })
  );
  knee.position.y = -0.4 * scale;
  leg.add(knee);
  // Shin
  const shin = new THREE.Mesh(
    new THREE.CylinderGeometry(0.09 * scale, 0.08 * scale, 0.38 * scale, 10),
    mat(pantsColor, { rough: 0.9 })
  );
  shin.position.y = -0.59 * scale;
  shin.castShadow = true;
  leg.add(shin);
  // Boot
  const boot = new THREE.Mesh(
    new THREE.BoxGeometry(0.16 * scale, 0.12 * scale, 0.28 * scale),
    mat(bootColor, { rough: 0.5, metal: 0.1 })
  );
  boot.position.set(0, -0.82 * scale, 0.04 * scale);
  boot.castShadow = true;
  leg.add(boot);
  return leg;
}

function buildGun(scale, weaponClass, bodyColor, metalColor) {
  const g = new THREE.Group();
  if (weaponClass === 'shotgun') {
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.08 * scale, 0.1 * scale, 0.55 * scale), mat(bodyColor, { rough: 0.5, metal: 0.5 }));
    body.position.set(0, 0, 0.2 * scale); g.add(body);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.045 * scale, 0.045 * scale, 0.45 * scale, 10), mat(metalColor, { rough: 0.3, metal: 0.8 }));
    barrel.rotation.x = Math.PI / 2; barrel.position.set(0, 0.02 * scale, 0.45 * scale); g.add(barrel);
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.07 * scale, 0.12 * scale, 0.22 * scale), mat(0x3a2010, { rough: 0.8 }));
    stock.position.set(0, -0.02 * scale, -0.06 * scale); g.add(stock);
    g.userData.muzzle = new THREE.Vector3(0, 0.02 * scale, 0.7 * scale);
  } else if (weaponClass === 'sniper') {
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.07 * scale, 0.09 * scale, 0.7 * scale), mat(bodyColor, { rough: 0.4, metal: 0.6 }));
    body.position.set(0, 0, 0.28 * scale); g.add(body);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.03 * scale, 0.03 * scale, 0.55 * scale, 10), mat(metalColor, { rough: 0.2, metal: 0.9 }));
    barrel.rotation.x = Math.PI / 2; barrel.position.set(0, 0.015 * scale, 0.6 * scale); g.add(barrel);
    const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.04 * scale, 0.04 * scale, 0.16 * scale, 10), mat(0x0a0a0a, { rough: 0.3, metal: 0.7 }));
    scope.rotation.x = Math.PI / 2; scope.position.set(0, 0.09 * scale, 0.2 * scale); g.add(scope);
    g.userData.muzzle = new THREE.Vector3(0, 0.015 * scale, 0.88 * scale);
  } else if (weaponClass === 'rocket') {
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.09 * scale, 0.09 * scale, 0.8 * scale, 14), mat(0x4a4a2a, { rough: 0.7 }));
    tube.rotation.x = Math.PI / 2; tube.position.set(0, 0, 0.3 * scale); g.add(tube);
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.06 * scale, 0.14 * scale, 0.08 * scale), mat(bodyColor, { rough: 0.7 }));
    grip.position.set(0, -0.1 * scale, 0.05 * scale); g.add(grip);
    g.userData.muzzle = new THREE.Vector3(0, 0, 0.75 * scale);
  } else if (weaponClass === 'pistol') {
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.06 * scale, 0.1 * scale, 0.22 * scale), mat(bodyColor, { rough: 0.4, metal: 0.6 }));
    body.position.set(0, 0, 0.08 * scale); g.add(body);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.022 * scale, 0.022 * scale, 0.18 * scale, 8), mat(metalColor, { rough: 0.3, metal: 0.8 }));
    barrel.rotation.x = Math.PI / 2; barrel.position.set(0, 0.025 * scale, 0.18 * scale); g.add(barrel);
    g.userData.muzzle = new THREE.Vector3(0, 0.025 * scale, 0.3 * scale);
  } else {
    // Default rifle
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.06 * scale, 0.09 * scale, 0.5 * scale), mat(bodyColor, { rough: 0.4, metal: 0.6 }));
    body.position.set(0, 0, 0.18 * scale); g.add(body);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.028 * scale, 0.028 * scale, 0.4 * scale, 10), mat(metalColor, { rough: 0.3, metal: 0.8 }));
    barrel.rotation.x = Math.PI / 2; barrel.position.set(0, 0.015 * scale, 0.42 * scale); g.add(barrel);
    const mag = new THREE.Mesh(new THREE.BoxGeometry(0.045 * scale, 0.14 * scale, 0.07 * scale), mat(0x2a2a2a, { rough: 0.5, metal: 0.4 }));
    mag.position.set(0, -0.1 * scale, 0.1 * scale); g.add(mag);
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.04 * scale, 0.1 * scale, 0.05 * scale), mat(0x1a1a1a, { rough: 0.7 }));
    grip.position.set(0, -0.08 * scale, -0.02 * scale); grip.rotation.x = 0.2; g.add(grip);
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.05 * scale, 0.07 * scale, 0.16 * scale), mat(0x2a1a0e, { rough: 0.8 }));
    stock.position.set(0, 0, -0.12 * scale); g.add(stock);
    g.userData.muzzle = new THREE.Vector3(0, 0.015 * scale, 0.65 * scale);
  }
  return g;
}

// ============================================================
// PRESETS — different enemy / NPC archetypes
// ============================================================
const PRESETS = {
  enemy: {
    skin: 0xb88863,
    uniform: 0x3d5a2a,
    uniformDark: 0x2a3d1a,
    helmet: true,
    helmetColor: 0x2a3a1a,
    angry: true,
    weaponClass: 'rifle',
    eyeColor: 0xff2a2a,
    scale: 1,
  },
  cartel: {
    skin: 0xa37252,
    uniform: 0x6a4a2a,
    uniformDark: 0x3a2818,
    bandana: 0x8a1a1a,
    angry: true,
    weaponClass: 'rifle',
    eyeColor: 0x4a1a1a,
    scale: 1,
  },
  boss: {
    skin: 0x9a6a4a,
    uniform: 0x4a1a1a,
    uniformDark: 0x2a0a0a,
    helmet: true,
    helmetColor: 0x0a0a0a,
    helmetAccent: 0xff3a1a,
    angry: true,
    weaponClass: 'rocket',
    eyeColor: 0xff4a1a,
    scale: 1.6,
  },
  remote: {
    skin: 0xc9a37c,
    uniform: 0x2a4a8a,
    uniformDark: 0x1a3a6a,
    helmet: true,
    helmetColor: 0x1a3a6a,
    helmetAccent: 0xc8ff5d,
    weaponClass: 'rifle',
    eyeColor: 0x0a0a0a,
    scale: 1,
  },
  ranger: {
    skin: 0xc9a37c,
    uniform: 0x4a6b2a,
    uniformDark: 0x2a3a1a,
    helmet: true,
    helmetColor: 0x3a4a1a,
    weaponClass: 'rifle',
    eyeColor: 0x0a0a0a,
    scale: 1,
  },
};

/**
 * Animate a humanoid's walk/idle/fire cycle.
 * call from your render loop with dt, plus state flags.
 */
export function animateHumanoid(group, dt, state = {}) {
  const rig = group.userData.rig;
  if (!rig) return;
  const t = (group.userData.animTime = (group.userData.animTime || 0) + dt);
  const walking = !!state.walking;
  const firing = !!state.firing;
  const speed = state.speed || 6;

  if (walking) {
    const phase = t * speed;
    const swing = Math.sin(phase) * 0.7;
    if (rig.leftLeg) rig.leftLeg.rotation.x = swing;
    if (rig.rightLeg) rig.rightLeg.rotation.x = -swing;
    // Counter-swing arms (but only left arm — right holds gun forward)
    if (rig.leftArm) rig.leftArm.rotation.x = -0.95 - swing * 0.3;
    if (rig.pelvis) rig.pelvis.position.y = (group.userData.basePelvisY ?? 0.85) + Math.abs(Math.sin(phase * 2)) * 0.04;
    if (rig.torso) rig.torso.rotation.y = Math.sin(phase) * 0.08;
  } else {
    // Idle — slow breath
    if (rig.leftLeg) rig.leftLeg.rotation.x *= 0.85;
    if (rig.rightLeg) rig.rightLeg.rotation.x *= 0.85;
    if (rig.leftArm) rig.leftArm.rotation.x = -0.95 + Math.sin(t * 1.5) * 0.02;
    if (rig.pelvis) rig.pelvis.position.y = (group.userData.basePelvisY ?? 0.85) + Math.sin(t * 1.5) * 0.01;
    if (rig.torso) rig.torso.rotation.y *= 0.9;
  }

  if (firing && rig.rightArm) {
    // Recoil kick
    rig.rightArm.rotation.x = -1.1 - Math.abs(Math.sin(t * 30)) * 0.15;
  } else if (rig.rightArm) {
    rig.rightArm.rotation.x += (-1.1 - rig.rightArm.rotation.x) * 0.2;
  }

  // Head tracks slightly toward target if provided
  if (state.lookAt && rig.head) {
    const dx = state.lookAt.x - group.position.x;
    const dz = state.lookAt.z - group.position.z;
    const ang = Math.atan2(dx, dz);
    const local = ang - group.rotation.y;
    rig.head.rotation.y = Math.max(-0.6, Math.min(0.6, local));
  }
}
