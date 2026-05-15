import { supabase, TABLES } from './supabaseClient.js';

// Translate raw Supabase errors into friendly text the player can act on.
// We tag the returned Error with a `code` so the UI can react (e.g. show
// a "resend confirmation" button when the email hasn't been verified).
function friendlyError(err) {
  const raw = (err?.message || '').toLowerCase();
  const code = (err?.code || err?.error_code || '').toLowerCase();

  // Email not confirmed — by far the most common reason "correct credentials"
  // appear to fail. We surface this with a dedicated code so the UI can show
  // a Resend button.
  if (
    code === 'email_not_confirmed' ||
    raw.includes('email not confirmed') ||
    raw.includes('not confirmed') ||
    raw.includes('confirm your email')
  ) {
    const e = new Error('Your email is not confirmed yet. Check your inbox for the confirmation link, or tap Resend below.');
    e.code = 'email_not_confirmed';
    return e;
  }

  if (raw.includes('invalid login') || raw.includes('invalid_credentials') || code === 'invalid_credentials') {
    const e = new Error('That email or password is incorrect.');
    e.code = 'invalid_credentials';
    return e;
  }
  if (raw.includes('user already registered') || raw.includes('already exists') || code === 'user_already_exists') {
    const e = new Error('An account with this email already exists. Try signing in.');
    e.code = 'user_already_exists';
    return e;
  }
  if (raw.includes('password') && raw.includes('short')) {
    const e = new Error('Password must be at least 6 characters.');
    e.code = 'weak_password';
    return e;
  }
  if (raw.includes('rate') || raw.includes('too many') || code === 'over_request_rate_limit') {
    const e = new Error('Too many attempts. Please wait a moment and try again.');
    e.code = 'rate_limited';
    return e;
  }
  if (raw.includes('network') || raw.includes('fetch') || raw.includes('failed to fetch')) {
    const e = new Error('Network problem. Check your connection and try again.');
    e.code = 'network';
    return e;
  }
  if (raw.includes('invalid email') || raw.includes('email address') || code === 'invalid_email') {
    const e = new Error('That email address looks invalid.');
    e.code = 'invalid_email';
    return e;
  }

  const e = new Error(err?.message || 'Something went wrong. Try again.');
  e.code = code || 'unknown';
  return e;
}

export const Auth = {
  user: null,
  profile: null,
  lastEmail: null,

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
    const cleanEmail = (email || '').trim().toLowerCase();
    this.lastEmail = cleanEmail;
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: cleanEmail,
        password: password || '',
      });
      if (error) {
        // Log raw error to console so we can debug if user reports issues
        console.warn('[signIn] Supabase error:', error);
        throw error;
      }
      this.user = data.user;
      try {
        await this.loadProfile();
      } catch (e) {
        console.warn('Profile load after sign-in failed (continuing anyway):', e.message);
        this.profile = this._fallbackProfile();
      }
      return this.user;
    } catch (err) {
      throw friendlyError(err);
    }
  },

  async signUp(email, password, username) {
    const cleanEmail = (email || '').trim().toLowerCase();
    this.lastEmail = cleanEmail;
    try {
      const { data, error } = await supabase.auth.signUp({
        email: cleanEmail,
        password: password || '',
        options: {
          emailRedirectTo: 'https://sling-gogiapp.web.app/email-confirmed.html',
          data: { username },
        },
      });
      if (error) {
        console.warn('[signUp] Supabase error:', error);
        throw error;
      }
      this.user = data.user;
      if (this.user && data.session) {
        // Auto-confirmed (email confirmation disabled) — create profile now
        try { await this.ensureProfile(username); }
        catch (e) {
          console.warn('Profile create on signup failed:', e.message);
          this.profile = this._fallbackProfile(username);
        }
      }
      return { user: this.user, session: data.session };
    } catch (err) {
      throw friendlyError(err);
    }
  },

  async resendConfirmation(email) {
    const target = (email || this.lastEmail || '').trim().toLowerCase();
    if (!target) throw new Error('No email on file to resend to.');
    try {
      const { error } = await supabase.auth.resend({
        type: 'signup',
        email: target,
        options: {
          emailRedirectTo: 'https://sling-gogiapp.web.app/email-confirmed.html',
        },
      });
      if (error) throw error;
      return true;
    } catch (err) {
      console.warn('[resendConfirmation] error:', err);
      throw friendlyError(err);
    }
  },

  async sendPasswordReset(email) {
    const target = (email || this.lastEmail || '').trim().toLowerCase();
    if (!target) throw new Error('Please enter your email first.');
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(target, {
        redirectTo: 'https://sling-gogiapp.web.app/email-confirmed.html',
      });
      if (error) throw error;
      return true;
    } catch (err) {
      console.warn('[sendPasswordReset] error:', err);
      throw friendlyError(err);
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
      const { data: existing } = await supabase
        .from(TABLES.profiles).select('*')
        .eq('user_id', this.user.id).maybeSingle();
      if (existing) {
        this.profile = existing;
        return existing;
      }
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
