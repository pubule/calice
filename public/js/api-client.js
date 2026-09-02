export const API_URL = window.CALICE_API_URL || 'http://localhost:8787';

async function request(method, path, body) {
  const res = await fetch(`${API_URL}${path}`, {
    method,
    credentials: 'include',
    headers: body instanceof FormData ? {} : { 'content-type': 'application/json' },
    body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) {
    window.location.hash = '#/login';
    throw new Error('unauthorized');
  }
  if (!res.ok) {
    const err = new Error(`${method} ${path} failed: ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return res.status === 204 ? null : res.json();
}

export const api = {
  get: (path) => request('GET', path),
  post: (path, body) => request('POST', path, body),
  patch: (path, body) => request('PATCH', path, body),
  del: (path) => request('DELETE', path),
};
