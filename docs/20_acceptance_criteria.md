# 20. Acceptance Criteria

## 필수 완료 기준

### 기능

- [ ] 사용자 질문 입력 가능
- [ ] taskType 선택 가능
- [ ] sessionId 즉시 생성
- [ ] Round 1에서 Gemini/Claude/GPT 병렬 실행
- [ ] Round 2에서 회의/상호비판 재호출
- [ ] Round 3에서 최종 합성
- [ ] Provider별 상태 표시
- [ ] timeout Provider가 있어도 진행
- [ ] 최종 답변 저장
- [ ] 업체 발송용 문장과 내부 검토 메모 분리

### Timeout

- [ ] Provider timeout 존재
- [ ] Round timeout 존재
- [ ] Session timeout 존재
- [ ] Promise.allSettled 또는 동등 구조 사용
- [ ] Mock delay로 병렬성 검증 가능

### Safety

- [ ] 위험 문구 탐지
- [ ] 누락 자료 표시
- [ ] 단정 표현 방지
- [ ] riskLevel 표시
- [ ] confidenceScore 표시

### UI

- [ ] 각 AI 초안 카드 표시
- [ ] 회의/비판 카드 표시
- [ ] 최종 답변 패널 표시
- [ ] timeout/failed 상태가 사용자에게 명확히 보임

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
