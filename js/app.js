// =================================================================
// APP ENTRY — module-side. Owns the real auth submit handler.
//
// IMPORTANT BOOT STRATEGY:
//   Auth must work even if three.js / game code fails to load.
//   So we only import auth.js + lobby.js up front. game.js (which
//   pulls in three.js via the importmap) is imported LAZILY the
//   first time the user actually starts a mission or enters the world.
// =================================================================
import { waitForSupabaseGlobal } from './supabaseClient.js';

let Auth;
let initLobby, showLobby, hideLobby, refreshLobby, showToast;

// Lazy game module — loaded on first mission launch.
let gameModulePromise = null;
function loadGameModule() {
  if (!gameModulePromise) {
    gameModulePromise = import('./game.js').catch((err) => {
      console.error('[boot] game.js failed to load:', err);
      // Reset so a retry can attempt again
      gameModulePromise = null;
      throw err;
    });
  }
  return gameModulePromise;
}

// =========================================================
// Signal "module loaded" to the pre-boot script ASAP, before
// any await. The Sign In button can now call the real handler.
// =========================================================
window.__JUNGLE_BOOT = window.__JUNGLE_BOOT || {};
window.__JUNGLE_BOOT.moduleReady = true;
window.__jungleHandleAuthSubmit = handleAuthSubmit;

// Clear the boot banner — modules made it here, no more "still loading".
if (typeof window.__jungleClearBanner === 'function') window.__jungleClearBanner();

(function clearStaleMsg(){
  var el = document.getElementById('authMessage');
  if (el && /still loading|connecting|loading game|network slow|game modules|background init/i.test(el.textContent || '')) {
    el.textContent = '';
    el.className = 'auth-msg';
    el.style.display = 'none';
  }
})();

// =========================================================
// MAIN
// =========================================================
(async function main() {
  // Wait for the Supabase UMD global (the inline script in index.html
  // injects it from a regular CDN URL).
  const ok = await waitForSupabaseGlobal(15000);
  if (!ok) {
    try { setupAuthUI(); } catch (_) {}
    setMessage('Supabase library failed to load. Check your internet and hard refresh the page.', 'error');
    console.error('[boot] supabase global never appeared');
    return;
  }

  // Load ONLY the modules we need for auth + lobby. game.js is lazy.
  let authMod, lobbyMod;
  try {
    [authMod, lobbyMod] = await Promise.all([
      import('./auth.js'),
      import('./lobby.js'),
    ]);
  } catch (err) {
    console.error('[boot] auth/lobby import failed:', err);
    try { setupAuthUI(); } catch (_) {}
    setMessage('Could not load app code. Hard refresh the page (Cmd+Shift+R).', 'error');
    return;
  }

  Auth = authMod.Auth;
  initLobby    = lobbyMod.initLobby;
  showLobby    = lobbyMod.showLobby;
  hideLobby    = lobbyMod.hideLobby;
  refreshLobby = lobbyMod.refreshLobby;
  showToast    = lobbyMod.showToast;

  setupAuthUI();

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

  // Try to restore a previous session — non-blocking for the UI.
  let user = null;
  try { user = await Auth.init(); }
  catch (e) { console.warn('Auth.init error:', e?.message); }

  if (user) {
    enterApp();
  } else {
    document.getElementById('authScreen').classList.add('active');
  }

  // Replay any click that happened while we were still loading.
  if (window.__JUNGLE_BOOT.pendingClick) {
    window.__JUNGLE_BOOT.pendingClick = false;
    setTimeout(() => {
      try { handleAuthSubmit(); }
      catch (err) { console.error('Replaying pending click failed:', err); }
    }, 80);
  }

  // Best-effort warm-up of the game module in the background AFTER auth
  // is done. If it fails, we ignore — user will retry on click.
  setTimeout(() => {
    loadGameModule().catch(() => { /* swallow — handled on click */ });
  }, 1500);
})();

function enterApp() {
  document.getElementById('authScreen').classList.remove('active');
  showLobby();
  refreshLobby();
}

// =========================================================
// AUTH UI HELPERS
// =========================================================
function setMessage(text, kind) {
  const el = document.getElementById('authMessage');
  if (!el) return;
  el.className = 'auth-msg';
  if (!text) {
    el.textContent = '';
    el.style.display = 'none';
    return;
  }
  el.textContent = text;
  if (kind) el.classList.add(kind);
  el.style.display = 'block';
  el.style.visibility = 'visible';
  el.style.opacity = '1';
  console.log(`[auth message] (${kind || 'info'}):`, text);
}

function setActions(actions) {
  const wrap = document.getElementById('authActions');
  if (!wrap) return;
  wrap.innerHTML = '';
  if (!actions || !actions.length) {
    wrap.hidden = true;
    return;
  }
  wrap.hidden = false;
  actions.forEach(a => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'auth-action-btn';
    b.textContent = a.label;
    b.addEventListener('click', a.onClick);
    wrap.appendChild(b);
  });
}

function setSubmitLabel(text) {
  const submitBtn = document.getElementById('authSubmit');
  if (!submitBtn) return;
  const label = submitBtn.querySelector('.btn-label');
  if (label) label.textContent = text;
  else submitBtn.textContent = text;
}

let currentMode = 'signin';
let submitInFlight = false;

