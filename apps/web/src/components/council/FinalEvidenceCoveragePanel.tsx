"use client";

// Final-answer evidence coverage block (Step 11) — display-only.
//
// Renders the Step 10 evidence usage contract (`evidenceCoverageStatus`,
// `evidenceUsed`, `coveredClaims`, `uncoveredClaims`) inside the existing
// final-answer card body. Thin renderer over the pure view-model in
// `finalEvidenceCoverageView.ts`. No verified-citation enforcement, no
// semantic RAG, no full chunk bodies, no internal ids shown.
//
// Returns a fragment (not a card) so it nests cleanly in the existing
// "내부 메모 및 누락 근거" card without card-in-card layout.

import type { FinalAnswer } from "@/lib/council/schemas";
import { buildFinalEvidenceCoverageView } from "./finalEvidenceCoverageView";

export function FinalEvidenceCoveragePanel({
  answer,
}: {
  answer: Pick<
    FinalAnswer,
    | "evidenceCoverageStatus"
    | "evidenceUsed"
    | "coveredClaims"
    | "uncoveredClaims"
  >;
}) {
  const view = buildFinalEvidenceCoverageView(answer);
  // not_requested (ai_only) → quiet UI, render nothing.
  if (!view.visible) return null;

  return (
    <div className="detail-group">
      <b>
        근거 커버리지{" "}
        <span className={`badge evidence-coverage-${view.tone}`}>
          {view.statusLabel}
        </span>
      </b>

      {view.warning && <p className="muted">{view.warning}</p>}

      {view.evidenceRefs.length > 0 && (
        <ul>
          {view.evidenceRefs.map((r) => (
            <li key={r.key}>
              {r.title}
              <span className="muted">
                {" "}
                · 신뢰수준 {r.trustLevel} · {r.verificationStatus}
              </span>
            </li>
          ))}
        </ul>
      )}

      {view.coveredClaims.length > 0 && (
        <>
          <b>근거 연결 주장</b>
          <ul>
            {view.coveredClaims.map((c, idx) => (
              <li key={idx}>
                {c.claim}
                <span className="muted"> · 근거 {c.refCount}건</span>
              </li>
            ))}
          </ul>
        </>
      )}

      {view.uncoveredClaims.length > 0 && (
        <>
          <b>근거 부족 항목</b>
          <ul>
            {view.uncoveredClaims.map((claim, idx) => (
              <li key={idx}>{claim}</li>
            ))}
          </ul>
        </>
      )}

      <p className="muted">
        ※ 표시용 근거 커버리지이며, 검증된 인용 강제는 적용되지 않습니다.
      </p>
    </div>
  );
}
