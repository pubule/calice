import { registerRoute, startRouter, navigate } from './router.js';
import { login, signup, logout, me } from './auth.js';
import { mountHome } from './screens/home.js';
import { mountCellar } from './screens/cellar.js';
import { mountAdd } from './screens/add.js';
import { mountStats } from './screens/stats.js';
import { mountProfile } from './screens/profile.js';
import { mountInviteAccept } from './screens/invite.js';

// Stash an invite code from the raw hash BEFORE the auth guard below can run
// (a 401 from `me()` makes api-client.js overwrite location.hash to
// '#/login' before startRouter() ever sees the original hash, so
// '#/invite/:code' would otherwise vanish for a logged-out visitor with no
// trace in sessionStorage for auth.js to resume after login/signup).
const inviteMatch = location.hash.match(/^#\/invite\/(.+)$/);
if (inviteMatch) sessionStorage.setItem('pendingInviteCode', inviteMatch[1]);

const AUTH_VIEWS = ['view-login', 'view-signup'];

function showView(id) {
  document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
  document.getElementById(id)?.classList.add('active');
  const navbar = document.querySelector('.navbar');
  if (navbar) navbar.style.display = AUTH_VIEWS.includes(id) ? 'none' : '';
}

registerRoute('#/login', () => showView('view-login'));
registerRoute('#/signup', () => showView('view-signup'));
registerRoute('#/home', async () => { showView('view-home'); await mountHome(); });
registerRoute('#/cellar', async () => { showView('view-cellar'); await mountCellar(); });
registerRoute('#/add', async () => { showView('view-add'); await mountAdd(); });
registerRoute('#/stats', async () => { showView('view-stats'); await mountStats(); });
registerRoute('#/profile', async () => { showView('view-profile'); await mountProfile(); });
registerRoute('#/invite/:code', async (search, params) => { showView('view-invite'); await mountInviteAccept(search, params); });

function flashError(btnId, message) {
  console.error(message);
  const btn = document.getElementById(btnId);
  const original = btn.textContent;
  btn.textContent = message;
  setTimeout(() => { btn.textContent = original; }, 2500);
}

document.getElementById('login-submit').addEventListener('click', async () => {
  try {
    const joinedInvite = await login(document.getElementById('login-email').value, document.getElementById('login-password').value);
    navigate(joinedInvite ? '#/cellar' : '#/home');
  } catch (err) {
    flashError('login-submit', 'Credenziali non valide');
  }
});
document.getElementById('go-signup').addEventListener('click', () => navigate('#/signup'));
document.getElementById('go-login').addEventListener('click', () => navigate('#/login'));
document.getElementById('signup-submit').addEventListener('click', async () => {
  try {
    const joinedInvite = await signup(
      document.getElementById('signup-email').value,
      document.getElementById('signup-password').value,
      document.getElementById('signup-name').value,
    );
    navigate(joinedInvite ? '#/cellar' : '#/home');
  } catch (err) {
    flashError('signup-submit', err.status === 409 ? 'Email già registrata — accedi' : 'Registrazione non riuscita');
  }
});
document.querySelector('.logout')?.addEventListener('click', async () => {
  await logout();
  navigate('#/login');
});

document.querySelectorAll('.navbtn[data-view]').forEach((btn) => {
  btn.addEventListener('click', () => navigate('#/' + btn.dataset.view.replace('view-', '')));
});

// Route guard: only start the router (and thus render any view) once we know
// whether there's a valid session. On 401 the api-client already set
// location.hash to '#/login' before this rejects, so startRouter() picks
// that hash up on its first render either way — any '#/invite/:code' was
// already captured to sessionStorage above, before this could clobber it.
me().catch(() => navigate('#/login')).finally(() => startRouter());
