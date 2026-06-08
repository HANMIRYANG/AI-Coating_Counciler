# Development Checklist

> **상태 (2026-06-08):** Phase 1 MVP + Phase 2(문서/RAG/근거/인용) 기반이 모두
> 구현되어 단위 테스트 568개가 통과한다. 아래 체크는 그 현실을 반영한다.
> 미체크 항목은 의도적으로 다른 선택을 했거나(예: shadcn/ui 대신 Claude Design)
> 후속 Phase 로 미룬 것이다.

## Initial Setup

- [x] Next.js App Router 생성
- [x] TypeScript 설정
- [x] Tailwind 설정
- [ ] shadcn/ui 설정 — **대신 Claude Design export (`components/design/`) 사용**
- [x] Prisma 설정 (`prisma/schema.prisma` + migrations)
- [x] PostgreSQL 연결 (docker-compose / Neon, `SESSION_STORE=prisma`)
- [x] .env.example 반영

## Backend

- [x] Provider Adapter interface (`provider.ts`)
- [x] OpenAI provider
- [x] Anthropic provider
- [x] Gemini provider
- [x] Mock provider (지연/실패/timeout/hang/rate_limit 시나리오)
- [x] withTimeout utility (+ AbortController 연동)
- [x] ProviderExecutionService (`orchestrator.ts: runProvider` — fallback chain / rate limiter)
- [x] CouncilOrchestrator (Round 1/2/3 + quorum grace + partial completion)
- [x] SafetyGuard (`safety.ts` + `applySafetyGuard`/ideation/checklist 변형)
- [x] Zod schemas (`schemas.ts`)
- [x] API routes (council-sessions / documents / evidence-sources)

## Frontend

- [x] Prompt input
- [x] Task type selector (8종)
- [x] Round progress timeline (`RoundTimeline`)
- [x] Provider opinion cards (`ProviderCard`)
- [x] Critique cards (`CritiquePanel`)
- [x] Final answer panel (`FinalAnswerPanel`)
- [x] Missing evidence panel (`EvidencePanel` / `FinalEvidenceCoveragePanel`)
- [x] Unsafe phrase panel (`RiskPhrasePanel`)

## Tests

- [x] Parallel execution test (`orchestrator.test.ts`)
- [x] One provider timeout test
- [x] Partial completion test
- [x] Dangerous phrase test (`safety.test.ts`)
- [x] Schema validation test (`schemas.test.ts`)
