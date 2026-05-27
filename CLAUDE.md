# CLAUDE.md

이 파일은 Claude Code가 이 저장소를 열었을 때 반드시 따라야 하는 개발 지침입니다.

---

## Project

**ai-coating-council-starter**

기능성 특수 페인트/코팅제 제조사를 위한 AI 회의형 기술검토 시스템입니다.

---

## Non-negotiable Requirements

### 1. Round-based AI Council

최종 답변을 한 번에 만들지 마세요.

반드시 아래 구조를 구현하세요.

```text
Round 1: Independent Provider Opinions
Round 2: Cross Critique / Meeting
Round 3: Final Synthesis
```

### 2. Parallel Execution Inside Each Round

같은 Round 안에서는 Gemini, Claude, GPT 호출이 병렬로 실행되어야 합니다.

나쁜 예:

```ts
const gemini = await callGemini();
const claude = await callClaude();
const gpt = await callOpenAI();
```

좋은 예:

```ts
const results = await Promise.allSettled([
  runProvider("gemini"),
  runProvider("claude"),
  runProvider("openai"),
]);
```

단, 실제 구현에서는 provider별 timeout, retry, logging, status persistence를 포함해야 합니다.

### 3. Timeout Policy

기본값은 `.env.example`에 정의합니다.

권장값:

```text
PROVIDER_TIMEOUT_MS=90000
ROUND_TIMEOUT_MS=120000
SESSION_TIMEOUT_MS=240000
SYNTHESIS_TIMEOUT_MS=90000
MAX_PROVIDER_RETRIES=1
```

### 4. Partial Completion

- 3개 성공: complete
- 2개 성공: partial_completed, 최종 합성 진행
- 1개 성공: limited_answer, 강한 경고 포함
- 0개 성공: failed

### 5. Domain Safety

불연, 난연, 화재 방지, 폭발 방지, 인증, 법령 준수 관련 표현은 단정하지 않습니다.

반드시 아래를 구분하세요.

```text
evidenceBackedClaims
assumptions
missingEvidence
unsafePhrases
recommendedSafeWording
```

> 필요한 추가 자료(시험성적서/SDS/TDS 등)는 `missingEvidence` 한 필드로 통합 기록합니다. 별도의 `neededDocuments` 필드는 사용하지 않습니다.

---

## Recommended Stack

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
- BullMQ or lightweight in-process worker for MVP

---

## Design Integration

Claude Design 산출물은 `design/claude-design-export/`에 들어옵니다.

초기 구현에서는 기능 중심 UI를 만들고, 이후 Claude Design 기준으로 다음 경로에 컴포넌트를 정리하세요.

```text
apps/web/src/components/design/
apps/web/public/design-reference/
```
