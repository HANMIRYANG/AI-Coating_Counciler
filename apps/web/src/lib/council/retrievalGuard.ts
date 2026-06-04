// Retrieval Guard — deterministic citation-sufficiency gate for final answers.
//
// Runs AFTER applyEvidenceUsage (which already validates model-provided E-IDs
// against the session evidence preview and only sets `sufficient` when the
// mapping is valid with zero uncovered claims). This module does NOT rewrite
// the answer; it CLASSIFIES whether the validated evidence usage is strong
// enough to treat the answer as business-citation-ready, and what to do if not.
//
// Pure + deterministic: no I/O, no clocks, no randomness. Conservative by
// design — for a manufacturer, under-claiming readiness is safer than
// over-claiming. `businessCitationReady` is therefore granted ONLY for
// `sufficient` coverage backed by at least one business-citable trust level
// and no uncovered claims; everything else is warning/blocked/not_required.

import { EVIDENCE_TRUST_LEVELS } from "./evidenceCatalog";
import { isBusinessCitableTrustLevel, type EvidenceTrustLevel } from "./evidence";
import type { EvidencePreviewRetrievalStatus } from "./evidencePreview";
import type {
  EvidenceCoverageStatus,
  EvidenceUsedRef,
  GuardStatus,
  RetrievalGuardResult,
} from "./schemas";
import type { EvidenceMode, RiskLevel, TaskType } from "./types";

// Task types whose answers are intended for business/customer use and must be
// backed by usable evidence to be citation-ready.
const EVIDENCE_REQUIRED_TASK_TYPES: ReadonlySet<TaskType> = new Set([
  "document_based_answer",
  "certification_checklist",
  "risky_phrase_review",
]);

function isHighRisk(level: RiskLevel): boolean {
  return level === "high" || level === "critical";
}

// At least one used reference sits on a business-citable trust level
// (uploaded_*/official_*). unverified_web / third_party_reference only → false,
// so an answer backed solely by unverified web sources is never business-ready.
function hasBusinessCitableEvidence(used: EvidenceUsedRef[]): boolean {
  return used.some((r) => {
    const lvl = r.trustLevel;
    return (
      typeof lvl === "string" &&
      (EVIDENCE_TRUST_LEVELS as readonly string[]).includes(lvl) &&
      isBusinessCitableTrustLevel(lvl as EvidenceTrustLevel)
    );
  });
}

// The minimal fields the guard inspects on a final answer. `evidenceBackedClaims`
// exists only on the standard FinalAnswer (optional here).
export type GuardAnswerFields = {
  evidenceCoverageStatus: EvidenceCoverageStatus;
  evidenceUsed: EvidenceUsedRef[];
  coveredClaims: { claim: string; evidenceChunkIds: string[] }[];
  uncoveredClaims: string[];
  missingEvidence: string[];
  evidenceBackedClaims?: string[];
  riskLevel: RiskLevel;
  confidenceScore: number;
};

export type RetrievalGuardInput = {
  taskType: TaskType;
  evidenceMode: EvidenceMode;
  // Session preview retrieval status (undefined for ai_only / no preview).
  retrievalStatus?: EvidencePreviewRetrievalStatus | null;
  answer: GuardAnswerFields;
};

// Coverage states that mean "no usable evidence was retrieved at all".
function isNoUsableEvidence(coverage: EvidenceCoverageStatus): boolean {
  return (
    coverage === "no_evidence" ||
    coverage === "unavailable" ||
    coverage === "not_requested"
  );
}

/**
 * Evaluate the Retrieval Guard. Returns a compact, machine-readable verdict.
 *
 * Policy summary:
 *   - ai_only:
 *       · anomaly (claims `sufficient` or carries evidenceUsed) → warning.
 *       · else evidence-required task/high-risk → warning (AI-only is not
 *         business-citable for these).
 *       · else → not_required.
 *       · businessCitationReady is always false (no retrieved evidence).
 *   - internal_docs / internal_docs_web:
 *       · businessCitationReady ⇔ coverage `sufficient` AND ≥1 valid covered
 *         claim AND zero uncovered claims AND ≥1 business-citable trust level.
 *       · businessCitationReady → passed.
 *       · else if evidence is REQUIRED and none usable was retrieved → blocked.
 *       · else → warning (advisory; needs human review before sending).
 */
