import { supabase, TABLES } from './supabaseClient.js';

// Translate raw Supabase errors into friendly text the player can act on.
function friendlyError(err) {
  const raw = (err?.message || '').toLowerCase();
  if (!raw) return 'Something went wrong. Try again.';
  if (raw.includes('invalid login') || raw.includes('invalid_credentials')) {
    return 'That email or password is incorrect.';
  }
  if (raw.includes('email not confirmed') || raw.includes('not confirmed')) {
    return 'Please confirm your email before signing in (check your inbox).';
  }
  if (raw.includes('user already registered') || raw.includes('already exists')) {
    return 'An account with this email already exists. Try signing in.';
  }
  if (raw.includes('password') && raw.includes('short')) {
    return 'Password must be at least 6 characters.';
  }
  if (raw.includes('rate') || raw.includes('too many')) {
    return 'Too many attempts. Please wait a moment and try again.';
  }
  if (raw.includes('network') || raw.includes('fetch')) {
    return 'Network problem. Check your connection and try again.';
  }
  if (raw.includes('invalid email') || raw.includes('email address')) {
    return 'That email address looks invalid.';
  }
  return err?.message || 'Something went wrong. Try again.';
}

export const Auth = {
  user: null,
  profile: null,

  async init() {
    try {
      const { data: sess } = await supabase.auth.getSession();
      const session = sess?.session;
      this.user = session?.user || null;
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
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: (email || '').trim().toLowerCase(),
        password: password || '',
      });
      if (error) throw error;
      this.user = data.user;
      // Never let a profile hiccup block sign-in — load it, but swallow errors
      try {
        await this.loadProfile();
      } catch (e) {
        console.warn('Profile load after sign-in failed (continuing anyway):', e.message);
        this.profile = this._fallbackProfile();
      }
      return this.user;
    } catch (err) {
      // Re-throw with a friendly message
      const friendly = new Error(friendlyError(err));
      friendly.original = err;
      throw friendly;
    }
  },

  async signUp(email, password, username) {
    try {
      const { data, error } = await supabase.auth.signUp({
        email: (email || '').trim().toLowerCase(),
        password: password || '',
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
      return { user: this.user, session: data.session };
    } catch (err) {
      const friendly = new Error(friendlyError(err));
      friendly.original = err;
      throw friendly;
    }
  },

  async signOut() {
    try { await supabase.auth.signOut(); } catch (e) { console.warn(e); }
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
