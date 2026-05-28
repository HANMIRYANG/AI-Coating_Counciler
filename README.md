# ai-coating-council-starter

기능성 특수 페인트/코팅제 제조사를 위한 **3-AI 기술검토 회의형 스타터 프로젝트**입니다.

이 저장소는 Claude Code가 바로 읽고 구현을 시작할 수 있도록 만든 문서형 스타터입니다.  
핵심 목표는 Gemini 단독 사용 시 발생하는 할루시네이션을 줄이고, **Gemini + Claude + GPT가 각자 독립 의견을 낸 뒤 다시 회의/상호비판을 거쳐 최종 답변을 생성**하는 것입니다.

---

## 핵심 설계 원칙

1. **한 번에 최종 답변을 내지 않는다.**
   - Round 1: Gemini / Claude / GPT가 사용자 프롬프트에 대해 각자 독립 의견을 생성
   - Round 2: 각 AI의 의견을 다시 호출하여 상호비판/회의
   - Round 3: 최종 의장/합성 단계에서 근거 기반 합의안 작성

2. **AI 호출은 병렬 실행하되, 회의 단계는 라운드 단위로 순차 진행한다.**
   - 같은 라운드 안에서는 Gemini / Claude / GPT를 동시에 호출
   - 다음 라운드는 이전 라운드의 최소 성공 조건을 만족하면 진행

3. **Timeout은 넉넉하게 잡되, 전체가 멈추지 않게 한다.**
   - Provider 개별 timeout
   - 라운드별 timeout
   - 전체 세션 timeout
   - 부분 완료 허용
   - 늦게 도착한 AI 응답은 후속 revision으로 반영 가능

4. **최대한 누락 없이 결과를 도출한다.**
   - missingEvidence
   - assumptions
   - unsafePhrases
   - followUpQuestions
   - evidenceBackedClaims
   - unresolvedDisagreements
   를 필수 출력 필드로 둔다.
   - 추가 시험성적서/SDS/TDS 등 필요 자료는 별도 필드가 아니라 `missingEvidence` 한 곳에 통합 기록한다.

5. **특수도료/기능성 코팅제 안전성 도메인 규칙을 강제한다.**
   - 불연/난연/화재방지/폭발방지/인증/법령 관련 단정 표현 금지
   - 시험성적서, SDS, TDS, 도포 두께, 기재, 시험방법이 없으면 확정 답변 금지

---

## 폴더 구조

```text
ai-coating-council-starter/
  README.md
  CLAUDE.md
  .env.example
  docs/
  prompts/
  templates/
  checklists/
  architecture/
  design/
```

---

## VSCode에서 시작하기

1. 이 zip을 압축 해제합니다.
2. VSCode에서 `ai-coating-council-starter` 폴더를 엽니다.
3. Claude Code를 실행합니다.
4. `prompts/01_first_claude_code_prompt.md` 내용을 Claude Code에 붙여넣습니다.
5. 구현 완료 후 Codex에는 `prompts/03_codex_review_prompt.md`와 `prompts/04_codex_timeout_concurrency_review_prompt.md`를 사용합니다.

---

## 가장 먼저 읽을 문서

```text
CLAUDE.md
docs/03_ai_council_workflow.md
docs/04_timeout_and_parallel_execution_policy.md
docs/05_round_based_orchestration.md
docs/21_meeting_state_machine.md
prompts/01_first_claude_code_prompt.md
```

---

## 디자인 반영 방식

Claude Design 산출물은 아래에 보관합니다.

```text
design/claude-design-export/
```

실제 개발 적용 지침은 아래 문서를 따릅니다.

```text
docs/11_claude_design_integration.md
```

---

## MVP 최종 목표

사용자가 다음과 같이 질문했을 때:

```text
HE-850A 방사방열 코팅제를 자동차 배터리팩 외장재에 적용 가능한지 업체에 설명할 답변을 만들어줘.
```

시스템은 다음 흐름을 수행해야 합니다.