export function evaluateRetrievalGuard(
  input: RetrievalGuardInput,
): RetrievalGuardResult {
  const { taskType, evidenceMode, answer } = input;
  const coverage = answer.evidenceCoverageStatus;
  const requiredEvidence =
    EVIDENCE_REQUIRED_TASK_TYPES.has(taskType) || isHighRisk(answer.riskLevel);

  // ── ai_only ──────────────────────────────────────────────────────────
  if (evidenceMode === "ai_only") {
    const reasons: string[] = [];
    const anomalous =
      coverage === "sufficient" || answer.evidenceUsed.length > 0;
    if (anomalous) {
      reasons.push(
        "ai_only 모드인데 근거 사용/충분 주장이 있습니다 (예상치 못함).",
      );
      return {
        guardStatus: "warning",
        reasons,
        requiredEvidence,
        businessCitationReady: false,
        recommendedAction:
          "AI 단독 모드에서는 근거 인용을 신뢰하지 마세요. 업로드 문서로 다시 검토하세요.",
      };
    }
    if (requiredEvidence) {
      reasons.push(
        "이 작업/위험 수준은 근거 문서가 필요하지만 ai_only 모드입니다.",
      );
      return {
        guardStatus: "warning",
        reasons,
        requiredEvidence,
        businessCitationReady: false,
        recommendedAction:
          "업체 발송 전 사내 문서를 업로드해 internal_docs 모드로 재검토하세요.",
      };
    }
    return {
      guardStatus: "not_required",
      reasons: ["ai_only 모드 — 근거 게이트 비적용 (AI 지식 기반 자문)."],
      requiredEvidence,
      businessCitationReady: false,
      recommendedAction:
        "AI 지식 기반 답변입니다. 업체 발송용으로 쓰려면 근거 문서로 확인하세요.",
    };
  }

  // ── internal_docs / internal_docs_web ────────────────────────────────
  const reasons: string[] = [];
  const hasValidCoveredClaim = answer.coveredClaims.some(
    (c) => c.claim.trim().length > 0 && c.evidenceChunkIds.length > 0,
  );
  const businessCitable = hasBusinessCitableEvidence(answer.evidenceUsed);

  const businessCitationReady =
    coverage === "sufficient" &&
    hasValidCoveredClaim &&
    answer.uncoveredClaims.length === 0 &&
    businessCitable;

  if (businessCitationReady) {
    reasons.push(
      "근거 매핑이 검증되었고(충분), 모든 주장이 업체-인용 가능한 근거로 뒷받침됩니다.",
    );
    return {
      guardStatus: "passed",
      reasons,
      requiredEvidence,
      businessCitationReady: true,
      recommendedAction:
        "업체 발송 가능. 인용에 신뢰수준 caveat(예: 업로드 사본)을 함께 표기하세요.",
    };
  }

  // Not business-ready — explain why and decide warning vs blocked.
  if (coverage === "sufficient" && !businessCitable) {
    reasons.push(
      "근거가 충분으로 표기됐으나 업체-인용 가능한 신뢰수준(uploaded/official)이 없습니다 (미검증 웹 등).",
    );
  } else if (coverage === "partial") {
    reasons.push(
      "근거 후보는 있으나 claim 단위 매핑이 부분적입니다 (검증된 충분 상태 아님).",
    );
  } else if (coverage === "no_evidence") {
    reasons.push("내부 문서 근거가 검색되지 않았습니다.");
  } else if (coverage === "unavailable") {
    reasons.push("내부 문서 검색을 사용할 수 없어 근거를 확인하지 못했습니다.");
  } else if (coverage === "not_requested") {
    reasons.push("근거 검색이 요청되지 않았습니다.");
  }
  if (answer.uncoveredClaims.length > 0) {
    reasons.push(`근거 미연결 주장이 ${answer.uncoveredClaims.length}건 있습니다.`);
  }
  if (
    isHighRisk(answer.riskLevel) &&
    isNoUsableEvidence(coverage) &&
    (answer.evidenceBackedClaims?.length ?? 0) > 0
  ) {
    reasons.push(
      "고위험 답변이 근거 없이 'evidenceBackedClaims'를 주장합니다 (점검 필요).",
    );
  }

  if (requiredEvidence && isNoUsableEvidence(coverage)) {
    return {
      guardStatus: "blocked",
      reasons,
      requiredEvidence,
      businessCitationReady: false,
      recommendedAction:
        "업체 발송 금지. 관련 시험성적서/인증 등 근거 문서를 확보·업로드한 뒤 재검토하세요.",
    };
  }

  return {
    guardStatus: "warning",
    reasons,
    requiredEvidence,
    businessCitationReady: false,
    recommendedAction:
      "내부 자문으로만 사용하세요. 업체 발송 전 근거 보강과 사람 검토가 필요합니다.",
  };
}

// Attach the guard verdict to a synthesis answer (returns a copy). Reads only
// fields common to all answer shapes plus the optional `evidenceBackedClaims`.
export function applyRetrievalGuard<T extends GuardAnswerFields>(
  answer: T,
  ctx: {
    taskType: TaskType;
    evidenceMode: EvidenceMode;
    retrievalStatus?: EvidencePreviewRetrievalStatus | null;
  },
): T & { retrievalGuard: RetrievalGuardResult } {
  const retrievalGuard = evaluateRetrievalGuard({
    taskType: ctx.taskType,
    evidenceMode: ctx.evidenceMode,
    retrievalStatus: ctx.retrievalStatus,
    answer,
  });
  return { ...answer, retrievalGuard };
}

// Stable status → guard label for UI / markdown.
export const GUARD_STATUS_LABEL: Record<GuardStatus, string> = {
  not_required: "가드 비적용",
  passed: "발송 가능",
  warning: "검토 필요",
  blocked: "발송 차단",
};
