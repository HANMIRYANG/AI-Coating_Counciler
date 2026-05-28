# Final Answer Schema

> **Source of truth**: `apps/web/src/lib/council/schemas.ts` (`FinalAnswerSchema`).
> 이 템플릿은 Zod 스키마를 사람이 읽기 좋게 옮긴 것이며, 코드와 어긋날 경우 코드를 우선합니다.

```json
{
  "conclusion": "string (필수, 1자 이상)",
  "finalMarkdown": "string (필수, 1자 이상)",
  "businessReadyAnswer": "string (필수, 1자 이상)",
  "internalMemo": "string",
  "evidenceBackedClaims": ["string"],
  "assumptions": ["string"],
  "missingEvidence": ["string"],
  "unsafePhrases": [
    {
      "phrase": "string",
      "reason": "string (optional)",
      "recommended": "string (optional)"
    }
  ],
  "recommendedSafeWording": ["string"],
  "riskLevel": "low | medium | high | critical",
  "confidenceScore": 0.0,
  "followUpQuestions": ["string"],
  "unresolvedDisagreements": ["string"],
  "providerSummary": [
    {
      "providerId": "gemini | anthropic | openai",
      "status": "string",
      "latencyMs": 0
    }
  ],
  "sessionStatus": "string (optional)"
}
```

## 주의

- `providerSummary` 가 정식 필드명입니다 (`providerParticipation` 이 아닙니다). 라운드별 round1/round2 성공 분리도 하지 않으며, provider별 최종 status를 1줄씩 담는 평탄한 배열입니다.
- `sessionStatus` 는 옵셔널이며, 합성 시점의 세션 상태(`completed` / `partial_completed` / `limited_answer` / `fallback_summary` 등)를 그대로 담습니다.
- `unsafePhrases[].recommended` 가 정식 필드명입니다 (`saferAlternative` 아님).
- `riskLevel` 미설정 시 `"low"` 가 기본값.
- `internalMemo` 가 빈 문자열일 수 있으며, 업체 발송용 본문(`businessReadyAnswer`)은 빈 문자열을 허용하지 않습니다 (1자 이상).

## Prisma 영속화 round-trip (2026-05-28 이후)

`SESSION_STORE=prisma` 모드에서 위 필드 전부가 `FinalAnswer` row 에 그대로 저장·복원됩니다. `followUpQuestions`, `providerSummary`, `sessionStatus` 는 마이그레이션 `20260528120000_add_final_answer_extras` 에서 추가되었습니다.
