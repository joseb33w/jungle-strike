// =================================================================
// Supabase client — uses the GLOBAL window.supabase that index.html
// loads from a regular (non-module) <script> tag. This avoids the
// ES-module CDN import chain that was failing to load in the preview
// environment and blocking the entire app boot.
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

function buildClient() {
  const g = (typeof window !== 'undefined') ? window : globalThis;
  if (g && g.supabase && typeof g.supabase.createClient === 'function') {
    return g.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }
  return null;
}

// Try immediately; if the global isn't there yet, fall back to a proxy
// that resolves the client lazily on first method call. This guarantees
// `import { supabase } from './supabaseClient.js'` NEVER hangs at import
// time, even if the supabase global script is still loading.
let _client = buildClient();

function ensureClient() {
  if (_client) return _client;
  _client = buildClient();
  if (!_client) {
    throw new Error('Supabase library not loaded yet. Please refresh.');
  }
  return _client;
}

export const supabase = new Proxy({}, {
  get(_target, prop) {
    const c = ensureClient();
    const value = c[prop];
    if (typeof value === 'function') return value.bind(c);
    return value;
  },
});

// Helper: wait up to `ms` for the global library to appear.
export async function waitForSupabaseGlobal(ms = 8000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    const g = (typeof window !== 'undefined') ? window : globalThis;
    if (g && g.supabase && typeof g.supabase.createClient === 'function') {
      if (!_client) _client = g.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
      return true;
    }
    await new Promise(r => setTimeout(r, 100));
  }
  return false;
}
