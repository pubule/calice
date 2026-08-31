const PBKDF2_ITERATIONS = 100_000;

function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function fromHex(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  return bytes;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const derived = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    keyMaterial,
    256,
  );
  return `${PBKDF2_ITERATIONS}:${toHex(salt)}:${toHex(derived)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [iterStr, saltHex, hashHex] = stored.split(':');
  const iterations = Number(iterStr);
  const salt = fromHex(saltHex);
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const derived = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    keyMaterial,
    256,
  );
  return toHex(derived) === hashHex;
}

async function hmac(data: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  return toHex(sig);
}

export async function signSession(userId: number, secret: string): Promise<string> {
  const payload = `${userId}.${Date.now() + 1000 * 60 * 60 * 24 * 30}`; // 30-day expiry
  const sig = await hmac(payload, secret);
  return `${payload}.${sig}`;
}

export async function verifySession(token: string, secret: string): Promise<number | null> {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [userIdStr, expStr, sig] = parts;
  const payload = `${userIdStr}.${expStr}`;
  const expected = await hmac(payload, secret);
  if (expected !== sig) return null;
  if (Date.now() > Number(expStr)) return null;
  const userId = Number(userIdStr);
  return Number.isInteger(userId) ? userId : null;
}
