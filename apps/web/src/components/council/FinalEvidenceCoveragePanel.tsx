"use client";

// Final-answer evidence coverage block — display-only.
//
// Renders the evidence usage contract (`evidenceCoverageStatus`,
// `evidenceUsed`, `coveredClaims`, `uncoveredClaims`) plus the Retrieval Guard
// verdict (`retrievalGuard`) inside the existing final-answer card body. Thin
// renderer over the pure view-model in `finalEvidenceCoverageView.ts`. The
// guard is a status gate (citation sufficiency), NOT a legal certification; no
// full chunk bodies, no internal ids shown.
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
    | "retrievalGuard"
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

      {view.guard && (
        <p>
          <b>
            근거 가드{" "}
            <span className={`badge evidence-coverage-${view.guard.tone}`}>
              {view.guard.statusLabel}
            </span>
          </b>
          <span className="muted">
            {" "}
            · 업체 발송 {view.guard.businessReady ? "가능" : "불가"}
          </span>
          {view.guard.recommendedAction && (
            <span className="muted"> — {view.guard.recommendedAction}</span>
          )}
        </p>
      )}

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

      {view.citations && (
        <>
          <b>
            검증된 인용{" "}
            <span
              className={`badge evidence-coverage-${view.citations.tone}`}
            >
              {view.citations.readyLabel}
            </span>
          </b>
          {view.citations.citedClaims.length > 0 && (
            <ul>
              {view.citations.citedClaims.map((c) => (
                <li key={c.label}>
                  [{c.label}] {c.claim}
                  <span className="muted">
                    {" "}
                    — 근거:{" "}
                    {c.evidence.length > 0
                      ? c.evidence
                          .map(
                            (e) =>
                              `${e.title} (${e.trustLevel}·${e.verificationStatus})`,
                          )
                          .join(", ")
                      : "없음"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      <p className="muted">
        ※ 근거 가드는 인용 충분성·유효성에 대한 결정적 게이트이며, 사실의 법적
        인증이 아닙니다. 발송 전 사람 검토를 권장합니다.
      </p>
    </div>
  );
}
