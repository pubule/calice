import { api } from './api-client.js';

// If the user arrived via an invite link while logged out, invite.js stashed
// the code before redirecting to login/signup. Resume it now that there's a
// session, so the caller's normal post-auth navigation still applies after.
async function resumePendingInvite() {
  const code = sessionStorage.getItem('pendingInviteCode');
  if (!code) return;
  sessionStorage.removeItem('pendingInviteCode');
  try {
    await api.post(`/api/invites/${code}/accept`);
  } catch (err) {
    console.error('pending invite accept failed', err);
  }
}

export async function signup(email, password, name) {
  await api.post('/api/auth/signup', { email, password, name });
  await resumePendingInvite();
}

export async function login(email, password) {
  await api.post('/api/auth/login', { email, password });
  await resumePendingInvite();
}

export async function logout() {
  await api.post('/api/auth/logout');
}

export async function me() {
  return api.get('/api/auth/me');
}
