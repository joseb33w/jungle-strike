// =============================================================
// Jungle Strike — Procedural Sound Engine
// All audio synthesized in browser via WebAudio. No external samples.
// Handles gunshots per weapon, footsteps, reload, hit, kill, explosion,
// enemy fire, ambient jungle bed, and UI cues.
// =============================================================

let ctx = null;
let masterGain = null;
let ambientGain = null;
let ambientNodes = null;
let enabled = true;
let unlocked = false;

function ensureContext() {
  if (ctx) return ctx;
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    ctx = new Ctx();
    masterGain = ctx.createGain();
    masterGain.gain.value = enabled ? 0.7 : 0;
    masterGain.connect(ctx.destination);
    ambientGain = ctx.createGain();
    ambientGain.gain.value = 0;
    ambientGain.connect(masterGain);
  } catch (e) { console.warn('[sound] ctx fail:', e.message); }
  return ctx;
}

function resume() {
  if (!ctx) ensureContext();
  if (!ctx) return;
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
}

function unlock() {
  if (unlocked) return;
  if (!ctx) ensureContext();
  if (!ctx) return;
  try {
    if (ctx.state === 'suspended') ctx.resume();
    const buf = ctx.createBuffer(1, 1, 22050);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    src.start(0);
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    g.gain.value = 0.0001;
    osc.frequency.value = 440;
    osc.connect(g); g.connect(masterGain);
    osc.start();
    osc.stop(ctx.currentTime + 0.02);
    unlocked = true;
  } catch (e) { /* ignore */ }
}

// Auto-unlock on any first user gesture
function attachGlobalUnlock() {
  const handler = () => {
    ensureContext();
    resume();
    unlock();
    if (unlocked) {
      ['pointerdown', 'touchstart', 'mousedown', 'keydown', 'click', 'touchend', 'pointerup']
        .forEach(t => {
          window.removeEventListener(t, handler, true);
          document.removeEventListener(t, handler, true);
        });
    }
  };
  ['pointerdown', 'touchstart', 'mousedown', 'keydown', 'click', 'touchend', 'pointerup']
    .forEach(t => {
      window.addEventListener(t, handler, { capture: true, passive: true });
      document.addEventListener(t, handler, { capture: true, passive: true });
    });
}
attachGlobalUnlock();

function now() { return ctx ? ctx.currentTime : 0; }

function tone({ freq = 440, freqEnd, type = 'sine', dur = 0.2, vol = 0.2, attack = 0.005, release = 0.08, dest }) {
  if (!ctx || !enabled) return;
  const t = now();
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (freqEnd !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(0.01, freqEnd), t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vol, t + attack);
  g.gain.linearRampToValueAtTime(0.0001, t + dur + release);
  osc.connect(g);
  g.connect(dest || masterGain);
  osc.start(t);
  osc.stop(t + dur + release + 0.02);
}

function noise({ dur = 0.2, vol = 0.2, filterFreq = 1200, q = 1, type = 'bandpass', attack = 0.003, release = 0.06, dest }) {
  if (!ctx || !enabled) return;
  const t = now();
  const len = Math.floor(ctx.sampleRate * (dur + release));
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * 0.9;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const filter = ctx.createBiquadFilter();
  filter.type = type;
  filter.frequency.value = filterFreq;
  filter.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vol, t + attack);
  g.gain.linearRampToValueAtTime(0.0001, t + dur + release);
  src.connect(filter); filter.connect(g); g.connect(dest || masterGain);
  src.start(t);
  src.stop(t + dur + release + 0.02);
}

// ============================================================
// WEAPON SOUNDS — distinct per gun
// ============================================================
const weaponSounds = {
  pistol() {
    tone({ freq: 1400, freqEnd: 220, type: 'sawtooth', dur: 0.05, vol: 0.18, release: 0.05 });
    noise({ dur: 0.08, vol: 0.22, filterFreq: 1800, q: 4, release: 0.1 });
    tone({ freq: 90, freqEnd: 40, type: 'sine', dur: 0.12, vol: 0.18, release: 0.1 });
  },
  shotgun() {
    noise({ dur: 0.22, vol: 0.32, filterFreq: 600, q: 1.5, release: 0.3 });
    tone({ freq: 60, freqEnd: 30, type: 'sine', dur: 0.25, vol: 0.26, release: 0.25 });
    noise({ dur: 0.06, vol: 0.18, filterFreq: 3200, q: 6 });
  },
  rifle() {
    tone({ freq: 1600, freqEnd: 280, type: 'sawtooth', dur: 0.04, vol: 0.15, release: 0.04 });
    noise({ dur: 0.06, vol: 0.18, filterFreq: 2400, q: 3, release: 0.06 });
    tone({ freq: 110, freqEnd: 50, type: 'square', dur: 0.08, vol: 0.14, release: 0.06 });
  },
  sniper() {
    tone({ freq: 80, freqEnd: 30, type: 'sine', dur: 0.4, vol: 0.32, release: 0.35 });
    noise({ dur: 0.35, vol: 0.26, filterFreq: 900, q: 2, release: 0.3 });
    tone({ freq: 2400, freqEnd: 300, type: 'sawtooth', dur: 0.06, vol: 0.2 });
  },
  rocket() {
    tone({ freq: 200, freqEnd: 60, type: 'sawtooth', dur: 0.5, vol: 0.28, release: 0.4 });
    noise({ dur: 0.5, vol: 0.22, filterFreq: 700, q: 1.2, release: 0.4 });
  },
};

