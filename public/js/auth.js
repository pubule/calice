import { api } from './api-client.js';

export async function signup(email, password, name) {
  await api.post('/api/auth/signup', { email, password, name });
}

export async function login(email, password) {
  await api.post('/api/auth/login', { email, password });
}

export async function logout() {
  await api.post('/api/auth/logout');
}

export async function me() {
  return api.get('/api/auth/me');
}
