# 09. API Design

## API 목표

프론트엔드는 긴 AI 작업을 기다리지 않고 sessionId를 즉시 받아야 합니다.

> **Source of truth**: `apps/web/src/app/api/**/route.ts`.
> 본 문서가 코드와 어긋날 경우 라우트 핸들러의 동작이 우선합니다.

---

## 라우트 개요 (2026-05-28 현재)

| Method | Path | 핸들러 | 비고 |
|---|---|---|---|
| `POST` | `/api/council-sessions` | `app/api/council-sessions/route.ts` | 세션 생성 + 백그라운드 오케스트레이션 시작 |
| `GET`  | `/api/council-sessions?limit=N` | `app/api/council-sessions/route.ts` | 최근 세션 summary 목록 (newest first) |
| `GET`  | `/api/council-sessions/:id` | `app/api/council-sessions/[id]/route.ts` | 세션 스냅샷 (의견·비판·**최종 답변 포함**). `?debug=1` 옵션. |
| `POST` | `/api/council-sessions/:id/start` | `app/api/council-sessions/[id]/start/route.ts` | idempotent 명시적 시작 (이미 시작했으면 no-op) |
| `GET`  | `/api/evidence-sources` | `app/api/evidence-sources/route.ts` | 카탈로그/정책 메타데이터. 현재 `retrievalEnabled=false`. |
| `POST` | `/api/documents` | `app/api/documents/route.ts` | **Phase 2 foundation 한정.** text/plain·text/markdown 만 수용, 결정적 chunking 후 Prisma 영속화. PDF/DOCX/이미지 → 415. |
| `GET`  | `/api/documents` | `app/api/documents/route.ts` | **Phase 2 foundation 한정.** 문서 summary 목록 (chunk 본문 미포함). |
| `GET`  | `/api/documents/search?q=...` | `app/api/documents/search/route.ts` | **Phase 2 foundation 한정.** 영속화된 chunk 본문에 대한 결정적 키워드 검색 + metadata 필터. 임베딩/벡터 검색 아님. |
| `GET`  | `/api/documents/evidence?query=...` | `app/api/documents/evidence/route.ts` | **Phase 2 foundation 한정.** 키워드 검색 결과를 내부문서 evidence 후보로 정규화. orchestrator 미연결. |

> 별도의 `GET /api/council-sessions/:id/final-answer` 엔드포인트는 **없습니다**. 최종 답변은 `GET /api/council-sessions/:id` 응답의 `finalAnswer` 필드로 함께 반환됩니다.
> Phase 2 후보: `POST /api/council-sessions/:id/providers/:providerId/retry`, `GET /api/council-sessions/:id/events` (SSE) — 둘 다 미구현.

---

## Endpoints (상세)

### Create Session

```http
POST /api/council-sessions
Content-Type: application/json
```

Request (validated by `CreateSessionRequestSchema`):

```json
{
  "prompt": "HE-850A를 배터리팩 외장재에 적용 가능한지 검토해줘",
  "taskType": "technical_review",
  "evidenceMode": "ai_only"
}
```

- `taskType`: `technical_review | test_report_interpretation | customer_reply | proposal_copy | risky_phrase_review | application_ideas | certification_checklist | document_based_answer` (8종)
- `evidenceMode`: `ai_only | internal_docs | internal_docs_web` (기본 `ai_only`)

Response `201`:

```json
{
  "sessionId": "cs_xxx",
  "status": "created"
}
```

오류:
- `400 invalid_json` (body 파싱 실패)
- `400 invalid_request` (Zod 검증 실패. `details` 에 flatten된 에러 포함)

---

### List Recent Sessions

```http
GET /api/council-sessions?limit=N
```

Response `200`:

```json
{
  "sessions": [
    {
      "id": "cs_xxx",
      "userPrompt": "...",
      "taskType": "technical_review",
      "evidenceMode": "ai_only",
      "status": "completed",
      "currentRound": null,
      "createdAt": 1717000000000,
      "completedAt": 1717000060000,
      "errorMessage": null
    }
  ]
}
```

- `limit` 미지정 또는 비정상 값은 store가 기본값으로 clamp.
- `providerCalls`, `opinions`, `critiques`, `finalAnswer`, `attempts` 등 **상세 페이로드는 절대 포함되지 않습니다** (목록 뷰 비용 보호).
- 인증 없음 — 로컬/MVP 한정. 운영 노출 시 admin/RBAC 게이트 권장.

---

### Get Session Snapshot

```http
GET /api/council-sessions/:id
GET /api/council-sessions/:id?debug=1
```

Response `200` (요약):

