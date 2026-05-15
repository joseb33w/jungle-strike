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

function setupAuthUI() {
  const tabs = document.querySelectorAll('#authScreen .tab');
  const usernameField = document.getElementById('usernameField');
  const submitBtn = document.getElementById('authSubmit');
  let mode = 'signin';

  tabs.forEach(t => {
    t.addEventListener('click', () => {
      tabs.forEach(x => x.classList.remove('active'));
      t.classList.add('active');
      mode = t.dataset.tab;
      usernameField.hidden = mode !== 'signup';
      // Also toggle required on the username input itself
      const userInput = document.getElementById('authUsername');
      if (userInput) userInput.required = (mode === 'signup');
      submitBtn.textContent = mode === 'signin' ? 'Sign In' : 'Create Account';
      setMessage('');
    });
  });

  document.getElementById('authForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('authEmail').value.trim();
    const pw = document.getElementById('authPassword').value;
    const username = document.getElementById('authUsername').value.trim();
    const submit = document.getElementById('authSubmit');

    // Basic client-side checks with friendly text
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
          // Signed up AND auto-signed-in
          setMessage('');
          enterApp();
        } else if (Auth.user && !res?.session) {
          // Email confirmation required
          setMessage('Account created! Check your email to confirm, then sign in.', 'success');
        } else {
          setMessage('Account created. Please sign in.', 'success');
        }
      }
    } catch (err) {
      setMessage(err?.message || 'Something went wrong. Please try again.', 'error');
      console.error('Auth submit error:', err);
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