```text
1. sessionId 즉시 생성
2. Round 1: Gemini / Claude / GPT 독립 초안 병렬 생성
3. Round 2: 각 AI의 초안을 기반으로 회의/상호비판 재호출
4. Round 3: 최종 합성
5. 근거 있음 / 추정 / 누락 자료 / 위험 표현 / 업체 발송용 문장 분리
6. 사용자가 결과 화면에서 각 AI 의견과 회의 결과를 확인
```

---

## MVP 구현 안내 (apps/web)

이 저장소는 **Next.js App Router 기반의 단일 워크스페이스 앱(`apps/web`)** 으로 구현되어 있습니다.
실제 코드는 모두 `apps/web/src/` 아래에 있으며, 본 README의 위쪽 부분은 설계 의도, 아래는 실제 실행 방법입니다.

### 폴더 구조

```text
apps/web/
  src/
    app/
      page.tsx                          # 메인 입력 화면 (taskType, evidenceMode)
      sessions/[id]/page.tsx            # 세션 결과/진행 상태 화면 (1.5s 폴링)
      api/council-sessions/route.ts     # POST: 세션 생성 + 백그라운드 오케스트레이션 시작
      api/council-sessions/[id]/route.ts            # GET: 상태 조회
      api/council-sessions/[id]/start/route.ts      # POST: 명시적 시작 (idempotent)
    components/council/                 # ProviderCard, RoundTimeline, CritiquePanel, FinalAnswerPanel
    lib/council/
      types.ts                          # 도메인 공통 타입
      schemas.ts                        # Zod 스키마 (ProviderOpinion / Critique / FinalAnswer)
      safety.ts                         # 위험 표현 감지, 권장 대체 표현, riskLevel 계산
      prompts.ts                        # 라운드별 시스템/유저 프롬프트 + JSON 추출
      timeout.ts                        # withTimeout + AbortController 연동
      models.ts                         # 모델 정책 (stable / high-accuracy / fast fallback)
      rateLimiter.ts                    # provider별 동시성/Retry-After/cooldown/health
      orchestrator.ts                   # Round 1/2/3 오케스트레이터 (Promise.allSettled)
      store.ts                          # 세션 저장소 인터페이스 + 기본 인메모리 구현 (SESSION_STORE 로 분기)
      prismaSessionStore.ts             # opt-in Prisma 백엔드 (SESSION_STORE=prisma 일 때 lazy-require)
      provider.ts                       # AiProviderAdapter 인터페이스
      providers/
        index.ts                        # registry: mock vs real 선택
        mock.ts                         # 지연/실패/timeout/hang/rate_limit 시나리오 모킹
        openai.ts / anthropic.ts / gemini.ts
      __tests__/                        # Vitest: timeout / safety / schemas / models / rateLimiter / orchestrator
  prisma/schema.prisma                  # Prisma 모델 정의 (영속화 활성 시 사용)
  prisma/migrations/                    # init_council, add_final_answer_extras 등
```

### 로컬 실행

```bash
# 1. 환경 변수 준비
cp .env.example .env.local

# 2. 의존성 설치 (루트에서 실행 — npm workspaces 가 apps/web 을 잡습니다)
npm install

# 3. Mock 모드로 즉시 실행 (API 키 불필요, USE_MOCK_PROVIDERS=true 기본값)
npm run dev
# → http://localhost:3000

# 4. (옵션) 실제 Provider 호출
#   - .env.local 에 OPENAI_API_KEY / ANTHROPIC_API_KEY / GEMINI_API_KEY 입력
#   - USE_MOCK_PROVIDERS=false 로 변경
#   - 키가 비어 있는 Provider 는 자동으로 mock 으로 대체됩니다

# 5. 테스트 (Vitest)
npm test --workspace apps/web
```

### 필수 환경 변수

`apps/web/.env.local` 또는 저장소 루트 `.env`. `.env.example` 의 전체 목록을 참고하세요.

