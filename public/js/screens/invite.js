import { api } from '../api-client.js';
import { navigate } from '../router.js';

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
    await acceptInvite(code);
    navigate('#/cellar');
  } catch (err) {
    if (msgEl) msgEl.textContent = 'Codice invito non valido o scaduto.';
    else console.error('invite accept failed', err);
  }
}
