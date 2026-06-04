// Deterministic citation INTEGRITY check — review / export readiness.
//
// Sits on top of the Retrieval Guard (citation sufficiency gate) and Verified
// Citations (claim→evidence rendering). It does NOT call any model and is NOT
// legal/factual certification — it only inspects the already-validated mappings
// and classifies whether the answer is review-ready / export-ready, surfacing
// structured issues + Korean recommendations. Pure + deterministic; never emits
// raw chunk bodies or internal chunkIds.

import type { EvidenceUsedRef, RetrievalGuardResult } from "./schemas";
import { buildVerifiedCitations } from "./verifiedCitations";

export type CitationIntegrityStatus = "ready" | "review_required" | "blocked";

export type CitationIntegrityIssueCode =
  | "unresolved_claim"
  | "missing_evidence_ref"
  | "not_business_ready_guard"
  | "no_cited_claims"
  | "unguarded_legacy_answer"
  // Inline-label advisories (NEVER downgrade readiness — citations are rendered
  // separately from the prose).
  | "body_has_no_citation_labels" // body has zero [C#] labels
  | "body_missing_citation_labels" // body has labels but omits some generated [C#]
  | "body_has_unknown_citation_labels"; // body has [C#] not among generated

export type CitationIntegrityIssue = {
  code: CitationIntegrityIssueCode;
  message: string;
  severity: CitationIntegritySeverity;
};

// `problem` = readiness-relevant. `advisory` = informational inline-label note
// that NEVER affects integrityStatus / reviewRequired / exportReady / citationReady.
export type CitationIntegritySeverity = "problem" | "advisory";

const ISSUE_SEVERITY: Record<
  CitationIntegrityIssueCode,
  CitationIntegritySeverity
> = {
  unresolved_claim: "problem",
  missing_evidence_ref: "problem",
  not_business_ready_guard: "problem",
  no_cited_claims: "problem",
  unguarded_legacy_answer: "problem",
  body_has_no_citation_labels: "advisory",
  body_missing_citation_labels: "advisory",
  body_has_unknown_citation_labels: "advisory",
};

export type CitationIntegrityResult = {
  integrityStatus: CitationIntegrityStatus;
  issues: CitationIntegrityIssue[];
  // Severity-split views of `issues` (preserve issue order within each group).
  problemIssues: CitationIntegrityIssue[];
  advisoryIssues: CitationIntegrityIssue[];
  problemCount: number;
  advisoryCount: number;
  reviewRequired: boolean;
  exportReady: boolean;
  summary: string;
  // Combined (problem-then-advisory) for back-compat, plus split groups.
  recommendations: string[];
  problemRecommendations: string[];
  advisoryRecommendations: string[];
};

export type CitationIntegrityInput = {
  businessReadyAnswer?: string;
  finalMarkdown?: string;
  evidenceUsed: EvidenceUsedRef[];
  coveredClaims: { claim: string; evidenceChunkIds: string[] }[];
  uncoveredClaims: string[];
  retrievalGuard?: RetrievalGuardResult;
};

// Matches inline citation handles like [C1], [C12] in answer prose (capturing
// the bare "C1" label).
const CITATION_LABEL_RE = /\[(C\d+)\]/g;

// Unique inline [C#] labels in first-appearance order.
function parseBodyCitationLabels(body: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of body.matchAll(CITATION_LABEL_RE)) {
    const label = m[1];
    if (!seen.has(label)) {
      seen.add(label);
      out.push(label);
    }
  }
  return out;
}

const RECOMMENDATION: Record<CitationIntegrityIssueCode, string> = {
  unresolved_claim:
    "미연결(근거 부족) 주장에 대한 근거 문서를 확보·연결하세요.",
  missing_evidence_ref: "근거가 연결되지 않은 인용 주장을 확인하세요.",
  not_business_ready_guard:
    "근거 가드가 발송 가능 상태가 아닙니다. 근거를 보강하세요.",
  no_cited_claims: "인용된 주장이 없습니다. 주장-근거 매핑을 추가하세요.",
  unguarded_legacy_answer:
    "근거 가드가 없는 구버전 답변입니다. 재실행 후 검토하세요.",
  body_has_no_citation_labels:
    "본문에 [C1] 형식 인용 라벨이 없습니다(자문). 필요 시 본문에 인용을 표기하세요.",
  body_missing_citation_labels:
    "본문에 일부 생성된 인용 라벨이 누락되었습니다(자문). 필요 시 본문에 표기하세요.",
  body_has_unknown_citation_labels:
    "본문에 생성되지 않은 인용 라벨이 있습니다(자문). 본문 인용을 확인하세요.",
};

// Whether an answer has anything citation-related worth assessing/showing. A
// `not_required` guard with no cited/unresolved claims (normal ai_only /
// low-risk path) → false, so the integrity surface stays quiet.
export function hasCitationIntegrityMaterial(args: {
  citedClaimCount: number;
  unresolvedClaimCount: number;
  retrievalGuard?: RetrievalGuardResult;
}): boolean {
  return (
    args.citedClaimCount > 0 ||
    args.unresolvedClaimCount > 0 ||
    (args.retrievalGuard !== undefined &&
      args.retrievalGuard.guardStatus !== "not_required")
  );
}

/**
 * Evaluate citation integrity from a final answer's validated fields.
 *
 *   - `ready`            : citations are business-ready and fully resolved.
 *   - `blocked`          : guard blocked, or evidence required but not ready.
 *   - `review_required`  : anything else (default).
 *
 * `body_has_no_citation_labels` is ADVISORY only — the system renders citations
 * separately, so missing inline labels never downgrades readiness.
 */
