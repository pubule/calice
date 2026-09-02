// Verifies the JWT Cloudflare Access puts in the `Cf-Access-Jwt-Assertion`
// header. Never trust `Cf-Access-Authenticated-User-Email` directly — it's
// just a header, and headers can be forged. The signature check against the
// team's public keys, expiry, and audience are what make the token
// unforgeable. Ported from ombre-su-roccamora/webapp/worker/access.js.

type JWK = { kid: string; kty: string; n: string; e: string };

const cache: { at: number; keys: JWK[] | null } = { at: 0, keys: null };

function b64url(s: string): Uint8Array {
  return Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
}

function json(s: string): any {
  return JSON.parse(new TextDecoder().decode(b64url(s)));
}

async function fetchKeys(team: string): Promise<JWK[]> {
  if (cache.keys && Date.now() - cache.at < 3600_000) return cache.keys;
  const res = await fetch(`https://${team}.cloudflareaccess.com/cdn-cgi/access/certs`);
  if (!res.ok) throw new Error(`Access keys unreachable: ${res.status}`);
  cache.keys = (await res.json<{ keys: JWK[] }>()).keys;
  cache.at = Date.now();
  return cache.keys;
}

// Returns the verified email, or null. Never throws for a malformed token —
// a bad token is a 401, not a server error.
export async function emailFromJwt(
  token: string | undefined,
  opts: { team: string; aud: string; now?: number; getKeys?: (team: string) => Promise<JWK[]> },
): Promise<string | null> {
  const { team, aud, now = Date.now(), getKeys = fetchKeys } = opts;
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [head, body, sig] = parts;

  let h: any, c: any;
  try {
    h = json(head);
    c = json(body);
  } catch {
    return null;
  }

  const keys = await getKeys(team);
  const jwk = keys.find((k) => k.kid === h.kid);
  if (!jwk) return null;

  let valid = false;
  try {
    const key = await crypto.subtle.importKey(
      'jwk',
      { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify'],
    );
    valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64url(sig), new TextEncoder().encode(`${head}.${body}`));
  } catch {
    return null;
  }
  if (!valid) return null;

  if (!c.exp || c.exp * 1000 <= now) return null;
  const audiences = Array.isArray(c.aud) ? c.aud : [c.aud];
  if (!audiences.includes(aud)) return null;
  return c.email || null;
}
