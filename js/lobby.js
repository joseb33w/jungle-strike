import { supabase, TABLES } from './supabaseClient.js';
import { Auth } from './auth.js';
import { WEAPONS, MISSIONS } from './data.js';

let presenceInterval = null;
let invitesChannel = null;
let onUserAction = null;

export function initLobby({ onLaunchMission, onEnterWorld }) {
  onUserAction = { onLaunchMission, onEnterWorld };

  document.querySelectorAll('.lobby-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.lobby-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.pane').forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      const pane = document.getElementById(tab.dataset.pane + 'Pane');
      if (pane) pane.classList.add('active');
      if (tab.dataset.pane === 'world') refreshWorld();
    });
  });

  document.getElementById('logoutBtn').addEventListener('click', async () => {
    stopPresence();
    await Auth.signOut();
    location.reload();
  });

  document.getElementById('enterWorldBtn').addEventListener('click', () => {
    onUserAction.onEnterWorld();
  });

  document.getElementById('sendInviteBtn').addEventListener('click', sendInvite);
}

export function showLobby() {
  document.getElementById('authScreen').classList.remove('active');
  document.getElementById('gameScreen').classList.remove('active');
  document.getElementById('lobbyScreen').classList.add('active');
  refreshLobby();
  startPresence();
  subscribeInvites();
  refreshWorld();
}

export function hideLobby() {
  document.getElementById('lobbyScreen').classList.remove('active');
}

export function refreshLobby() {
  const p = Auth.profile;
  if (!p) return;
  document.getElementById('lobbyHello').textContent = `Welcome, ${p.username}`;
  document.getElementById('lobbyCoins').textContent = p.coins;
  document.getElementById('lobbyKills').textContent = p.kills_total;
  document.getElementById('lobbyMissions').textContent = p.missions_completed;
  renderMissions();
  renderArmory();
}

function renderMissions() {
  const grid = document.getElementById('missionGrid');
  grid.innerHTML = '';
  MISSIONS.forEach(m => {
    const card = document.createElement('article');
    card.className = 'mission-card';
    card.style.setProperty('--gradient', m.gradient);
    const total = m.waves
      ? m.waves.reduce((s, w) => s + w.count, 0)
      : (m.boss ? m.enemies + 1 : m.enemies);
    card.innerHTML = `
      <div class="mission-icon">${m.icon}</div>
      <h4>${m.name}</h4>
      <p>${m.description}</p>
      <div class="mission-meta">
        <span>Difficulty: <b>${m.difficulty}</b></span>
        <span>Targets: <b>${total}</b></span>
        <span>Bonus: <b>${m.bonus} 🪙</b></span>
      </div>
      <button class="primary-btn">Deploy</button>
    `;
    card.querySelector('button').addEventListener('click', () => onUserAction.onLaunchMission(m));
    grid.appendChild(card);
  });
}

function renderArmory() {
  const grid = document.getElementById('armoryGrid');
  grid.innerHTML = '';
  const owned = Auth.profile.owned_weapons || ['pistol'];
  const equipped = Auth.profile.equipped_weapon || 'pistol';

  Object.values(WEAPONS).forEach(w => {
    const isOwned = owned.includes(w.id);
    const isEquipped = equipped === w.id;
    const card = document.createElement('article');
    card.className = 'weapon-card' + (isEquipped ? ' equipped' : '');
    card.innerHTML = `
      <div class="weapon-icon">${w.icon}</div>
      <h4>${w.name}</h4>
      <div class="stat-row">
        <span>Damage ${w.damage}</span>
        <span>Magazine ${w.magazine}</span>
        <span>Range ${w.range}m</span>
        ${w.auto ? '<span>Auto</span>' : ''}
      </div>
      <div class="weapon-actions"></div>
    `;
    const actions = card.querySelector('.weapon-actions');
    if (!isOwned) {
      const buy = document.createElement('button');
      buy.className = 'btn-buy';
      buy.textContent = `Buy — ${w.cost} 🪙`;
      buy.addEventListener('click', () => purchaseWeapon(w));
      actions.appendChild(buy);
    } else if (isEquipped) {
      const eq = document.createElement('button');
      eq.className = 'btn-equipped';
      eq.textContent = 'Equipped';
      eq.disabled = true;
      actions.appendChild(eq);
    } else {
      const eq = document.createElement('button');
      eq.className = 'btn-equip';
      eq.textContent = 'Equip';
      eq.addEventListener('click', () => equipWeapon(w));
      actions.appendChild(eq);
    }
    grid.appendChild(card);
  });
}

async function purchaseWeapon(w) {
  if (Auth.profile.coins < w.cost) {
    const need = w.cost - Auth.profile.coins;
    showToast(`You need ${need} more coin${need === 1 ? '' : 's'} to buy this.`);
    return;
  }
  const owned = [...(Auth.profile.owned_weapons || []), w.id];
  await Auth.saveProfile({
    coins: Auth.profile.coins - w.cost,
    owned_weapons: owned,
    equipped_weapon: w.id,
  });
  refreshLobby();
  showToast(`${w.name} purchased and equipped!`);
}

