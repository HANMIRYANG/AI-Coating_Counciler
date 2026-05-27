# 15. Logging, Monitoring, Audit

## 왜 필요한가

특수도료/기술영업 답변은 나중에 “왜 이런 답변이 나왔는지” 추적 가능해야 합니다.

---

## Provider Call Log

각 Provider 호출마다 저장합니다.

```text
sessionId
providerId
round
model
status
startedAt
endedAt
latencyMs
timeoutMs
retryCount
errorType
errorMessage
tokenUsage
```

---

## Audit View

관리자는 다음을 볼 수 있어야 합니다.

```text
- 사용자 질문
- Round 1 각 AI 초안
- Round 2 회의/비판
- 최종 답변
- 누락 자료
- 위험 문구
- 어떤 AI가 timeout되었는지
- 어떤 AI가 최종 답변에 반영되었는지
```

---

## Error Categories

```text
timeout
rate_limit
auth_error
invalid_request
schema_validation_failed
provider_5xx
network_error
unknown
```

---

## 운영 시 중요 지표

```text
- 평균 session latency
- provider별 timeout rate
- provider별 schema invalid rate
- partial_completed 비율
- failed 비율
- 위험 표현 탐지 횟수
- 누락자료 상위 항목
```
