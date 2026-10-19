// Minimal, rate-limited client for https://api.openf1.org/v1.

export const OPENF1_BASE = "https://api.openf1.org/v1";

// The free tier allows a few requests per second; stay comfortably below it.
const MIN_SPACING_MS = 400;
const MAX_RETRIES = 4;

type Params = Record<string, string | number | undefined>;

let queue: Promise<unknown> = Promise.resolve();
let lastRequest = 0;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Format epoch ms the way OpenF1 date filters expect (UTC, no zone suffix). */
export function isoParam(ms: number): string {
  return new Date(ms).toISOString().replace("Z", "");
}

function buildUrl(endpoint: string, params: Params, range?: { from?: number; to?: number }): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  }
  if (range?.from != null) parts.push(`date%3E=${encodeURIComponent(isoParam(range.from))}`);
  if (range?.to != null) parts.push(`date%3C${encodeURIComponent(isoParam(range.to))}`);
  return `${OPENF1_BASE}/${endpoint}${parts.length ? `?${parts.join("&")}` : ""}`;
}

async function request<T>(url: string, signal?: AbortSignal): Promise<T[]> {
  for (let attempt = 0; ; attempt++) {
    const wait = lastRequest + MIN_SPACING_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastRequest = Date.now();
    let res: Response;
    try {
      res = await fetch(url, { signal, headers: { Accept: "application/json" } });
    } catch (err) {
      if (signal?.aborted || attempt >= MAX_RETRIES) throw err;
      await sleep(1000 * 2 ** attempt);
      continue;
    }
    // OpenF1 answers 404 when a filter matches nothing.
    if (res.status === 404) return [];
    if ((res.status === 429 || res.status >= 500) && attempt < MAX_RETRIES) {
      const retryAfter = Number(res.headers.get("Retry-After"));
      await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 1000 * 2 ** attempt);
      continue;
    }
    if (!res.ok) throw new Error(`OpenF1 ${res.status} for ${url}`);
    const body: unknown = await res.json();
    return Array.isArray(body) ? (body as T[]) : [];
  }
}

/** Queue a GET so requests are serialised and spaced out. */
export function openf1<T>(
  endpoint: string,
  params: Params = {},
  range?: { from?: number; to?: number },
  signal?: AbortSignal,
): Promise<T[]> {
  const url = buildUrl(endpoint, params, range);
  const run = queue.then(() => request<T>(url, signal));
  queue = run.catch(() => undefined);
  return run;
}
