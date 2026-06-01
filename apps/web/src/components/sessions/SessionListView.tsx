"use client";

// Shared session-list view for /history and /archive. Fetches recent session
// summaries (GET /api/council-sessions) and renders them as links into the
// session screen. Read-only; never exposes debug payload.

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AppShell } from "@/components/design/CouncilDesign";
import type { SessionStatus } from "@/lib/council/types";

export type SessionSummary = {
  id: string;
  userPrompt: string;
  taskType: string;
  evidenceMode: string;
  status: SessionStatus;
  currentRound: string | null;
  createdAt: number;
  completedAt: number | null;
  errorMessage: string | null;
};

const STATUS_KO: Partial<Record<SessionStatus, string>> = {
  created: "생성됨",
  preparing: "준비 중",
  round1_running: "1라운드 진행",
  round2_running: "2라운드 진행",
  synthesis_running: "합성 중",
  completed: "완료",
  partial_completed: "부분 완료",
  limited_answer: "제한적 답변",
  failed: "실패",
  timed_out: "시간 초과",
};

const TASKTYPE_KO: Record<string, string> = {
  technical_review: "기술 검토",
  application_ideas: "적용 아이디어",
  test_report_interpretation: "성적서 해석",
  certification_checklist: "인증 체크리스트",
  document_based_answer: "문서 기반 답변",
  customer_reply: "업체 답변",
  proposal_copy: "제안 문구",
  risky_phrase_review: "위험 표현 검토",
};

export function SessionListView({
  active,
  title,
  emptyText,
  statusFilter,
}: {
  active: "history" | "inbox";
  title: string;
  emptyText: string;
  // When provided, only sessions whose status is in this list are shown.
  // A serializable array (not a function) so server components can pass it.
  statusFilter?: SessionStatus[];
}) {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/council-sessions?limit=100", {
          cache: "no-store",
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(json?.error ?? `HTTP ${res.status}`);
        }
        if (!cancelled) setSessions((json.sessions as SessionSummary[]) ?? []);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const rows = useMemo(
    () =>
      statusFilter
        ? sessions.filter((s) => statusFilter.includes(s.status))
        : sessions,
    [sessions, statusFilter],
  );

  return (
    <AppShell
      active={active}
      title={title}
      status={loading ? "불러오는 중" : `총 ${rows.length}건`}
    >
      <div className="content">
        <div className="container wide">
          <div className="hero">
            <h2>{title}</h2>
          </div>

          {error && (
            <div className="form-error" role="alert">
              불러오기 실패: {error}
            </div>
          )}
          {!loading && !error && rows.length === 0 && (
            <p className="muted">{emptyText}</p>
          )}

          <div className="suggestions">
            {rows.map((s) => (
              <Link key={s.id} className="sugg" href={`/sessions/${s.id}`}>
                <div>
                  <b>
                    {s.userPrompt.length > 60
                      ? `${s.userPrompt.slice(0, 60)}…`
                      : s.userPrompt}
                  </b>
                  <span>
                    {TASKTYPE_KO[s.taskType] ?? s.taskType} ·{" "}
                    {STATUS_KO[s.status] ?? s.status} ·{" "}
                    {new Date(s.createdAt).toLocaleString("ko-KR")}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </AppShell>
  );
}

// Terminal statuses that carry a usable final answer — the "archive".
export const ARCHIVE_STATUSES: SessionStatus[] = [
  "completed",
  "partial_completed",
  "limited_answer",
  "timed_out",
];
