import { api } from '../api-client.js';
import { navigate } from '../router.js';

// Called both directly (user opens #/invite/:code already logged in) and
// after auth.js resumes a pending invite post-login/signup — keep it
// idempotent (`insert or ignore` server-side) and safe to call twice.
export async function acceptInvite(code) {
  const { cellarId } = await api.post(`/api/invites/${code}/accept`);
  return cellarId;
}

export async function mountInviteAccept(search, params) {
  const code = params?.code;
  const msgEl = document.getElementById('invite-message');
  if (msgEl) msgEl.textContent = 'Accesso alla cantina condivisa in corso…';
  if (!code) {
    if (msgEl) msgEl.textContent = 'Codice invito mancante.';
    return;
  }
  try {
    await api.get('/api/auth/me');
  } catch (err) {
    // Not authenticated: stash the code and send the user to log in/sign up
    // first, then resume the accept once they're authenticated.
    sessionStorage.setItem('pendingInviteCode', code);
    navigate('#/login');
    return;
  }
  // Authenticated: handle the accept directly, right here — clear whatever
  // main.js's bootstrap guard may have stashed for this code so a later
  // login/signup in this tab doesn't try to re-resume an invite that was
  // already resolved (success or failure) on this direct visit.
  sessionStorage.removeItem('pendingInviteCode');
  try {
    await acceptInvite(code);
    navigate('#/cellar');
  } catch (err) {
    if (msgEl) msgEl.textContent = 'Codice invito non valido o scaduto.';
    else console.error('invite accept failed', err);
  }
}
