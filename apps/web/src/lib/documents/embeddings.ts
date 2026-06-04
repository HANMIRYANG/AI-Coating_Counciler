// Pluggable text embedder for semantic document retrieval.
//
// Mirrors the chat-provider factory (providers/index.ts: buildProviderRegistry):
// a real OpenAI embedder is used ONLY when USE_MOCK_PROVIDERS=false AND
// OPENAI_API_KEY is present; otherwise a deterministic, key-free MockEmbedder
// keeps local dev and tests runnable AND reproducible. The MockEmbedder is pure
// (token feature hashing — no clocks, no randomness) so unit tests are
// byte-stable, matching the determinism contract of the keyword search layer.

import { enforceModelPolicy } from "@/lib/council/models";
import { withTimeout } from "@/lib/council/timeout";

export interface Embedder {
  /** Stable id stamped onto each chunk so a model change is detectable. */
  readonly id: string;
  /** Embedding dimensionality (informational; the real guard is id match). */
  readonly dims: number;
  /** Embed texts → one vector per input, IN ORDER. */
  embed(texts: string[]): Promise<Float32Array[]>;
}

export const DEFAULT_EMBEDDING_MODEL = "text-embedding-3-small";
export const MOCK_EMBEDDER_DIMS = 256;
export const MOCK_EMBEDDER_ID = `mock-hash-${MOCK_EMBEDDER_DIMS}`;

function intEnv(key: string, fallback: number): number {
  const raw = process.env[key];
  const n = raw === undefined ? NaN : Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

// ── deterministic token feature hashing (MockEmbedder) ──────────────────

// Split on any non-letter/non-number run (keeps Korean + ASCII tokens, drops
// punctuation). Lowercased (no-op for Korean, folds ASCII).
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 0);
}

// FNV-1a 32-bit. Deterministic, dependency-free.
function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// Bag-of-tokens feature-hashed vector, L2-normalized. Shared tokens → similar
// vectors, so cosine approximates token overlap — enough to exercise the
// vector/hybrid pipeline deterministically. Real semantics come from OpenAI.
export function mockEmbedText(
  text: string,
  dims: number = MOCK_EMBEDDER_DIMS,
): Float32Array {
  const vec = new Float32Array(dims);
  for (const tok of tokenize(text)) {
    const h = fnv1a(tok);
    const idx = h % dims;
    vec[idx] += (h & 1) === 0 ? 1 : -1;
  }
  let norm = 0;
  for (let i = 0; i < dims; i++) norm += vec[i] * vec[i];
  norm = Math.sqrt(norm);
  if (norm > 0) for (let i = 0; i < dims; i++) vec[i] /= norm;
  return vec;
}

export class MockEmbedder implements Embedder {
  readonly id = MOCK_EMBEDDER_ID;
  readonly dims = MOCK_EMBEDDER_DIMS;
  async embed(texts: string[]): Promise<Float32Array[]> {
    return texts.map((t) => mockEmbedText(t, this.dims));
  }
}

// Real embeddings via the OpenAI SDK (already a dependency; see
// providers/openai.ts for the same lazy-import + apiKey pattern).
export class OpenAiEmbedder implements Embedder {
  readonly id: string;
  readonly dims: number;
  private readonly batchSize: number;
  private readonly timeoutMs: number;

  constructor() {
    // Reuse the model-policy guard so a "*-latest"/preview embedding alias is
    // rejected just like a chat model.
    this.id = enforceModelPolicy(
      "openai",
      process.env.EMBEDDING_MODEL?.trim() || DEFAULT_EMBEDDING_MODEL,
    );
    this.dims = intEnv("EMBEDDING_DIMS", 1536);
    this.batchSize = intEnv("EMBEDDING_BATCH_SIZE", 96);
    this.timeoutMs = intEnv("EMBEDDING_TIMEOUT_MS", 20_000);
  }

  async embed(texts: string[]): Promise<Float32Array[]> {
    if (texts.length === 0) return [];
    const { default: OpenAI } = await import("openai");
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const out: Float32Array[] = [];
    for (let i = 0; i < texts.length; i += this.batchSize) {
      const batch = texts.slice(i, i + this.batchSize);
      const res = await withTimeout(
        (signal) =>
          client.embeddings.create(
            { model: this.id, input: batch },
            { signal },
          ),
        { timeoutMs: this.timeoutMs, label: "embeddings" },
      );
      // The API may return data out of order; sort by index before mapping.
      const sorted = [...res.data].sort((a, b) => a.index - b.index);
      for (const d of sorted) {
        out.push(Float32Array.from(d.embedding as number[]));
      }
    }
    return out;
  }
}

export function isMockEmbedderEnabled(): boolean {
  const mock =
    (process.env.USE_MOCK_PROVIDERS ?? "true").toLowerCase() !== "false";
  return mock || !process.env.OPENAI_API_KEY;
}

export function buildEmbedder(): Embedder {
  return isMockEmbedderEnabled() ? new MockEmbedder() : new OpenAiEmbedder();
}
