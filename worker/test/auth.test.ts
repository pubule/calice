import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword, signSession, verifySession } from '../src/lib/auth';

describe('password hashing', () => {
  it('verifies a correct password', async () => {
    const hash = await hashPassword('correct-horse');
    expect(await verifyPassword('correct-horse', hash)).toBe(true);
  });

  it('rejects a wrong password', async () => {
    const hash = await hashPassword('correct-horse');
    expect(await verifyPassword('wrong-password', hash)).toBe(false);
  });

  it('produces a different hash each time (random salt)', async () => {
    const a = await hashPassword('same-password');
    const b = await hashPassword('same-password');
    expect(a).not.toBe(b);
  });

  it('rejects a malformed stored hash (not enough parts)', async () => {
    expect(await verifyPassword('password', 'not-a-valid-hash')).toBe(false);
  });

  it('rejects a malformed stored hash (too many parts)', async () => {
    expect(await verifyPassword('password', 'a:b:c:d')).toBe(false);
  });

  it('rejects a malformed stored hash (empty parts)', async () => {
    expect(await verifyPassword('password', '100000::abc')).toBe(false);
  });

  it('rejects a malformed stored hash (non-integer iterations)', async () => {
    expect(await verifyPassword('password', 'notanumber:deadbeef:cafe')).toBe(false);
  });

  it('rejects a malformed stored hash (zero iterations)', async () => {
    expect(await verifyPassword('password', '0:deadbeef:cafe')).toBe(false);
  });
});

describe('session tokens', () => {
  const secret = 'test-secret';

  it('round-trips a valid token', async () => {
    const token = await signSession(42, secret);
    expect(await verifySession(token, secret)).toBe(42);
  });

  it('rejects a tampered token', async () => {
    const token = await signSession(42, secret);
    const tampered = token.slice(0, -2) + 'xx';
    expect(await verifySession(tampered, secret)).toBeNull();
  });

  it('rejects a token signed with a different secret', async () => {
    const token = await signSession(42, secret);
    expect(await verifySession(token, 'other-secret')).toBeNull();
  });
});
