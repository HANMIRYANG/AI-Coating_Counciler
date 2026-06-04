// Pure vector-similarity helpers for semantic document retrieval.
//
// Embeddings are stored in `DocumentChunk.embedding` (Bytes, little-endian
// Float32) with the producing embedder id + dims recorded in
// `DocumentChunk.metadata` (so a model change is detectable — mismatched chunks
// are skipped at query time and become backfill targets). NO migration is
// needed: both columns already exist.
//
// All ranking here is deterministic — same inputs → same scores and ordering,
// using the same tie-break as the keyword layer (search.ts: rankCandidates):
//   score desc → documentId asc → chunkIndex asc.

import type { DocumentMetadata } from "./schemas";
import type { DocumentSearchResult } from "./search";

export const MAX_VECTOR_CANDIDATES_DEFAULT = 500;

// Keys written into DocumentChunk.metadata alongside the stored vector.
export const EMBEDDING_META_MODEL_KEY = "embeddingModel";
export const EMBEDDING_META_DIMS_KEY = "embeddingDims";

export function maxVectorCandidates(): number {
  const raw = process.env.MAX_VECTOR_CANDIDATES;
  const n = raw === undefined ? NaN : Number(raw);
  return Number.isFinite(n) && n > 0
    ? Math.floor(n)
    : MAX_VECTOR_CANDIDATES_DEFAULT;
}

// ── serialization (LE Float32, deterministic across platforms) ──────────

export function encodeEmbedding(vec: Float32Array): Buffer {
  const buf = Buffer.allocUnsafe(vec.length * 4);
  for (let i = 0; i < vec.length; i++) buf.writeFloatLE(vec[i], i * 4);
  return buf;
}

export function decodeEmbedding(buf: Buffer): Float32Array {
  const n = Math.floor(buf.length / 4);
  const vec = new Float32Array(n);
  for (let i = 0; i < n; i++) vec[i] = buf.readFloatLE(i * 4);
  return vec;
}

// ── embedding-stamp metadata helpers ────────────────────────────────────

export function embeddingStamp(embedder: {
  id: string;
  dims: number;
}): Record<string, unknown> {
  return {
    [EMBEDDING_META_MODEL_KEY]: embedder.id,
    [EMBEDDING_META_DIMS_KEY]: embedder.dims,
  };
}

export function chunkEmbeddingModel(metadata: unknown): string | null {
  if (
    metadata &&
    typeof metadata === "object" &&
    EMBEDDING_META_MODEL_KEY in metadata
  ) {
    const v = (metadata as Record<string, unknown>)[EMBEDDING_META_MODEL_KEY];
    return typeof v === "string" ? v : null;
  }
  return null;
}

// ── similarity + ranking ────────────────────────────────────────────────

export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

// A decoded chunk candidate ready for cosine scoring. `snippet` is the bounded
// display snippet (never the full body), built by the caller.
export type VectorCandidate = {
  chunkId: string;
  chunkIndex: number;
  documentId: string;
  filename: string;
  snippet: string;
  metadata: DocumentMetadata | null;
  vector: Float32Array;
};

function compareString(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

// Score by cosine vs the query vector, drop non-positive, sort deterministically,
// trim to `limit`. The result `score` is the cosine similarity (0..1).
export function rankByCosine(
  candidates: VectorCandidate[],
  queryVec: Float32Array,
  limit: number,
  minScore = 0,
): DocumentSearchResult[] {
  const scored = candidates
    .map((c) => ({ c, score: cosineSimilarity(c.vector, queryVec) }))
    .filter((s) => s.score > minScore);

  scored.sort(
    (a, b) =>
      b.score - a.score ||
      compareString(a.c.documentId, b.c.documentId) ||
      a.c.chunkIndex - b.c.chunkIndex,
  );

  return scored.slice(0, limit).map(({ c, score }) => ({
    documentId: c.documentId,
    filename: c.filename,
    chunkId: c.chunkId,
    chunkIndex: c.chunkIndex,
    snippet: c.snippet,
    metadata: c.metadata,
    score,
  }));
}

// Merge keyword + vector results into ONE deterministic ranking. Each list's
// scores are min-max normalized to [0,1] within that list (a single-item or
// all-equal list normalizes to 1), then combined as a weighted sum. Dedupe by
// chunkId, keeping the keyword result object (snippet/metadata) when a chunk
// appears in both. Deterministic tie-break.
export function mergeHybrid(
  keyword: DocumentSearchResult[],
  vector: DocumentSearchResult[],
  limit: number,
  weights: { keyword: number; vector: number } = { keyword: 0.5, vector: 0.5 },
): DocumentSearchResult[] {
  const norm = (list: DocumentSearchResult[]): Map<string, number> => {
    const m = new Map<string, number>();
    if (list.length === 0) return m;
    const scores = list.map((r) => r.score);
    const min = Math.min(...scores);
    const max = Math.max(...scores);
    const span = max - min;
    for (const r of list) {
      m.set(r.chunkId, span === 0 ? 1 : (r.score - min) / span);
    }
    return m;
  };

  const kNorm = norm(keyword);
  const vNorm = norm(vector);

  // keyword first → its result object wins on dedupe (same chunk, same snippet).
  const byId = new Map<string, DocumentSearchResult>();
  for (const r of [...keyword, ...vector]) {
    if (!byId.has(r.chunkId)) byId.set(r.chunkId, r);
  }

  const merged = [...byId.values()].map((r) => ({
    r,
    score:
      weights.keyword * (kNorm.get(r.chunkId) ?? 0) +
      weights.vector * (vNorm.get(r.chunkId) ?? 0),
  }));

  merged.sort(
    (a, b) =>
      b.score - a.score ||
      compareString(a.r.documentId, b.r.documentId) ||
      a.r.chunkIndex - b.r.chunkIndex,
  );

  return merged.slice(0, limit).map(({ r, score }) => ({ ...r, score }));
}
