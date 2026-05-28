# 08. Data Model

> **상태 (2026-05-28)**: Prisma schema 는 in-memory `SessionStore` record
> 모양과 **alignment 완료** 이며, **`PrismaSessionStore` 도 구현 완료**
> (`apps/web/src/lib/council/prismaSessionStore.ts`). 런타임은 dual-mode —
> `SESSION_STORE` 환경 변수로 선택합니다. **기본값은 `memory`** 이며,
> `prisma` 로 전환하려면 `.env` 에 `SESSION_STORE=prisma` 를 설정하고 아래
> "활성화 절차" 를 수행해야 합니다.
>
> `FinalAnswer` 의 `followUpQuestions` / `providerSummary` / `sessionStatus`
> 3 필드는 마이그레이션 `20260528120000_add_final_answer_extras` 부터
> Prisma 에서도 round-trip 됩니다. 그 이전 스키마로 운영 중이라면 마이
> 그레이션을 먼저 적용해야 합니다.

## 런타임 backend 선택

| `SESSION_STORE` | 구현 | 용도 |
|---|---|---|
| `memory` (기본) | `MemorySessionStore` (`store.ts`) | 단일 프로세스 dev / mock 데모. 재시작 시 휘발. |
| `prisma` | `PrismaSessionStore` (`prismaSessionStore.ts`) | 영속화. multi-worker / multi-process 배포에 필수. |

`store.ts` 는 `@prisma/client` 를 정적 import 하지 않습니다.
`getOrCreateGlobalStore()` 가 `SESSION_STORE=prisma` 일 때만 `require()` 로
Prisma 백엔드를 lazy load — memory 전용 경로의 번들에 Prisma 가 포함되지 않습니다.

## 런타임 vs 영속 layer 매핑

| 항목 | 런타임 record | Prisma model |
|---|---|---|
| Session record | `SessionRecord` | `CouncilSession` |
| Round 1 / 2 출력 | `session.opinions[]`, `session.critiques[]` | `AgentResponse`, `AgentCritique` (parsedResponse Json) |
| Synthesis 결과 | `session.finalAnswer` | `FinalAnswer` (revisionNumber per row) |
| 라운드별 provider 요약 | `session.providerCalls[]` | `ProviderCallLog` (unique sessionId+providerId+round) |
| **per-attempt forensic log** | `session.attempts[]` | `ProviderAttemptLog` (append-only, fire-and-forget) |
| 인용 evidence (Phase 2) | — | `Document`, `DocumentChunk` (placeholder) |

## 활성화 절차

```bash
# repo root
docker compose up -d

# apps/web
npx prisma migrate dev --name init_council
npx prisma generate

# .env.local
SESSION_STORE=prisma
```

PrismaSessionStore 의 `appendAttempt` 는 fire-and-forget 으로 호출됩니다 —
forensic 로그 쓰기 실패가 orchestrator 진행을 막지 않도록 의도된 설계입니다.

---

## Prisma Model

```prisma
model CouncilSession {
  id               String   @id @default(cuid())
  userPrompt       String   @db.Text
  normalizedPrompt String?  @db.Text
  taskType         String
  evidenceMode     String   @default("ai_only")
  status           String
  currentRound     String?
  riskLevel        String?
  confidenceScore  Float?
  createdAt        DateTime @default(now())
  startedAt        DateTime?
  completedAt      DateTime?
  deadlineAt       DateTime
  updatedAt        DateTime @updatedAt
  errorMessage     String?

  agentResponses      AgentResponse[]
  agentCritiques      AgentCritique[]
  finalAnswers        FinalAnswer[]
  providerCallLogs    ProviderCallLog[]
  providerAttemptLogs ProviderAttemptLog[]

  @@index([createdAt])    // recent-session list
  @@index([status])
  @@index([taskType])
}

model ProviderCallLog {
  id             String    @id @default(cuid())
  sessionId      String
  providerId     String
  round          String
  status         String     // pending | running | succeeded | failed |
                            // timed_out | schema_invalid | cancelled |
                            // rate_limited
  startedAt      DateTime?
  endedAt        DateTime?
  latencyMs      Int?
  timeoutMs      Int?
  retryCount     Int       @default(0)
  errorType      String?
  errorMessage   String?
  modelRequested String?
  modelUsed      String?
  rateLimited    Boolean   @default(false)
  rawResponse    String?   @db.Text   // debug payload — gated by admin
  parsedResponse Json?                 // debug payload — gated by admin
  createdAt      DateTime  @default(now())

  session CouncilSession @relation(fields: [sessionId], references: [id], onDelete: Cascade)

  @@index([sessionId])
  @@index([providerId, round])
  @@index([status])
  @@unique([sessionId, providerId, round])  // upsert key
}

model ProviderAttemptLog {
  id           String   @id @default(cuid())
  sessionId    String
  providerId   String
  round        String
  model        String
  attemptIndex Int
  chainIndex   Int
  status       String
  startedAt    DateTime
  endedAt      DateTime
  latencyMs    Int
  timeoutMs    Int
  errorType    String?
  errorMessage String?
  retryAfterMs Int?
  rateLimited  Boolean  @default(false)
  createdAt    DateTime @default(now())

  session CouncilSession @relation(fields: [sessionId], references: [id], onDelete: Cascade)

  @@index([sessionId])
  @@index([sessionId, providerId, round])
  @@index([providerId, round, status])
  @@index([status])
}
```

