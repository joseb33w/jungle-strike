export const WEAPONS = {
  pistol: {
    id: 'pistol', name: 'Sidearm M9', icon: '🔫',
    cost: 0, damage: 22, fireRate: 380, magazine: 12, reserve: 60, reload: 1100,
    spread: 0.012, range: 80, auto: false,
  },
  shotgun: {
    id: 'shotgun', name: 'Boar Buster', icon: '💥',
    cost: 350, damage: 18, fireRate: 700, magazine: 6, reserve: 24, reload: 1500,
    spread: 0.08, range: 35, auto: false, pellets: 6,
  },
  rifle: {
    id: 'rifle', name: 'Canopy AR-15', icon: '🎯',
    cost: 600, damage: 28, fireRate: 110, magazine: 30, reserve: 120, reload: 1700,
    spread: 0.018, range: 120, auto: true,
  },
  sniper: {
    id: 'sniper', name: 'Vine Hunter', icon: '🪶',
    cost: 1100, damage: 110, fireRate: 1000, magazine: 5, reserve: 20, reload: 2200,
    spread: 0.003, range: 240, auto: false,
  },
  rocket: {
    id: 'rocket', name: 'Howler RPG', icon: '🚀',
    cost: 2200, damage: 180, fireRate: 1400, magazine: 1, reserve: 6, reload: 2600,
    spread: 0.005, range: 160, auto: false, splash: 6,
  },
};

export const MISSIONS = [
  {
    id: 'recon',
    name: 'Recon Patrol',
    icon: '🦜',
    objective: 'Eliminate 8 jungle scouts',
    description: 'Light enemy patrol along the river basin. Move fast, eliminate scouts, and exfil before reinforcements arrive.',
    difficulty: 'Easy',
    enemies: 8,
    enemyHealth: 60,
    enemySpeed: 1.6,
    timeLimit: 0,
    rewardPerKill: 12,
    bonus: 80,
    gradient: 'linear-gradient(135deg, rgba(127, 209, 74, 0.45), rgba(20, 54, 31, 0.85))',
  },
  {
    id: 'boss',
    name: 'Warlord Hunt',
    icon: '🐍',
    objective: 'Take down the warlord & his guards',
    description: 'A cartel warlord is hiding deep in the canopy. Wipe out his guards (10) then put down the warlord himself — he hits hard.',
    difficulty: 'Hard',
    enemies: 10,
    enemyHealth: 75,
    enemySpeed: 1.9,
    boss: { health: 600, damage: 22, speed: 1.8 },
    timeLimit: 0,
    rewardPerKill: 18,
    bonus: 240,
    gradient: 'linear-gradient(135deg, rgba(255, 122, 61, 0.45), rgba(43, 14, 14, 0.85))',
  },
  {
    id: 'survival',
    name: 'Endless Outpost',
    icon: '🛖',
    objective: 'Survive 3 enemy waves',
    description: 'Hold the abandoned ranger outpost while waves of insurgents close in. Each wave is bigger and faster than the last.',
    difficulty: 'Medium',
    enemies: 0,
    waves: [
      { count: 6, health: 50, speed: 1.6 },
      { count: 9, health: 70, speed: 1.9 },
      { count: 12, health: 90, speed: 2.2 },
    ],
    rewardPerKill: 15,
    bonus: 180,
    gradient: 'linear-gradient(135deg, rgba(255, 200, 87, 0.45), rgba(54, 32, 8, 0.85))',
  },
];

export const WORLD_CONFIG = {
  enemyBots: 6,
  botHealth: 70,
  botSpeed: 1.5,
  rewardPerBotKill: 8,
  rewardPerPlayerKill: 30,
};
