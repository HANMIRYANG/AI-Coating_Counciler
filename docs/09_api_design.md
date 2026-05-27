# 09. API Design

## API 목표

프론트엔드는 긴 AI 작업을 기다리지 않고 sessionId를 즉시 받아야 합니다.

---

## Endpoints

### Create Session

```http
POST /api/council-sessions
```

Request:

```json
{
  "prompt": "HE-850A를 배터리팩 외장재에 적용 가능한지 검토해줘",
  "taskType": "technical_review"
}
```

Response:

```json
{
  "sessionId": "clx...",
  "status": "created"
}
```

---

### Start Session

```http
POST /api/council-sessions/:id/start
```

MVP에서는 create 시 자동 start해도 됩니다.

---

### Get Session Status

```http
GET /api/council-sessions/:id
```

Response:

```json
{
  "id": "clx...",
  "status": "round2_running",
  "currentRound": "critique",
  "providers": [
    {
      "providerId": "gemini",
      "round": "initial",
      "status": "succeeded",
      "latencyMs": 42100
    },
    {
      "providerId": "claude",
      "round": "initial",
      "status": "succeeded",
      "latencyMs": 51200
    },
    {
      "providerId": "openai",
      "round": "initial",
      "status": "timed_out",
      "latencyMs": 90000
    }
  ]
}
```

---

### Get Final Answer

```http
GET /api/council-sessions/:id/final-answer
```

---

### Retry Provider

```http
POST /api/council-sessions/:id/providers/:providerId/retry
```

Phase 2 기능입니다.

---

## Polling 정책

MVP에서는 polling으로 충분합니다.

```text
프론트엔드 polling interval: 1500ms
최대 polling 시간: SESSION_TIMEOUT_MS + 30초
```

Production에서는 SSE 또는 WebSocket을 고려합니다.
