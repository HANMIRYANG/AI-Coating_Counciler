# 22. Future Code Structure

> **Status: 제안 문서 (미채택).** 아래 `packages/core` / `packages/db` 모노레포
> 분리 구조는 **초기 제안일 뿐 현재 코드에는 적용되지 않았습니다.** 실제 구현은
> 단일 Next.js 앱(`apps/web`)에 집중되어 있습니다.
>
> 실제 위치 매핑:
> - 오케스트레이터 / 실행 / 타임아웃 → `apps/web/src/lib/council/`
>   (`orchestrator.ts`, `timeout.ts`, `rateLimiter.ts`)
> - provider 어댑터 → `apps/web/src/lib/council/providers/`
>   (`openai.ts`, `anthropic.ts`, `gemini.ts`, `mock.ts`, 인터페이스 `provider.ts`)
> - 스키마 → `apps/web/src/lib/council/schemas.ts` (단일 파일, Zod)
> - safety guard → `apps/web/src/lib/council/safety.ts`
> - Prisma → `apps/web/prisma/`
>
> `packages/core` 추출은 멀티 앱/패키지 재사용이 필요해질 때 재검토할 **향후
> 리팩토링 후보**입니다. 아래 트리는 그 시점의 참고용으로만 보존합니다.

Claude Code가 (멀티 패키지로) 실제 구현을 분리한다면 다음 구조를 추천합니다.

```text
apps/
  web/
    src/
      app/
        api/
          council-sessions/
        council/
          [sessionId]/
      components/
        council/
        design/
        ui/
      lib/
        api/
        utils/
packages/
  core/
    src/
      orchestrator/
      providers/
      schemas/
      safety/
      execution/
  db/
    prisma/
```

## 핵심 파일 후보

```text
packages/core/src/orchestrator/CouncilOrchestrator.ts
packages/core/src/execution/ProviderExecutionService.ts
packages/core/src/execution/withTimeout.ts
packages/core/src/providers/AiProviderAdapter.ts
packages/core/src/providers/OpenAIProvider.ts
packages/core/src/providers/AnthropicProvider.ts
packages/core/src/providers/GeminiProvider.ts
packages/core/src/providers/MockProvider.ts
packages/core/src/safety/DomainSafetyGuard.ts
packages/core/src/schemas/providerOpinion.schema.ts
packages/core/src/schemas/providerCritique.schema.ts
packages/core/src/schemas/finalAnswer.schema.ts
```
