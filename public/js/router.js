const routes = new Map();
// Patterns with a `:param` segment (e.g. '#/invite/:code') can't be matched
// by the exact-match `routes` Map lookup, so they're kept separately and
// checked by segment count/literal match only when the exact lookup misses.
const dynamicRoutes = [];

export function registerRoute(hash, mountFn) {
  if (hash.includes(':')) {
    dynamicRoutes.push({ segments: hash.split('/'), mountFn });
  } else {
    routes.set(hash, mountFn);
  }
}

export function navigate(hash) {
  window.location.hash = hash;
}

function matchDynamic(base) {
  const segments = base.split('/');
  for (const route of dynamicRoutes) {
    if (route.segments.length !== segments.length) continue;
    const params = {};
    const matched = route.segments.every((seg, i) => {
      if (seg.startsWith(':')) {
        params[seg.slice(1)] = segments[i];
        return true;
      }
      return seg === segments[i];
    });
    if (matched) return { mountFn: route.mountFn, params };
  }
  return null;
}

function renderCurrent() {
  const hash = window.location.hash || '#/home';
  const [base] = hash.split('?');
  const search = new URLSearchParams(hash.split('?')[1] || '');
  const mount = routes.get(base);
  if (mount) {
    mount(search);
    return;
  }
  const dynamic = matchDynamic(base);
  if (dynamic) {
    dynamic.mountFn(search, dynamic.params);
    return;
  }
  routes.get('#/home')?.(search);
}

export function startRouter() {
  window.addEventListener('hashchange', renderCurrent);
  renderCurrent();
}
