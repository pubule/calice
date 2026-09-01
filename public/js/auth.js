import { api } from './api-client.js';

// If the user arrived via an invite link while logged out, main.js's
// bootstrap guard (before it redirects an unauthenticated visitor to
// #/login and clobbers the original #/invite/:code hash) or invite.js
// itself stashed the code. Resume it now that there's a session, so the
// caller's normal post-auth navigation still applies after. Returns true
// only when a pending invite was actually accepted, so callers can send the
// user to the cellar they just joined instead of the normal #/home.
async function resumePendingInvite() {
  const code = sessionStorage.getItem('pendingInviteCode');
  if (!code) return false;
  sessionStorage.removeItem('pendingInviteCode');
  try {
    await api.post(`/api/invites/${code}/accept`);
    return true;
  } catch (err) {
    console.error('pending invite accept failed', err);
    return false;
  }
}

export async function signup(email, password, name) {
  await api.post('/api/auth/signup', { email, password, name });
  return resumePendingInvite();
}

export async function login(email, password) {
  await api.post('/api/auth/login', { email, password });
  return resumePendingInvite();
}

export async function logout() {
  await api.post('/api/auth/logout');
}

export async function me() {
  return api.get('/api/auth/me');
}
