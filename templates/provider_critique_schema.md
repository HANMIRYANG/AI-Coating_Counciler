# Provider Critique Schema

> **Source of truth**: `apps/web/src/lib/council/schemas.ts` (`ProviderCritiqueSchema`).
> 이 템플릿은 Zod 스키마를 사람이 읽기 좋게 옮긴 것이며, 코드와 어긋날 경우 코드를 우선합니다.

```json
{
  "providerId": "gemini | anthropic | openai",
  "model": "string (optional)",
  "agreements": ["string"],
  "disagreements": ["string"],
  "unsupportedClaims": [
    {
      "claim": "string",
      "attributedTo": "gemini | anthropic | openai (optional)",
      "reason": "string (optional)"
    }
  ],
  "unsafePhrasesFound": [
    {
      "phrase": "string",
      "reason": "string (optional)",
      "recommended": "string (optional)"
    }
  ],
  "missingEvidenceFound": ["string"],
  "recommendedCorrections": ["string"],
  "providerSpecificCritiques": [
    {
      "targetProviderId": "gemini | anthropic | openai",
      "critique": "string"
    }
  ],
  "confidenceAdjustment": 0.0
}
```

## 주의

- `providerId` / `targetProviderId` / `attributedTo` 는 모두 `gemini | anthropic | openai` 세 값 중 하나입니다 (`claude` 아님).
- `unsupportedClaims[]` 는 `{ claim, attributedTo?, reason? }` 3-필드 객체입니다 (기존 4-필드 형태 아님).
- `providerSpecificCritiques[]` 는 `{ targetProviderId, critique }` 의 단순 객체 배열입니다. 강점/약점/필수수정 분류 없이 한 줄 비판입니다.
- `unsafePhrasesFound[].recommended` 가 정식 필드명입니다 (`saferAlternative` 아님).
- `confidenceAdjustment` 는 −1.0 ~ +1.0 으로 clamp 됩니다.
