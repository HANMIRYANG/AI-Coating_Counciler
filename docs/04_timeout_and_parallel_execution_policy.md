# 04. Timeout and Parallel Execution Policy

## 목표

AI Provider가 느리거나 실패해도 전체 시스템이 멈추지 않게 합니다.  
동시에, 너무 짧은 timeout으로 인해 답변 누락이 생기지 않도록 넉넉한 시간을 제공합니다.

---

## 기본 Timeout 값

MVP 권장값:

```text
PROVIDER_TIMEOUT_MS=90000
ROUND_TIMEOUT_MS=120000
SYNTHESIS_TIMEOUT_MS=90000
SESSION_TIMEOUT_MS=240000
MAX_PROVIDER_RETRIES=1
```

운영 환경에서 더 넉넉하게 잡을 경우:

```text
PROVIDER_TIMEOUT_MS=120000
ROUND_TIMEOUT_MS=150000
SYNTHESIS_TIMEOUT_MS=120000
SESSION_TIMEOUT_MS=300000
MAX_PROVIDER_RETRIES=1
```

---

## 병렬 실행 원칙

같은 Round 안에서는 Gemini, Claude, GPT를 반드시 동시에 실행합니다.

### 금지 코드

```ts
const gemini = await geminiProvider.generateOpinion(input);
const claude = await claudeProvider.generateOpinion(input);
const openai = await openaiProvider.generateOpinion(input);
```

### 권장 코드

```ts
const results = await Promise.allSettled([
  runProviderWithTimeout("gemini", input),
  runProviderWithTimeout("claude", input),
  runProviderWithTimeout("openai", input),
]);
```

---

## 왜 Promise.allSettled인가

`Promise.all`은 하나의 Provider가 실패하면 전체가 reject될 수 있습니다.  
이 시스템은 Provider 하나의 실패가 전체 실패로 이어지면 안 됩니다.

따라서 다음 정보를 Provider별로 저장합니다.

```text
pending
running
succeeded
failed
timed_out
cancelled
```

---

## Timeout 계층

### 1. Provider Timeout

개별 AI 호출 제한 시간입니다.

```text
Gemini: 90초
Claude: 90초
GPT: 90초
```

### 2. Round Timeout

Round 전체 제한 시간입니다.

```text
Round 1: 120초
Round 2: 120초
Round 3: 90초
```

### 3. Session Timeout

전체 회의 세션 제한 시간입니다.

```text
전체: 240초
```

---

## Partial Completion 정책

```text
3개 Provider 성공:
- status = completed
- confidence 계산 시 정상 반영

2개 Provider 성공:
- status = partial_completed
- 최종 합성 진행
- 누락 Provider 표시

1개 Provider 성공:
- status = limited_answer
- 최종 답변 가능하나 강한 경고 표시
- “다른 AI 검토가 완료되지 않아 제한적 검토입니다” 문구 포함

0개 Provider 성공:
- status = failed
- 사용자에게 재시도 안내
```

---

## Timeout 이후 늦게 도착한 결과

Provider 호출이 실제로 늦게 완료되었거나, background job이 뒤늦게 결과를 받는 경우:

```text
1. 기존 FinalAnswer를 덮어쓰지 않는다.
2. LateResponse로 저장한다.
3. 사용자가 “후속 검토 반영” 버튼을 누르면 revision 생성.
4. revisionNumber를 증가시킨다.
```

### MVP 구현 상태 (2026-05-28)

- Late Response 큐 및 revision 라우트는 **Phase 2** 로 보류. orchestrator 는 합성 종료 시 그대로 세션을 닫습니다.
- 데이터 모델은 미리 준비되어 있습니다 — `FinalAnswer.revisionNumber` (`apps/web/prisma/schema.prisma`) 가 존재하며, 활성 시 `PrismaSessionStore` 에 `appendLateResponse()` / 새 revision row 작성 로직과 `POST /api/council-sessions/:id/revisions` 엔드포인트를 추가하면 됩니다.
- 따라서 현재 운영에서는 timeout 으로 cancel된 provider가 늦게 회신해도 결과는 폐기됩니다. 인지 필요.

---

## Per-Provider Rate Limiter

> **Source of truth**: `apps/web/src/lib/council/rateLimiter.ts`.

각 Provider 는 **독립된 limiter** 를 갖습니다 — Gemini 쿼터가 막혀도 Claude/GPT 호출은 막히지 않습니다. Limiter 가 cooldown 으로 들어가면 orchestrator 는 해당 provider 의 호출을 `rate_limited` 상태로 마킹하고 나머지 provider 로 세션을 계속 진행합니다.

| 항목 | OpenAI | Anthropic | Gemini |
|---|---|---|---|
| MAX_CONCURRENT | 2 | 2 | 2 |
| BACKOFF_MAX_MS | 8000 | 8000 | 8000 |
| MAX_RETRIES | 2 | 2 | 2 |
| COOLDOWN_MS | 30000 | 30000 | 30000 |

환경 변수 (`.env.example:131-154`):

```text
RATE_LIMIT_OPENAI_MAX_CONCURRENT / _BACKOFF_MAX_MS / _MAX_RETRIES / _COOLDOWN_MS
RATE_LIMIT_ANTHROPIC_…
RATE_LIMIT_GEMINI_…
```

### 동작 요약

1. 호출 직전 limiter 가 동시성 슬롯을 잡습니다 (`MAX_CONCURRENT` 초과 시 큐).
2. SDK 가 429/quota 에러를 던지면 → `markRateLimited(provider, { retryAfterMs })`. limiter 가 `COOLDOWN_MS` (또는 `Retry-After` 헤더가 더 길면 그 값) 동안 cool down.
3. cool down 중에는 해당 provider 의 모든 시도가 즉시 `rate_limited` 로 실패. orchestrator 는 partial completion 분류에 반영.
4. 호출 후 슬롯 반환. health snapshot 은 `GET /api/council-sessions/:id` 응답의 `providerHealth` 에 포함됩니다.

### Partial Completion 분류에 미치는 영향

`rate_limited` 는 별도 상태이지만 partial completion 분류에서는 **실패로 간주** 됩니다 — limiter 가 막힌 provider 는 의견을 내지 못한 것과 같기 때문입니다. 따라서 3개 중 1개가 rate_limited 라면 결과는 `partial_completed` 가 됩니다.

---

## Retry 정책

Retry는 timeout을 줄이는 것이 아니라 오히려 늘릴 수 있습니다.

따라서 MVP에서는 다음으로 제한합니다.

```text
429 또는 5xx:
- 최대 1회 재시도
- 1.2초~5초 jitter backoff

4xx:
- 재시도 금지

timeout:
- 기본 재시도 금지 또는 1회까지만 허용
```

---

## UI 표시 정책

UI는 사용자가 멈춘 것으로 느끼지 않도록 Provider별 상태를 표시해야 합니다.

```text
Gemini: 의견 작성 중...
Claude: 완료
GPT: timeout - 부분 검토에서 제외됨
회의 단계: Claude/GPT 의견 기반으로 진행 중
최종 답변: 생성 중
```

---

## API Route 정책

긴 AI 호출을 하나의 request/response 안에서 모두 기다리지 않습니다.

권장 구조:

```text
POST /api/council-sessions
→ sessionId 즉시 반환

POST /api/council-sessions/:id/start
→ background execution 시작

GET /api/council-sessions/:id
→ 현재 상태 조회

GET /api/council-sessions/:id/events
→ SSE, 선택
```

MVP에서는 `POST /api/council-sessions`가 sessionId를 반환하고 내부에서 job을 enqueue하는 구조가 좋습니다.
