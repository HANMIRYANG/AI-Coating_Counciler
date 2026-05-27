# 07. Provider Adapter Design

## Provider Adapter의 목적

OpenAI, Anthropic, Gemini API 차이를 숨기고, Orchestrator는 동일한 인터페이스만 사용하게 합니다.

---

## Provider IDs

```ts
type ProviderId = "openai" | "anthropic" | "gemini" | "mock";
```

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
