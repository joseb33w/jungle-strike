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
    console.error('Bootstrap error:', err.message, err.stack);
    showFatalError(err.message);
  }
})();

function enterApp() {
  document.getElementById('authScreen').classList.remove('active');
  showLobby();
  refreshLobby();
}

function setMessage(text, kind) {
  const el = document.getElementById('authMessage');
  if (!el) return;
  el.textContent = text || '';
  el.className = 'auth-msg' + (kind ? ' ' + kind : '');
}

function setActions(actions) {
  // actions: [{label, onClick}]
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
        setMessage('Enter your email above first, then tap Forgot password.', 'error');
        return;
      }
      setMessage('Sending password reset link…', 'info');
      try {
        await Auth.sendPasswordReset(email);
        setMessage(`Password reset email sent to ${email}. Check your inbox.`, 'success');
        setActions(null);
      } catch (err) {
        setMessage(err?.message || 'Could not send reset email.', 'error');
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
    if (pw.length < 6) { setMessage('Password must be at least 6 characters.', 'error'); return; }
    if (mode === 'signup' && !username) { setMessage('Please choose a callsign.', 'error'); return; }

    setMessage(mode === 'signin' ? 'Signing you in…' : 'Creating your account…', 'info');
    submit.disabled = true;

    try {
      if (mode === 'signin') {
        await Auth.signIn(email, pw);
        if (Auth.user) {
          setMessage('');
          enterApp();
        } else {
          setMessage('Could not sign you in. Please try again.', 'error');
        }
      } else {
        const res = await Auth.signUp(email, pw, username);
        if (Auth.user && res?.session) {
          setMessage('');
          enterApp();
        } else if (Auth.user && !res?.session) {
          setMessage(`Account created! We sent a confirmation link to ${email}. Click it, then come back and sign in.`, 'success');
          setActions([
            { label: 'Resend confirmation email', onClick: async () => {
                setMessage('Resending confirmation email…', 'info');
                try {
                  await Auth.resendConfirmation(email);
                  setMessage(`Confirmation email re-sent to ${email}. Check your inbox & spam folder.`, 'success');
                } catch (err) {
                  setMessage(err?.message || 'Could not resend.', 'error');
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
      // in the error banner area so the user can fix it in one tap.
      if (err?.code === 'email_not_confirmed') {
        setActions([
          { label: 'Resend confirmation email', onClick: async () => {
              setMessage('Resending confirmation email…', 'info');
              try {
                await Auth.resendConfirmation(email);
                setMessage(`Confirmation email re-sent to ${email}. Tap the link inside, then try signing in again.`, 'success');
              } catch (e2) {
                setMessage(e2?.message || 'Could not resend.', 'error');
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
  el.innerHTML = `<div><h1>⚠️ Failed to load</h1><p>${msg}</p></div>`;
  document.body.appendChild(el);
}
