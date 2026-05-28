# Provider Opinion Schema

> **Source of truth**: `apps/web/src/lib/council/schemas.ts` (`ProviderOpinionSchema`).
> 이 템플릿은 Zod 스키마를 사람이 읽기 좋게 옮긴 것이며, 코드와 어긋날 경우 코드를 우선합니다.

```json
{
  "providerId": "gemini | anthropic | openai",
  "model": "string (optional)",
  "summary": "string (필수, 1자 이상)",
  "technicalAssessment": [
    {
      "topic": "string",
      "detail": "string"
    }
  ],
  "evidenceBackedClaims": ["string"],
  "assumptions": ["string"],
  "missingEvidence": ["string"],
  "risks": [
    {
      "description": "string",
      "severity": "low | medium | high | critical (optional)"
    }
  ],
  "unsafePhrases": [
    {
      "phrase": "string",
      "reason": "string (optional)",
      "recommended": "string (optional)"
    }
  ],
  "recommendedAnswer": "string",
  "confidenceScore": 0.0,
  "followUpQuestions": ["string"]
}
```

## 주의

- `providerId` 는 항상 `gemini | anthropic | openai` 세 값 중 하나입니다. (`claude` 가 아니라 `anthropic`).
- `unsafePhrases[].recommended` 가 정식 필드명입니다. (`saferAlternative` 아님).
- `technicalAssessment` 는 `{ topic, detail }` 두 필드 객체 배열입니다. (`claim/assessment/confidence/basis/missingEvidence` 가 아님).
- 모든 배열 필드는 모델이 빠뜨리면 `[]` 로 기본값이 채워집니다 (`schemas.ts` `default([])`).
- `confidenceScore` 는 0.0–1.0 범위로 clamp 됩니다.
