// Internal document search foundation — deterministic keyword matching.
//
// This is NOT full RAG. There are no embeddings, no vector similarity, no
// external fetching, and no orchestrator wiring. It is a pure, deterministic
// keyword layer over the already-persisted `DocumentChunk.content` plus the
// `Document.metadata` JSONB column.
//
// This module holds ONLY pure helpers + the request schema so they can be
// unit-tested without a database. The Prisma query lives in
// `DocumentService.search` (service.ts) and feeds candidates into
// `rankCandidates` here. Everything is byte-for-byte deterministic: same
// inputs → same ordering, scores, and snippets. No clocks, no randomness.

import { z } from "zod";
import { EvidenceDocumentTypeSchema } from "@/lib/council/evidence";

import type { Prisma } from "@prisma/client";
import type { DocumentMetadata } from "./schemas";

export const SEARCH_DEFAULT_LIMIT = 10;
export const SEARCH_MAX_LIMIT = 50;
// Upper bound on chunks pulled from the DB before in-process scoring. Keeps
// the query bounded; candidates are fetched in a deterministic order so the
// truncation point is stable. A vector index will replace this scan later.
export const SEARCH_CANDIDATE_CAP = 200;
// Max distinct query terms honored (bounds the OR fan-out in the where clause).
export const SEARCH_MAX_TERMS = 20;
export const SNIPPET_MAX_CHARS = 160;
// Characters of leading context kept before the first match in a snippet.
const SNIPPET_LEAD_CHARS = 40;

// Query-param contract for GET /api/documents/search. `q` is required and
// must contain at least one non-whitespace character. Metadata filters are
// optional and matched exactly against `Document.metadata` keys.
export const SearchDocumentsRequestSchema = z.object({
  q: z.string().trim().min(1, "q must be non-empty"),
  documentType: EvidenceDocumentTypeSchema.optional(),
  productName: z.string().trim().min(1).max(255).optional(),
  issuer: z.string().trim().min(1).max(255).optional(),
  limit: z.number().int().positive().optional(),
});
export type SearchDocumentsRequest = z.infer<typeof SearchDocumentsRequestSchema>;

// A raw chunk row (joined with its parent document) before scoring.
export type SearchCandidate = {
  chunkId: string;
  chunkIndex: number;
  content: string;
  documentId: string;
  filename: string;
  metadata: DocumentMetadata | null;
};

// Lightweight result. Carries a short snippet — never the full chunk body.
export type DocumentSearchResult = {
  documentId: string;
  filename: string;
  chunkId: string;
  chunkIndex: number;
  snippet: string;
  metadata: DocumentMetadata | null;
  score: number;
};

export function clampSearchLimit(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return SEARCH_DEFAULT_LIMIT;
  const n = Math.floor(value);
  if (n <= 0) return SEARCH_DEFAULT_LIMIT;
  return Math.min(n, SEARCH_MAX_LIMIT);
}

// Lowercase, split on whitespace, drop empties, de-duplicate preserving
// first-seen order, and cap the term count. Pure + deterministic.
export function normalizeQuery(q: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of q.toLowerCase().split(/\s+/)) {
    const term = raw.trim();
    if (term.length === 0 || seen.has(term)) continue;
    seen.add(term);
    out.push(term);
    if (out.length >= SEARCH_MAX_TERMS) break;
  }
  return out;
}

function countOccurrences(haystack: string, needle: string): number {
  if (needle.length === 0) return 0;
  let count = 0;
  let idx = haystack.indexOf(needle);
  while (idx !== -1) {
    count++;
    idx = haystack.indexOf(needle, idx + needle.length);
  }
  return count;
}

// Deterministic relevance score for one chunk against the query terms.
//   score = (distinct terms matched) * 100 + (total occurrences)
// Distinct-term coverage dominates raw frequency so a chunk hitting more of
// the query ranks above one that merely repeats a single term.
export function scoreChunkContent(
  content: string,
  terms: string[],
): { score: number; matchedTerms: number; occurrences: number } {
  const lower = content.toLowerCase();
  let matchedTerms = 0;
  let occurrences = 0;
  for (const term of terms) {
    const occ = countOccurrences(lower, term);
    if (occ > 0) {
      matchedTerms++;
      occurrences += occ;
    }
  }
  return { score: matchedTerms * 100 + occurrences, matchedTerms, occurrences };
}

// Build a bounded snippet centered on the first matching term. Whitespace is
// collapsed for display. Falls back to the head of the content when no term
// matches (defensive — ranked candidates always match at least one term).
export function buildSnippet(
  content: string,
  terms: string[],
  maxLen: number = SNIPPET_MAX_CHARS,
): string {
  const collapsed = content.replace(/\s+/g, " ").trim();
  const lower = collapsed.toLowerCase();

  let first = -1;
  for (const term of terms) {
    const pos = lower.indexOf(term);
    if (pos !== -1 && (first === -1 || pos < first)) first = pos;
  }

  if (first === -1) {
    const head = collapsed.slice(0, maxLen).trimEnd();
    return head.length < collapsed.length ? `${head}…` : head;
  }

  const start = Math.max(0, first - SNIPPET_LEAD_CHARS);
  const end = Math.min(collapsed.length, start + maxLen);
  let snippet = collapsed.slice(start, end).trim();
  if (start > 0) snippet = `…${snippet}`;
  if (end < collapsed.length) snippet = `${snippet}…`;
  return snippet;
}

// Deterministic string compare (no locale dependence) for stable tie-breaks.
function compareString(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

// Score, filter out non-matches, sort, and trim to `limit`. Ordering:
//   1. score descending
//   2. documentId ascending   (stable across runs)
//   3. chunkIndex ascending
export function rankCandidates(
  candidates: SearchCandidate[],
  terms: string[],
  limit: number,
): DocumentSearchResult[] {
  const scored = candidates
    .map((c) => ({ c, score: scoreChunkContent(c.content, terms).score }))
    .filter((s) => s.score > 0);

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
    snippet: buildSnippet(c.content, terms),
    metadata: c.metadata,
    score,
  }));
}

// Construct the Prisma `where` for the candidate scan: chunks whose content
// contains ANY term (case-insensitive), narrowed by exact metadata filters
// on the parent document's JSONB column. Pure — no DB access.
export function buildChunkWhere(
  terms: string[],
  filters: {
    documentType?: string;
    productName?: string;
    issuer?: string;
  },
): Prisma.DocumentChunkWhereInput {
  const where: Prisma.DocumentChunkWhereInput = {
    OR: terms.map((t) => ({
      content: { contains: t, mode: "insensitive" as const },
    })),
  };

  const metadataConditions: Prisma.DocumentWhereInput[] = [];
  if (filters.documentType) {
    metadataConditions.push({
      metadata: { path: ["documentType"], equals: filters.documentType },
    });
  }
  if (filters.productName) {
    metadataConditions.push({
      metadata: { path: ["productName"], equals: filters.productName },
    });
  }
  if (filters.issuer) {
    metadataConditions.push({
      metadata: { path: ["issuer"], equals: filters.issuer },
    });
  }
  if (metadataConditions.length > 0) {
    where.document = { AND: metadataConditions };
  }

  return where;
}
