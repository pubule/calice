import { fetchWithTimeout } from './fetch-timeout';

export type OffSuggestion = { name?: string; producer?: string; country?: string; imageUrl?: string };

export async function lookupBarcode(barcode: string, fetchImpl: typeof fetch = fetch): Promise<OffSuggestion | null> {
  const res = await fetchWithTimeout(`https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(barcode)}`, 8000, fetchImpl);
  if (!res || !res.ok) return null;

  let body: any;
  try {
    body = await res.json();
  } catch {
    return null;
  }

  const product = body?.product;
  if (!product) return null;

  const suggestion: OffSuggestion = {};
  if (typeof product.product_name === 'string' && product.product_name.trim()) suggestion.name = product.product_name.trim();
  if (typeof product.brands === 'string' && product.brands.trim()) suggestion.producer = product.brands.split(',')[0].trim();
  if (typeof product.countries === 'string' && product.countries.trim()) suggestion.country = product.countries.split(',')[0].trim();
  if (typeof product.image_url === 'string' && product.image_url.trim()) suggestion.imageUrl = product.image_url.trim();
  return Object.keys(suggestion).length ? suggestion : null;
}