async function equipWeapon(w) {
  await Auth.saveProfile({ equipped_weapon: w.id });
  refreshLobby();
  showToast(`${w.name} equipped.`);
}

/* ----- WORLD ----- */
async function refreshWorld() {
  await fetchInvites();
  await fetchOnline();
}

async function fetchOnline() {
  const cutoff = new Date(Date.now() - 60_000).toISOString();
  const { data } = await supabase
    .from(TABLES.worldPlayers)
    .select('*')
    .gte('last_seen', cutoff)
    .order('last_seen', { ascending: false })
    .limit(20);
  const list = document.getElementById('onlineList');
  list.innerHTML = '';
  const others = (data || []).filter(p => p.user_id !== Auth.user.id);
  if (!others.length) {
    list.innerHTML = '<p class="empty">Nobody else online right now.</p>';
    return;
  }
  others.forEach(p => {
    const item = document.createElement('div');
    item.className = 'online-item';
    item.innerHTML = `
      <span>🎯 <strong>${p.username}</strong> · ${p.world_kills} kills</span>
      <button class="secondary-btn">Invite</button>
    `;
    item.querySelector('button').addEventListener('click', () => {
      document.getElementById('inviteUser').value = p.username;
      sendInvite();
    });
    list.appendChild(item);
  });
}

async function fetchInvites() {
  if (!Auth.profile) return;
  const { data } = await supabase
    .from(TABLES.worldInvites)
    .select('*')
    .eq('to_username', Auth.profile.username)
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
    .limit(10);
  const list = document.getElementById('invitesList');
  list.innerHTML = '';
  if (!data || !data.length) {
    list.innerHTML = '<p class="empty">No pending invites.</p>';
    return;
  }
  data.forEach(inv => {
    const item = document.createElement('div');
    item.className = 'invite-item';
    item.innerHTML = `
      <span>📨 <strong>${inv.from_username}</strong> wants to squad up</span>
      <div class="actions">
        <button class="primary-btn" data-act="accept">Accept</button>
        <button class="ghost-btn" data-act="decline">Decline</button>
      </div>
    `;
    item.querySelector('[data-act=accept]').addEventListener('click', async () => {
      await supabase.from(TABLES.worldInvites).update({ status: 'accepted' }).eq('id', inv.id);
      onUserAction.onEnterWorld(inv.room_code);
    });
    item.querySelector('[data-act=decline]').addEventListener('click', async () => {
      await supabase.from(TABLES.worldInvites).update({ status: 'declined' }).eq('id', inv.id);
      fetchInvites();
    });
    list.appendChild(item);
  });
}

async function sendInvite() {
  const input = document.getElementById('inviteUser');
  const target = (input.value || '').trim();
  if (!target) return showToast('Please enter a username.');
  if (target === Auth.profile.username) return showToast("You can't invite yourself.");
  const { data: target_p } = await supabase
    .from(TABLES.profiles).select('username').eq('username', target).maybeSingle();
  if (!target_p) return showToast('We couldn\u2019t find that username.');
  await supabase.from(TABLES.worldInvites).insert({
    from_username: Auth.profile.username,
    to_username: target,
    room_code: 'global',
    status: 'pending',
  });
  input.value = '';
  showToast(`Invite sent to ${target}.`);
}

function subscribeInvites() {
  if (invitesChannel) supabase.removeChannel(invitesChannel);
  invitesChannel = supabase
    .channel('invites-' + Auth.profile.username)
    .on('postgres_changes', {
      event: 'INSERT',
      schema: 'public',
      table: TABLES.worldInvites,
      filter: `to_username=eq.${Auth.profile.username}`,
    }, payload => {
      showToast(`📨 ${payload.new.from_username} invited you!`);
      fetchInvites();
    })
    .subscribe();
}

function startPresence() {
  if (presenceInterval) return;
  upsertPresence();
  presenceInterval = setInterval(upsertPresence, 25_000);
}

function stopPresence() {
  if (presenceInterval) clearInterval(presenceInterval);
  presenceInterval = null;
}

async function upsertPresence() {
  if (!Auth.profile) return;
  const existing = await supabase
    .from(TABLES.worldPlayers)
    .select('id')
    .eq('user_id', Auth.user.id)
    .maybeSingle();
  if (existing.data) {
    await supabase.from(TABLES.worldPlayers)
      .update({ last_seen: new Date().toISOString(), username: Auth.profile.username, weapon: Auth.profile.equipped_weapon })
      .eq('id', existing.data.id);
  } else {
    await supabase.from(TABLES.worldPlayers).insert({
      username: Auth.profile.username,
      x: 0, y: 1.6, z: 0, ry: 0,
      weapon: Auth.profile.equipped_weapon,
      health: 100, world_kills: 0,
      last_seen: new Date().toISOString(),
    });
  }
  fetchOnline();
}

export function showToast(msg, ms = 2500) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(t._h);
  t._h = setTimeout(() => t.classList.add('hidden'), ms);
}