| 카테고리 | 키 | 설명 |
|---|---|---|
| Provider 키 | `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `GEMINI_API_KEY` | Real 모드에서만 필요. Mock 모드 기본값. |
| 모델 (per-role) | `{PROVIDER}_PRIMARY_MODEL` / `{PROVIDER}_FALLBACK_MODEL` / `{PROVIDER}_FAST_FALLBACK_MODEL` / `{PROVIDER}_HIGH_ACCURACY_MODEL` | 4-role 체인의 각 역할을 개별 override. 빈 값이면 `lib/council/models.ts` stable 기본값. |
| 모델 (legacy) | `OPENAI_MODEL` / `ANTHROPIC_MODEL` / `GEMINI_MODEL` | backward-compat. **primary 만** override 합니다 (highAccuracy / fallback / fastFallback 에는 영향 없음). |
| 모델 정책 | `ALLOW_PREVIEW_MODELS=false` / `ALLOW_EXPERIMENTAL_MODELS=false` / `ALLOW_LATEST_MODELS=false` | 모델명에 `preview` / `experimental` / `latest` 가 **포함되면** 거부됩니다 (substring match). 권장: 모두 false. |
| Timeout | `PROVIDER_TIMEOUT_MS` / `ROUND_TIMEOUT_MS` / `SYNTHESIS_TIMEOUT_MS` / `SESSION_TIMEOUT_MS` | 3-Layer deadline. |
| Rate-limit | `RATE_LIMIT_{OPENAI,ANTHROPIC,GEMINI}_{MAX_CONCURRENT,MAX_RETRIES,BACKOFF_MAX_MS,COOLDOWN_MS}` | Provider 단위 큐 / 백오프 / cooldown. |
| 실행 모드 | `USE_MOCK_PROVIDERS` | `true` (기본) → API 키 없이 동작. |
| Mock 시나리오 | `MOCK_FAIL_PROVIDER` / `MOCK_TIMEOUT_PROVIDER` / `MOCK_HANG_PROVIDER` / `MOCK_RATE_LIMIT_PROVIDER` | 각 provider 별 실패 주입. |

### Round 흐름 요약

```text
POST /api/council-sessions
  → sessionId 즉시 반환 + 백그라운드 오케스트레이터 시작 (await 하지 않음)
     ├── Round 1 (initial)  : Gemini / Claude / GPT 병렬 — Promise.allSettled
     ├── Round 2 (critique) : 동일하게 병렬 비판
     └── Round 3 (synthesis): GPT 우선 → Claude → Gemini fallback → deterministic fallback

  성공 Provider 수
    3 → completed
    2 → partial_completed
    1 → limited_answer  (외부 발송용 답변에 경고 자동 삽입)
    0 → failed
