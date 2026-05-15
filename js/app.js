// =================================================================
// APP ENTRY — LOBBY/GAME ONLY.
//
// Auth is OWNED by the inline non-module script in index.html.
// That script signs the user in, fetches their profile, then calls
// bootWithSession({ user, profile, supabase }) on this module.
//
// We then wire up the lobby and (lazily) the game engine.
// =================================================================
import { Auth } from './auth.js';
import { setExternalSupabase } from './supabaseClient.js';

let initLobby, showLobby, hideLobby, refreshLobby, showToast;
let lobbyReady = false;

// Lazy game module — three.js is only loaded when the player tries
// to start a mission or enter the world. A failure there does NOT
// affect the lobby; the user just sees a toast and stays in lobby.
let gameModulePromise = null;
function loadGameModule() {
  if (!gameModulePromise) {
    gameModulePromise = import('./game.js').catch((err) => {
      console.error('[boot] game.js failed to load:', err);
      gameModulePromise = null;
      throw err;
    });
  }
  return gameModulePromise;
}

async function ensureLobbyWired() {
  if (lobbyReady) return;
  const lobbyMod = await import('./lobby.js');
  initLobby    = lobbyMod.initLobby;
  showLobby    = lobbyMod.showLobby;
  hideLobby    = lobbyMod.hideLobby;
  refreshLobby = lobbyMod.refreshLobby;
  showToast    = lobbyMod.showToast;

  initLobby({
    onLaunchMission: async (mission) => {
      try {
        if (showToast) showToast('Loading mission…');
        const mod = await loadGameModule();
        hideLobby();
        mod.startMission(mission, () => showLobby());
      } catch (err) {
        console.error('Mission load failed:', err);
        if (showToast) showToast('Could not load game engine. Hard refresh and try again.');
      }
    },
    onEnterWorld: async () => {
      try {
        if (showToast) showToast('Loading world…');
        const mod = await loadGameModule();
        hideLobby();
        mod.startWorld(() => showLobby());
      } catch (err) {
        console.error('World load failed:', err);
        if (showToast) showToast('Could not load game engine. Hard refresh and try again.');
      }
    },
  });

  lobbyReady = true;
}

/**
 * Called by the inline auth script after a successful sign-in.
 * Receives the live Supabase client + user + profile, hydrates the
 * Auth singleton (so lobby.js and game.js can keep using their
 * existing `Auth.profile` API), and renders the lobby.
 */
export async function bootWithSession({ user, profile, supabase: externalClient }) {
  if (externalClient) setExternalSupabase(externalClient);

  // Hydrate the legacy Auth singleton so the rest of the app works
  // unchanged — lobby/game read Auth.user and Auth.profile.
  Auth.user = user || null;
  Auth.profile = profile || null;
  Auth.lastEmail = (user && user.email) || null;

  await ensureLobbyWired();

  // Switch screens
  document.getElementById('authScreen')?.classList.remove('active');
  document.getElementById('gameScreen')?.classList.remove('active');
  document.getElementById('lobbyScreen')?.classList.add('active');

  // Render lobby contents
  try { showLobby(); }
  catch (e) { console.error('showLobby error:', e); }

  // Warm up the game module in the background — if it fails, the
  // user only sees the consequence on first mission launch (and
  // gets a friendly toast then).
  setTimeout(() => {
    loadGameModule().catch(() => { /* swallow — handled on click */ });
  }, 1500);
}

// Re-export for debugging
window.__JUNGLE_BOOT_WITH_SESSION = bootWithSession;
