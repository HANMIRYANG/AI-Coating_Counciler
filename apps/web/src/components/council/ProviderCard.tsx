"use client";

import { cn } from "@/lib/ui/cn";
import type { ProviderId, ProviderStatus, RoundKey } from "@/lib/council/types";
import type { ProviderOpinion } from "@/lib/council/schemas";

const LABELS: Record<ProviderId, string> = {
  gemini: "Gemini",
  anthropic: "Claude",
  openai: "GPT",
};

const STATUS_KO: Record<ProviderStatus, string> = {
  pending: "대기",
  running: "작성 중",
  succeeded: "완료",
  failed: "실패",
  timed_out: "시간 초과",
  schema_invalid: "응답 형식 오류",
  cancelled: "취소됨",
  rate_limited: "Rate-Limited",
};

const STATUS_COLORS: Record<ProviderStatus, string> = {
  pending: "bg-ink-400/20 text-ink-700",
  running: "bg-amber-100 text-amber-800",
  succeeded: "bg-emerald-100 text-emerald-800",
  failed: "bg-red-100 text-red-800",
  timed_out: "bg-red-100 text-red-800",
  schema_invalid: "bg-red-100 text-red-800",
  cancelled: "bg-ink-400/20 text-ink-700",
  rate_limited: "bg-amber-100 text-amber-800",
};

export function ProviderCard(props: {
  providerId: ProviderId;
  calls: Array<{
    providerId: ProviderId;
    round: RoundKey;
    status: ProviderStatus;
    latencyMs: number | null;
    errorMessage: string | null;
    modelUsed?: string | null;
    rateLimited?: boolean;
  }>;
  opinion?: ProviderOpinion;
}) {
  const { providerId, calls, opinion } = props;
  const initial = calls.find(
    (c) => c.providerId === providerId && c.round === "initial",
  );

  return (
    <div className="flex flex-col rounded-lg border border-navy-100 bg-white p-4 shadow-sm">
      <header className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="grid h-7 w-7 place-items-center rounded-md bg-navy-50 text-[11px] font-bold text-navy-900">
            {LABELS[providerId][0]}
          </span>
          <div className="leading-tight">
            <div className="text-sm font-semibold text-navy-900">
              {LABELS[providerId]}
            </div>
            <div className="text-[11px] text-ink-500">
              {initial?.modelUsed ?? opinion?.model ?? "모델 대기"}
              {initial?.rateLimited ? " · rate-limited fallback" : ""}
            </div>
          </div>
        </div>
        {initial && (
          <span
            className={cn(
              "rounded-full px-2 py-0.5 text-[11px] font-medium",
              STATUS_COLORS[initial.status],
            )}
          >
            {STATUS_KO[initial.status]}
            {initial.latencyMs != null
              ? ` · ${(initial.latencyMs / 1000).toFixed(1)}s`
              : ""}
          </span>
        )}
      </header>

      {opinion ? (
        <div className="space-y-3 text-sm">
          <p className="leading-relaxed text-ink-900">{opinion.summary}</p>
          <Section title="주요 주장" items={opinion.evidenceBackedClaims} />
          <Section title="누락 근거" items={opinion.missingEvidence} warn />
          <Section
            title="위험 표현"
            items={opinion.unsafePhrases.map((p) => p.phrase)}
            danger
          />
          <div className="flex items-center justify-between border-t border-navy-100 pt-2 text-[11px] text-ink-500">
            <span>신뢰도 {(opinion.confidenceScore * 100).toFixed(0)}%</span>
            <span>후속 질문 {opinion.followUpQuestions.length}건</span>
          </div>
        </div>
      ) : initial && initial.status === "running" ? (
        <p className="text-sm text-ink-500">의견 작성 중</p>
      ) : initial && initial.status !== "succeeded" ? (
        <div className="rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-700">
          이 AI의 Round 1 호출이 실패했습니다.
          {initial.errorMessage ? ` (${initial.errorMessage})` : ""}
        </div>
      ) : (
        <p className="text-sm text-ink-500">대기 중</p>
      )}
    </div>
  );
}

function Section({
  title,
  items,
  warn,
  danger,
}: {
  title: string;
  items: string[];
  warn?: boolean;
  danger?: boolean;
}) {
  return (
    <div>
      <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-ink-500">
        {title}
      </div>
      {items.length ? (
        <ul
          className={cn(
            "list-inside list-disc space-y-1 text-[13px]",
            danger ? "text-red-700" : warn ? "text-amber-800" : "text-ink-700",
          )}
        >
          {items.map((c, i) => (
            <li key={i}>{c}</li>
          ))}
        </ul>
      ) : (
        <div className="text-[12px] text-ink-400">없음</div>
      )}
    </div>
  );
}
