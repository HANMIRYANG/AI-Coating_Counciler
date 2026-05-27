# 05. Round-Based Orchestration

## 목적

사용자의 요구대로 “한 번에 답변을 내는 구조”가 아니라, 각 AI가 의견을 낸 뒤 다시 호출하여 회의하는 구조를 구현합니다.

---

## 라운드 정의

### Round 0: Session Preparation

```text
- prompt 정규화
- taskType 확인
- risk keywords 탐지
- requiredEvidence 후보 생성
- session 생성
```

### Round 1: Independent Opinion Round

```text
Gemini opinion
Claude opinion
GPT opinion
```

각 Provider는 다른 Provider의 의견을 보지 않습니다.

### Round 2: Meeting / Cross Critique Round

```text
Gemini critic: Claude/GPT 의견 비판
Claude critic: Gemini/GPT 의견 비판
GPT critic: Gemini/Claude 의견 비판
```

Round 2에서는 다음을 반드시 수행합니다.

```text
- 근거 없는 주장 탐지
- 위험 표현 탐지
- 누락된 시험 조건 탐지
- 의견 불일치 탐지
- 더 안전한 표현 제안
```

### Round 3: Final Synthesis Round

```text
Final synthesizer:
- Round 1 의견 종합
- Round 2 비판 반영
- 위험 표현 제거
- 업체 발송용 문장 작성
- 내부 검토 메모 작성
```

---

## State Machine

```text
created
→ preparing
→ round1_running
→ round1_completed / round1_partial
→ round2_running
→ round2_completed / round2_partial
→ synthesis_running
→ completed / partial_completed / limited_answer / failed
```

---

## Round Transition Rules

### Round 1 → Round 2

```text
if succeededOpinions >= 2:
  proceed to round2
elif succeededOpinions == 1:
  proceed to round2 (degraded critique 시도)
  └─ round2 결과가 0 succeeded → synthesis_running with warning
else:
  failed
```

> 구현 정책: round1_limited 상태도 항상 round2 를 시도한다 (`orchestrator.ts: run()`).
> Round 2 가 0 succeeded 로 끝나면 synthesis 단계에서 명시적 경고를 부착한다 (`applySafetyGuard` 참조).

### Round 2 → Round 3

```text
if succeededCritiques >= 2:
  proceed to full synthesis
elif succeededCritiques == 1:
  proceed to limited synthesis
else:
  synthesize from opinions only with warning
```

---

## Provider Role Strategy

### Gemini

```text
- 적용처 확장
- 아이디어 탐색
- 시장/사례 관점
- 빠질 수 있는 응용 분야 제안
```

### Claude

```text
- 기술 문서 품질
- 논리성 검토
- 업체 발송 문장 톤
- 과장 표현 완화
```

### GPT

```text
- 최종 구조화
- 위험 분리
- evidence/assumption 구분
- 전체 합의안 정리
```

---

## Synthesis Owner

MVP에서는 GPT를 최종 합성 Provider로 추천합니다.  
다만 GPT가 실패할 경우 Claude를 fallback synthesizer로 사용할 수 있어야 합니다.

```text
Primary synthesizer: GPT
Fallback synthesizer: Claude
Final fallback: deterministic local summarizer
```
