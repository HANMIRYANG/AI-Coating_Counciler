# 20. Acceptance Criteria

> **검증 일자**: 2026-05-28
> **검증 방법**: 코드/테스트 교차 확인. 각 항목 옆 file:line 은 검증 시점의 위치이며 리팩토링 시 이동할 수 있습니다.

## 필수 완료 기준

### 기능

- [x] 사용자 질문 입력 가능 — `apps/web/src/app/page.tsx`
- [x] taskType 선택 가능 — `apps/web/src/app/page.tsx`, `schemas.ts:8-17` (8종 enum)
- [x] sessionId 즉시 생성 — `app/api/council-sessions/route.ts:47,70-75` (POST가 201 즉시 응답, 오케스트레이션은 background)
- [x] Round 1에서 Gemini/Claude/GPT 병렬 실행 — `orchestrator.ts:305` (`Promise.allSettled` per round)
- [x] Round 2에서 회의/상호비판 재호출 — `orchestrator.ts` Round 2 블록
- [x] Round 3에서 최종 합성 — `orchestrator.ts` Synthesis 블록
- [x] Provider별 상태 표시 — `components/council/ProviderCard.tsx`, `GET /:id` 응답 `providers[]`
- [x] timeout Provider가 있어도 진행 — `orchestrator.ts:238-249` (partial_completed / limited_answer 분기)
- [x] 최종 답변 저장 — 메모리 `MemorySessionStore` + opt-in `PrismaSessionStore.FinalAnswer` row
- [x] 업체 발송용 문장과 내부 검토 메모 분리 — `schemas.ts:89-90` (`businessReadyAnswer` vs `internalMemo`)

### Timeout

- [x] Provider timeout 존재 — `.env.example:65` `PROVIDER_TIMEOUT_MS=90000`, `orchestrator.ts:82-85`
- [x] Round timeout 존재 — `.env.example:66` `ROUND_TIMEOUT_MS=120000`
- [x] Session timeout 존재 — `.env.example:68` `SESSION_TIMEOUT_MS=240000`, `orchestrator.ts:251-253` (`timed_out` 강등)
- [x] Promise.allSettled 또는 동등 구조 사용 — `orchestrator.ts:305`
- [x] Mock delay로 병렬성 검증 가능 — `__tests__/orchestrator.test.ts` (wall-clock < sum 검증)

### Safety

- [x] 위험 문구 탐지 — `safety.ts` + `__tests__/safety.test.ts`
- [x] 누락 자료 표시 — `missingEvidence` 필드 (`schemas.ts:52,93`)
- [x] 단정 표현 방지 — `unsafePhrases` + `recommendedSafeWording` (`schemas.ts:94-95`)
- [x] riskLevel 표시 — `schemas.ts:96`, `FinalAnswerPanel.tsx`
- [x] confidenceScore 표시 — `schemas.ts:97`, `FinalAnswerPanel.tsx`

### UI

- [x] 각 AI 초안 카드 표시 — `components/council/ProviderCard.tsx`
- [x] 회의/비판 카드 표시 — `components/council/CritiquePanel.tsx`
- [x] 최종 답변 패널 표시 — `components/council/FinalAnswerPanel.tsx`
- [x] timeout/failed 상태가 사용자에게 명확히 보임 — `ProviderCard.tsx` + `RoundTimeline.tsx`

---

## 완료 데모 시나리오

```text
질문:
방사방열 코팅제를 전기차 배터리팩 외장재에 적용 가능하다고 업체에 설명하려고 합니다. 안전한 답변을 만들어주세요.

결과:
- 3개 AI가 각자 의견 생성
- 다시 회의/상호비판 수행
- 최종 답변 생성
- 배터리 화재 방지 단정 금지
- 추가 시험자료 필요 표시
```

위 시나리오는 Mock provider (`USE_MOCK_PROVIDERS=true` 기본값) 환경에서 즉시 재현 가능합니다. 실제 provider 호출은 `.env.local` 에 키 + `USE_MOCK_PROVIDERS=false` 설정 후 사용.
