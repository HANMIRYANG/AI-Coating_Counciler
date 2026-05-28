# 07. Provider Adapter Design

## Provider Adapter의 목적

OpenAI, Anthropic, Gemini API 차이를 숨기고, Orchestrator는 동일한 인터페이스만 사용하게 합니다.

---

## Provider IDs

```ts
type ProviderId = "gemini" | "anthropic" | "openai";
```

`mock` 은 별도의 클래스(`MockProviderAdapter`)로 존재하지만 `ProviderId` enum 값은 아닙니다. `USE_MOCK_PROVIDERS=true` 일 때 위 3개 ID 자리에 mock 어댑터가 끼워집니다.

---

## 공통 메서드

```ts
interface AiProviderAdapter {
  id: ProviderId;
  displayName: string;

  generateInitialOpinion(
    input: InitialOpinionInput,
    options: ProviderCallOptions
  ): Promise<ProviderOpinion>;

  generateCritique(
    input: CritiqueInput,
    options: ProviderCallOptions
  ): Promise<ProviderCritique>;

  generateSynthesis?(
    input: SynthesisInput,
    options: ProviderCallOptions
  ): Promise<FinalAnswer>;
}
```

---

## ProviderCallOptions

```ts
type ProviderCallOptions = {
  timeoutMs: number;
  retryCount: number;
  abortSignal?: AbortSignal;
  sessionId: string;
  round: "initial" | "critique" | "synthesis";
};
```

---

## ProviderOpinion 필수 필드

```ts
type ProviderOpinion = {
  providerId: ProviderId;
  summary: string;
  technicalAssessment: TechnicalAssessmentItem[];
  evidenceBackedClaims: string[];
  assumptions: string[];
  missingEvidence: string[];
  risks: RiskItem[];
  unsafePhrases: UnsafePhraseItem[];
  recommendedAnswer: string;
  confidenceScore: number;
  followUpQuestions: string[];
};
```

---

## ProviderCritique 필수 필드

```ts
type ProviderCritique = {
  providerId: ProviderId;
  agreements: string[];
  disagreements: string[];
  unsupportedClaims: UnsupportedClaimItem[];
  unsafePhrasesFound: UnsafePhraseItem[];
  missingEvidenceFound: string[];
  recommendedCorrections: string[];
  providerSpecificCritiques: ProviderSpecificCritique[];
  confidenceAdjustment: number;
};
```

---

## Error Normalization

Provider마다 error 형식이 다릅니다.  
항상 내부 표준 에러로 변환합니다.

```ts
type NormalizedProviderError = {
  providerId: ProviderId;
  errorType:
    | "timeout"
    | "rate_limit"
    | "auth"
    | "invalid_request"
    | "provider_5xx"
    | "schema_validation"
    | "unknown";
  message: string;
  retryable: boolean;
  rawError?: unknown;
};
```

---

## 모델 체인 정책 (Model Fallback & High-Accuracy Routing)

> **Source of truth**: `apps/web/src/lib/council/models.ts`.

각 Provider 는 4개 역할의 모델을 핀(pin) 해 둡니다.

| 역할 | 용도 |
|---|---|
| `primary` | 기본 워크호스. 평시 사용. |
| `fallback` (옵션) | 429/쿼터 압박 시 primary 와 fastFallback 사이의 중간 hop. |
| `fastFallback` | 가장 저렴·빠른 모델. 마지막 안전망. |
| `highAccuracy` | 고위험 코팅 프롬프트 전용. 별도 라우팅으로만 들어감. |

### 체인 결정 — `resolveModelChain(providerId, mode)`

```text
default       : [primary, fallback?, fastFallback]
high_accuracy : [highAccuracy, primary, fallback?, fastFallback]
```

- 중복 제거하되 순서는 유지합니다.
- `highAccuracy` head 는 절대 legacy `*_MODEL` env 로 덮어쓸 수 없습니다.
- 각 hop 은 `enforceModelPolicy` 를 통과해야 합니다 — `preview`/`experimental`/`latest` substring 이 들어가면 거부 (운영자가 명시적으로 `ALLOW_*` env 를 켜지 않는 한).

### 고위험 라우팅 — `inferAccuracyMode(prompt, taskType)`

다음 둘 중 하나면 `high_accuracy` 모드:
1. `taskType` 이 `HIGH_RISK_TASK_TYPES` 에 포함.
2. `userPrompt` 가 `HIGH_RISK_KEYWORDS` (불연/난연/배터리/UL 94/MSDS/인증 등) 중 하나를 포함 (대소문자 무시).

→ Orchestrator 는 high_accuracy 가 트리거되면 `resolveModelChain(provider, "high_accuracy")` 의 head 부터 시도합니다.

### 환경 변수

```text
OPENAI_PRIMARY_MODEL / OPENAI_FALLBACK_MODEL /
OPENAI_FAST_FALLBACK_MODEL / OPENAI_HIGH_ACCURACY_MODEL
ANTHROPIC_PRIMARY_MODEL / ANTHROPIC_FAST_FALLBACK_MODEL /
ANTHROPIC_HIGH_ACCURACY_MODEL
GEMINI_PRIMARY_MODEL / GEMINI_FAST_FALLBACK_MODEL /
GEMINI_HIGH_ACCURACY_MODEL

# legacy (primary 만 덮어씀)
OPENAI_MODEL / ANTHROPIC_MODEL / GEMINI_MODEL

ALLOW_PREVIEW_MODELS=false
ALLOW_EXPERIMENTAL_MODELS=false
ALLOW_LATEST_MODELS=false
```

기본값(핀)은 `DEFAULT_MODELS` 상수에 있으며, 모델 롤포워드 시 이 맵 + 배포 버전을 함께 올립니다.

---

## Mock Provider

Mock Provider는 필수입니다.

목적:

- API 비용 없이 UI 개발
- 병렬 실행 테스트
- timeout 시나리오 테스트
- Provider 실패 시 partial completion 테스트

Mock Provider는 env로 지연 시간을 조절할 수 있게 합니다.

```text
MOCK_GEMINI_DELAY_MS=3000
MOCK_CLAUDE_DELAY_MS=5000
MOCK_OPENAI_DELAY_MS=4000
MOCK_FAIL_PROVIDER=gemini
MOCK_TIMEOUT_PROVIDER=claude
```
