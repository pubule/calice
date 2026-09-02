import { describe, it, expect } from 'vitest';
import { emailFromJwt } from '../src/lib/access';

function b64url(buf: ArrayBuffer | Uint8Array): string {
  return Buffer.from(buf as any).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function generateKeyPair() {
  return crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  );
}

describe('emailFromJwt', () => {
  it('verifies a valid token, rejects expired/wrong-audience/wrong-key/malformed/tampered ones', async () => {
    const pair = await generateKeyPair();
    const jwk = { ...(await crypto.subtle.exportKey('jwk', pair.publicKey)), kid: 'k1', alg: 'RS256' } as any;
    const getKeys = async () => [jwk];

    const sign = async (payload: object, key = pair.privateKey, kid = 'k1') => {
      const head = b64url(new TextEncoder().encode(JSON.stringify({ alg: 'RS256', kid })));
      const body = b64url(new TextEncoder().encode(JSON.stringify(payload)));
      const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(`${head}.${body}`));
      return `${head}.${body}.${b64url(sig)}`;
    };

    const opts = { team: 'test', aud: 'AUD1', now: 1_000_000, getKeys };
    const good = { email: 'fabio@example.com', aud: ['AUD1'], exp: 2000 };

    expect(await emailFromJwt(await sign(good), opts)).toBe('fabio@example.com');
    expect(await emailFromJwt(undefined, opts)).toBeNull();
    expect(await emailFromJwt('not-a-jwt', opts)).toBeNull();
    expect(await emailFromJwt(await sign({ ...good, exp: 999 }), opts)).toBeNull();
    expect(await emailFromJwt(await sign({ ...good, aud: ['OTHER'] }), opts)).toBeNull();
    expect(await emailFromJwt(await sign(good, (await generateKeyPair()).privateKey), opts)).toBeNull();
    expect(await emailFromJwt(await sign(good, pair.privateKey, 'unknown'), opts)).toBeNull();
    expect(await emailFromJwt(await sign({ ...good, email: undefined }), opts)).toBeNull();

    // Tampering: swap the body after signing, keep the original head/sig.
    const token = await sign(good);
    const [head, , sig] = token.split('.');
    const forgedBody = b64url(new TextEncoder().encode(JSON.stringify({ ...good, email: 'thief@example.com' })));
    expect(await emailFromJwt(`${head}.${forgedBody}.${sig}`, opts)).toBeNull();
  });
});
