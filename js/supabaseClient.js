// =================================================================
// Supabase client wrapper.
//
// The inline auth script in index.html owns the real Supabase client.
// It creates it from the UMD global (window.supabase) and then calls
// setExternalSupabase(client) so the rest of the app shares the
// SAME client instance (same session, same realtime channels).
//
// If for any reason the inline auth hasn't initialized yet, we lazily
// build a client from the global window.supabase, so module-time
// imports of `supabase` NEVER hang.
// =================================================================

export const SUPABASE_URL = 'https://xhhmxabftbyxrirvvihn.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_NZHoIxqqpSvVBP8MrLHCYA_gmg1AbN-';

export const TABLES = {
  profiles: 'uNMexs7BYTXQ2_jungle_strike_profiles',
  missionRuns: 'uNMexs7BYTXQ2_jungle_strike_mission_runs',
  worldPlayers: 'uNMexs7BYTXQ2_jungle_strike_world_players',
  worldInvites: 'uNMexs7BYTXQ2_jungle_strike_world_invites',
  worldChat: 'uNMexs7BYTXQ2_jungle_strike_world_chat',
};

let _client = null;

export function setExternalSupabase(client) {
  if (client) _client = client;
}

function buildFromGlobal() {
  const g = (typeof window !== 'undefined') ? window : globalThis;
  if (g && g.supabase && typeof g.supabase.createClient === 'function') {
    return g.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }
  return null;
}

function ensureClient() {
  if (_client) return _client;
  _client = buildFromGlobal();
  if (!_client) {
    throw new Error('Supabase client not initialized yet.');
  }
  return _client;
}

// Proxy so `import { supabase } from './supabaseClient.js'` never
// hangs at import time — calls resolve lazily on first use.
export const supabase = new Proxy({}, {
  get(_target, prop) {
    const c = ensureClient();
    const value = c[prop];
    if (typeof value === 'function') return value.bind(c);
    return value;
  },
});

// Legacy helper kept for any caller that still imports it.
export async function waitForSupabaseGlobal(ms = 8000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    if (_client) return true;
    const g = (typeof window !== 'undefined') ? window : globalThis;
    if (g && g.supabase && typeof g.supabase.createClient === 'function') {
      if (!_client) _client = g.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
      return true;
    }
    await new Promise(r => setTimeout(r, 100));
  }
  return false;
}
