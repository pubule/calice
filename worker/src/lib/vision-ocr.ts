// Confirmed present on this account's Workers AI catalog on 2026-09-02
// (GET /accounts/{account_id}/ai/models/search?task=Image-to-Text) — no
// `price` property, unlike @cf/moondream/moondream3.1-9B-A2B.
const VISION_MODEL = '@cf/llava-hf/llava-1.5-7b-hf';

const PROMPT =
  'Extract the wine name, producer/winery, vintage year, and denomination/appellation ' +
  '(e.g. DOCG, DOC, AOC, AVA) visible on this label. Reply with ONLY a JSON object: ' +
  '{"name": string|null, "producer": string|null, "vintage": number|null, "denomination": string|null}. ' +
  'No other text before or after the JSON.';

export type OcrResult = { parsed?: { name?: string; producer?: string; vintage?: number; denomination?: string }; rawText?: string };

function base64ToBytes(dataUrl: string): number[] {
  const base64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
  const binary = atob(base64);
  const bytes = new Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export async function runVisionOcr(ai: Ai, photoBase64: string): Promise<OcrResult | null> {
  let text: string;
  try {
    const response: any = await ai.run(VISION_MODEL as any, { image: base64ToBytes(photoBase64), prompt: PROMPT, max_tokens: 256 });
    text = typeof response === 'string' ? response : (response?.description ?? response?.response ?? '');
  } catch {
    return null;
  }
  if (!text || !text.trim()) return null;

  try {
    const parsed = JSON.parse(text.trim());
    const clean: NonNullable<OcrResult['parsed']> = {};
    if (typeof parsed.name === 'string' && parsed.name.trim()) clean.name = parsed.name.trim();
    if (typeof parsed.producer === 'string' && parsed.producer.trim()) clean.producer = parsed.producer.trim();
    if (typeof parsed.vintage === 'number' && Number.isInteger(parsed.vintage)) clean.vintage = parsed.vintage;
    if (typeof parsed.denomination === 'string' && parsed.denomination.trim()) clean.denomination = parsed.denomination.trim();
    return Object.keys(clean).length ? { parsed: clean } : { rawText: text };
  } catch {
    return { rawText: text };
  }
}
