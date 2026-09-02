import { describe, it, expect } from 'vitest';
import { runVisionOcr } from '../src/lib/vision-ocr';

describe('runVisionOcr', () => {
  it('parses a valid JSON response', async () => {
    const fakeAi = { run: async () => ({ description: '{"name":"Barolo DOCG","producer":"Elio Altare","vintage":2016,"denomination":"Barolo DOCG"}' }) } as any;
    const result = await runVisionOcr(fakeAi, 'data:image/jpeg;base64,AAAA');
    expect(result).toEqual({ parsed: { name: 'Barolo DOCG', producer: 'Elio Altare', vintage: 2016, denomination: 'Barolo DOCG' } });
  });

  it('falls back to rawText when the response is not valid JSON', async () => {
    const fakeAi = { run: async () => ({ description: 'Barolo DOCG 2016, Elio Altare' }) } as any;
    const result = await runVisionOcr(fakeAi, 'data:image/jpeg;base64,AAAA');
    expect(result).toEqual({ rawText: 'Barolo DOCG 2016, Elio Altare' });
  });

  it('also reads a { response } shape (some Workers AI models use this key instead of description)', async () => {
    const fakeAi = { run: async () => ({ response: '{"name":"Chianti"}' }) } as any;
    const result = await runVisionOcr(fakeAi, 'data:image/jpeg;base64,AAAA');
    expect(result).toEqual({ parsed: { name: 'Chianti' } });
  });

  it('returns null when the AI binding throws (not enabled on the account, model error, etc.)', async () => {
    const fakeAi = { run: async () => { throw new Error('AI binding not available'); } } as any;
    expect(await runVisionOcr(fakeAi, 'data:image/jpeg;base64,AAAA')).toBeNull();
  });

  it('returns null when the model returns no usable text at all', async () => {
    const fakeAi = { run: async () => ({}) } as any;
    expect(await runVisionOcr(fakeAi, 'data:image/jpeg;base64,AAAA')).toBeNull();
  });

  it('returns null without calling ai.run when photoBase64 exceeds the size guard', async () => {
    const fakeAi = { run: async (): Promise<never> => { throw new Error('should not be called'); } } as any;
    const oversized = 'data:image/jpeg;base64,' + 'A'.repeat(2_000_001);
    expect(await runVisionOcr(fakeAi, oversized)).toBeNull();
  });
});
