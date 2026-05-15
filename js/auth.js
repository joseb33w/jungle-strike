import { supabase, TABLES } from './supabaseClient.js';

export const Auth = {
  user: null,
  profile: null,

  async init() {
    try {
      const { data } = await supabase.auth.getUser();
      this.user = data?.user || null;
      if (this.user) {
        try { await this.loadProfile(); } catch (e) { console.warn('loadProfile (init):', e.message); }
      }
      return this.user;
    } catch (e) {
      console.error('Auth init error:', e.message);
      return null;
    }
  },

  async signIn(email, password) {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    this.user = data.user;
    // Never let a profile hiccup block sign-in — load it, but swallow errors
    try {
      await this.loadProfile();
    } catch (e) {
      console.warn('Profile load after sign-in failed (continuing anyway):', e.message);
      // Build a fallback in-memory profile so the lobby still works
      this.profile = this._fallbackProfile();
    }
    return this.user;
  },

  async signUp(email, password, username) {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: 'https://sling-gogiapp.web.app/email-confirmed.html',
        data: { username },
      },
    });
    if (error) throw error;
    this.user = data.user;
    if (this.user) {
      try { await this.ensureProfile(username); }
      catch (e) {
        console.warn('Profile create on signup failed:', e.message);
        this.profile = this._fallbackProfile(username);
      }
    }
    return this.user;
  },

  async signOut() {
    await supabase.auth.signOut();
    this.user = null;
    this.profile = null;
  },

  _fallbackProfile(username) {
    const u = username || this.user?.user_metadata?.username || (this.user?.email || 'agent').split('@')[0];
    return {
      id: null,
      username: u,
      coins: 500,
      kills_total: 0,
      missions_completed: 0,
      owned_weapons: ['pistol'],
      equipped_weapon: 'pistol',
      _fallback: true,
    };
  },

  async loadProfile() {
    if (!this.user) return null;
    try {
      const { data, error } = await supabase
        .from(TABLES.profiles)
        .select('*')
        .eq('user_id', this.user.id)
        .maybeSingle();
      if (error) throw error;
      if (data) {
        this.profile = data;
        return this.profile;
      }
    } catch (e) {
      console.warn('Profile select failed:', e.message);
    }

    // No row found — try to create one
    const fallbackName = this.user?.user_metadata?.username || (this.user?.email || 'agent').split('@')[0];
    try {
      await this.ensureProfile(fallbackName);
    } catch (e) {
      console.warn('ensureProfile failed:', e.message);
      this.profile = this._fallbackProfile(fallbackName);
    }
    return this.profile;
  },

  async ensureProfile(username) {
    if (!this.user) return null;
    const safe = (username || 'agent').replace(/[^a-zA-Z0-9_]/g, '').slice(0, 16) || 'agent' + Math.floor(Math.random() * 999);
    try {
      const { data, error } = await supabase
        .from(TABLES.profiles)
        .insert({
          username: safe,
          coins: 500,
          kills_total: 0,
          missions_completed: 0,
          owned_weapons: ['pistol'],
          equipped_weapon: 'pistol',
        })
        .select('*')
        .single();
      if (error) throw error;
      this.profile = data;
      return data;
    } catch (insertErr) {
      // Likely a duplicate or RLS quirk — try to load the existing row
      const { data: existing } = await supabase
        .from(TABLES.profiles).select('*')
        .eq('user_id', this.user.id).maybeSingle();
      if (existing) {
        this.profile = existing;
        return existing;
      }
      // Last resort: in-memory fallback so the app still loads
      this.profile = this._fallbackProfile(safe);
      console.warn('ensureProfile fallback (in-memory):', insertErr.message);
      return this.profile;
    }
  },

  async saveProfile(patch) {
    if (!this.profile || this.profile._fallback || !this.profile.id) {
      // Update in-memory only
      if (this.profile) Object.assign(this.profile, patch);
      return this.profile;
    }
    const { data, error } = await supabase
      .from(TABLES.profiles)
      .update(patch)
      .eq('id', this.profile.id)
      .select('*')
      .single();
    if (!error && data) this.profile = data;
    return this.profile;
  },
};
