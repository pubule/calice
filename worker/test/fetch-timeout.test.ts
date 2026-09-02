import { describe, it, expect } from 'vitest';
import { fetchWithTimeout } from '../src/lib/fetch-timeout';

describe('fetchWithTimeout', () => {
  it('returns the response on success', async () => {
    const fetchImpl = (async () => new Response('ok')) as typeof fetch;
    const res = await fetchWithTimeout('https://example.com', 1000, fetchImpl);
    expect(await res!.text()).toBe('ok');
  });

  it('returns null when the fetch implementation throws', async () => {
    const fetchImpl = (async () => { throw new Error('boom'); }) as typeof fetch;
    expect(await fetchWithTimeout('https://example.com', 1000, fetchImpl)).toBeNull();
  });
});
