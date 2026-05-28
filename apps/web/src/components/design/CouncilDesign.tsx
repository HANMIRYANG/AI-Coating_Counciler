"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import type {
  ProviderId,
  ProviderStatus,
  RoundKey,
  SessionStatus,
  TaskType,
} from "@/lib/council/types";
import type {
  FinalAnswer,
  ProviderCritique,
  ProviderOpinion,
} from "@/lib/council/schemas";
import { usePathname } from "next/navigation";
import { Icons, AiAvatar, type IconName } from "./icons";
import { EVIDENCE_SOURCE_DISPLAY_LABELS } from "@/lib/council/evidenceCatalog";
import { useRecentSessions } from "@/lib/ui/useRecentSessions";
import type { SessionSummary } from "@/lib/council/store";
import { EvidencePanel } from "@/components/council/EvidencePanel";
import { RiskPhrasePanel } from "@/components/council/RiskPhrasePanel";

export type ProviderCallView = {
  providerId: ProviderId;
  round: RoundKey;
  status: ProviderStatus;
  latencyMs: number | null;
  timeoutMs?: number | null;
  retryCount?: number;
  errorType?: string | null;
  errorMessage: string | null;
  modelRequested?: string | null;
  modelUsed?: string | null;
  rateLimited?: boolean;
};

export type ProviderHealthView = {
  providerId: ProviderId;
  health: "healthy" | "degraded" | "rate_limited" | "unavailable";
  cooldownMs: number;
};

const PROVIDER_LABELS: Record<ProviderId, string> = {
  gemini: "Gemini",
  anthropic: "Claude",
  openai: "GPT",
};

// Human-readable label for each TaskType. Used by the sidebar's recent
// session items so an operator can tell at a glance what mode produced
// each session.
const TASK_TYPE_LABEL: Record<TaskType, string> = {
  technical_review: "검토",
  application_ideas: "아이디어",
  test_report_interpretation: "성적서 해석",
  certification_checklist: "인증 체크",
  document_based_answer: "문서 기반",
  customer_reply: "업체 답변",
  proposal_copy: "제안 문구",
  risky_phrase_review: "위험 표현",
};

// Compact status label for the sidebar (the existing SESSION_STATUS_TEXT
// produces strings that are too long for a narrow list item). Any in-flight
// state collapses to "진행 중"; terminal states keep their distinct labels
// so operators can spot failures at a glance.
const SESSION_STATUS_SIDEBAR_LABEL: Record<SessionStatus, string> = {
  created: "대기",
  preparing: "준비 중",
  round1_running: "진행 중",
  round1_completed: "진행 중",
  round1_partial: "진행 중",
  round1_limited: "진행 중",
  round2_running: "진행 중",
  round2_completed: "진행 중",
  round2_partial: "진행 중",
  round2_limited: "진행 중",
  synthesis_running: "진행 중",
  completed: "완료",
  partial_completed: "부분 완료",
  limited_answer: "제한적 답변",
  failed: "실패",
  timed_out: "시간 초과",
};

function shortPrompt(text: string, max = 30): string {
  const cleaned = text.trim().replace(/\s+/g, " ");
  if (cleaned.length <= max) return cleaned;
  return cleaned.slice(0, Math.max(0, max - 3)) + "...";
}

