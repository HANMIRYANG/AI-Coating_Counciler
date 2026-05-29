"use client";

import { useEffect, useState } from "react";
import { SessionWorkspace } from "@/components/design/CouncilDesign";
import type { ProviderId, SessionStatus } from "@/lib/council/types";
import type {
  FinalAnswer,
  ProviderCritique,
  ProviderOpinion,
} from "@/lib/council/schemas";
import type { SessionEvidencePreview } from "@/lib/council/evidencePreview";

type SessionApiResponse = {
  id: string;
  status: SessionStatus;
  currentRound: string | null;
  userPrompt: string;
  taskType: string;
  evidenceMode: string;
  createdAt: number;
  startedAt: number | null;
  completedAt: number | null;
  errorMessage: string | null;
  providers: Array<{
    providerId: ProviderId;
    round: "initial" | "critique" | "synthesis";
    status:
      | "pending"
      | "running"
      | "succeeded"
      | "failed"
      | "timed_out"
      | "schema_invalid"
      | "cancelled"
      | "rate_limited";
    latencyMs: number | null;
    timeoutMs: number | null;
    retryCount: number;
    errorType: string | null;
    errorMessage: string | null;
    modelRequested: string | null;
    modelUsed: string | null;
    rateLimited: boolean;
  }>;
  providerHealth: Array<{
    providerId: ProviderId;
    health: "healthy" | "degraded" | "rate_limited" | "unavailable";
    cooldownMs: number;
  }>;
  opinions: ProviderOpinion[];
  critiques: ProviderCritique[];
  finalAnswer: FinalAnswer | null;
  evidencePreview: SessionEvidencePreview | null;
};

const TERMINAL_STATES: SessionStatus[] = [
  "completed",
  "partial_completed",
  "limited_answer",
  "failed",
  "timed_out",
];

// Poll cadence. `NEXT_PUBLIC_POLLING_INTERVAL_MS` is inlined at build time;
// non-finite / non-positive values fall back to 1500ms. The error-retry
// cadence is derived from this floor so a misconfig can't busy-loop.
const POLL_INTERVAL_MS = (() => {
  const raw = process.env.NEXT_PUBLIC_POLLING_INTERVAL_MS;
  const n = raw === undefined ? NaN : Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 1500;
})();
const POLL_ERROR_RETRY_MS = Math.max(POLL_INTERVAL_MS * 2, 3000);

export default function SessionPage({ params }: { params: { id: string } }) {
  const [data, setData] = useState<SessionApiResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;

    const poll = async () => {
      try {
        const res = await fetch(`/api/council-sessions/${params.id}`, {
          cache: "no-store",
        });
        if (!res.ok) {
          if (res.status === 404) {
            throw new Error(
              "세션을 찾을 수 없습니다. 개발 서버가 재시작되면 메모리 세션이 사라질 수 있습니다.",
            );
          }
          throw new Error(`HTTP ${res.status}`);
        }
        const json = (await res.json()) as SessionApiResponse;
        if (cancelled) return;
        setData(json);
        setError(null);
        if (!TERMINAL_STATES.includes(json.status)) {
          timer = setTimeout(poll, POLL_INTERVAL_MS);
        }
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "polling_failed");
        timer = setTimeout(poll, POLL_ERROR_RETRY_MS);
      }
    };

    poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [params.id]);

  return <SessionWorkspace sessionId={params.id} data={data} error={error} />;
}