export function evaluateCitationIntegrity(
  input: CitationIntegrityInput,
): CitationIntegrityResult {
  const vc = buildVerifiedCitations({
    evidenceUsed: input.evidenceUsed,
    coveredClaims: input.coveredClaims,
    uncoveredClaims: input.uncoveredClaims,
    retrievalGuard: input.retrievalGuard,
  });

  const guard = input.retrievalGuard;
  // Defensive: a contradictory payload (businessCitationReady=true but
  // guardStatus !== "passed") is treated as NOT business-ready, so a blocked /
  // warning guard can never be reported as ready via a bad flag.
  const businessReady =
    guard?.businessCitationReady === true && guard?.guardStatus === "passed";
  const requiredEvidence = guard?.requiredEvidence === true;
  const body = `${input.businessReadyAnswer ?? ""}\n${input.finalMarkdown ?? ""}`;
  const bodyLabels = parseBodyCitationLabels(body);
  const generated = new Set(vc.citationLabels);

  const issues: CitationIntegrityIssue[] = [];
  const add = (code: CitationIntegrityIssueCode, message: string) =>
    issues.push({ code, message, severity: ISSUE_SEVERITY[code] });

  // ── readiness-relevant problems ──────────────────────────────────────
  if (!guard) {
    add("unguarded_legacy_answer", "근거 가드가 없는 구버전 답변입니다.");
  } else if (!businessReady) {
    add(
      "not_business_ready_guard",
      `근거 가드가 발송 가능 상태가 아닙니다 (${guard.guardStatus}).`,
    );
  }
  if (vc.citedClaims.length === 0) {
    add("no_cited_claims", "인용된 주장이 없습니다.");
  }
  if (!vc.allCitedClaimsResolved) {
    add("missing_evidence_ref", "일부 인용 주장에 연결된 근거가 없습니다.");
  }
  if (vc.hasUnresolvedClaims) {
    add(
      "unresolved_claim",
      `미연결 주장이 ${vc.unresolvedClaims.length}건 있습니다.`,
    );
  }

  // ── advisory inline-label notes (NEVER downgrade readiness) ──────────
  if (vc.citedClaims.length > 0) {
    if (bodyLabels.length === 0) {
      add(
        "body_has_no_citation_labels",
        "본문에 [C1] 형식의 인용 라벨이 없습니다 (자문).",
      );
    } else {
      const missing = vc.citationLabels.filter((l) => !bodyLabels.includes(l));
      if (missing.length > 0) {
        add(
          "body_missing_citation_labels",
          `본문에 누락된 인용 라벨: ${missing.map((l) => `[${l}]`).join(", ")} (자문).`,
        );
      }
      const unknown = bodyLabels.filter((l) => !generated.has(l));
      if (unknown.length > 0) {
        add(
          "body_has_unknown_citation_labels",
          `본문에 생성되지 않은 인용 라벨: ${unknown.map((l) => `[${l}]`).join(", ")} (자문).`,
        );
      }
    }
  }

  // Readiness is decided ONLY by guard + verified-citation state — advisory
  // inline-label issues never participate.
  let integrityStatus: CitationIntegrityStatus;
  if (
    guard?.guardStatus === "blocked" ||
    (requiredEvidence && !vc.citationReady)
  ) {
    integrityStatus = "blocked";
  } else if (
    vc.citationReady &&
    businessReady &&
    vc.allCitedClaimsResolved &&
    !vc.hasUnresolvedClaims
  ) {
    integrityStatus = "ready";
  } else {
    integrityStatus = "review_required";
  }

  const exportReady = integrityStatus === "ready";
  const reviewRequired = integrityStatus !== "ready";

  const problemIssues = issues.filter((i) => i.severity === "problem");
  const advisoryIssues = issues.filter((i) => i.severity === "advisory");
  const problemCount = problemIssues.length;
  const advisoryCount = advisoryIssues.length;

  // One recommendation per distinct issue code, in issue order, per group.
  const recsFor = (list: CitationIntegrityIssue[]): string[] => {
    const out: string[] = [];
    const seen = new Set<CitationIntegrityIssueCode>();
    for (const iss of list) {
      if (seen.has(iss.code)) continue;
      seen.add(iss.code);
      out.push(RECOMMENDATION[iss.code]);
    }
    return out;
  };
  const problemRecommendations = recsFor(problemIssues);
  const advisoryRecommendations = recsFor(advisoryIssues);
  const recommendations = [
    ...problemRecommendations,
    ...advisoryRecommendations,
  ];

  // Summary never labels advisory-only findings as "문제". A ready answer with
  // only advisory inline-label notes reads as usable-with-notes.
  let summary: string;
  if (integrityStatus === "ready") {
    summary =
      advisoryCount > 0
        ? `인용 무결성 양호 — 내보내기 가능 (자문 ${advisoryCount}건)`
        : "인용 무결성 양호 — 내보내기 가능";
  } else if (integrityStatus === "blocked") {
    summary = `발송 차단 — 근거 필수 조건 미충족 (문제 ${problemCount}건)`;
  } else {
    summary = `검토 필요 — 인용 무결성 문제 ${problemCount}건`;
  }

  return {
    integrityStatus,
    issues,
    problemIssues,
    advisoryIssues,
    problemCount,
    advisoryCount,
    reviewRequired,
    exportReady,
    summary,
    recommendations,
    problemRecommendations,
    advisoryRecommendations,
  };
}

export const INTEGRITY_STATUS_LABEL: Record<CitationIntegrityStatus, string> = {
  ready: "양호",
  review_required: "검토 필요",
  blocked: "차단",
};
