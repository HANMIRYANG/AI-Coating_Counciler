"use client";

import type { FinalAnswer } from "@/lib/council/schemas";

type UnsafePhraseItem = FinalAnswer["unsafePhrases"][number];

export type RiskPhrasePanelProps = {
  unsafePhrases: FinalAnswer["unsafePhrases"];
  recommendedSafeWording: FinalAnswer["recommendedSafeWording"];
  riskLevel: FinalAnswer["riskLevel"];
  confidenceScore: FinalAnswer["confidenceScore"];
};

const RISK_LABEL_KO: Record<FinalAnswer["riskLevel"], string> = {
  low: "낮음",
  medium: "중간",
  high: "높음",
  critical: "매우 높음",
};

export function RiskPhrasePanel({
  unsafePhrases,
  recommendedSafeWording,
  riskLevel,
  confidenceScore,
}: RiskPhrasePanelProps) {
  const phrases = unsafePhrases ?? [];
  const wording = recommendedSafeWording ?? [];
  const confidencePct = Math.round((confidenceScore ?? 0) * 100);

  return (
    <>
      <div className="detail-group">
        <b>위험도 / 신뢰도</b>
        <span>
          위험도 {RISK_LABEL_KO[riskLevel]} · 신뢰도 {confidencePct}%
        </span>
      </div>

      <div className="detail-group">
        <b>위험 표현 ({phrases.length}건)</b>
        {phrases.length ? (
          <ul>
            {phrases.map((p, idx) => (
              <li key={idx}>
                <UnsafePhraseLine item={p} />
              </li>
            ))}
          </ul>
        ) : (
          <span>발견된 위험 표현 없음</span>
        )}
      </div>

      <div className="detail-group">
        <b>권장 안전 표현</b>
        {wording.length ? (
          <ul>
            {wording.map((item, idx) => (
              <li key={idx}>{item}</li>
            ))}
          </ul>
        ) : (
          <span>없음</span>
        )}
      </div>
    </>
  );
}

function UnsafePhraseLine({ item }: { item: UnsafePhraseItem }) {
  const parts: string[] = [item.phrase];
  if (item.reason) parts.push(`사유: ${item.reason}`);
  if (item.recommended) parts.push(`권장 대체: ${item.recommended}`);
  return <>{parts.join(" · ")}</>;
}
