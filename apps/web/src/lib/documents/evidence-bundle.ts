// Internal evidence bundle foundation.
//
// Normalizes Step 5 keyword document-search results into bounded
// evidence/citation candidates that a future council orchestrator can
// consume. This is NOT wired into the orchestrator, and it is NOT full RAG:
//   - No embeddings, no vector similarity, no semantic retrieval.
//   - No external web fetching.
//   - No evidence-bundle → orchestrator handoff.
//
// It is a deterministic, bounded transform over the existing
// `DocumentService.search` output. Trust/verification tokens are reused from
// `lib/council/evidence.ts` so the eventual orchestrator wiring speaks the
// same vocabulary. Candidates carry only a bounded snippet — never the full
// chunk body.

import { z } from "zod";

import { EvidenceDocumentTypeSchema } from "@/lib/council/evidence";
import type {
  EvidenceTrustLevel,
  EvidenceVerificationStatus,
} from "@/lib/council/evidence";

import { DocumentService } from "./service";
import { normalizeQuery, type DocumentSearchResult } from "./search";
import type { DocumentMetadata } from "./schemas";

// Internal documents are operator-uploaded derivatives (extracted text), so
// they sit at `uploaded_copy` on the trust ladder — business-citable WITH a
// caveat — and are `auto_extracted` because a keyword scan, not a human,
// produced the candidate. A reviewer can later promote individual items.
export const INTERNAL_DOCUMENT_TRUST_LEVEL: EvidenceTrustLevel =
  "uploaded_copy";
export const INTERNAL_DOCUMENT_VERIFICATION_STATUS: EvidenceVerificationStatus =
  "auto_extracted";

// Names the retrieval path that produced the bundle. Distinguishes this
// keyword foundation from the future vector / hybrid retrievers.
export const RETRIEVAL_MODE = "internal_documents_keyword" as const;
export type RetrievalMode = typeof RETRIEVAL_MODE;

export type RetrievalStatus = "ok" | "no_matches";

// Query-param contract for GET /api/documents/evidence. Mirrors the search
// contract but uses `query` (the orchestrator-facing term) instead of `q`.
export const EvidenceBundleRequestSchema = z.object({
  query: z.string().trim().min(1, "query must be non-empty"),
  documentType: EvidenceDocumentTypeSchema.optional(),
  productName: z.string().trim().min(1).max(255).optional(),
  issuer: z.string().trim().min(1).max(255).optional(),
  limit: z.number().int().positive().optional(),
});
export type EvidenceBundleRequest = z.infer<typeof EvidenceBundleRequestSchema>;

// A single internal-document evidence/citation candidate. Carries a bounded
// snippet only — never the full chunk body.
export type InternalEvidenceCandidate = {
  sourceType: "internal_document";
  documentId: string;
  filename: string;
  chunkId: string;
  chunkIndex: number;
  snippet: string;
  metadata: DocumentMetadata | null;
  score: number;
  trustLevel: EvidenceTrustLevel;
  verificationStatus: EvidenceVerificationStatus;
};

export type EvidenceBundle = {
  normalizedQuery: string;
  retrievalMode: RetrievalMode;
  retrievalStatus: RetrievalStatus;
  count: number;
  candidates: InternalEvidenceCandidate[];
};

// Pure: map one search result into an evidence candidate. Stamps the fixed
// internal-document trust + verification tokens; copies the rest verbatim.
export function toEvidenceCandidate(
  result: DocumentSearchResult,
): InternalEvidenceCandidate {
  return {
    sourceType: "internal_document",
    documentId: result.documentId,
    filename: result.filename,
    chunkId: result.chunkId,
    chunkIndex: result.chunkIndex,
    snippet: result.snippet,
    metadata: result.metadata,
    score: result.score,
    trustLevel: INTERNAL_DOCUMENT_TRUST_LEVEL,
    verificationStatus: INTERNAL_DOCUMENT_VERIFICATION_STATUS,
  };
}

// Pure: map an ordered list of search results, preserving order (the search
// layer already sorted them deterministically).
export function toEvidenceCandidates(
  results: DocumentSearchResult[],
): InternalEvidenceCandidate[] {
  return results.map(toEvidenceCandidate);
}

// Service: runs the keyword document search, then normalizes the hits into a
// bounded evidence bundle. Deterministic — inherits the search layer's
// determinism and adds no clocks or randomness. DB errors propagate as
// `DocumentServiceError` for the route to map to 503.
export class EvidenceBundleService {
  constructor(
    private readonly documents: DocumentService = new DocumentService(),
  ) {}

  async build(input: EvidenceBundleRequest): Promise<EvidenceBundle> {
    const results = await this.documents.search({
      q: input.query,
      documentType: input.documentType,
      productName: input.productName,
      issuer: input.issuer,
      limit: input.limit,
    });

    const candidates = toEvidenceCandidates(results);
    return {
      normalizedQuery: normalizeQuery(input.query).join(" "),
      retrievalMode: RETRIEVAL_MODE,
      retrievalStatus: candidates.length > 0 ? "ok" : "no_matches",
      count: candidates.length,
      candidates,
    };
  }
}