```json
{
  "id": "cs_xxx",
  "status": "round2_running",
  "currentRound": "critique",
  "userPrompt": "...",
  "taskType": "technical_review",
  "evidenceMode": "ai_only",
  "createdAt": 1717000000000,
  "startedAt": 1717000000123,
  "completedAt": null,
  "deadlineAt": 1717000240000,
  "errorMessage": null,
  "providers": [
    {
      "providerId": "gemini",
      "round": "initial",
      "status": "succeeded",
      "latencyMs": 42100,
      "timeoutMs": 90000,
      "retryCount": 0,
      "errorType": null,
      "errorMessage": null,
      "modelRequested": "gemini-3.5-flash",
      "modelUsed": "gemini-3.5-flash",
      "rateLimited": false
    }
  ],
  "providerHealth": { "...rate limiter snapshot..." : true },
  "opinions": [ "...ProviderOpinion[]..." ],
  "critiques": [ "...ProviderCritique[]..." ],
  "finalAnswer": null,
  "debug": false
}
```

- `finalAnswer` 는 합성 라운드가 끝나면 `FinalAnswer` (Zod schema 참고) 객체로 채워집니다.
- `404 not_found` — 세션 없음.

`?debug=1` 추가 페이로드:
- 각 `providers[]` 항목에 `rawResponse`, `parsedResponse` (단, 둘 다 `schema_invalid` 케이스에만 값이 들어 있음).
- 최상위 `attempts` 배열 — 전체 시도(forensic) 로그.

`?debug=1` 인가:
- `ADMIN_DEBUG_TOKEN` 환경변수가 설정되어 있으면, 요청 헤더 `x-admin-debug-token` 이 일치해야 함. 불일치/미전송 → `403 debug_forbidden`.
- `ADMIN_DEBUG_TOKEN` 미설정이면, `NODE_ENV !== "production"` 일 때만 허용. 운영에서는 토큰 없이 `?debug=1` 사용 불가.

---

### Start Session (idempotent)

```http
POST /api/council-sessions/:id/start
```

- `Create Session` 시점에 오케스트레이션이 자동 시작되므로 일반적인 흐름에서는 호출할 필요가 없습니다.
- 이미 `status !== "created"` 인 경우 `200 alreadyStarted: true`로 응답하고 새 작업을 시작하지 않습니다.
- `404 not_found` — 세션 없음.

---

### Evidence Sources

```http
GET /api/evidence-sources
```

Response `200`:

```json
{
  "sources": [ "...DEFAULT_EVIDENCE_SOURCE_CATALOG..." ],
  "retrievalPolicy": { "...DEFAULT_SOURCE_RETRIEVAL_POLICY..." },
  "retrievalEnabled": false,
  "message": "공식 출처 조회 및 사내 문서 / RAG 기능은 아직 구현되지 않았습니다. 본 응답은 카탈로그 / 정책 메타데이터만 노출합니다."
}
```

- 정적 응답. 외부 fetch 없음.
- `retrievalEnabled: false` 가 진실. RAG / 공식 출처 조회는 Phase 2.

---

### Documents (Phase 2 foundation)

```http
POST /api/documents
Content-Type: application/json
```

Request:

```json
{
  "filename": "tds.txt",
  "originalName": "HE-850A-TDS.txt",
  "mimeType": "text/plain | text/markdown",
  "content": "<UTF-8 text payload, ≤ 256KB>",
  "category": "tds | test_report | ...",
  "version": "v1",
  "metadata": {
    "productName": "HE-850A",
    "documentType": "test_report",
    "issuer": "KCL",
    "testMethod": "KS F 2271",
    "substrate": "강판",
    "coatingThickness": "120 μm"
  }
}
```

- `mimeType` 미지원 (`application/pdf`, `application/msword`, `image/*` 등) → `415 unsupported_media_type`.
- Zod 검증 실패 → `400 invalid_request` + `details` (flatten).
- DB 미구성/미가용 → `503 database_unavailable` (메모리 fallback 없음 — Step 3 의 의도된 동작).
- 성공 → `201 { id, chunkCount, status: "chunked" }`.
- **metadata 객체는 검증 후 `Document.metadata` (JSONB) 에 영속화됩니다.** unknown 키는 Zod 가 저장 전에 제거하며, `GET /api/documents` summary 에 그대로 노출됩니다. retrieval 에는 아직 사용되지 않습니다.

```http
GET /api/documents?limit=N
```

Response `200`:

```json
{
  "documents": [
    {
      "id": "...",
      "filename": "tds.txt",
      "originalName": "tds.txt",
      "mimeType": "text/plain",
      "sizeBytes": 1234,
      "category": null,
      "version": null,
      "status": "chunked",
      "metadata": {
        "productName": "HE-850A",
        "documentType": "test_report",
        "issuer": "KCL",
        "testMethod": "KS F 2271"
      },
      "chunkCount": 3,
      "createdAt": 1748400000000
    }
  ]
}
```

