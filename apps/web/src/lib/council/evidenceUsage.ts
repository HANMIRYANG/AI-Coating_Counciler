// Deterministic population of the final-answer evidence usage contract
// (Step 10).
//
// Synthesis prompts may ask the model to map claims to prompt-visible
// evidence IDs (E1, E2...). This module validates that mapping against the
// session evidence preview, translates valid IDs to internal refs, and
// downgrades invalid/unmapped claims into uncovered claims. When no mapping
// is returned, it derives a conservative partial contract from the preview.
//
// Pure + deterministic: no clocks, no randomness, no I/O.

import type { EvidenceCoverageStatus, EvidenceUsedRef } from "./schemas";
import type {
  EvidencePreviewCandidate,
  SessionEvidencePreview,
} from "./evidencePreview";
import { evidenceCandidateId } from "./prompts";

// Structural carrier for the evidence-usage contract. Both FinalAnswer and
// IdeationFinalAnswer satisfy this (identical field types), so the helpers
// below stay shape-agnostic and `applyEvidenceUsage` preserves the concrete
// synthesis type via the generic parameter.
type EvidenceUsageCarrier = {
  missingEvidence: string[];
  evidenceUsed: EvidenceUsedRef[];
  coveredClaims: { claim: string; evidenceChunkIds: string[] }[];
  uncoveredClaims: string[];
  evidenceCoverageStatus: EvidenceCoverageStatus;
};

// Bound the derived uncovered-claim list so the contract stays compact.
const MAX_UNCOVERED_CLAIMS = 10;

// Generic marker used when no claim-level mapping can be derived. Mirrors the
// "claim-level evidence mapping not verified" intent in plain Korean.
export const UNVERIFIED_CLAIM_MAPPING_NOTE =
  "claim 단위 근거 매핑이 검증되지 않았습니다 (claim-level evidence mapping not verified).";

function toRef(c: EvidencePreviewCandidate): EvidenceUsedRef {
  return {
    chunkId: c.chunkId,
    filename: c.filename,
    chunkIndex: c.chunkIndex,
    trustLevel: c.trustLevel,
    verificationStatus: c.verificationStatus,
  };
}

function unique<T>(items: T[]): T[] {
  return Array.from(new Set(items));
}

function normalizeEvidenceId(id: string): string {
  return id.trim().replace(/^\[|\]$/g, "").replace(/^근거\s+/i, "");
}

// Prefer the answer's own missingEvidence as the uncovered-claim list; fall
// back to the generic note. Always bounded.
function deriveUncoveredClaims(answer: EvidenceUsageCarrier): string[] {
  const fromMissing = answer.missingEvidence.filter((m) => m.trim().length > 0);
  const list =
    fromMissing.length > 0 ? fromMissing : [UNVERIFIED_CLAIM_MAPPING_NOTE];
  return list.slice(0, MAX_UNCOVERED_CLAIMS);
}

// Did the model itself produce an evidence mapping? The prompt asks synthesis
// providers to use E1/E2 IDs when evidence candidates are present; schema
// defaults keep older/no-evidence outputs compatible.
function modelProducedMapping(answer: EvidenceUsageCarrier): boolean {
  return (
    answer.evidenceCoverageStatus !== "not_requested" ||
    answer.evidenceUsed.length > 0 ||
    answer.coveredClaims.length > 0 ||
    answer.uncoveredClaims.length > 0
  );
}

function candidateLookup(
  candidates: EvidencePreviewCandidate[],
): Map<string, EvidencePreviewCandidate> {
  const map = new Map<string, EvidencePreviewCandidate>();
  candidates.forEach((c, i) => {
    map.set(evidenceCandidateId(i), c);
    map.set(c.chunkId, c);
  });
  return map;
}

function applyModelMapping<T extends EvidenceUsageCarrier>(
  answer: T,
  preview: SessionEvidencePreview,
): T {
  const candidates = preview.candidates;
  const byId = candidateLookup(candidates);
  const used = new Map<string, EvidenceUsedRef>();
  const coveredClaims: EvidenceUsageCarrier["coveredClaims"] = [];
  const uncoveredClaims = new Set(
    answer.uncoveredClaims.filter((c) => c.trim().length > 0),
  );

  for (const claim of answer.coveredClaims) {
    const resolvedChunkIds: string[] = [];
    for (const rawId of claim.evidenceChunkIds) {
      const candidate = byId.get(normalizeEvidenceId(rawId));
      if (!candidate) continue;
      resolvedChunkIds.push(candidate.chunkId);
      used.set(candidate.chunkId, toRef(candidate));
    }

    const uniqIds = unique(resolvedChunkIds);
    if (claim.claim.trim().length > 0 && uniqIds.length > 0) {
      coveredClaims.push({ claim: claim.claim, evidenceChunkIds: uniqIds });
    } else if (claim.claim.trim().length > 0) {
      uncoveredClaims.add(claim.claim);
    }
  }

  const uncovered =
    uncoveredClaims.size > 0
      ? Array.from(uncoveredClaims).slice(0, MAX_UNCOVERED_CLAIMS)
      : answer.missingEvidence.length > 0
        ? deriveUncoveredClaims(answer)
        : [];
  const hasValidCoveredClaims = coveredClaims.length > 0;
  const canAcceptSufficient =
    answer.evidenceCoverageStatus === "sufficient" &&
    hasValidCoveredClaims &&
    uncovered.length === 0;

  return {
    ...answer,
    evidenceUsed: Array.from(used.values()),
    coveredClaims,
    uncoveredClaims: uncovered,
    evidenceCoverageStatus: canAcceptSufficient ? "sufficient" : "partial",
  } as T;
}

/**
 * Return a copy of `answer` with the evidence usage contract populated from
 * the session evidence preview. Never throws; never marks `sufficient`
 * unless the model explicitly did.
 *
 *   - ai_only / not_requested / missing preview → `not_requested`, no refs.
 *   - `no_matches` → `no_evidence`, uncovered claims, no refs.
 *   - `unavailable` / `failed` → `unavailable`, uncovered claims, no refs.
 *   - `ok` + model mapping present → validate + translate E1/E2 refs.
 *   - `ok` + no model mapping → conservative `partial`: refs from preview
 *     candidates, uncovered claims derived, no covered claims.
 */
export function applyEvidenceUsage<T extends EvidenceUsageCarrier>(
  answer: T,
  preview: SessionEvidencePreview | null | undefined,
): T {
  const status = preview?.retrievalStatus;

  if (!preview || status === "not_requested") {
    return {
      ...answer,
      evidenceUsed: [],
      coveredClaims: [],
      uncoveredClaims: [],
      evidenceCoverageStatus: "not_requested",
    } as T;
  }

  if (status === "no_matches") {
    return {
      ...answer,
      evidenceUsed: [],
      coveredClaims: [],
      uncoveredClaims: deriveUncoveredClaims(answer),
      evidenceCoverageStatus: "no_evidence",
    } as T;
  }

  if (status === "unavailable" || status === "failed") {
    return {
      ...answer,
      evidenceUsed: [],
      coveredClaims: [],
      uncoveredClaims: deriveUncoveredClaims(answer),
      evidenceCoverageStatus: "unavailable",
    } as T;
  }

  // status === "ok"
  if (modelProducedMapping(answer)) {
    return applyModelMapping(answer, preview);
  }

  const coverageStatus: EvidenceCoverageStatus = "partial";
  return {
    ...answer,
    evidenceUsed: preview.candidates.map(toRef),
    coveredClaims: [],
    uncoveredClaims: deriveUncoveredClaims(answer),
    evidenceCoverageStatus: coverageStatus,
  } as T;
}
