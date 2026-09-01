const routes = new Map();

export function registerRoute(hash, mountFn) {
  routes.set(hash, mountFn);
}

export function navigate(hash) {
  window.location.hash = hash;
}

function renderCurrent() {
  const hash = window.location.hash || '#/home';
  const [base] = hash.split('?');
  const mount = routes.get(base) || routes.get('#/home');
  mount?.(new URLSearchParams(hash.split('?')[1] || ''));
}

export function startRouter() {
  window.addEventListener('hashchange', renderCurrent);
  renderCurrent();
}
