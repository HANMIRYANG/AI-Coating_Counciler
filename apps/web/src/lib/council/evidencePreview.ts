// Session-level evidence retrieval *preview*.
//
// Step 7 wires the Step 6 internal evidence bundle into the council session
// lifecycle as a bounded PREFLIGHT. When a session runs with an evidence
// mode other than `ai_only`, the orchestrator retrieves internal-document
// evidence once, up front, and stashes this lightweight preview on the
// session record so the snapshot endpoint can surface retrieval status.
//
// What this is NOT (still unimplemented):
//   - Evidence candidates are NOT injected into provider prompts.
//   - No embeddings / vector search / external web fetching / PDF-DOCX parse.
//   - No final RAG reasoning over the evidence.
//
// This module is pure (types + deterministic mappers + a bounded timeout
// knob). It imports ONLY types from the documents layer, so pulling it into
// `store.ts` never drags `@prisma/client` into the memory-only code path.

import type { EvidenceMode } from "./types";
import type {
  EvidenceBundle,
  InternalEvidenceCandidate,
} from "@/lib/documents/evidence-bundle";
import type { DocumentMetadata } from "@/lib/documents/schemas";

// Hard cap on candidates kept in the session preview. The bundle itself is
// already bounded by the search limit; the preview is intentionally smaller
// — it is a status indicator, not the retrieval payload.
export const MAX_PREVIEW_CANDIDATES = 5;

// Default bounded timeout for the preflight so a slow/unreachable database
// can never stall a council run. Overridable via env, floored at 1s.
const DEFAULT_PREVIEW_TIMEOUT_MS = 8_000;
const MIN_PREVIEW_TIMEOUT_MS = 1_000;

export function evidencePreviewTimeoutMs(): number {
  const raw = process.env.EVIDENCE_PREVIEW_TIMEOUT_MS;
  const v = raw === undefined ? DEFAULT_PREVIEW_TIMEOUT_MS : Number(raw);
  if (!Number.isFinite(v)) return DEFAULT_PREVIEW_TIMEOUT_MS;
  return Math.max(MIN_PREVIEW_TIMEOUT_MS, Math.floor(v));
}

export type EvidencePreviewRetrievalStatus =
  // mode === "ai_only" → retrieval intentionally skipped.
  | "not_requested"
  // retrieval ran and found at least one candidate.
  | "ok"
  // retrieval ran cleanly but matched nothing.
  | "no_matches"
  // database unreachable / preflight timed out — session still proceeds.
  | "unavailable"
  // any other retrieval error — session still proceeds.
  | "failed";

// Lightweight candidate kept on the session. Carries a bounded snippet only
// — never the full chunk body.
export type EvidencePreviewCandidate = {
  documentId: string;
  filename: string;
  chunkId: string;
  chunkIndex: number;
  snippet: string;
  metadata: DocumentMetadata | null;
  score: number;
  trustLevel: string;
  verificationStatus: string;
  // Source discriminator (docs/23). Defaults to "internal_document"; external
  // official-source URLs (internal_docs_web) use "external_url" + carry `url`.
  // For external candidates the document/chunk fields are placeholders.
  sourceType?: "internal_document" | "external_url";
  url?: string;
};

export type SessionEvidencePreview = {
  mode: EvidenceMode;
  retrievalStatus: EvidencePreviewRetrievalStatus;
  count: number;
  candidates: EvidencePreviewCandidate[];
  errorMessage?: string;
};

function toPreviewCandidate(
  c: InternalEvidenceCandidate,
): EvidencePreviewCandidate {
  return {
    documentId: c.documentId,
    filename: c.filename,
    chunkId: c.chunkId,
    chunkIndex: c.chunkIndex,
    snippet: c.snippet,
    metadata: c.metadata,
    score: c.score,
    trustLevel: c.trustLevel,
    verificationStatus: c.verificationStatus,
    sourceType: "internal_document",
  };
}

// Build a preview candidate from a successfully fetched external source
// (internal_docs_web). Document/chunk fields are placeholders.
export function externalPreviewCandidate(r: {
  url: string;
  title: string;
  snippet: string;
  trustLevel: string;
}): EvidencePreviewCandidate {
  return {
    documentId: "",
    filename: r.title || r.url,
    chunkId: r.url,
    chunkIndex: 0,
    snippet: r.snippet,
    metadata: null,
    score: 0,
    trustLevel: r.trustLevel,
    verificationStatus: "auto_extracted",
    sourceType: "external_url",
    url: r.url,
  };
}

// Merge external candidates ahead of the internal ones. If any external
// candidate exists the overall status becomes "ok" (we have something to show)
// even when the internal retrieval found nothing or was unavailable.
export function withExternalCandidates(
  base: SessionEvidencePreview,
  external: EvidencePreviewCandidate[],
): SessionEvidencePreview {
  if (external.length === 0) return base;
  const candidates = [...external, ...base.candidates];
  return {
    ...base,
    retrievalStatus: "ok",
    count: base.count + external.length,
    candidates,
  };
}

// ai_only: retrieval is never attempted.
export function notRequestedPreview(mode: EvidenceMode): SessionEvidencePreview {
  return { mode, retrievalStatus: "not_requested", count: 0, candidates: [] };
}

// Map a successful retrieval into a bounded preview. `count` reflects the
// full bundle size; `candidates` is truncated to MAX_PREVIEW_CANDIDATES.
export function previewFromBundle(
  mode: EvidenceMode,
  bundle: EvidenceBundle,
): SessionEvidencePreview {
  const candidates = bundle.candidates
    .slice(0, MAX_PREVIEW_CANDIDATES)
    .map(toPreviewCandidate);
  return {
    mode,
    retrievalStatus: bundle.count > 0 ? "ok" : "no_matches",
    count: bundle.count,
    candidates,
  };
}

// Database unreachable or preflight timed out. The council run continues.
export function unavailablePreview(
  mode: EvidenceMode,
  errorMessage: string,
): SessionEvidencePreview {
  return {
    mode,
    retrievalStatus: "unavailable",
    count: 0,
    candidates: [],
    errorMessage,
  };
}

// Any other retrieval error. The council run continues.
export function failedPreview(
  mode: EvidenceMode,
  errorMessage: string,
): SessionEvidencePreview {
  return {
    mode,
    retrievalStatus: "failed",
    count: 0,
    candidates: [],
    errorMessage,
  };
}