function shoot(weaponId) {
  const fn = weaponSounds[weaponId] || weaponSounds.pistol;
  fn();
}

function explosion() {
  if (!ctx || !enabled) return;
  noise({ dur: 0.5, vol: 0.38, filterFreq: 400, q: 0.8, release: 0.6 });
  tone({ freq: 90, freqEnd: 25, type: 'sawtooth', dur: 0.4, vol: 0.32, release: 0.4 });
  tone({ freq: 180, freqEnd: 40, type: 'triangle', dur: 0.55, vol: 0.18, release: 0.5 });
  noise({ dur: 0.7, vol: 0.18, filterFreq: 1800, q: 3, release: 0.6 });
}

function reload() {
  // Mechanical clicks: mag out, mag in, slide
  setTimeout(() => noise({ dur: 0.04, vol: 0.16, filterFreq: 1600, q: 8 }), 0);
  setTimeout(() => tone({ freq: 380, freqEnd: 220, type: 'square', dur: 0.05, vol: 0.14 }), 100);
  setTimeout(() => noise({ dur: 0.05, vol: 0.18, filterFreq: 1200, q: 6 }), 450);
  setTimeout(() => tone({ freq: 420, freqEnd: 280, type: 'square', dur: 0.06, vol: 0.16 }), 700);
  setTimeout(() => noise({ dur: 0.06, vol: 0.2, filterFreq: 2400, q: 8 }), 950);
}

function footstep() {
  if (!ctx || !enabled) return;
  noise({ dur: 0.06, vol: 0.06 + Math.random() * 0.04, filterFreq: 500 + Math.random() * 400, q: 1.2 });
  tone({ freq: 70 + Math.random() * 30, type: 'sine', dur: 0.04, vol: 0.06 });
}

function hit() {
  // Player got hit — short red noise burst
  noise({ dur: 0.15, vol: 0.22, filterFreq: 800, q: 2, release: 0.15 });
  tone({ freq: 320, freqEnd: 90, type: 'square', dur: 0.12, vol: 0.18 });
}

function enemyShoot() {
  // Distinct from player gun — more raspy
  tone({ freq: 900, freqEnd: 180, type: 'sawtooth', dur: 0.06, vol: 0.12, release: 0.06 });
  noise({ dur: 0.07, vol: 0.1, filterFreq: 1400, q: 3 });
}

function kill() {
  tone({ freq: 660, type: 'triangle', dur: 0.07, vol: 0.14 });
  setTimeout(() => tone({ freq: 990, type: 'triangle', dur: 0.12, vol: 0.16, release: 0.14 }), 60);
}

function pickup() {
  tone({ freq: 880, type: 'triangle', dur: 0.06, vol: 0.14 });
  setTimeout(() => tone({ freq: 1320, type: 'triangle', dur: 0.1, vol: 0.16 }), 50);
  setTimeout(() => tone({ freq: 1760, type: 'triangle', dur: 0.12, vol: 0.14, release: 0.14 }), 110);
}

function uiClick() {
  tone({ freq: 660, freqEnd: 880, type: 'square', dur: 0.04, vol: 0.08 });
}

function victory() {
  const notes = [523, 659, 784, 1047, 1318];
  notes.forEach((f, i) => setTimeout(() => tone({ freq: f, type: 'triangle', dur: 0.14, vol: 0.18, release: 0.18 }), i * 90));
}

function defeat() {
  const notes = [440, 370, 294, 220];
  notes.forEach((f, i) => setTimeout(() => tone({ freq: f, type: 'sawtooth', dur: 0.22, vol: 0.18, release: 0.22 }), i * 140));
}

