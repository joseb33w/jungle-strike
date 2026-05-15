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
    // Enter the app as long as we have a user — profile loads in the background
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
      submitBtn.textContent = mode === 'signin' ? 'Deploy' : 'Enlist';
      document.getElementById('authMessage').textContent = '';
    });
  });

  document.getElementById('authForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('authEmail').value.trim();
    const pw = document.getElementById('authPassword').value;
    const username = document.getElementById('authUsername').value.trim();
    const msg = document.getElementById('authMessage');
    const submit = document.getElementById('authSubmit');
    msg.textContent = mode === 'signin' ? 'Authenticating…' : 'Creating account…';
    submit.disabled = true;
    try {
      if (mode === 'signin') {
        await Auth.signIn(email, pw);
        // If we got here, auth worked — enter the app no matter what
        if (Auth.user) {
          msg.textContent = '';
          enterApp();
        } else {
          msg.textContent = 'Login failed: no user returned.';
        }
      } else {
        if (!username) throw new Error('Choose a callsign.');
        await Auth.signUp(email, pw, username);
        if (Auth.user) {
          msg.textContent = '';
          enterApp();
        } else {
          msg.textContent = 'Account created! Check your email to confirm, then sign in.';
        }
      }
    } catch (err) {
      // Show the REAL Supabase error so the user knows what's wrong
      const text = err?.message || 'Something went wrong.';
      msg.textContent = text;
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
