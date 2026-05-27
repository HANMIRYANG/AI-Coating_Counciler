"use client";

import { useState } from "react";
import type { FinalAnswer } from "@/lib/council/schemas";
import type { RiskLevel } from "@/lib/council/types";
import { cn } from "@/lib/ui/cn";

const RISK_KO: Record<RiskLevel, string> = {
  low: "낮음",
  medium: "중간",
  high: "높음",
  critical: "매우 높음",
};

const RISK_COLOR: Record<RiskLevel, string> = {
  low: "bg-emerald-100 text-emerald-800 border-emerald-200",
  medium: "bg-amber-100 text-amber-800 border-amber-200",
  high: "bg-red-100 text-red-800 border-red-200",
  critical: "bg-red-200 text-red-900 border-red-300",
};

type Tab = "business" | "internal" | "evidence" | "risk";

export function FinalAnswerPanel({ ans }: { ans: FinalAnswer }) {
  const [tab, setTab] = useState<Tab>("business");
  const risk = (ans.riskLevel ?? "low") as RiskLevel;

  return (
    <div className="overflow-hidden rounded-lg border border-navy-100 bg-white shadow-sm">
      <header className="flex items-center justify-between border-b border-navy-100 bg-navy-50 px-5 py-3">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wider text-ink-500">
            최종 합의안
          </div>
          <div className="text-sm font-semibold text-navy-900">
            {ans.conclusion}
          </div>
        </div>
        <div className="flex items-center gap-2 text-[11px]">
          <span
            className={cn(
              "rounded-full border px-2 py-0.5 font-medium",
              RISK_COLOR[risk],
            )}
          >
            riskLevel · {RISK_KO[risk]}
          </span>
          <span className="rounded-full border border-navy-200 bg-white px-2 py-0.5 text-navy-900">
            confidence · {(ans.confidenceScore * 100).toFixed(0)}%
          </span>
        </div>
      </header>

      <nav className="flex border-b border-navy-100 bg-white text-sm">
        <TabBtn active={tab === "business"} onClick={() => setTab("business")}>
          업체 발송용
        </TabBtn>
        <TabBtn active={tab === "internal"} onClick={() => setTab("internal")}>
          내부 검토 메모
        </TabBtn>
        <TabBtn active={tab === "evidence"} onClick={() => setTab("evidence")}>
          근거 / 누락 자료
        </TabBtn>
        <TabBtn active={tab === "risk"} onClick={() => setTab("risk")}>
          위험 표현
        </TabBtn>
      </nav>

      <div className="p-5 text-sm leading-relaxed text-ink-900">
        {tab === "business" && <Markdown content={ans.businessReadyAnswer} />}
        {tab === "internal" && (
          <div className="space-y-4">
            <Markdown content={ans.finalMarkdown} />
            <div className="rounded-md border border-navy-100 bg-navy-50 p-3 text-[13px] text-ink-700">
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-ink-500">
                내부 메모
              </div>
              <p className="whitespace-pre-wrap">
                {ans.internalMemo || "없음"}
              </p>
            </div>
          </div>
        )}
        {tab === "evidence" && (
          <div className="space-y-4">
            <Group title="근거 있는 주장" items={ans.evidenceBackedClaims} />
            <Group title="추정" items={ans.assumptions} tone="muted" />
            <Group title="누락 자료" items={ans.missingEvidence} tone="warn" />
            <Group
              title="해결되지 않은 의견"
              items={ans.unresolvedDisagreements}
              tone="warn"
            />
            <Group title="후속 질문" items={ans.followUpQuestions} tone="muted" />
          </div>
        )}
        {tab === "risk" && (
          <div className="space-y-3">
            {ans.unsafePhrases.length === 0 ? (
              <p className="text-[13px] text-emerald-700">
                자동 점검 결과, 위험 표현은 발견되지 않았습니다.
              </p>
            ) : (
              <ul className="space-y-2">
                {ans.unsafePhrases.map((p, i) => (
                  <li
                    key={i}
                    className="rounded-md border border-red-200 bg-red-50 p-3 text-[13px] text-red-800"
                  >
                    <div>
                      <b>위험 표현:</b> {p.phrase}
                    </div>
                    {p.reason && (
                      <div className="text-[12px] text-red-700">
                        사유: {p.reason}
                      </div>
                    )}
                    {p.recommended && (
                      <div className="mt-1 rounded bg-white p-2 text-[12px] text-ink-700">
                        권장 대체: {p.recommended}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
            <Group
              title="권장 안전 표현"
              items={ans.recommendedSafeWording}
              tone="muted"
            />
          </div>
        )}
      </div>
    </div>
  );
}

function TabBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "border-b-2 px-4 py-2 text-sm transition",
        active
          ? "border-navy-900 font-semibold text-navy-900"
          : "border-transparent text-ink-500 hover:text-navy-700",
      )}
    >
      {children}
    </button>
  );
}

function Markdown({ content }: { content: string }) {
  return (
    <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-relaxed text-ink-900">
      {content}
    </pre>
  );
}

function Group({
  title,
  items,
  tone,
}: {
  title: string;
  items: string[];
  tone?: "warn" | "muted";
}) {
  return (
    <div>
      <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-ink-500">
        {title}
      </div>
      {items.length === 0 ? (
        <div className="text-[12px] text-ink-400">없음</div>
      ) : (
        <ul className="list-inside list-disc space-y-1 text-[13px]">
          {items.map((it, i) => (
            <li
              key={i}
              className={cn(
                tone === "warn"
                  ? "text-amber-800"
                  : tone === "muted"
                    ? "text-ink-500"
                    : "text-ink-900",
              )}
            >
              {it}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
