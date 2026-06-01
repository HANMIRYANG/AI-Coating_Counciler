"use client";

// 설정 / 정보 (읽기 전용). 서버의 비밀 아닌 런타임 설정(GET /api/config)을
// 표시한다. 값 변경은 환경변수(.env)로만 가능하므로 편집 컨트롤은 없다.

import { useEffect, useState } from "react";
import { AppShell } from "@/components/design/CouncilDesign";

type Config = {
  timeouts: {
    providerTimeoutMs: number;
    roundTimeoutMs: number;
    synthesisTimeoutMs: number;
    sessionTimeoutMs: number;
    maxRetries: number;
  };
  thresholds: {
    minOpinionsForMeeting: number;
    minCritiquesForSynthesis: number;
  };
  models: Record<string, Record<string, string>>;
  sessionStore: string;
  useMockProviders: boolean;
  pollingIntervalMs: number;
};

function Row({ label, value }: { label: string; value: string }) {
  return (
    <li>
      <b>{label}</b>
      <span className="muted"> {value}</span>
    </li>
  );
}

export default function SettingsPage() {
  const [cfg, setCfg] = useState<Config | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/config", { cache: "no-store" });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`);
        if (!cancelled) setCfg(json as Config);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const secs = (ms: number) => `${(ms / 1000).toFixed(0)}초 (${ms}ms)`;

  return (
    <AppShell active="settings" title="설정 / 정보" status="읽기 전용">
      <div className="content">
        <div className="container wide">
          <div className="hero">
            <h2>설정 / 정보</h2>
            <p className="readiness-note">
              아래 값은 서버 환경변수에서 읽은 현재 런타임 설정입니다. 비밀
              정보(API 키·토큰·DB 접속정보)는 노출하지 않습니다. 변경은
              <code> .env</code>로만 가능합니다.
            </p>
          </div>

          {error && (
            <div className="form-error" role="alert">
              불러오기 실패: {error}
            </div>
          )}
          {!cfg && !error && <p className="muted">불러오는 중...</p>}

          {cfg && (
            <>
              <div className="section-title">
                <h2>실행 모드</h2>
              </div>
              <ul className="readiness-status" style={{ display: "block" }}>
                <Row label="세션 저장소" value={cfg.sessionStore} />
                <Row
                  label="Mock providers"
                  value={cfg.useMockProviders ? "true (모의)" : "false (실제)"}
                />
                <Row
                  label="UI 폴링 간격"
                  value={`${cfg.pollingIntervalMs}ms`}
                />
              </ul>

              <div className="section-title">
                <h2>타임아웃 / 임계값</h2>
              </div>
              <ul className="readiness-status" style={{ display: "block" }}>
                <Row label="Provider" value={secs(cfg.timeouts.providerTimeoutMs)} />
                <Row label="Round" value={secs(cfg.timeouts.roundTimeoutMs)} />
                <Row
                  label="Synthesis"
                  value={secs(cfg.timeouts.synthesisTimeoutMs)}
                />
                <Row label="Session" value={secs(cfg.timeouts.sessionTimeoutMs)} />
                <Row
                  label="최대 재시도"
                  value={`${cfg.timeouts.maxRetries}`}
                />
                <Row
                  label="회의 최소 의견 수"
                  value={`${cfg.thresholds.minOpinionsForMeeting}`}
                />
                <Row
                  label="합성 최소 비판 수"
                  value={`${cfg.thresholds.minCritiquesForSynthesis}`}
                />
              </ul>

              <div className="section-title">
                <h2>기본 모델 체인</h2>
              </div>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ textAlign: "left" }}>
                      <th style={{ padding: 6 }}>Provider</th>
                      <th style={{ padding: 6 }}>역할</th>
                      <th style={{ padding: 6 }}>모델</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(cfg.models).flatMap(([provider, roles]) =>
                      Object.entries(roles).map(([role, model]) => (
                        <tr
                          key={`${provider}-${role}`}
                          style={{ borderTop: "1px solid var(--line, #ddd)" }}
                        >
                          <td style={{ padding: 6 }}>{provider}</td>
                          <td style={{ padding: 6 }}>{role}</td>
                          <td style={{ padding: 6 }}>{model}</td>
                        </tr>
                      )),
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>
    </AppShell>
  );
}