`AgentResponse` / `AgentCritique` / `FinalAnswer` / `Document` /
`DocumentChunk` 는 기존과 동일한 의도로 유지됩니다. 전체 정의는
`apps/web/prisma/schema.prisma` 를 보세요.

---

## ProviderCallLog vs ProviderAttemptLog

`ProviderCallLog` 는 **(session, provider, round) 단위 요약** 입니다.
하나의 row 는 한 round 의 최종 outcome 만 가지고 있으며,
`(sessionId, providerId, round)` 는 unique 입니다 — 미래의
`PrismaSessionStore` 가 upsert 로 갱신할 수 있습니다.

`ProviderAttemptLog` 는 **try 단위 forensic 로그** 입니다. limiter 내부
의 429 retry 와 orchestrator 의 chain hop 모두 별도 row 로 기록됩니다.
`ProviderCallLog` 가 "openai/round=initial 의 결과는 무엇이었는가" 를
설명한다면, `ProviderAttemptLog` 는 "그 결과에 도달하기 위해 어떤 시도
들이 있었는가" 를 설명합니다.

`ProviderAttemptLog` 는 **admin / debug payload** 입니다. 공개 요약
endpoint (`GET /api/council-sessions`) 에는 절대 노출되지 않으며,
session 별 debug 조회 (`GET /api/council-sessions/:id?debug=1`) 에서
admin token 인증을 통과한 경우에만 노출됩니다.

---

## Status 값

### `CouncilSession.status`

```text
created
preparing
round1_running
round1_completed
round1_partial
round1_limited
round2_running
round2_completed
round2_partial
round2_limited
synthesis_running
completed
partial_completed
limited_answer
failed
timed_out
```

### Provider call / attempt status

```text
pending
running
succeeded
failed
timed_out
schema_invalid
cancelled
rate_limited
```

---

## raw / parsed response 처리

- `ProviderCallLog.rawResponse` 와 `parsedResponse` 는 **`schema_invalid`
  로 끝난 호출에만** 채워집니다 (LLM 이 valid JSON 을 반환했으나 Zod
  schema 를 통과하지 못한 경우).
- 공개 API 응답에는 **절대 포함되지 않습니다**. `?debug=1` 쿼리 + admin
  token 인증이 일치할 때에만 노출됩니다.
- 운영 배포 시 이 payload 를 별도 로그 sink (PII redaction 적용)로
  옮기는 것을 검토하세요.

---

## 구현 상태 체크리스트 (완료)

- [x] `PrismaSessionStore` (`apps/web/src/lib/council/prismaSessionStore.ts`)
      `SessionStore` interface 그대로 구현.
- [x] `getSessionStore()` 가 `SESSION_STORE=prisma` 일 때 Prisma 백엔드를
      lazy require 로 반환 (`store.ts: getOrCreateGlobalStore`).
- [x] `upsertProviderCall` 은 `(sessionId, providerId, round)` compound
      unique 키를 사용한 Prisma `upsert`.
- [x] `appendAttempt` 는 append-only `create` + fire-and-forget (await
      안 함). DB latency 가 orchestrator 진행을 막지 않습니다.
- [x] `PrismaClient` 싱글턴 (`apps/web/src/lib/db.ts`) — Next.js dev
      hot-reload 시 connection leak 방지를 위한 globalThis 캐싱.
- [x] Contract test (`prisma_schema_contract.test.ts`) 가 dual-mode 와
      fire-and-forget 패턴을 텍스트로 검증.

## 운영 도입 전 확인 사항

1. `docker compose up -d` 가 PostgreSQL 16 컨테이너를 띄우는지.
2. `npx prisma migrate dev --name init_council` 로 schema 가 DB 에 반영
   되었는지.
3. `npx prisma generate` 후 `@prisma/client` 가 갱신되었는지.
4. 부하 테스트에서 `appendAttempt` 가 백그라운드로 누적되는 동안
   orchestrator latency 가 영향받지 않는지.
5. `ProviderAttemptLog` 가 공개 요약 API 에 노출되지 않는지 (whitelist +
   blocklist 테스트로 보장됨).
6. `ADMIN_DEBUG_TOKEN` 이 prod 에 설정되어 있는지 (`?debug=1` 보호용).