function formatSidebarDate(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Pull the session id out of `/sessions/<id>` so the sidebar can mark it active. */
function matchSessionIdFromPath(pathname: string | null): string | null {
  if (!pathname) return null;
  const m = pathname.match(/^\/sessions\/([^/?#]+)/);
  return m ? m[1] : null;
}

function SidebarRecentList({
  sessions,
  loading,
  error,
  activeSessionId,
}: {
  sessions: SessionSummary[];
  loading: boolean;
  error: string | null;
  activeSessionId: string | null;
}) {
  if (loading && sessions.length === 0) {
    return <div className="sb-hist-empty">기록 불러오는 중</div>;
  }
  if (error && sessions.length === 0) {
    return <div className="sb-hist-empty">기록을 불러오지 못함</div>;
  }
  if (sessions.length === 0) {
    return <div className="sb-hist-empty">최근 검토 없음</div>;
  }
  return (
    <>
      {sessions.map((s) => {
        const taskLabel = TASK_TYPE_LABEL[s.taskType] ?? s.taskType;
        const statusLabel =
          SESSION_STATUS_SIDEBAR_LABEL[s.status] ?? s.status;
        const isActive = s.id === activeSessionId;
        return (
          <Link
            key={s.id}
            href={`/sessions/${s.id}`}
            className={`sb-hist-item${isActive ? " is-active" : ""}`}
            title={s.userPrompt}
          >
            <b>{shortPrompt(s.userPrompt)}</b>
            <span>
              {taskLabel} · {statusLabel} · {formatSidebarDate(s.createdAt)}
            </span>
          </Link>
        );
      })}
    </>
  );
}

const SUGGESTIONS: Array<{
  icon: IconName;
  title: string;
  sub: string;
  prompt: string;
  taskType?: TaskType;
}> = [
  {
    icon: "Beaker",
    title: "내화 성능 인증",
    sub: "불연도료 KS F 2271 30분 내화 등급 적용 범위",
    prompt:
      "불연도료의 KS F 2271 30분 내화 등급을 업체에 설명할 답변을 작성해줘.",
    taskType: "certification_checklist",
  },
  {
    icon: "Shield",
    title: "안전 적합성 확인",
    sub: "제품 가공 설비 방오 코팅의 위생법 적합 여부",
    prompt:
      "SUS304 제품 가공 설비에 방오 코팅제를 적용할 수 있는지 검토해줘.",
    taskType: "technical_review",
  },
  {
    icon: "Chart",
    title: "적용 아이디어",
    sub: "차열도료 옥상 적용 + 다음 실험 1단계",
    prompt:
      "차열도료를 옥상 슬라브에 적용할 수 있는 새로운 아이디어와 다음 실험 1단계를 제안해줘.",
    taskType: "application_ideas",
  },
  {
    icon: "FileText",
    title: "시험성적서 인용",
    sub: "시험성적서 인용 가능 범위와 표현 가이드",
    prompt:
      "보유 중인 시험성적서를 업체 제안서에 인용할 때 안전한 표현을 정리해줘.",
    taskType: "test_report_interpretation",
  },
];

// Mode selector exposed on the home page. Labels are intentionally short
// (chip-style segmented control). Internal taskType values map 1:1 to the
// schema in `lib/council/types.ts` — all 8 task types are exposed; prompt
// branching for each lives in `lib/council/prompts.ts: taskTypeGuidance`.
const TASK_MODES: Array<{ value: TaskType; label: string; hint: string }> = [
  {
    value: "technical_review",
    label: "검토",
    hint: "기존 제품 적용성 검토",
  },
  {
    value: "application_ideas",
    label: "아이디어",
    hint: "새로운 적용/실험 아이디어",
  },
  {
    value: "test_report_interpretation",
    label: "성적서 해석",
    hint: "시험성적서 해석/인용 표현",
  },
  {
    value: "certification_checklist",
    label: "인증 체크",
    hint: "필요한 인증/규격 체크리스트",
  },
  {
    value: "document_based_answer",
    label: "문서 기반 답변",
    hint: "사내 문서 기반 답변 (RAG 미연결)",
  },
  {
    value: "customer_reply",
    label: "업체 답변",
    hint: "업체 발송용 답변 작성",
  },
  {
    value: "proposal_copy",
    label: "제안 문구",
    hint: "제안서 안전 표현 강화",
  },
  {
    value: "risky_phrase_review",
    label: "위험 표현",
    hint: "단정/위험 표현 검토 및 보정안",
  },
];

const STATUS_TEXT: Record<ProviderStatus, string> = {
  pending: "대기",
  running: "작성 중",
  succeeded: "완료",
  failed: "실패",
  timed_out: "시간 초과",
  schema_invalid: "형식 오류",
  cancelled: "취소됨",
  rate_limited: "제한됨",
};

const SESSION_STATUS_TEXT: Record<SessionStatus, string> = {
  created: "세션 생성",
  preparing: "검토 준비",
  round1_running: "AI 의견 생성 중",
  round1_completed: "AI 의견 완료",
  round1_partial: "AI 의견 일부 완료",
  round1_limited: "AI 의견 제한 완료",
  round2_running: "상호비판 진행 중",
  round2_completed: "상호비판 완료",
  round2_partial: "상호비판 일부 완료",
  round2_limited: "상호비판 제한 완료",
  synthesis_running: "최종 답변 생성 중",
  completed: "검토 완료",
  partial_completed: "부분 완료",
  limited_answer: "제한적 답변",
  failed: "실패",
  timed_out: "시간 초과",
};

const STEPS = [
  { n: 1, label: "Gemini", sub: "의견 생성" },
  { n: 2, label: "Claude", sub: "의견 생성" },
  { n: 3, label: "GPT", sub: "의견 생성" },
  { n: 4, label: "AI 회의", sub: "상호비판" },
  { n: 5, label: "내부자료", sub: "검증" },
  { n: 6, label: "최종 답변", sub: "생성" },
];

export function AppShell({
  active = "chat",
  title,
  crumb,
  status,
  children,
  composer,
}: {
  active?: "chat" | "history" | "docs" | "inbox" | "settings";
  title: string;
  crumb?: string | null;
  status?: string | null;
  children: ReactNode;
  composer?: ReactNode;
}) {
  return (
    <div className="app">
      <Sidebar active={active} />
      <main className="main">
        <Topbar title={title} crumb={crumb} status={status} />
        {children}
        {composer}
      </main>
    </div>
  );
}

function Sidebar({
  active,
}: {
  active: "chat" | "history" | "docs" | "inbox" | "settings";
}) {
  const { sessions, loading, error } = useRecentSessions(8);
  const pathname = usePathname();
  const activeSessionId = matchSessionIdFromPath(pathname);

  const navItems: Array<{
    id: typeof active;
    label: string;
    icon: IconName;
    count?: number;
  }> = [
    { id: "chat", label: "검토 채팅", icon: "Sparkles" },
    {
      id: "history",
      label: "최근 검토 기록",
      icon: "History",
      count: sessions.length,
    },
    { id: "docs", label: "내부 기술자료 관리", icon: "Database", count: 8 },
    { id: "inbox", label: "업체 발송 답변 보관함", icon: "Inbox", count: 24 },
    { id: "settings", label: "설정", icon: "Settings" },
  ];

  return (
    <aside className="sb">
      <Link href="/" className="sb-brand" aria-label="새 검토 시작">
        <div className="sb-mark">
          <span>HM</span>
        </div>
        <div className="sb-name">
          <b>특수도료 AI 검토</b>
          <span>HANMIR COATINGS</span>
        </div>
      </Link>

      <Link href="/" className="sb-cta">
        <Icons.Plus /> 새 검토 시작
      </Link>

      <nav className="sb-nav" aria-label="주요 메뉴">
        {navItems.map((it) => {
          const Icon = Icons[it.icon];
          const enabled = it.id === "chat";
          return enabled ? (
            <Link
              key={it.id}
              href="/"
              className={`sb-item ${active === it.id ? "is-active" : ""}`}
            >
              <Icon className="ico" />
              {it.label}
              {it.count != null && <span className="count">{it.count}</span>}
            </Link>
          ) : (
            <button
              key={it.id}
              type="button"
              className={`sb-item ${active === it.id ? "is-active" : ""}`}
              disabled
              title="Phase 2에서 연결 예정"
            >
              <Icon className="ico" />
              {it.label}
              {it.count != null && <span className="count">{it.count}</span>}
            </button>
          );
        })}
      </nav>

      <div className="sb-section">최근 검토 기록</div>
      <div className="sb-hist">
        <SidebarRecentList
          sessions={sessions}
          loading={loading}
          error={error}
          activeSessionId={activeSessionId}
        />
      </div>

      <div className="sb-foot">
        <div className="sb-avatar">KH</div>
        <div>
          <b>김한미 기술검토팀</b>
          <span>technical@hanmir.co.kr</span>
        </div>
      </div>
    </aside>
  );
}

function Topbar({
  title,
  crumb,
  status,
}: {
  title: string;
  crumb?: string | null;
  status?: string | null;
}) {
  return (
    <div className="topbar">
      <h1>{title}</h1>
      {crumb && (
        <div className="crumb">
          / <b>{crumb}</b>
        </div>
      )}
      <div className="tb-actions">
        {status && (
          <div className="tb-pill">
            <span className="dot" />
            {status}
          </div>
        )}
        <button className="tb-ic-btn" type="button" title="기술자료">
          <Icons.BookOpen />
        </button>
        <button className="tb-ic-btn" type="button" title="알림">
          <Icons.Bell />
        </button>
        <button className="tb-ic-btn" type="button" title="계정">
          <Icons.User />
        </button>
      </div>
    </div>
  );
}

export function HomeWorkspace({
  prompt,
  setPrompt,
  taskType,
  setTaskType,
  onSubmit,
  submitting,
  error,
}: {
  prompt: string;
  setPrompt: (value: string) => void;
  taskType: TaskType;
  setTaskType: (value: TaskType) => void;
  onSubmit: () => void;
  submitting: boolean;
  error: string | null;
}) {
  const canSend = prompt.trim().length >= 4 && !submitting;
  const activeMode = TASK_MODES.find((m) => m.value === taskType);

  return (
    <AppShell
      title="새 검토 시작"
      status={submitting ? "세션 생성 중" : "업체 문의 검토 준비"}
      composer={
        <Composer
          value={prompt}
          setValue={setPrompt}
          onSend={onSubmit}
          sendDisabled={!canSend}
          inputDisabled={submitting}
          submitting={submitting}
          placeholder="질문을 입력하세요..."
        />
      }
    >
      <div className="content">
        <div className="container">
          <div className="hero">
            <div className="mark">
              <span>HM</span>
            </div>
            <h2>특수도료 AI 검토 시스템</h2>
            <p>
              특수도료, 불연, 단열, 차열, 방오 코팅 관련 질문을 입력하면
              3개의 AI가 회의하여 내부 검토용 답변과 업체 발송용 문안을
              분리해 생성합니다.
            </p>
          </div>

          <div className="section-title">
            <h2>검토 모드</h2>
            <span className="sub">
              {activeMode ? activeMode.hint : "모드를 선택하세요"}
            </span>
          </div>
          <div
            className="task-modes"
            role="group"
            aria-label="검토 모드 선택"
          >
            {TASK_MODES.map((m) => {
              const isActive = m.value === taskType;
              return (
                <button
                  key={m.value}
                  type="button"
                  aria-pressed={isActive}
                  className={`task-mode${isActive ? " is-active" : ""}`}
                  onClick={() => setTaskType(m.value)}
                  disabled={submitting}
                  title={m.hint}
                >
                  {m.label}
                </button>
              );
            })}
          </div>

          <div className="section-title">
            <h2>예시 검토 시작</h2>
            <span className="sub">자주 묻는 업체 문의 유형</span>
          </div>
          <div className="suggestions">
            {SUGGESTIONS.map((s) => {
              const Icon = Icons[s.icon];
              return (
                <button
                  key={s.title}
                  className="sugg"
                  type="button"
                  disabled={submitting}
                  // Guard against late clicks racing an in-flight session
                  // creation. The Composer remains the canonical input.
                  onClick={() => {
                    if (submitting) return;
                    setPrompt(s.prompt);
                    if (s.taskType) setTaskType(s.taskType);
                  }}
                >
                  <div className="ico">
                    <Icon />
                  </div>
                  <div>
                    <b>{s.title}</b>
                    <span>{s.sub}</span>
                  </div>
                </button>
              );
            })}
          </div>

          <div className="section-title">
            <h2>근거 출처 준비 상태</h2>
            <span className="sub">
              현재는 카탈로그/정책 메타데이터만 노출됩니다.
            </span>
          </div>
          <div
            className="evidence-readiness"
            aria-label="근거 출처 준비 상태"
          >
            <ul className="readiness-status">
              <li>
                <b>공식 출처 조회</b>
                <span className="readiness-badge">준비 중</span>
              </li>
              <li>
                <b>사내 문서 / RAG</b>
                <span className="readiness-badge">준비 중</span>
              </li>
            </ul>
            <div className="readiness-sources">
              <span className="readiness-label">시드 출처</span>
              <span className="readiness-list">
                {EVIDENCE_SOURCE_DISPLAY_LABELS.join(", ")}
              </span>
            </div>
            <p className="readiness-note">
              카탈로그 포함 자체로 해당 기관 보고서가 모든 클레임에 자동
              유효함을 의미하지 않습니다. 실제 조회는 추후 단계에서
              연결될 예정입니다.
            </p>
          </div>

          {error && (
            <div className="form-error" role="alert">
              요청 실패: {error}
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}

export function SessionWorkspace({
  sessionId,
  data,
  error,
}: {
  sessionId: string;
  data: {
    status: SessionStatus;
    currentRound: string | null;
    userPrompt: string;
    taskType: string;
    evidenceMode: string;
    providers: ProviderCallView[];
    providerHealth: ProviderHealthView[];
    opinions: ProviderOpinion[];
    critiques: ProviderCritique[];
    finalAnswer: FinalAnswer | null;
    errorMessage: string | null;
  } | null;
  error: string | null;
}) {
  const statusText = data ? SESSION_STATUS_TEXT[data.status] : "세션 로딩 중";
  const currentStep = data ? computeCurrentStep(data.status, data.opinions) : 1;
  const done = !!data && isTerminal(data.status);
  const opinionsByProvider = useMemo(() => {
    const map = new Map<ProviderId, ProviderOpinion>();
    if (data) for (const o of data.opinions) map.set(o.providerId, o);
    return map;
  }, [data]);

  return (
    <AppShell
      title="검토 진행"
      crumb={sessionId}
      status={statusText}
      composer={
        <Composer
          value=""
          setValue={() => undefined}
          onSend={() => undefined}
          sendDisabled
          inputDisabled
          placeholder={
            done ? "검토가 완료되었습니다." : "AI 검토가 진행 중입니다..."
          }
        />
      }
    >
      <div className="content">
        <div className="container wide">
          {error && !data && <div className="form-error">{error}</div>}

          {!data ? (
            <div className="design-empty">세션 정보를 불러오는 중입니다.</div>
          ) : (
            <div className="chat">
              <div className="msg msg-user fade-in">
                <div className="bubble">
                  <div>{data.userPrompt}</div>
                  <div className="msg-meta">
                    <span className="who">기술검토팀</span>
                    <span className="time">{data.taskType}</span>
                  </div>
                </div>
              </div>

              <div className="msg msg-system fade-in">
                <div className="avatar-sys">
                  <span>HM</span>
                </div>
                <div className="bubble">
                  <div className="msg-meta">
                    <span className="who">특수도료 AI 검토 시스템</span>
                    <span className="time">{statusText}</span>
                  </div>

                  <StepperCard current={currentStep} done={done} />
                  <ProviderHealthBar health={data.providerHealth} />

                  <div className="ai-grid">
                    {(["gemini", "anthropic", "openai"] as ProviderId[]).map(
                      (id) => (
                        <AiOpinionCard
                          key={id}
                          providerId={id}
                          calls={data.providers}
                          opinion={opinionsByProvider.get(id)}
                        />
                      ),
                    )}
                  </div>

                  {data.critiques.length > 0 && (
                    <SynthCard critiques={data.critiques} />
                  )}

                  {data.finalAnswer && <VerifyCard answer={data.finalAnswer} />}

                  {data.errorMessage && (
                    <div className="form-error">{data.errorMessage}</div>
                  )}

                  {data.finalAnswer ? (
                    <FinalAnswerCard answer={data.finalAnswer} />
                  ) : (
                    <div className="status-footer">
                      <span className="ai-streaming">
                        <i />
                        <i />
                        <i />
                      </span>
                      <span>
                        <b>{statusText}</b> 단계입니다. 각 AI 응답은 도착하는
                        대로 이 화면에 반영됩니다.
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}

function StepperCard({ current, done }: { current: number; done: boolean }) {
  return (
    <div className="stepper-card">
      <h3>
        {!done && <span className="pulse" />}
        AI 검토 진행 상태
        {done && <span className="done-tag">검토 완료</span>}
      </h3>
      <div className="stepper">
        {STEPS.map((s, i) => {
          const idx = i + 1;
          const state =
            idx < current || done
              ? "is-done"
              : idx === current
                ? "is-active"
                : "is-pending";
          return (
            <div key={s.n} className={`step ${state}`}>
              <div className="step-bubble">
                {state === "is-done" ? <Icons.Check size={14} /> : s.n}
              </div>
              <div className="step-label">{s.label}</div>
              <div className="step-sub">{s.sub}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function AiOpinionCard({
  providerId,
  calls,
  opinion,
}: {
  providerId: ProviderId;
  calls: ProviderCallView[];
  opinion?: ProviderOpinion;
}) {
  const call = calls.find(
    (c) => c.providerId === providerId && c.round === "initial",
  );
  const state = opinion ? "done" : call?.status === "running" ? "streaming" : "pending";
  const failed =
    call &&
    !["pending", "running", "succeeded"].includes(call.status) &&
    !opinion;

  return (
    <div
      className={`ai-card ${state === "pending" ? "is-pending" : ""} ${
        state === "streaming" ? "is-streaming" : ""
      }`}
    >
      <div className="ai-card-h">
        <div className="ai-mark">
          <AiAvatar kind={providerId} />
        </div>
        <b>{PROVIDER_LABELS[providerId]} 의견</b>
        <span className="ver">
          {call?.modelUsed ?? opinion?.model ?? "모델 대기"}
        </span>
      </div>

      {failed ? (
        <div className="ai-section danger">
          <div className="lbl">{STATUS_TEXT[call.status]}</div>
          <p>{call.errorMessage ?? "해당 AI의 의견 생성이 완료되지 않았습니다."}</p>
        </div>
      ) : state === "streaming" ? (
        <div className="ai-section">
          <div className="lbl">의견 생성 중</div>
          <div className="skel-stack">
            <span className="skel" />
            <span className="skel short" />
            <span className="skel mid" />
          </div>
        </div>
      ) : opinion ? (
        <>
          <div className="ai-section">
            <div className="lbl">요약</div>
            <p>{opinion.summary}</p>
          </div>
          <ListSection
            title="주요 주장"
            items={opinion.evidenceBackedClaims}
          />
          <ListSection title="검증 필요" items={opinion.missingEvidence} />
          <ListSection
            title="주의 표현"
            items={opinion.unsafePhrases.map((p) => p.phrase)}
          />
          <div className="ai-foot">
            <span>신뢰도 {(opinion.confidenceScore * 100).toFixed(0)}%</span>
            {call?.latencyMs != null && (
              <span>{(call.latencyMs / 1000).toFixed(1)}s</span>
            )}
          </div>
        </>
      ) : (
        <div className="ai-section">
          <div className="ai-streaming">
            <i />
            <i />
            <i />
          </div>
          <div className="muted">대기 중</div>
        </div>
      )}
    </div>
  );
}

function ListSection({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="ai-section">
      <div className="lbl">{title}</div>
      {items.length ? (
        <ul>
          {items.slice(0, 4).map((item, idx) => (
            <li key={idx}>{item}</li>
          ))}
        </ul>
      ) : (
        <p className="muted">없음</p>
      )}
    </div>
  );
}

function SynthCard({ critiques }: { critiques: ProviderCritique[] }) {
  const agreements = critiques.flatMap((c) => c.agreements).slice(0, 4);
  const disagreements = critiques.flatMap((c) => c.disagreements).slice(0, 4);
  const corrections = critiques
    .flatMap((c) => c.recommendedCorrections)
    .slice(0, 4);

  return (
    <div className="synth-card fade-in">
      <div className="synth-h">
        <Icons.Users size={18} />
        <b>AI 회의 결과</b>
        <span className="badge solid">{critiques.length}개 AI 상호비판</span>
      </div>
      <div className="synth-grid">
        <div className="synth-col">
          <div className="lbl">
            <span className="lbl-dot" />
            공통점
          </div>
          <MiniList items={agreements} empty="아직 합의 항목이 없습니다." />
        </div>
        <div className="synth-col">
          <div className="lbl">
            <span className="lbl-dot" />
            차이점
          </div>
          <MiniList items={disagreements} empty="주요 이견이 없습니다." />
        </div>
        <div className="synth-col">
          <div className="lbl">
            <span className="lbl-dot" />
            보정 권장
          </div>
          <MiniList items={corrections} empty="추가 보정 권장이 없습니다." />
        </div>
      </div>
    </div>
  );
}

function VerifyCard({ answer }: { answer: FinalAnswer }) {
  const rows = [
    {
      icon: "FileText" as IconName,
      label: "근거 있는 주장",
      sub: "evidenceBackedClaims",
      value: `${answer.evidenceBackedClaims.length}건`,
      ok: answer.evidenceBackedClaims.length > 0,
    },
    {
      icon: "AlertTriangle" as IconName,
      label: "누락 근거",
      sub: "missingEvidence",
      value: `${answer.missingEvidence.length}건`,
      ok: answer.missingEvidence.length === 0,
    },
    {
      icon: "ShieldCheck" as IconName,
      label: "위험 표현",
      sub: "unsafePhrases",
      value: `${answer.unsafePhrases.length}건`,
      ok: answer.unsafePhrases.length === 0,
    },
    {
      icon: "Chart" as IconName,
      label: "위험도",
      sub: "riskLevel",
      value: riskLabel(answer.riskLevel),
      ok: ["low", "medium"].includes(answer.riskLevel),
    },
  ];

  return (
    <div className="verify-card fade-in">
      <div className="verify-h">
        <Icons.ShieldCheck size={18} />
        <b>내부 검증 결과</b>
        <span className="sub">최종 답변 안전성 점검</span>
        <span className="status">
          <Icons.Check size={11} /> 검토 완료
        </span>
      </div>
      <div className="verify-body">
        <div className="verify-rows">
          {rows.map((row) => {
            const Icon = Icons[row.icon];
            return (
              <div className="verify-row" key={row.label}>
                <div className="row-ic">
                  <Icon />
                </div>
                <div className="row-lbl">
                  <b>{row.label}</b>
                  {row.sub}
                </div>
                <div className="row-val">{row.value}</div>
                <div className="row-chk">
                  {row.ok ? <Icons.CheckCircle /> : <Icons.AlertTriangle />}
                </div>
              </div>
            );
          })}
        </div>
        <div className="verify-summary">
          <div className="verify-shield">
            <Icons.ShieldCheck />
          </div>
          <h4>검증 완료</h4>
          <p>
            업체 발송 전에 근거, 누락 자료, 위험 표현을 분리해 확인했습니다.
          </p>
          <div className="verify-meta">
            <div>
              <span className="l">신뢰도</span>
              <span className="v">
                {(answer.confidenceScore * 100).toFixed(0)}%
              </span>
            </div>
            <div>
              <span className="l">담당</span>
              <span className="v">기술검토팀</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function FinalAnswerCard({ answer }: { answer: FinalAnswer }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard?.writeText(answer.businessReadyAnswer);
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };

  return (
    <div className="final-wrap fade-in">
      <div className="fitness-card">
        <div className="fitness-left">
          <div className="fitness-shield">
            <Icons.ShieldCheck />
          </div>
          <div className="fitness-text">
            <b>{answer.sessionStatus === "limited_answer" ? "제한적 검토" : "발송 검토 가능"}</b>
            <span>최종 판단: {answer.conclusion}</span>
          </div>
        </div>
        <div className="fitness-checks">
          <div>
            <Icons.Check /> 근거 분리
          </div>
          <div>
            <Icons.Check /> 위험 표현 점검
          </div>
          <div>
            <Icons.Check /> 내부 메모 분리
          </div>
        </div>
      </div>

      <div className="answer-card">
        <div className="answer-h">
          <Icons.FileText size={16} />
          <b>최종 답변 (업체 발송용)</b>
          <span className="meta">risk · {riskLabel(answer.riskLevel)}</span>
        </div>
        <div className="answer-body">
          <pre>{answer.businessReadyAnswer}</pre>
        </div>
        <div className="answer-actions">
          <button className="btn" type="button" onClick={copy}>
            <Icons.Copy /> {copied ? "복사됨" : "복사하기"}
          </button>
          <button className="btn" type="button">
            <Icons.Mail /> 메일 초안
          </button>
          <button className="btn" type="button">
            <Icons.Download /> PDF 저장
          </button>
          <button className="btn primary" type="button">
            <Icons.Users /> 내부 검토 요청
          </button>
        </div>
      </div>

      <div className="answer-card secondary">
        <div className="answer-h">
          <Icons.Shield size={16} />
          <b>내부 메모 및 누락 근거</b>
        </div>
        <div className="answer-body compact">
          <p>{answer.internalMemo || "별도 내부 메모가 없습니다."}</p>
          <EvidencePanel
            claims={answer.evidenceBackedClaims}
            assumptions={answer.assumptions}
            missing={answer.missingEvidence}
          />
          <RiskPhrasePanel
            unsafePhrases={answer.unsafePhrases}
            recommendedSafeWording={answer.recommendedSafeWording}
            riskLevel={answer.riskLevel}
            confidenceScore={answer.confidenceScore}
          />
          <DetailGroup
            title="후속 질문"
            items={answer.followUpQuestions}
          />
        </div>
      </div>
    </div>
  );
}

function Composer({
  value,
  setValue,
  onSend,
  sendDisabled,
  inputDisabled,
  submitting,
  placeholder,
}: {
  value: string;
  setValue: (value: string) => void;
  onSend: () => void;
  sendDisabled?: boolean;
  inputDisabled?: boolean;
  submitting?: boolean;
  placeholder: string;
}) {
  const send = () => {
    if (sendDisabled || submitting) return;
    onSend();
  };

  return (
    <div className="composer-wrap">
      <div className="composer">
        <textarea
          value={value}
          placeholder={placeholder}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          disabled={inputDisabled}
        />
        <div className="composer-actions">
          <button className="composer-chip" type="button" disabled>
            <Icons.Paperclip /> 파일 첨부
          </button>
          <button className="composer-chip" type="button" disabled>
            <Icons.Database /> 내부 자료 참조
          </button>
          <button className="composer-chip" type="button" disabled>
            <Icons.Sparkles /> AI 가이드
          </button>
          <button
            className="composer-send"
            type="button"
            disabled={sendDisabled || submitting}
            onClick={send}
            title="검토 시작"
          >
            {submitting ? <span className="send-spinner" /> : <Icons.Send />}
          </button>
        </div>
      </div>
      <div className="composer-hint">
        <span>3개의 AI가 의견을 교환한 후 최종 답변을 생성합니다.</span>
        <span>
          <kbd>Enter</kbd> 전송 · <kbd>Shift + Enter</kbd> 줄바꿈
        </span>
      </div>
    </div>
  );
}

function ProviderHealthBar({ health }: { health: ProviderHealthView[] }) {
  if (health.length === 0) return null;
  return (
    <div className="health-row">
      {health.map((h) => (
        <span key={h.providerId} className={`health-pill ${h.health}`}>
          {PROVIDER_LABELS[h.providerId]} · {h.health}
          {h.cooldownMs > 0 ? ` · ${Math.ceil(h.cooldownMs / 1000)}s` : ""}
        </span>
      ))}
    </div>
  );
}

function MiniList({ items, empty }: { items: string[]; empty: string }) {
  if (!items.length) return <p className="muted">{empty}</p>;
  return (
    <ul>
      {items.map((item, idx) => (
        <li key={idx}>{item}</li>
      ))}
    </ul>
  );
}

function DetailGroup({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="detail-group">
      <b>{title}</b>
      {items.length ? (
        <ul>
          {items.map((item, idx) => (
            <li key={idx}>{item}</li>
          ))}
        </ul>
      ) : (
        <span>없음</span>
      )}
    </div>
  );
}

function computeCurrentStep(
  status: SessionStatus,
  opinions: ProviderOpinion[],
): number {
  if (status === "round1_running") {
    return Math.max(1, Math.min(3, opinions.length + 1));
  }
  if (
    status === "round1_completed" ||
    status === "round1_partial" ||
    status === "round1_limited" ||
    status === "round2_running"
  ) {
    return 4;
  }
  if (
    status === "round2_completed" ||
    status === "round2_partial" ||
    status === "round2_limited"
  ) {
    return 5;
  }
  if (status === "synthesis_running") return 6;
  if (isTerminal(status)) return 6;
  return 1;
}

function isTerminal(status: SessionStatus): boolean {
  return [
    "completed",
    "partial_completed",
    "limited_answer",
    "failed",
    "timed_out",
  ].includes(status);
}

function riskLabel(risk: FinalAnswer["riskLevel"]): string {
  return {
    low: "낮음",
    medium: "중간",
    high: "높음",
    critical: "매우 높음",
  }[risk];
}