function setupAuthUI() {
  const tabs = document.querySelectorAll('#authScreen .tab');
  const usernameField = document.getElementById('usernameField');

  tabs.forEach(t => {
    t.addEventListener('click', () => {
      tabs.forEach(x => x.classList.remove('active'));
      t.classList.add('active');
      currentMode = t.dataset.tab;
      window.__JUNGLE_CURRENT_MODE = currentMode;
      if (usernameField) usernameField.hidden = currentMode !== 'signup';
      setSubmitLabel(currentMode === 'signin' ? 'Sign In' : 'Create Account');
      setMessage('');
      setActions(null);
    });
  });

  if (window.__JUNGLE_CURRENT_MODE) currentMode = window.__JUNGLE_CURRENT_MODE;

  const forgotLink = document.getElementById('forgotLink');
  if (forgotLink) {
    forgotLink.addEventListener('click', async (e) => {
      e.preventDefault();
      if (!Auth) {
        setMessage('App is still loading. Please wait a moment and try again.', 'error');
        return;
      }
      const email = (document.getElementById('authEmail').value || '').trim();
      if (!email) {
        setMessage('Type your email in the box above first, then tap Forgot password.', 'error');
        return;
      }
      setMessage('Sending you a password reset link\u2026', 'info');
      try {
        await Auth.sendPasswordReset(email);
        setMessage(`We sent a password reset link to ${email}. Check your inbox (and spam folder).`, 'success');
        setActions(null);
      } catch (err) {
        setMessage(err?.message || 'We couldn\u2019t send the reset email. Please try again.', 'error');
      }
    });
  }
}

// =========================================================
// THE REAL SUBMIT HANDLER
// =========================================================
async function handleAuthSubmit() {
  if (submitInFlight) {
    console.log('[auth] submit ignored — already in flight');
    return;
  }

  if (!Auth) {
    setMessage('Still finishing setup… your sign-in will run automatically in a moment.', 'info');
    window.__JUNGLE_BOOT.pendingClick = true;
    return;
  }

  if (window.__JUNGLE_CURRENT_MODE) currentMode = window.__JUNGLE_CURRENT_MODE;

  const emailEl = document.getElementById('authEmail');
  const pwEl = document.getElementById('authPassword');
  const userEl = document.getElementById('authUsername');
  const submit = document.getElementById('authSubmit');

  const email = (emailEl?.value || '').trim();
  const pw = pwEl?.value || '';
  const username = (userEl?.value || '').trim();

  console.log('[auth] submit start', { mode: currentMode, email, hasPw: !!pw, username });
  setActions(null);

  if (!email) { setMessage('Please enter your email.', 'error'); emailEl?.focus(); return; }
  if (!pw)    { setMessage('Please enter your password.', 'error'); pwEl?.focus(); return; }
  if (pw.length < 6) { setMessage('Your password needs to be at least 6 characters.', 'error'); pwEl?.focus(); return; }
  if (currentMode === 'signup' && !username) { setMessage('Please choose a username.', 'error'); userEl?.focus(); return; }

  setMessage(currentMode === 'signin' ? 'Signing you in\u2026' : 'Creating your account\u2026', 'info');
  submitInFlight = true;
  if (submit) submit.disabled = true;

  try {
    if (currentMode === 'signin') {
      console.log('[auth] calling Auth.signIn');
      await Auth.signIn(email, pw);
      console.log('[auth] signIn result — user:', Auth.user?.id, 'profile:', Auth.profile?.username);

      if (Auth.user) {
        const name = Auth.profile?.username || email.split('@')[0];
        setMessage(`Welcome back, ${name}! Taking you to the menu\u2026`, 'success');
        setTimeout(() => {
          try { enterApp(); }
          catch (e) {
            console.error('enterApp failed after sign-in:', e);
            setMessage('Signed in, but something went wrong loading the menu. Please refresh.', 'error');
          }
        }, 500);
      } else {
        setMessage('We couldn\u2019t sign you in. Please double-check your email and password.', 'error');
      }
    } else {
      console.log('[auth] calling Auth.signUp');
      const res = await Auth.signUp(email, pw, username);
      console.log('[auth] signUp result — user:', Auth.user?.id, 'session:', !!res?.session);

      if (Auth.user && res?.session) {
        setMessage(`Welcome, ${username}! Your account is ready. Taking you to the menu\u2026`, 'success');
        setTimeout(() => {
          try { enterApp(); }
          catch (e) {
            console.error('enterApp failed after sign-up:', e);
            setMessage('Account created, but something went wrong loading the menu. Please refresh.', 'error');
          }
        }, 600);
      } else if (Auth.user && !res?.session) {
        setMessage(`Account created! We sent a confirmation link to ${email}. Click it, then come back and sign in.`, 'success');
        setActions([
          { label: 'Resend confirmation email', onClick: async () => {
              setMessage('Sending another confirmation email\u2026', 'info');
              try {
                await Auth.resendConfirmation(email);
                setMessage(`We re-sent the confirmation email to ${email}. Check your inbox and spam folder.`, 'success');
              } catch (err) {
                setMessage(err?.message || 'We couldn\u2019t resend the email. Please try again in a moment.', 'error');
              }
            }
          }
        ]);
      } else {
        setMessage('Account created. Please sign in.', 'success');
      }
    }
  } catch (err) {
    const msg = err?.message || 'Something went wrong. Please try again.';
    setMessage(msg, 'error');
    console.error('[auth] submit error:', err);

    if (err?.code === 'email_not_confirmed') {
      setActions([
        { label: 'Resend confirmation email', onClick: async () => {
            setMessage('Sending another confirmation email\u2026', 'info');
            try {
              await Auth.resendConfirmation(email);
              setMessage(`We re-sent the confirmation email to ${email}. Tap the link inside, then try signing in again.`, 'success');
            } catch (e2) {
              setMessage(e2?.message || 'We couldn\u2019t resend the email. Please try again in a moment.', 'error');
            }
          }
        }
      ]);
    }
  } finally {
    submitInFlight = false;
    if (submit) submit.disabled = false;
  }
}
