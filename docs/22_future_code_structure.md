# 22. Future Code Structure

Claude Code가 실제 구현을 시작하면 다음 구조를 추천합니다.

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
