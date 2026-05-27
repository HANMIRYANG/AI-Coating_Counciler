"use client";

import type { ProviderCritique } from "@/lib/council/schemas";

const NAMES: Record<string, string> = {
  gemini: "Gemini",
  anthropic: "Claude",
  openai: "GPT",
};

export function CritiquePanel({
  critiques,
}: {
  critiques: ProviderCritique[];
}) {
  if (critiques.length === 0) {
    return (
      <div className="rounded-md border border-navy-100 bg-white p-4 text-sm text-ink-500">
        Round 2 상호비판 결과를 기다리는 중입니다.
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
      {critiques.map((c) => (
        <div
          key={c.providerId}
          className="rounded-md border border-navy-100 bg-white p-4 text-sm"
        >
          <header className="mb-2 flex items-center justify-between">
            <div className="text-sm font-semibold text-navy-900">
              {NAMES[c.providerId] ?? c.providerId} 회의 의견
            </div>
            <span className="text-[11px] text-ink-500">
              confidence {(c.confidenceAdjustment * 100).toFixed(0)}%
            </span>
          </header>

          <Block title="합의점" items={c.agreements} />
          <Block title="이견" items={c.disagreements} />
          <Block
            title="근거 부족 주장"
            items={c.unsupportedClaims.map(
              (a) =>
                `${a.claim}${a.attributedTo ? ` (${NAMES[a.attributedTo]})` : ""}`,
            )}
            danger
          />
          <Block title="권장 보정" items={c.recommendedCorrections} />
        </div>
      ))}
    </div>
  );
}

function Block({
  title,
  items,
  danger,
}: {
  title: string;
  items: string[];
  danger?: boolean;
}) {
  return (
    <div className="mb-2">
      <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-ink-500">
        {title}
      </div>
      {items.length ? (
        <ul
          className={`list-inside list-disc text-[13px] ${
            danger ? "text-red-700" : "text-ink-700"
          }`}
        >
          {items.map((a, i) => (
            <li key={i}>{a}</li>
          ))}
        </ul>
      ) : (
        <div className="text-[12px] text-ink-400">없음</div>
      )}
    </div>
  );
}
