// =================================================================
// APP ENTRY — module-side. Owns the real auth submit handler.
// The pre-boot inline script in index.html owns the *click* binding
// and forwards into `window.__jungleHandleAuthSubmit`. This split is
// what makes the auth UI survive even when modules load slowly.
// =================================================================
import { waitForSupabaseGlobal } from './supabaseClient.js';

// We import auth.js / lobby.js / game.js LAZILY (after we've confirmed
// the supabase global is on the page). This way, if the Supabase script
// failed to download, we can still surface a clear error to the user
// instead of dying inside a top-level module import.
let Auth;
let initLobby, showLobby, hideLobby, refreshLobby, showToast;
let startMission, startWorld;

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
  if (el && /still loading|connecting|loading game|network slow|game modules/i.test(el.textContent || '')) {
    el.textContent = '';
    el.className = 'auth-msg';
    el.style.display = 'none';
  }
})();

// =========================================================
// MAIN
// =========================================================
(async function main() {
  try {
    // Wait for the Supabase UMD global to be available (the inline
    // <script> in index.html injects it from a regular CDN URL).
    const ok = await waitForSupabaseGlobal(15000);
    if (!ok) {
      // Even if supabase didn't load, set up the auth UI shell so
      // the user gets a helpful error when they tap Sign In.
      setupAuthUI();
      setMessage('Supabase library failed to load from the CDN. Check your internet and hard refresh the page.', 'error');
      console.error('[boot] supabase global never appeared');
      // Replay any pending click so the user sees the error immediately.
      if (window.__JUNGLE_BOOT.pendingClick) {
        window.__JUNGLE_BOOT.pendingClick = false;
      }
      return;
    }

    // Now safe to lazy-import the rest of the app.
    const [authMod, lobbyMod, gameMod] = await Promise.all([
      import('./auth.js'),
      import('./lobby.js'),
      import('./game.js'),
    ]);
    Auth = authMod.Auth;
    initLobby   = lobbyMod.initLobby;
    showLobby   = lobbyMod.showLobby;
    hideLobby   = lobbyMod.hideLobby;
    refreshLobby = lobbyMod.refreshLobby;
    showToast   = lobbyMod.showToast;
    startMission = gameMod.startMission;
    startWorld   = gameMod.startWorld;

    setupAuthUI();

    initLobby({
      onLaunchMission: (mission) => {
        hideLobby();
        startMission(mission, () => showLobby());
      },
      onEnterWorld: () => {
        hideLobby();
        startWorld(() => showLobby());
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
  } catch (err) {
    console.error('Startup error:', err && err.message, err && err.stack);
    try { setupAuthUI(); } catch (_) {}
    setMessage('Background init failed: ' + (err && err.message || err) + '. You can still try to sign in.', 'error');
  }
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
  // Tab clicks are also wired by the pre-boot script (so they work even
  // without modules), but we re-wire here to also sync currentMode in
  // the module scope.
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

  // If pre-boot already set a mode, mirror it.
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
// THE REAL SUBMIT HANDLER (called via window.__jungleHandleAuthSubmit
// from the pre-boot script's click/submit/Enter listeners)
// =========================================================
async function handleAuthSubmit() {
  if (submitInFlight) {
    console.log('[auth] submit ignored — already in flight');
    return;
  }

  // If modules / Auth aren't ready yet, give a clear message instead
  // of crashing silently.
  if (!Auth) {
    setMessage('Still finishing setup… your sign-in will run automatically in a moment.', 'info');
    window.__JUNGLE_BOOT.pendingClick = true;
    return;
  }

  // Pick up the mode the user last selected (pre-boot maintains it).
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
