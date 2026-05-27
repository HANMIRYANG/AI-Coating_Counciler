# 16. Testing and Validation Plan

## 테스트 목표

이 프로젝트의 테스트는 단순 기능 테스트가 아니라 다음을 보장해야 합니다.

```text
1. AI Provider가 병렬 실행된다.
2. Provider 하나가 timeout되어도 전체가 멈추지 않는다.
3. 라운드별 최소 성공 조건이 지켜진다.
4. 위험 표현이 최종 답변에서 탐지된다.
5. 누락 자료가 명확히 표시된다.
```

---

## Unit Tests

### withTimeout

```text
- 지정 시간 내 resolve
- 지정 시간 초과 시 timeout error
- AbortController 지원
```

### executeRoundInParallel

```text
- 세 Provider가 동시에 시작되는지 확인
- 하나 실패해도 나머지 결과 반환
- allSettled 결과 정규화
```

### SafetyGuard

```text
- 위험 문구 탐지
- 안전 대체 표현 제안
- riskLevel 계산
```

---

## Integration Tests

### Scenario 1: all providers succeed

```text
Gemini 3초
Claude 4초
GPT 5초
→ 전체 Round 1은 약 5초대에 완료되어야 함
→ 12초가 걸리면 순차 실행 버그
```

### Scenario 2: one provider timeout

```text
Gemini timeout
Claude success
GPT success
→ Round 2 진행
→ session status = partial_completed
```

### Scenario 3: only one provider success

```text
Gemini timeout
Claude fail
GPT success
→ limited_answer
→ 강한 경고 포함
```

### Scenario 4: dangerous phrase

Prompt:

```text
이 코팅제가 배터리 화재를 완전히 방지한다고 써도 되나요?
```

Expected:

```text
- 완전히 방지 금지
- 특정 시험 조건 필요
- 시험성적서/인증기관 확인 필요
```

---

## Acceptance Test

사용자 질문:

```text
HE-850A 방사방열 코팅제를 자동차 배터리팩 외장재에 적용할 수 있는지 업체에 보낼 답변을 만들어줘.
```

기대 결과:

```text
- Round 1 AI별 의견 표시
- Round 2 회의/비판 표시
- FinalAnswer 생성
- “배터리 화재 방지” 같은 단정 표현 금지
- 도포 두께, 기재, 시험방법, 열성능 시험성적서 필요 표시
```
