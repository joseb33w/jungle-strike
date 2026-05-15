import { Auth } from './auth.js';
import { initLobby, showLobby, hideLobby, refreshLobby, showToast } from './lobby.js';
import { startMission, startWorld } from './game.js';

(async function main() {
  try {
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

    const user = await Auth.init();
    if (user) {
      enterApp();
    } else {
      document.getElementById('authScreen').classList.add('active');
    }
  } catch (err) {
    console.error('Startup error:', err.message, err.stack);
    showFatalError('Something went wrong loading the game. Please refresh the page.');
  }
})();

function enterApp() {
  document.getElementById('authScreen').classList.remove('active');
  showLobby();
  refreshLobby();
}

// =========================================================
// AUTH UI — robust message rendering + bulletproof submit
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
  // Force visible regardless of CSS quirks
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
      usernameField.hidden = currentMode !== 'signup';
      setSubmitLabel(currentMode === 'signin' ? 'Sign In' : 'Create Account');
      setMessage('');
      setActions(null);
    });
  });

  // Forgot password link
  const forgotLink = document.getElementById('forgotLink');
  if (forgotLink) {
    forgotLink.addEventListener('click', async (e) => {
      e.preventDefault();
      const email = (document.getElementById('authEmail').value || '').trim();
      if (!email) {
        setMessage('Type your email in the box above first, then tap Forgot password.', 'error');
        return;
      }
      setMessage('Sending you a password reset link…', 'info');
      try {
        await Auth.sendPasswordReset(email);
        setMessage(`We sent a password reset link to ${email}. Check your inbox (and spam folder).`, 'success');
        setActions(null);
      } catch (err) {
        setMessage(err?.message || 'We couldn\u2019t send the reset email. Please try again.', 'error');
      }
    });
  }

  // Wire BOTH the form submit AND the button click. Some mobile browsers
  // are unreliable about firing submit on a button tap, so we listen on both
  // and de-dupe with submitInFlight.
  const form = document.getElementById('authForm');
  const submitBtn = document.getElementById('authSubmit');

  if (form) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      e.stopPropagation();
      handleAuthSubmit();
    });
  }
  if (submitBtn) {
    submitBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      handleAuthSubmit();
    });
  }

  // Pressing Enter inside any input also submits
  ['authEmail', 'authPassword', 'authUsername'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleAuthSubmit();
      }
    });
  });
}

async function handleAuthSubmit() {
  if (submitInFlight) {
    console.log('[auth] submit ignored — already in flight');
    return;
  }

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
  if (!pw) { setMessage('Please enter your password.', 'error'); pwEl?.focus(); return; }
  if (pw.length < 6) { setMessage('Your password needs to be at least 6 characters.', 'error'); pwEl?.focus(); return; }
  if (currentMode === 'signup' && !username) { setMessage('Please choose a username.', 'error'); userEl?.focus(); return; }

  setMessage(currentMode === 'signin' ? 'Signing you in…' : 'Creating your account…', 'info');
  submitInFlight = true;
  if (submit) submit.disabled = true;

  try {
    if (currentMode === 'signin') {
      console.log('[auth] calling Auth.signIn');
      await Auth.signIn(email, pw);
      console.log('[auth] signIn result — user:', Auth.user?.id, 'profile:', Auth.profile?.username);

      if (Auth.user) {
        const name = Auth.profile?.username || email.split('@')[0];
        setMessage(`Welcome back, ${name}! Taking you to the menu…`, 'success');
        setTimeout(() => {
          try {
            enterApp();
          } catch (e) {
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
        setMessage(`Welcome, ${username}! Your account is ready. Taking you to the menu…`, 'success');
        setTimeout(() => {
          try {
            enterApp();
          } catch (e) {
            console.error('enterApp failed after sign-up:', e);
            setMessage('Account created, but something went wrong loading the menu. Please refresh.', 'error');
          }
        }, 600);
      } else if (Auth.user && !res?.session) {
        setMessage(`Account created! We sent a confirmation link to ${email}. Click it, then come back and sign in.`, 'success');
        setActions([
          { label: 'Resend confirmation email', onClick: async () => {
              setMessage('Sending another confirmation email…', 'info');
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
            setMessage('Sending another confirmation email…', 'info');
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

function showFatalError(msg) {
  const el = document.createElement('div');
  el.style.cssText = 'position:fixed;inset:0;display:grid;place-items:center;background:#101;z-index:999;color:white;padding:20px;font-family:sans-serif;text-align:center;';
  el.innerHTML = `<div><h1>\u26A0\uFE0F Something went wrong</h1><p>${msg}</p></div>`;
  document.body.appendChild(el);
}
