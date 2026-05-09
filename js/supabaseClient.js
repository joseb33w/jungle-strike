import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

export const SUPABASE_URL = 'https://xhhmxabftbyxrirvvihn.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_NZHoIxqqpSvVBP8MrLHCYA_gmg1AbN-';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export const TABLES = {
  profiles: 'uNMexs7BYTXQ2_jungle_strike_profiles',
  missionRuns: 'uNMexs7BYTXQ2_jungle_strike_mission_runs',
  worldPlayers: 'uNMexs7BYTXQ2_jungle_strike_world_players',
  worldInvites: 'uNMexs7BYTXQ2_jungle_strike_world_invites',
  worldChat: 'uNMexs7BYTXQ2_jungle_strike_world_chat',
};
