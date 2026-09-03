// A small shared wrapper every external lookup in this feature uses: never
// throw, never hang past `ms`. A dependency being slow or down degrades the
// caller's data, it never turns into a 500.
export async function fetchWithTimeout(url: string, ms: number, fetchImpl: typeof fetch = fetch, init?: RequestInit): Promise<Response | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