```

UI(`/sessions/[id]`)는 **1.5초 간격으로 폴링**하여 위 상태를 실시간 표시합니다.

### 안전 가드 (도메인 정책)

- 한국어 단정 표현(`완전 방지`, `100% 안전`, `인증 완료` 등)을 정규식 + 화이트스페이스 허용 매칭으로 자동 탐지.
- 최종 답변 텍스트 전체를 다시 스캔하여 발견 시 `unsafePhrases`에 자동 추가하고 `riskLevel`을 격상 (`high`/`critical`).
- 업체 발송용 답변에는 `FINAL_ANSWER_DISCLAIMER_KO` 가 자동 첨부됩니다.
- 1개만 성공한 limited_answer 모드에서는 발송용 답변 상단에 "제한적 검토" 경고가 prepend 됩니다.

### Rate-limit / Model 정책

- 각 Provider 별 `SingleProviderLimiter` 인스턴스가 **동시성 / FIFO 큐 / Retry-After / cooldown / health** 를 관리합니다.
- Provider 가 cooldown 에 진입하면 큐에 대기 중인 모든 작업이 **즉시 rate_limited 로 fail-fast** 되어 회의가 정지되지 않습니다.
- 모델 fallback chain (in-call walk on 429):
  - **default 모드**: `primary → fallback?  → fastFallback`
  - **high_accuracy 모드**: `highAccuracy → primary → fallback? → fastFallback`
  - 동일 모델은 dedup. OpenAI 처럼 `highAccuracy === primary` 인 경우 head 가 자연스럽게 collapse 됩니다.
- 화재/배터리/인증/SDS 등 위험 키워드가 포함된 프롬프트는 자동으로 **high-accuracy 체인**으로 escalate 됩니다 (`lib/council/models.ts: inferAccuracyMode`). legacy `OPENAI_MODEL` / `ANTHROPIC_MODEL` / `GEMINI_MODEL` env 가 설정되어 있어도 high-accuracy head 는 영향을 받지 않습니다 (별도 `*_HIGH_ACCURACY_MODEL` 키 사용).
- 모델명에 `preview`, `experimental`, `latest` 가 **포함되면 (substring match)** 운영 모드에서 거부됩니다. 의도적 사용은 `ALLOW_PREVIEW_MODELS=true` / `ALLOW_EXPERIMENTAL_MODELS=true` / `ALLOW_LATEST_MODELS=true` 로 opt-in (latest 는 권장하지 않음).

### 테스트 (apps/web/src/lib/council/__tests__/)

| 파일 | 검증 항목 |
|---|---|
| `timeout.test.ts` | withTimeout, AbortSignal 전파 |
| `safety.test.ts` | 위험 표현 감지, riskLevel 계산 |
| `schemas.test.ts` | ProviderOpinion / FinalAnswer / 요청 Zod 검증 |
| `models.test.ts` | 모델 정책 (preview/experimental/latest 차단), high-accuracy 라우팅, fallback chain |
| `rateLimiter.test.ts` | 동시성 cap, Retry-After 백오프, cooldown fail-fast, 회복, 메트릭 |
| `orchestrator.test.ts` | 병렬 실행 (wall-clock < sum), hang 비차단, partial_completed, limited_answer, all-fail, 429 격리 |
| `attempts.test.ts` | 모든 hop / retry 가 attempt 로그에 기록; debug 엔드포인트 admin token 인증; 영문 high-risk 키워드 case-insensitive escalation |
| `real_provider_smoke.test.ts` | 실제 API 호출 smoke (`REAL_PROVIDER_SMOKE=true` 일 때만 실행) |

### Claude Design 통합

- 원본은 `design/claude-design-export/` (수정 금지, 참고 전용).
- 1차 구현은 기능 우선 UI. 색상/타이포는 Pretendard + navy 톤으로 디자인 시스템 일부만 가져왔습니다.
- 추후 컴포넌트 통합 시 `apps/web/src/components/design/` 에 분리하여 비즈니스 로직과 격리하세요.

### 알려진 제한 사항 (MVP)

1. **저장소는 dual-mode 입니다.**
   - 기본값 (`SESSION_STORE=memory`) — `MemorySessionStore`. 프로세스가 재시작되면 세션이 사라집니다. 단일 Node 프로세스 dev / mock 데모 용도.
   - opt-in (`SESSION_STORE=prisma`) — `PrismaSessionStore` (`apps/web/src/lib/council/prismaSessionStore.ts`). 영속화. multi-worker / multi-process 배포에 반드시 필요.
   - **활성화 절차:**
     ```bash
     docker compose up -d                              # repo root, PostgreSQL 16
     cd apps/web && npx prisma migrate dev --name init_council
     npx prisma generate
     # then set SESSION_STORE=prisma in .env.local
     ```
   - `store.ts` 는 `@prisma/client` 를 **정적 import 하지 않습니다.** Prisma 백엔드는 `selectedBackend()` 가 `"prisma"` 를 반환할 때만 lazy require 됩니다 — memory 전용 경로의 번들 크기는 영향 없음.
   - `appendAttempt` (forensic log) 는 fire-and-forget. DB latency 가 orchestrator 를 막지 않도록 의도된 설계입니다.
   - `ProviderAttemptLog` 는 admin/debug 관찰성용입니다. 공개 요약 API (`GET /api/council-sessions`) 에는 절대 노출되지 않습니다 (whitelist + blocklist 테스트로 보장됨).
   - 자세한 schema 매핑은 `docs/08_data_model.md`.
2. **RAG (내부 기술자료/시험성적서) 는 placeholder.** evidenceMode `internal_docs` / `internal_docs_web` 은 UI 에 disabled 로 노출되어 있습니다.
   - 외부 공식 출처 (KOLAS/KATS, KCL, KTR, KTC, FITI, KATRI, KOTITI, KFI, KICT 등) 자동 조회는 아직 구현되지 않았습니다.
   - source catalog 및 RAG retrieval 은 Phase 2 로 계획되어 있습니다. 세부 사항: `docs/23_ideation_and_evidence_source_strategy.md`.
   - 위 기관 목록은 시드 (seed) 일 뿐, 각 기관이 모든 시험 항목에 대해 자동으로 유효한 인증을 발급하는 것은 아닙니다. **운영 도입 전, 각 기관의 인증 범위와 시험 방법을 KOLAS/KATS 또는 해당 기관 공식 채널로 직접 확인하세요.**
3. **SSE / WebSocket 미구현.** UI 폴링 (1.5s). 운영 환경 도입 시 SSE 권장.
4. **Provider 호출 진행률이 줄어들지 않습니다.** 진행 중 latency 는 종료 후에만 latencyMs 로 표시.
5. **Late-arriving response 저장 미구현.** revisionNumber 필드는 schema 에만 존재.
6. **실 API 비용 테스트는 mock 모드에서 검증한 흐름을 그대로 사용합니다.** 실제 모델 응답 JSON 형식이 schema 와 다르면 `schema_invalid` 로 분류되어 자동 제외됩니다.
7. **Provider 메트릭은 in-memory listener 기반입니다.** `SingleProviderLimiter.onMetric(...)` 으로 dispatch 되며 별도 메트릭 sink (Prometheus / OpenTelemetry / Datadog 등) 와 연결되어 있지 않습니다. UI 에는 health 상태만 노출됩니다. 운영 도입 시 listener 를 telemetry exporter 에 연결해야 alert / dashboard 가 가능합니다.
8. **debug payload (`rawResponse`, `parsedResponse`, `attempts[]`) 은 `?debug=1` 쿼리 파라미터로만 노출됩니다.** 보호 정책:
   - `ADMIN_DEBUG_TOKEN` 환경 변수가 설정되어 있으면 `x-admin-debug-token` 헤더가 반드시 일치해야 합니다 (운영 권장).
   - 설정되지 않은 경우 `NODE_ENV !== "production"` 일 때만 허용 (개발 기본값).
   - 운영 배포 시에는 반드시 token 을 설정하고, 추가로 admin role / session 으로 보호하세요.
9. **실 API 비용을 검증하는 smoke 테스트는 opt-in 입니다.** `REAL_PROVIDER_SMOKE=true` 와 해당 API 키가 모두 설정되어 있을 때만 `real_provider_smoke.test.ts` 가 실행됩니다. CI 환경에서 키가 없으면 자동으로 skip 됩니다.

### Codex 리뷰 우선 항목

- `lib/council/orchestrator.ts` 의 deadline 누적 / round 잔여 시간 계산이 모든 분기에서 안전한지.
- `lib/council/rateLimiter.ts` 의 queue 폐기 (`rejectQueuedWithRateLimit`) 가 동시 호출 시 race-free 인지.
- 429 → fallback chain 시 cooldown 이 두 hop 모두에 동일하게 적용되는지 (현재는 fail-fast 의도).
- `applySafetyGuard` 가 모델이 반환한 unsafePhrases 와 정규식 탐지 결과를 중복 없이 머지하는지.
- `prompts.ts` 의 `extractJsonObject` 가 실제 모델 출력 (코드펜스 / 후행 콤마 / 한국어 escape) 을 충분히 견디는지.
- 멀티 워커/멀티 프로세스 배포 시 in-memory 저장소 한계 (반드시 Prisma 로 전환 필요).
