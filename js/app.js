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
// AUTH UI HELPERS — robust message rendering
// =========================================================
function setMessage(text, kind) {
  const el = document.getElementById('authMessage');
  if (!el) return;
  // Reset classes
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

function setupAuthUI() {
  const tabsContainer = document.querySelector('#authScreen .tabs');
  const tabs = document.querySelectorAll('#authScreen .tab');
  const usernameField = document.getElementById('usernameField');
  let mode = 'signin';

  if (tabsContainer) tabsContainer.setAttribute('data-active', 'signin');

  tabs.forEach(t => {
    t.addEventListener('click', () => {
      tabs.forEach(x => x.classList.remove('active'));
      t.classList.add('active');
      mode = t.dataset.tab;
      if (tabsContainer) tabsContainer.setAttribute('data-active', mode);
      usernameField.hidden = mode !== 'signup';
      const userInput = document.getElementById('authUsername');
      if (userInput) userInput.required = (mode === 'signup');
      setSubmitLabel(mode === 'signin' ? 'Sign In' : 'Create Account');
      setMessage('');
      setActions(null);
    });
  });

  // Forgot password link
  const forgotLink = document.getElementById('forgotLink');
  if (forgotLink) {
    forgotLink.addEventListener('click', async (e) => {
      e.preventDefault();
      const email = document.getElementById('authEmail').value.trim();
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

  document.getElementById('authForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('authEmail').value.trim();
    const pw = document.getElementById('authPassword').value;
    const username = document.getElementById('authUsername').value.trim();
    const submit = document.getElementById('authSubmit');

    setActions(null);

    if (!email) { setMessage('Please enter your email.', 'error'); return; }
    if (!pw) { setMessage('Please enter your password.', 'error'); return; }
    if (pw.length < 6) { setMessage('Your password needs to be at least 6 characters.', 'error'); return; }
    if (mode === 'signup' && !username) { setMessage('Please choose a username.', 'error'); return; }

    setMessage(mode === 'signin' ? 'Signing you in…' : 'Creating your account…', 'info');
    submit.disabled = true;

    try {
      if (mode === 'signin') {
        await Auth.signIn(email, pw);
        if (Auth.user) {
          const name = Auth.profile?.username || email.split('@')[0];
          setMessage(`Welcome back, ${name}! Taking you to the menu…`, 'success');
          // Give the user a beat to see the success message, then enter app.
          // If enterApp throws for any reason, we surface it instead of
          // leaving them stuck on a green "welcome" message.
          setTimeout(() => {
            try {
              enterApp();
            } catch (e) {
              console.error('enterApp failed after sign-in:', e);
              setMessage('Signed in, but something went wrong loading the menu. Please refresh.', 'error');
            }
          }, 600);
        } else {
          setMessage('We couldn\u2019t sign you in. Please double-check your email and password.', 'error');
        }
      } else {
        const res = await Auth.signUp(email, pw, username);
        if (Auth.user && res?.session) {
          setMessage(`Welcome, ${username}! Your account is ready. Taking you to the menu…`, 'success');
          setTimeout(() => {
            try {
              enterApp();
            } catch (e) {
              console.error('enterApp failed after sign-up:', e);
              setMessage('Account created, but something went wrong loading the menu. Please refresh.', 'error');
            }
          }, 700);
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
      console.error('Auth submit error:', err);

      // If the failure is "email not confirmed", offer a Resend button right
      // under the error so the user can fix it in one tap.
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
      submit.disabled = false;
    }
  });
}

function showFatalError(msg) {
  const el = document.createElement('div');
  el.style.cssText = 'position:fixed;inset:0;display:grid;place-items:center;background:#101;z-index:999;color:white;padding:20px;font-family:sans-serif;text-align:center;';
  el.innerHTML = `<div><h1>\u26A0\uFE0F Something went wrong</h1><p>${msg}</p></div>`;
  document.body.appendChild(el);
}