- `limit` 기본 20, 최대 100 (그 이상은 clamp).
- `metadata` 는 intake 시 저장된 값 그대로; metadata 없이 생성된 문서는 `null`.
- chunk 본문은 절대 포함되지 않음. 단일 문서의 chunk 본문은 Phase 2 retrieval 에서 별도 엔드포인트로 노출 예정.

```http
GET /api/documents/search?q=...&documentType=...&productName=...&issuer=...&limit=N
```

영속화된 `DocumentChunk.content` 에 대한 **결정적 키워드 검색**. 쿼리는 소문자화 → 공백 분리 → 중복 제거된 term 으로 정규화되고, 각 term 의 부분일치(대소문자 무시)로 chunk 를 매칭합니다. 점수는 `(매칭된 distinct term 수) * 100 + (총 출현 횟수)` 로 결정적입니다.

- `q` **필수**. 비어있거나 공백뿐이면 `400 invalid_request`.
- 선택 metadata 필터(`documentType` / `productName` / `issuer`)는 `Document.metadata` JSONB 키와 정확히 일치(exact match). `documentType` 은 evidence 문서 타입 enum 검증 — 잘못된 값은 `400`.
- `limit` 기본 10, 최대 50 (그 이상은 clamp).
- DB 미구성/미가용 → `503 database_unavailable`.

Response `200`:

```json
{
  "query": "방오 코팅",
  "count": 1,
  "results": [
    {
      "documentId": "...",
      "filename": "kcl-report.md",
      "chunkId": "...",
      "chunkIndex": 0,
      "snippet": "…방오 코팅의 부착 성능을 KCL 기준으로…",
      "metadata": { "productName": "HE-850A", "documentType": "test_report", "issuer": "KCL" },
      "score": 202
    }
  ]
}
```

- 결과는 score 내림차순 → `documentId` 오름차순 → `chunkIndex` 오름차순으로 결정적 정렬.
- chunk 전체 본문은 반환하지 않고 **bounded snippet** (기본 ≤160자, 첫 매치 주변) 만 포함.
- **미구현**: 임베딩 / 벡터 유사도, evidence bundle 조립, orchestrator 연결. 후보 chunk 는 결정적 순서로 상한(200) 까지만 스캔 후 in-process 정렬.

```http
GET /api/documents/evidence?query=...&documentType=...&productName=...&issuer=...&limit=N
```

`GET /api/documents/search` 결과를 **내부문서 evidence 후보**로 정규화합니다 (`lib/documents/evidence-bundle.ts`). 키워드 검색을 내부적으로 호출한 뒤 각 hit 를 council 의 evidence 어휘(`lib/council/evidence.ts`)로 매핑합니다.

- `query` **필수**. 비어있거나 공백뿐이면 `400 invalid_request`. (검색의 `q` 와 동일 의미 — orchestrator-facing 이름)
- 선택 metadata 필터(`documentType` / `productName` / `issuer`)와 `limit` (기본 10, 최대 50) 은 검색과 동일하게 동작.
- DB 미구성/미가용 → `503 database_unavailable`.

Response `200`:

```json
{
  "query": "방오 코팅",
  "normalizedQuery": "방오 코팅",
  "retrievalMode": "internal_documents_keyword",
  "retrievalStatus": "ok",
  "count": 1,
  "candidates": [
    {
      "sourceType": "internal_document",
      "documentId": "...",
      "filename": "kcl-report.md",
      "chunkId": "...",
      "chunkIndex": 0,
      "snippet": "…방오 코팅의 내후성 시험 결과를 KCL 기준으로…",
      "metadata": { "productName": "HE-850A", "documentType": "test_report", "issuer": "KCL" },
      "score": 202,
      "trustLevel": "uploaded_copy",
      "verificationStatus": "auto_extracted"
    }
  ]
}
```

- 각 후보는 내부문서 기본값으로 `trustLevel: "uploaded_copy"` (caveat 동반 시 business-citable) + `verificationStatus: "auto_extracted"` 를 부여받음. 사람이 후속 검토로 승격 가능.
- `retrievalStatus` 는 후보가 있으면 `ok`, 없으면 `no_matches`.
- chunk 전체 본문은 포함하지 않고 bounded snippet 만 전달. 정렬 순서는 검색 결과 순서를 그대로 보존.
- **미구현**: 임베딩 / 벡터 유사도, 최종 RAG retrieval, evidence bundle → orchestrator 핸드오프.

---

## Polling 정책

MVP에서는 polling으로 충분합니다.

```text
프론트엔드 polling interval: NEXT_PUBLIC_POLLING_INTERVAL_MS (기본 1500ms)
에러 재시도 cadence: max(2x interval, 3000ms) — 클라이언트가 자동 계산
최대 polling 시간: SESSION_TIMEOUT_MS + 30초
```

Production에서는 SSE 또는 WebSocket을 고려합니다 (`GET /:id/events` 형태로 추가 예정).
