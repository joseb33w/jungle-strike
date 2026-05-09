import { supabase, TABLES } from './supabaseClient.js';

export const Auth = {
  user: null,
  profile: null,

  async init() {
    try {
      const { data } = await supabase.auth.getUser();
      this.user = data?.user || null;
      if (this.user) await this.loadProfile();
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
    await this.loadProfile();
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
    if (this.user) await this.ensureProfile(username);
    return this.user;
  },

  async signOut() {
    await supabase.auth.signOut();
    this.user = null;
    this.profile = null;
  },

  async loadProfile() {
    const { data } = await supabase
      .from(TABLES.profiles)
      .select('*')
      .eq('user_id', this.user.id)
      .maybeSingle();
    if (data) {
      this.profile = data;
    } else {
      const fallbackName = this.user?.user_metadata?.username || (this.user?.email || 'agent').split('@')[0];
      await this.ensureProfile(fallbackName);
    }
    return this.profile;
  },

  async ensureProfile(username) {
    const safe = (username || 'agent').replace(/[^a-zA-Z0-9_]/g, '').slice(0, 16) || 'agent' + Math.floor(Math.random() * 999);
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
    if (error) {
      // duplicate? reload
      const { data: existing } = await supabase
        .from(TABLES.profiles).select('*')
        .eq('user_id', this.user.id).maybeSingle();
      this.profile = existing;
      return existing;
    }
    this.profile = data;
    return data;
  },

  async saveProfile(patch) {
    if (!this.profile) return;
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
