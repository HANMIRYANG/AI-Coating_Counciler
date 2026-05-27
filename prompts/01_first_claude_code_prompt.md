# First Claude Code Prompt

You are Claude Code working inside VSCode.

Project name:
ai-coating-council-starter

Goal:
Build a TypeScript full-stack MVP for a B2B AI technical review system for a functional/special paint and coating manufacturer.

The system must not generate a final answer in one call.
It must use a round-based AI council workflow:

Round 1:
Gemini, Claude, and GPT each produce independent opinions about the user's prompt.

Round 2:
Gemini, Claude, and GPT are called again. They review the Round 1 opinions, critique unsupported claims, identify missing evidence, detect unsafe phrases, and propose safer wording.

Round 3:
A final synthesis step produces the final answer using Round 1 opinions and Round 2 critiques.

Critical performance requirement:
Inside each round, Gemini, Claude, and GPT must run in true parallel. Do not call them sequentially.

Required timeout behavior:
- Each provider has its own timeout.
- Each round has a timeout.
- The whole session has a timeout.
- One provider timing out must not fail the whole session.
- If two providers succeed, proceed to the next round.
- If only one provider succeeds, produce a limited answer with clear warning.
- If all providers fail, mark the session failed with useful error messaging.

Recommended timeout values:
- PROVIDER_TIMEOUT_MS=90000
- ROUND_TIMEOUT_MS=120000
- SYNTHESIS_TIMEOUT_MS=90000
- SESSION_TIMEOUT_MS=240000
- MAX_PROVIDER_RETRIES=1

Required stack:
- Next.js App Router
- TypeScript
- Tailwind CSS
- shadcn/ui
- Prisma
- PostgreSQL
- Zod
- OpenAI SDK
- Anthropic SDK
- Google GenAI SDK
- Mock providers for local development

Before coding:
Read these files carefully:
- README.md
- CLAUDE.md
- docs/03_ai_council_workflow.md
- docs/04_timeout_and_parallel_execution_policy.md
- docs/05_round_based_orchestration.md
- docs/06_system_architecture.md
- docs/07_provider_adapter_design.md
- docs/08_data_model.md
- docs/12_domain_safety_policy.md
- docs/16_testing_and_validation_plan.md
- docs/21_meeting_state_machine.md

Implementation requirements:
1. Create a Next.js application structure.
2. Implement Prisma schema for:
   - CouncilSession
   - AgentResponse
   - AgentCritique
   - FinalAnswer
   - ProviderCallLog
   - Document
   - DocumentChunk
3. Implement Provider Adapter interface:
   - generateInitialOpinion()
   - generateCritique()
   - generateSynthesis(), optional
4. Implement adapters:
   - OpenAI provider
   - Anthropic provider
   - Gemini provider
   - Mock provider
5. Implement CouncilOrchestrator:
   - prepareSession()
   - runInitialOpinionRound()
   - runCritiqueRound()
   - runSynthesisRound()
   - applySafetyGuard()
6. Implement ProviderExecutionService:
   - executeProviderWithTimeout()
   - executeRoundInParallel()
   - normalizeProviderError()
   - saveProviderCallLog()
7. Use Promise.allSettled or equivalent safe parallel execution.
8. Implement withTimeout utility.
9. Add provider status tracking:
   - pending
   - running
   - succeeded
   - failed
   - timed_out
   - schema_invalid
10. Add API routes:
   - POST /api/council-sessions
   - GET /api/council-sessions/:id
   - GET /api/council-sessions/:id/final-answer
11. Add polling UI.
12. Add result page with:
   - Round 1 AI opinions
   - Round 2 meeting critiques
   - Final answer
   - Missing evidence
   - Unsafe phrases
   - Risk level
   - Confidence score
13. Add tests using mock providers with artificial delay to prove providers run concurrently.

Domain safety:
This app is for functional coatings and special paints. The final answer must not make unsupported claims about:
- flameproofing
- fire prevention
- battery fire prevention
- explosion prevention
- chemical safety
- certifications
- legal compliance
- universal substrate applicability
- permanent performance

Dangerous phrases:
- 완전 방지
- 100% 안전
- 불에 타지 않음
- 화재를 막음
- 폭발 방지
- 열폭주 방지
- 인증 완료
- 법적으로 문제 없음
- 모든 소재 적용 가능
- 반영구적

Safer alternatives:
- 특정 시험 조건에서 확인 필요
- 화염 확산 지연 가능성
- 기재 보호 보조 효과
- 추가 시험 필요
- 인증기관 확인 필요
- 도포 조건에 따라 성능 상이

Design note:
The visual design will be provided later through Claude Design.
For now, implement a clean functional UI and keep design tokens/components modular.
Claude Design outputs will be placed under:
design/claude-design-export/

Deliverables:
- Working MVP skeleton
- README with setup
- .env.example
- Prisma schema
- API routes
- Mock provider mode
- Tests for timeout and parallel execution
