/**
 * Polite HTTP client used by every source adapter:
 * - per-domain rate limiting (1 request per 2-5s with jitter)
 * - retry with exponential backoff on 429/5xx (max 3 retries)
 * - 20s timeout
 * - realistic browser User-Agent + Accept-Language cs-CZ
 */

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) " +
  "Chrome/129.0.0.0 Safari/537.36";

const DEFAULT_HEADERS: Record<string, string> = {
  "User-Agent": USER_AGENT,
  "Accept-Language": "cs-CZ,cs;q=0.9,en;q=0.8",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
};

const MIN_DELAY_MS = 2000;
const MAX_DELAY_MS = 5000;
const REQUEST_TIMEOUT_MS = 20_000;
const MAX_RETRIES = 3;

const lastRequestAtByHost = new Map<string, number>();
const queueByHost = new Map<string, Promise<void>>();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function jitterDelay(): number {
  return MIN_DELAY_MS + Math.random() * (MAX_DELAY_MS - MIN_DELAY_MS);
}

/** Serializes requests to the same host and enforces a jittered min delay between them. */
async function throttleHost(host: string): Promise<void> {
  const previous = queueByHost.get(host) ?? Promise.resolve();
  let release!: () => void;
  const next = new Promise<void>((resolve) => {
    release = resolve;
  });
  queueByHost.set(
    host,
    previous.then(() => next)
  );
  await previous;
  const last = lastRequestAtByHost.get(host);
  const now = Date.now();
  if (last != null) {
    const elapsed = now - last;
    const wait = jitterDelay() - elapsed;
    if (wait > 0) await sleep(wait);
  }
  lastRequestAtByHost.set(host, Date.now());
  release();
}

export interface FetchOptions {
  headers?: Record<string, string>;
  method?: string;
  body?: string;
  /** Skip the shared per-domain throttle (useful in tests). */
  skipThrottle?: boolean;
}

export class HttpError extends Error {
  constructor(
    message: string,
    public status: number | null,
    public url: string
  ) {
    super(message);
    this.name = "HttpError";
  }
}

/** Fetch with per-domain rate limiting, retry-with-backoff and a timeout. */
export async function politeFetch(url: string, opts: FetchOptions = {}): Promise<Response> {
  const host = new URL(url).host;
  let attempt = 0;
  for (;;) {
    attempt++;
    if (!opts.skipThrottle) await throttleHost(host);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: opts.method ?? "GET",
        headers: { ...DEFAULT_HEADERS, ...opts.headers },
        body: opts.body,
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if ((res.status === 429 || res.status >= 500) && attempt <= MAX_RETRIES) {
        const backoff = 500 * 2 ** attempt + Math.random() * 300;
        await sleep(backoff);
        continue;
      }
      if (!res.ok) {
        throw new HttpError(`HTTP ${res.status} for ${url}`, res.status, url);
      }
      return res;
    } catch (err) {
      clearTimeout(timeout);
      if (attempt <= MAX_RETRIES && !(err instanceof HttpError)) {
        const backoff = 500 * 2 ** attempt + Math.random() * 300;
        await sleep(backoff);
        continue;
      }
      throw err;
    }
  }
}

export async function fetchJson<T = unknown>(url: string, opts: FetchOptions = {}): Promise<T> {
  const res = await politeFetch(url, {
    ...opts,
    headers: { Accept: "application/json", ...opts.headers },
  });
  return (await res.json()) as T;
}

export async function fetchText(url: string, opts: FetchOptions = {}): Promise<string> {
  const res = await politeFetch(url, opts);
  return res.text();
}

export const MAX_RESULT_PAGES = 5;
