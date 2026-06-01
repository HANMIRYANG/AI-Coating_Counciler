// Deterministic population of the final-answer evidence usage contract
// (Step 10).
//
// The synthesis prompt is NOT changed in this step, so providers do not
// (yet) return evidence-usage fields. This module derives a conservative,
// bounded contract from the session evidence preview so the final answer
// always carries a coherent `evidenceCoverageStatus` + references. When a
// future prompt makes the model emit its own mapping, that explicit output
// is respected (including `sufficient`, which is NEVER auto-asserted here).
//
// Pure + deterministic: no clocks, no randomness, no I/O.

import type { EvidenceCoverageStatus, EvidenceUsedRef } from "./schemas";
import type {
  EvidencePreviewCandidate,
  SessionEvidencePreview,
} from "./evidencePreview";

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

// Prefer the answer's own missingEvidence as the uncovered-claim list; fall
// back to the generic note. Always bounded.
function deriveUncoveredClaims(answer: EvidenceUsageCarrier): string[] {
  const fromMissing = answer.missingEvidence.filter((m) => m.trim().length > 0);
  const list =
    fromMissing.length > 0 ? fromMissing : [UNVERIFIED_CLAIM_MAPPING_NOTE];
  return list.slice(0, MAX_UNCOVERED_CLAIMS);
}

// Did the model itself produce an evidence mapping? With the current prompt
// it never does (fields default to empty / not_requested), but respect it if
// a future prompt starts emitting one.
function modelProducedMapping(answer: EvidenceUsageCarrier): boolean {
  return (
    answer.evidenceCoverageStatus !== "not_requested" ||
    answer.evidenceUsed.length > 0 ||
    answer.coveredClaims.length > 0
  );
}

/**
 * Return a copy of `answer` with the evidence usage contract populated from
 * the session evidence preview. Never throws; never marks `sufficient`
 * unless the model explicitly did.
 *
 *   - ai_only / not_requested / missing preview → `not_requested`, no refs.
 *   - `no_matches` → `no_evidence`, uncovered claims, no refs.
 *   - `unavailable` / `failed` → `unavailable`, uncovered claims, no refs.
 *   - `ok` + model mapping present → respect model output as-is.
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
    // Respect the model's explicit mapping (already schema-validated).
    return answer;
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
