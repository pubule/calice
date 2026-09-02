import { api } from './api-client.js';

// Cloudflare Access owns the session; there's no login/signup flow left in
// the app. This just fetches (and, on a user's very first visit, creates)
// the current identity.
export function me() {
  return api.get('/api/auth/me');
}
