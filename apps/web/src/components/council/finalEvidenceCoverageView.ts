// Pure presentation logic for the final-answer evidence coverage block.
// The React component (`FinalEvidenceCoveragePanel.tsx`) is a thin renderer
// over the view-model produced here, so the decision logic is unit-testable
// under the repo's node-env vitest (no DOM / RTL).
//
// Display-only: it visualizes the evidence usage contract + the Retrieval
// Guard verdict on the final answer. The guard is a citation-sufficiency
// status gate, NOT a legal certification of truth. Never renders full chunk
// bodies; internal ids are used only as React keys, never displayed.

import type { FinalAnswer, GuardStatus } from "@/lib/council/schemas";
import { GUARD_STATUS_LABEL } from "@/lib/council/retrievalGuard";

export type FinalCoverageTone = "good" | "info" | "muted" | "warn";

export type EvidenceRefView = {
  key: string; // chunkId — used as React key only, never rendered
  title: string; // "filename #chunkIndex"
  trustLevel: string;
  verificationStatus: string;
};

export type CoveredClaimView = {
  claim: string;
  refCount: number;
};

export type GuardView = {
  statusLabel: string;
  tone: FinalCoverageTone;
  businessReady: boolean;
  recommendedAction: string;
  reasons: string[];
};

export type FinalEvidenceCoverageView = {
  // false for not_requested (ai_only) → quiet UI.
  visible: boolean;
  statusLabel: string;
  tone: FinalCoverageTone;
  // Review warning for non-sufficient coverage.
  warning?: string;
  evidenceRefs: EvidenceRefView[];
  coveredClaims: CoveredClaimView[];
  uncoveredClaims: string[];
  // Retrieval Guard verdict (present only when the answer carries one).
  guard?: GuardView;
};

const GUARD_TONE: Record<GuardStatus, FinalCoverageTone> = {
  not_required: "muted",
  passed: "good",
  warning: "warn",
  blocked: "warn",
};

const HIDDEN: FinalEvidenceCoverageView = {
  visible: false,
  statusLabel: "",
  tone: "muted",
  evidenceRefs: [],
  coveredClaims: [],
  uncoveredClaims: [],
};

const STATUS_LABEL: Record<string, string> = {
  not_requested: "근거 미요청",
  no_evidence: "근거 없음",
  partial: "부분 근거",
  sufficient: "근거 충분",
  unavailable: "근거 불가",
};

const STATUS_TONE: Record<string, FinalCoverageTone> = {
  no_evidence: "warn",
  partial: "warn",
  sufficient: "good",
  unavailable: "warn",
};

const STATUS_WARNING: Record<string, string> = {
  no_evidence:
    "내부 문서 근거가 없습니다. 최종 답변은 추가 문서 확보 후 다시 검토해야 합니다.",
  partial:
    "근거 후보는 있으나 claim 단위 매핑이 검증되지 않았습니다. 외부 발송 전 사람 검토가 필요합니다.",
  unavailable:
    "내부 문서 검색을 사용할 수 없어 근거를 확인하지 못했습니다. 발송 전 추가 확인이 필요합니다.",
};

type CoverageFields = Pick<
  FinalAnswer,
  | "evidenceCoverageStatus"
  | "evidenceUsed"
  | "coveredClaims"
  | "uncoveredClaims"
  | "retrievalGuard"
>;

function buildGuardView(
  guard: FinalAnswer["retrievalGuard"],
): GuardView | undefined {
  if (!guard) return undefined;
  return {
    statusLabel: GUARD_STATUS_LABEL[guard.guardStatus] ?? guard.guardStatus,
    tone: GUARD_TONE[guard.guardStatus] ?? "info",
    businessReady: guard.businessCitationReady,
    recommendedAction: guard.recommendedAction,
    reasons: guard.reasons,
  };
}

/**
 * Derive the coverage block view-model from a final answer.
 *
 *   - `not_requested` (ai_only) → hidden (quiet UI).
 *   - `sufficient` → "good" state, no warning.
 *   - `no_evidence` / `partial` / `unavailable` → "warn" state with a clear
 *     review warning.
 *
 * Tolerant of partially-populated input (defaults missing arrays/status).
 */
export function buildFinalEvidenceCoverageView(
  answer: Partial<CoverageFields> | null | undefined,
): FinalEvidenceCoverageView {
  const status = answer?.evidenceCoverageStatus ?? "not_requested";
  if (status === "not_requested") return HIDDEN;

  const evidenceUsed = answer?.evidenceUsed ?? [];
  const coveredClaims = answer?.coveredClaims ?? [];
  const uncoveredClaims = answer?.uncoveredClaims ?? [];

  return {
    visible: true,
    statusLabel: STATUS_LABEL[status] ?? status,
    tone: STATUS_TONE[status] ?? "info",
    warning: STATUS_WARNING[status],
    evidenceRefs: evidenceUsed.map((r) => ({
      key: r.chunkId,
      title: `${r.filename} #${r.chunkIndex}`,
      trustLevel: r.trustLevel ?? "—",
      verificationStatus: r.verificationStatus ?? "—",
    })),
    coveredClaims: coveredClaims.map((c) => ({
      claim: c.claim,
      refCount: c.evidenceChunkIds.length,
    })),
    uncoveredClaims,
    guard: buildGuardView(answer?.retrievalGuard),
  };
}
