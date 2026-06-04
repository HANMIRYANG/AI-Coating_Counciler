// Deterministic verified-citation rendering for final answers.
//
// Turns the ALREADY-VALIDATED evidence usage contract (evidenceUsed,
// coveredClaims, uncoveredClaims) + the Retrieval Guard verdict into a
// review-friendly citation view. This is NOT automatic legal/factual
// certification and calls NO model — it only re-presents claim→evidence
// mappings that `applyEvidenceUsage` already validated against the session
// evidence preview, with stable labels so a reviewer can check each claim.
//
// Pure + deterministic: no clocks, no randomness, no I/O. NEVER includes raw
// chunk body text or internal chunk IDs in its output.

import type { EvidenceUsedRef, RetrievalGuardResult } from "./schemas";

// A cited evidence reference. `label` is a stable "E1"/"E2"… handle; `title`
// is the human "filename#chunkIndex". No internal chunkId, no body text.
export type CitationEvidenceRef = {
  label: string;
  title: string;
  filename: string;
  chunkIndex: number;
  trustLevel: string;
  verificationStatus: string;
};

export type CitedClaim = {
  label: string; // stable "C1", "C2", …
  claim: string;
  evidence: CitationEvidenceRef[];
};

export type VerifiedCitations = {
  citedClaims: CitedClaim[];
  // Dedup union of every CITED evidence ref, in label (first-appearance) order.
  evidenceRefs: CitationEvidenceRef[];
  unresolvedClaims: string[];
  // true ONLY when the guard verdict is passed + business-citation-ready, every
  // cited claim resolves to ≥1 evidenceUsed ref, AND there are no unresolved/
  // uncovered claims.
  citationReady: boolean;
  // Derived flags (deterministic) for downstream integrity checks / UI.
  hasUnresolvedClaims: boolean;
  // Every cited claim resolves to ≥1 evidence ref (vacuously true with none).
  allCitedClaimsResolved: boolean;
  citationLabels: string[]; // ["C1", "C2", …]
  evidenceLabels: string[]; // ["E1", "E2", …]
};

export type CitationInput = {
  evidenceUsed: EvidenceUsedRef[];
  coveredClaims: { claim: string; evidenceChunkIds: string[] }[];
  uncoveredClaims: string[];
  retrievalGuard?: RetrievalGuardResult;
};

function fallback(s: string | undefined): string {
  return s && s.trim().length > 0 ? s : "—";
}

/**
 * Build the deterministic verified-citation view from a final answer's
 * validated evidence usage. Evidence refs are assigned stable E-labels on
 * first appearance across claims (claim order, then within-claim order) and
 * deduped by chunk; claims get C-labels in order.
 */
export function buildVerifiedCitations(
  answer: CitationInput,
): VerifiedCitations {
  // Resolve chunkId → the (first) matching evidenceUsed ref.
  const usedByChunkId = new Map<string, EvidenceUsedRef>();
  for (const ref of answer.evidenceUsed) {
    if (!usedByChunkId.has(ref.chunkId)) usedByChunkId.set(ref.chunkId, ref);
  }

  // Stable, deduped citation refs — only those actually cited by a claim.
  const citedByChunkId = new Map<string, CitationEvidenceRef>();
  const evidenceRefs: CitationEvidenceRef[] = [];
  const resolve = (chunkId: string): CitationEvidenceRef | undefined => {
    const existing = citedByChunkId.get(chunkId);
    if (existing) return existing;
    const ref = usedByChunkId.get(chunkId);
    if (!ref) return undefined;
    const made: CitationEvidenceRef = {
      label: `E${evidenceRefs.length + 1}`,
      title: `${ref.filename}#${ref.chunkIndex}`,
      filename: ref.filename,
      chunkIndex: ref.chunkIndex,
      trustLevel: fallback(ref.trustLevel),
      verificationStatus: fallback(ref.verificationStatus),
    };
    citedByChunkId.set(chunkId, made);
    evidenceRefs.push(made);
    return made;
  };

  const citedClaims: CitedClaim[] = answer.coveredClaims.map((c, i) => {
    const evidence: CitationEvidenceRef[] = [];
    const seen = new Set<string>();
    for (const chunkId of c.evidenceChunkIds) {
      const ref = resolve(chunkId);
      if (ref && !seen.has(ref.label)) {
        seen.add(ref.label);
        evidence.push(ref);
      }
    }
    return { label: `C${i + 1}`, claim: c.claim, evidence };
  });

  const unresolvedClaims = answer.uncoveredClaims.filter(
    (u) => u.trim().length > 0,
  );

  const allCitedClaimsResolved = citedClaims.every(
    (c) => c.evidence.length > 0,
  );
  const hasUnresolvedClaims = unresolvedClaims.length > 0;

  const citationReady =
    answer.retrievalGuard?.businessCitationReady === true &&
    // Defensive: a valid guard always pairs businessCitationReady with
    // guardStatus="passed", but stored/manual/legacy payloads may not — require
    // BOTH so a contradictory verdict (e.g. blocked + businessCitationReady)
    // never reads as ready.
    answer.retrievalGuard?.guardStatus === "passed" &&
    citedClaims.length > 0 &&
    allCitedClaimsResolved &&
    // Defensive: never "ready" while any claim is still unresolved/uncovered,
    // even if a (legacy/manual) payload's guard says business-ready.
    !hasUnresolvedClaims;

  return {
    citedClaims,
    evidenceRefs,
    unresolvedClaims,
    citationReady,
    hasUnresolvedClaims,
    allCitedClaimsResolved,
    citationLabels: citedClaims.map((c) => c.label),
    evidenceLabels: evidenceRefs.map((e) => e.label),
  };
}
