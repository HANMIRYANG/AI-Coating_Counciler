"use client";

// Session evidence preview panel (Step 9) — UI/status transparency only.
//
// Renders the Step 7/8 `evidencePreview` so a reviewer can see which internal
// document snippets were retrieved and whether the council prompt received
// evidence context. Thin renderer over the pure view-model in
// `evidencePreviewView.ts`.
//
// NOT implemented here: final-answer citation rendering, embeddings/vector
// search, external fetching, PDF/DOCX parsing. Only bounded snippets already
// present in the preview are shown — never full chunk bodies.

import type { SessionEvidencePreview } from "@/lib/council/evidencePreview";
import { Icons } from "@/components/design/icons";
import { buildEvidencePreviewView } from "./evidencePreviewView";

export function EvidencePreviewPanel({
  preview,
}: {
  preview: SessionEvidencePreview | null | undefined;
}) {
  const view = buildEvidencePreviewView(preview);
  // ai_only / not_requested / missing → render nothing (quiet UI).
  if (!view.visible) return null;

  return (
    <div className="synth-card fade-in" aria-label="내부 문서 근거 검색">
      <div className="synth-h">
        <Icons.Database size={18} />
        <b>내부 문서 근거 검색</b>
        <span className={`badge solid evidence-tone-${view.tone}`}>
          {view.statusLabel}
        </span>
      </div>
      <div className="answer-body compact">
        <p className="muted">{view.summary}</p>
        {view.errorMessage && (
          <p className="muted">사유: {view.errorMessage}</p>
        )}

        {view.showCandidates && view.candidates.length > 0 && (
          <div className="detail-group">
            <b>검색된 문서 후보</b>
            <ul>
              {view.candidates.map((c) => (
                <li key={c.key}>
                  <b>{c.title}</b>
                  <span className="muted">
                    {" "}
                    · {c.metaSummary} · 신뢰수준 {c.trustLevel} · {c.verificationStatus}
                  </span>
                  <div className="muted">{c.snippet}</div>
                </li>
              ))}
            </ul>
          </div>
        )}

        {view.note && <p className="muted">{view.note}</p>}

        <p className="muted">
          ※ 키워드 검색 기반 내부 문서 후보이며, 검증된 최종 인용이 아닙니다.
        </p>
      </div>
    </div>
  );
}
