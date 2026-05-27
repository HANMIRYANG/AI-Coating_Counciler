# 02. MVP Scope

## Phase 1 MVP

### 반드시 구현

1. 세 AI Provider Adapter
   - OpenAI
   - Anthropic
   - Gemini
   - Mock Provider

2. Council Session 생성
   - 사용자 prompt
   - taskType
   - status

3. Round 1: 독립 의견
   - Provider별 opinion 생성
   - provider status 저장
   - latency 저장
   - raw response 저장
   - parsed response 저장

4. Round 2: 회의/상호비판
   - Round 1 결과를 각 Provider에게 다시 제공
   - 다른 AI 답변의 오류/누락/위험표현 검토
   - Provider별 critique 저장

5. Round 3: 최종 합성
   - 최소 성공 조건 기반 합성
   - 근거 있음/추정/누락자료/위험표현 분리
   - 업체 발송용 문장 생성

6. Timeout / Partial Completion
   - Provider timeout
   - Round timeout
   - Session timeout
   - 2개 Provider 성공 시 진행
   - 1개 성공 시 제한 답변

7. UI
   - 채팅형 입력
   - Provider별 카드
   - 회의/상호비판 카드
   - 최종 답변 패널
   - 누락자료/위험문구 패널

### 선택 구현

- SSE 기반 실시간 업데이트
- 우선은 polling으로 구현 가능
- 간단한 export markdown

---

## MVP 완료 기준

```text
사용자가 질문을 입력하면 3개 AI가 동시에 초안을 내고,
그 초안을 다시 기반으로 회의/상호비판을 수행한 뒤,
최종 답변을 생성한다.
한 AI가 timeout되어도 시스템 전체는 멈추지 않는다.
```
