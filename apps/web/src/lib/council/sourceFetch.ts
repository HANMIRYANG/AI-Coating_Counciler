// External source fetch for internal_docs_web (docs/23). Operator/user provides
// official-page URLs; this fetches them SERVER-SIDE, extracts a bounded text
// snippet, and assigns a trust level from the domain whitelist.
//
// SAFETY: a basic SSRF guard blocks non-http(s) and obvious private/loopback
// hosts. This is a stopgap (no DNS-rebind protection) — URLs are user-provided
// and the feature is a side-car that NEVER halts the council run. No retries
// (docs/23: SOURCE_RETRY_LIMIT=0). No JS execution / no headless browser.

import type { EvidenceTrustLevel } from "./evidenceCatalog";
import { trustLevelForUrl } from "./sourceWhitelist";

// ── tunables (docs/23 defaults; env-overridable) ──────────────────────
function envInt(key: string, def: number): number {
  const raw = process.env[key];
  const v = raw === undefined ? def : Number(raw);
  return Number.isFinite(v) ? Math.max(0, Math.floor(v)) : def;
}
export const sourceFetchTimeoutMs = () => envInt("SOURCE_FETCH_TIMEOUT_MS", 8000);
export const evidenceRetrievalBudgetMs = () =>
  envInt("EVIDENCE_RETRIEVAL_BUDGET_MS", 20000);
export const maxSourcesPerSession = () => envInt("MAX_SOURCES_PER_SESSION", 6);
export const maxParallelSourceFetch = () =>
  envInt("MAX_PARALLEL_SOURCE_FETCH", 3);

export const MAX_SOURCE_BYTES = 1_500_000; // 1.5MB page cap
export const EXTERNAL_SNIPPET_CHARS = 280;

export type SourceUnavailableReason =
  | "timeout"
  | "blocked"
  | "http_4xx"
  | "http_5xx"
  | "unsupported_content"
  | "too_large"
  | "parse_error"
  | "network_error";

export type SourceFetchResult =
  | {
      ok: true;
      url: string;
      title: string;
      snippet: string;
      trustLevel: EvidenceTrustLevel;
    }
  | { ok: false; url: string; reason: SourceUnavailableReason };

// Block obvious internal targets. Not exhaustive (no DNS resolution), but
// covers literal loopback / private / link-local hosts.
export function isBlockedHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "" || h === "localhost") return true;
  if (h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal"))
    return true;
  if (h === "0.0.0.0" || h === "::1" || h === "::") return true;
  if (/^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true;
  if (/^169\.254\./.test(h)) return true; // link-local incl. cloud metadata
  if (h.startsWith("fe80:") || h.startsWith("fc") || h.startsWith("fd"))
    return true; // IPv6 link-local / unique-local
  return false;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
}

function extractTitle(html: string): string | undefined {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!m) return undefined;
  const t = htmlToText(m[1]).slice(0, 200);
  return t.length > 0 ? t : undefined;
}

async function readTextBounded(
  res: Response,
  maxBytes: number,
): Promise<string> {
  const reader = res.body?.getReader?.();
  if (!reader) return await res.text();
  const decoder = new TextDecoder();
  let received = 0;
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    received += value.byteLength;
    if (received > maxBytes) {
      const keep = Math.max(0, maxBytes - (received - value.byteLength));
      text += decoder.decode(value.slice(0, keep), { stream: true });
      try {
        await reader.cancel();
      } catch {
        /* ignore */
      }
      break;
    }
    text += decoder.decode(value, { stream: true });
  }
  text += decoder.decode();
  return text;
}

type FetchImpl = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

/** Fetch + extract a single external source. Never throws. */
export async function fetchSource(
  url: string,
  opts?: { timeoutMs?: number; maxBytes?: number; fetchImpl?: FetchImpl },
): Promise<SourceFetchResult> {
  const timeoutMs = opts?.timeoutMs ?? sourceFetchTimeoutMs();
  const maxBytes = opts?.maxBytes ?? MAX_SOURCE_BYTES;
  const f: FetchImpl = opts?.fetchImpl ?? (fetch as unknown as FetchImpl);

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, url, reason: "parse_error" };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, url, reason: "blocked" };
  }
  if (isBlockedHost(parsed.hostname)) {
    return { ok: false, url, reason: "blocked" };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await f(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "user-agent": "ai-coating-council/1.0 (+evidence fetch)",
        accept: "text/html,application/xhtml+xml,text/plain",
      },
    });
    if (res.status >= 500) return { ok: false, url, reason: "http_5xx" };
    if (res.status >= 400) return { ok: false, url, reason: "http_4xx" };

    const ct = res.headers.get("content-type") ?? "";
    if (!/text\/html|application\/xhtml|text\/plain/i.test(ct)) {
      return { ok: false, url, reason: "unsupported_content" };
    }
    const cl = Number(res.headers.get("content-length") ?? "0");
    if (cl && cl > maxBytes) return { ok: false, url, reason: "too_large" };

    const raw = await readTextBounded(res, maxBytes);
    const body = htmlToText(raw);
    if (body.length === 0) return { ok: false, url, reason: "parse_error" };

    return {
      ok: true,
      url,
      title: extractTitle(raw) ?? parsed.hostname,
      snippet: body.slice(0, EXTERNAL_SNIPPET_CHARS),
      trustLevel: trustLevelForUrl(url),
    };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      return { ok: false, url, reason: "timeout" };
    }
    return { ok: false, url, reason: "network_error" };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetch multiple sources with bounded concurrency + an overall wall-clock
 * budget. Truncates the URL list to MAX_SOURCES_PER_SESSION. Returns one
 * result per attempted URL, in input order. Never throws.
 */
export async function fetchSources(
  urls: string[],
  opts?: {
    budgetMs?: number;
    concurrency?: number;
    timeoutMs?: number;
    fetchImpl?: FetchImpl;
    now?: () => number;
  },
): Promise<SourceFetchResult[]> {
  const now = opts?.now ?? (() => Date.now());
  const list = urls.slice(0, maxSourcesPerSession());
  const concurrency = Math.max(
    1,
    opts?.concurrency ?? maxParallelSourceFetch(),
  );
  const perFetchTimeout = opts?.timeoutMs ?? sourceFetchTimeoutMs();
  const deadline = now() + (opts?.budgetMs ?? evidenceRetrievalBudgetMs());

  const results: SourceFetchResult[] = new Array(list.length);
  let next = 0;
  async function worker() {
    for (;;) {
      const i = next++;
      if (i >= list.length) return;
      const remaining = deadline - now();
      if (remaining <= 0) {
        results[i] = { ok: false, url: list[i], reason: "timeout" };
        continue;
      }
      results[i] = await fetchSource(list[i], {
        timeoutMs: Math.min(perFetchTimeout, remaining),
        fetchImpl: opts?.fetchImpl,
      });
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, list.length) }, () => worker()),
  );
  return results;
}
