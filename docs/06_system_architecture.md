# 06. System Architecture

## 개요

```text
Frontend
  ↓
API Layer
  ↓
Council Orchestrator
  ↓
Provider Execution Service
  ↓
Gemini / Claude / GPT Adapters
  ↓
Database
```

---

## 주요 컴포넌트

### Frontend

- Prompt input
- Task type selector
- Session progress view
- Provider opinion cards
- Meeting critique cards
- Final answer panel
- Risk/missing evidence panel

### API Layer

- Session 생성
- Session 상태 조회
- 결과 조회
- 재시도 요청
- revision 생성, Phase 2

### CouncilOrchestrator

라운드 진행을 책임집니다.

```text
prepareSession()
runInitialOpinionRound()
runCritiqueRound()
runSynthesisRound()
applySafetyGuard()
completeSession()
```

### ProviderExecutionService

Provider 실행을 책임집니다.

```text
executeProviderWithTimeout()
executeRoundInParallel()
normalizeProviderError()
saveProviderCallLog()
```

### Provider Adapters

공통 인터페이스:

```ts
interface AiProviderAdapter {
  id: ProviderId;
  generateInitialOpinion(input: InitialOpinionInput): Promise<ProviderOpinion>;
  generateCritique(input: CritiqueInput): Promise<ProviderCritique>;
  generateSynthesis?(input: SynthesisInput): Promise<FinalAnswer>;
}
```

### SafetyGuard

특수도료 도메인 안전성 검사를 담당합니다.

```text
- unsafe phrase detection
- unsupported claim detection
- certification/legal disclaimer insertion
- missing evidence enforcement
```

---

## Recommended Runtime Strategy

### MVP

```text
In-process background execution
Polling every 1.5s
Mock provider mode
```

### Production

```text
BullMQ + Redis worker
SSE or WebSocket
Separate AI worker process
Job cancellation
Late response revision
```