function bossRoar() {
  if (!ctx || !enabled) return;
  noise({ dur: 1.2, vol: 0.3, filterFreq: 280, q: 0.8, release: 0.6 });
  tone({ freq: 80, freqEnd: 40, type: 'sawtooth', dur: 1.0, vol: 0.26, release: 0.4 });
  tone({ freq: 140, freqEnd: 60, type: 'triangle', dur: 1.1, vol: 0.16, release: 0.5 });
}

// ============================================================
// AMBIENT JUNGLE BED
// ============================================================
const ambientChirps = [];
let ambientChirpTimer = null;

function startAmbient(theme = 'jungle') {
  if (!ctx || !enabled || ambientNodes) return;
  const t = now();
  // Low forest drone
  const o1 = ctx.createOscillator(); o1.type = 'sawtooth'; o1.frequency.value = 48;
  const o2 = ctx.createOscillator(); o2.type = 'sawtooth'; o2.frequency.value = 48.4;
  const o3 = ctx.createOscillator(); o3.type = 'sine'; o3.frequency.value = 24;
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 320; lp.Q.value = 1.4;
  const g = ctx.createGain(); g.gain.value = 0;
  g.gain.linearRampToValueAtTime(0.06, t + 1.6);
  o1.connect(lp); o2.connect(lp); o3.connect(g); lp.connect(g); g.connect(ambientGain);
  o1.start(t); o2.start(t); o3.start(t);
  ambientGain.gain.cancelScheduledValues(t);
  ambientGain.gain.setValueAtTime(0, t);
  ambientGain.gain.linearRampToValueAtTime(0.9, t + 1.5);

  const lfo = ctx.createOscillator(); lfo.frequency.value = 0.07;
  const lfoG = ctx.createGain(); lfoG.gain.value = 80;
  lfo.connect(lfoG); lfoG.connect(lp.frequency); lfo.start(t);

  ambientNodes = { o1, o2, o3, g, lp, lfo, lfoG };

  // Random bird/insect chirps every 1-4 seconds
  function scheduleChirp() {
    if (!ambientNodes) return;
    const delay = 800 + Math.random() * 3200;
    ambientChirpTimer = setTimeout(() => {
      if (!ambientNodes) return;
      const which = Math.random();
      if (which < 0.4) {
        // Bird chirp
        const f = 2200 + Math.random() * 1800;
        tone({ freq: f, freqEnd: f * 1.4, type: 'triangle', dur: 0.06, vol: 0.04 + Math.random() * 0.04, dest: ambientGain });
        setTimeout(() => tone({ freq: f * 1.1, freqEnd: f * 1.5, type: 'triangle', dur: 0.05, vol: 0.04, dest: ambientGain }), 70);
      } else if (which < 0.75) {
        // Insect/cricket
        const f = 4000 + Math.random() * 2000;
        noise({ dur: 0.12 + Math.random() * 0.15, vol: 0.025, filterFreq: f, q: 18, dest: ambientGain });
      } else {
        // Distant howl / monkey
        const f = 180 + Math.random() * 80;
        tone({ freq: f, freqEnd: f * 1.5, type: 'sine', dur: 0.4, vol: 0.05, release: 0.3, dest: ambientGain });
      }
      scheduleChirp();
    }, delay);
  }
  scheduleChirp();
}

function stopAmbient() {
  if (ambientChirpTimer) { clearTimeout(ambientChirpTimer); ambientChirpTimer = null; }
  if (!ambientNodes) return;
  const t = now();
  ambientGain.gain.cancelScheduledValues(t);
  ambientGain.gain.setValueAtTime(ambientGain.gain.value, t);
  ambientGain.gain.linearRampToValueAtTime(0.0001, t + 0.4);
  const nodes = ambientNodes;
  ambientNodes = null;
  setTimeout(() => {
    try { Object.values(nodes).forEach(n => { try { n.stop?.(); n.disconnect?.(); } catch {} }); } catch {}
  }, 500);
}

function setEnabled(v) {
  enabled = !!v;
  if (masterGain && ctx) {
    masterGain.gain.setTargetAtTime(enabled ? 0.7 : 0.0, ctx.currentTime, 0.05);
  }
}

function isEnabled() { return enabled; }
function isUnlocked() { return unlocked; }

export const sound = {
  ensureContext, resume, unlock, isUnlocked,
  setEnabled, isEnabled,
  shoot, explosion, reload, footstep, hit, enemyShoot, kill, pickup,
  uiClick, victory, defeat, bossRoar,
  startAmbient, stopAmbient,
};
