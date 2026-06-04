# 09. API Design

## API 목표

프론트엔드는 긴 AI 작업을 기다리지 않고 sessionId를 즉시 받아야 합니다.

> **Source of truth**: `apps/web/src/app/api/**/route.ts`.
> 본 문서가 코드와 어긋날 경우 라우트 핸들러의 동작이 우선합니다.

---

## 라우트 개요 (2026-06-04 현재)

| Method | Path | 핸들러 | 비고 |
|---|---|---|---|
| `POST` | `/api/council-sessions` | `app/api/council-sessions/route.ts` | 세션 생성 + 백그라운드 오케스트레이션 시작 |
| `GET`  | `/api/council-sessions?limit=N` | `app/api/council-sessions/route.ts` | 최근 세션 summary 목록 (newest first) |
| `GET`  | `/api/council-sessions/:id` | `app/api/council-sessions/[id]/route.ts` | 세션 스냅샷 (의견·비판·**최종 답변** + **evidence preview** 포함). `?debug=1` 옵션. |
| `POST` | `/api/council-sessions/:id/start` | `app/api/council-sessions/[id]/start/route.ts` | idempotent 명시적 시작 (이미 시작했으면 no-op) |
| `GET`  | `/api/council-sessions/:id/export?format=markdown` | `app/api/council-sessions/[id]/export/route.ts` | 완료 세션의 안전한 Markdown 내보내기 (최종 답변·내부 메모·근거 커버리지·근거 가드·**검증된 인용·인용 무결성 점검·근거 부록** 포함). PDF/DOCX 미구현. |
| `GET`  | `/api/evidence-sources` | `app/api/evidence-sources/route.ts` | 카탈로그/정책 메타데이터. `retrievalEnabled=false` 는 **카탈로그 기반 자동 출처 조회**만 가리킴 — 사용자 제공 URL fetch 는 `internal_docs_web` 세션에서 동작. |
| `POST` | `/api/documents` | `app/api/documents/route.ts` | **Phase 2 foundation 한정.** text/plain·text/markdown 만 수용, 결정적 chunking 후 Prisma 영속화. PDF/DOCX/이미지 → 415. |
| `GET`  | `/api/documents` | `app/api/documents/route.ts` | **Phase 2 foundation 한정.** 문서 summary 목록 (chunk 본문 미포함). |
| `GET`  | `/api/documents/search?q=...` | `app/api/documents/search/route.ts` | **Phase 2.** 영속화된 chunk 본문에 대한 결정적 **키워드 전용** 검색 + metadata 필터. (의미 기반 벡터/하이브리드는 evidence 경로에서 사용 — 이 엔드포인트는 키워드 전용 유지.) |
| `GET`  | `/api/documents/evidence?query=...` | `app/api/documents/evidence/route.ts` | **Phase 2.** 내부문서 검색 결과를 evidence 후보로 정규화. retrieval 은 `EVIDENCE_RETRIEVAL_MODE`(keyword/vector/**hybrid** 기본)로 선택. (orchestrator 는 이 엔드포인트를 직접 호출하지 않고, 동일 evidence bundle 을 세션 preflight 에서 사용.) |
| `POST` | `/api/documents/parse` | `app/api/documents/parse/route.ts` | **Phase 2.** 멀티파트 파일(PDF/DOCX/이미지) 업로드 → text-layer 추출 + (텍스트 없으면) OCR fallback → 인라인 intake 로 chunking·영속화. 미지원 타입 → 415. `extractErrorToStatus` 로 상태코드 매핑. |
| `POST` | `/api/documents/:id/extract` | `app/api/documents/[id]/extract/route.ts` | **Phase 2.** Blob 원본(`needs_extraction`) 지연 추출 — private Blob 을 서버에서 가져와 text-layer/OCR 추출 후 chunk 부착 → `chunked` 승격. OCR 미설정 → 503. |
| `POST` | `/api/documents/blob/upload` | `app/api/documents/blob/upload/route.ts` | **Phase 2.** Vercel Blob client-upload 핸들러 — 대용량 원본(PDF/DOCX/이미지) 저장. 추출 가능 타입은 `status: needs_extraction`(그 외 `original_uploaded`)로 등록되며, 추출/chunking 은 `/api/documents/:id/extract` 로 지연 수행. `BLOB_READ_WRITE_TOKEN` 필요. |
| `POST` | `/api/documents/embeddings/backfill?limit=N` | `app/api/documents/embeddings/backfill/route.ts` | **Phase 2.** 임베딩이 없는 청크를 bounded 배치로 임베딩(벡터/하이브리드 검색용). `remaining` 0 될 때까지 반복 호출. write-token 게이트. |

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
  "evidencePreview": {
    "mode": "internal_docs",
    "retrievalStatus": "ok",
    "count": 3,
    "candidates": [
      {
        "documentId": "...",
        "filename": "kcl-report.md",
        "chunkId": "...",
        "chunkIndex": 0,
        "snippet": "…방오 코팅의 부착 성능…",
        "metadata": { "issuer": "KCL", "documentType": "test_report" },
        "score": 202,
        "trustLevel": "uploaded_copy",
        "verificationStatus": "auto_extracted"
      }
    ]
  },
  "debug": false
}
```

- `finalAnswer` 는 합성 라운드가 끝나면 `FinalAnswer` (Zod schema 참고) 객체로 채워집니다.
- `finalAnswer` 에는 **evidence usage 계약 (Step 10)** 필드가 포함됩니다(모두 optional/default 이므로 기존 응답과 하위호환):
  - `evidenceUsed`: `{ chunkId, filename, chunkIndex, trustLevel?, verificationStatus? }[]` — chunk 본문 미포함.
  - `coveredClaims`: `{ claim, evidenceChunkIds[] }[]`.
  - `uncoveredClaims`: `string[]`.
  - `evidenceCoverageStatus`: `not_requested | no_evidence | partial | sufficient | unavailable`. ai_only → `not_requested`. internal_docs + ok preview 인데 모델 매핑이 없으면 보수적으로 `partial`. `sufficient` 는 모델이 명시적으로 산출한 경우에만 사용(자동 설정 안 함).
  - `retrievalGuard` (optional, 하위호환): **Retrieval Guard** 결과. `applyEvidenceUsage` 직후 결정적으로 산출되어 부착됨. `{ guardStatus: "not_required"|"passed"|"warning"|"blocked", reasons[], requiredEvidence, businessCitationReady, recommendedAction }`. 답변을 재작성하지 않고 인용 충분성·유효성만 분류한다(법적 인증 아님). `businessCitationReady=true` 는 `sufficient`+검증된 매핑+업체-인용 가능 신뢰수준일 때만.
  - **검증된 인용(Verified Citations) — 렌더링 레이어** (`lib/council/verifiedCitations.ts`): 위 필드들에서 결정적으로 파생되는 표시/내보내기 전용 뷰(별도 API 필드 아님). covered claim 에 `[C1]` 라벨 + 인용 근거(`filename#chunkIndex`·신뢰수준·검증상태) 연결, uncovered 는 미연결로 분리, `citationReady`는 ① 가드 verdict 가 **passed + businessCitationReady**(둘 다 — 모순 payload 방어)이고 ② 모든 cited claim 이 ≥1 근거로 해석되며 ③ 미연결(uncovered) 주장이 0건일 때만 true. Markdown export 의 "검증된 인용" 섹션과 근거 커버리지 UI 에 노출. **모델 호출 없음·결정적이며, 법적/사실 인증이나 자동 사실검증이 아니다.** raw chunk 본문/내부 chunkId 비노출.
  - **인용 무결성 점검(Citation Integrity) — 검토/내보내기 준비 레이어** (`lib/council/citationIntegrity.ts`): 검증된 인용에서 결정적으로 파생(별도 API 필드 아님). `integrityStatus` `ready|review_required|blocked`, `reviewRequired`/`exportReady`/`summary`/`recommendations`. **이슈는 심각도로 분류**된다: `problem`(준비 관련 — `unresolved_claim`/`missing_evidence_ref`/`not_business_ready_guard`/`no_cited_claims`/`unguarded_legacy_answer`) vs `advisory`(인라인 라벨 — `body_has_no_citation_labels`/`body_missing_citation_labels`/`body_has_unknown_citation_labels`). 결과는 `problemIssues`/`advisoryIssues`/`problemCount`/`advisoryCount` 와 분리된 권장(`problemRecommendations`/`advisoryRecommendations`)을 제공. `ready`=citationReady, `blocked`=가드 blocked 또는 (근거 필수 ∧ citationReady 아님), 그 외 `review_required`. **`not_required` 가드 + cited/unresolved 주장 0건이면 무결성·부록 섹션은 조용히 생략**(일반 ai_only/저위험; blocked 가드는 클레임 0건이어도 표시). **본문 `[C#]` 인라인 라벨 점검(없음/누락/미지정)은 자문 전용 — `integrityStatus`/`reviewRequired`/`exportReady`/`citationReady` 를 절대 강등하지 않으며 사실/법적 인증이 아니다.** 검증된 인용 claim 행은 근거를 `[E#] filename#chunkIndex` 로 표기해 **근거 부록 라벨과 직접 연결**. Markdown export 는 문제와 자문을 분리 표시하며("문제"/"자문"), 근거 커버리지 UI 도 동일.
- `evidencePreview` 는 **세션 단위 내부문서 evidence 검색 preview (Step 7)** 입니다.
  - `evidenceMode: "ai_only"` → `retrievalStatus: "not_requested"`, 후보 없음 (기본 동작 동일).
  - `internal_docs` (및 `internal_docs_web`) → orchestrator 가 세션 시작 시 **bounded preflight** 로 내부 evidence bundle 을 1회 조회. 결과: `ok` / `no_matches`, DB 미가용·timeout 시 `unavailable`, 기타 오류 시 `failed`. **어떤 경우에도 council 세션은 계속 진행됩니다.**
  - `candidates` 는 최대 5개로 bounded, **snippet 만 포함하고 chunk 전체 본문은 절대 포함하지 않습니다**. `count` 는 전체 매칭 수.
  - **Step 8**: `internal_docs` 세션에서는 이 preview 후보(키워드+벡터 하이브리드 검색 결과)가 Round 1/2/3 provider 프롬프트에 **읽기 전용 evidence 컨텍스트**로 주입됩니다. 단, 이는 검증된 확정 citation 이 아니며 출력 JSON 스키마는 변경되지 않습니다. 검증된 citation 강제/렌더링은 여전히 미구현(다음 슬라이스).
  - 레거시 세션(preflight 이전 생성)은 `null`. recent-list summary 에는 포함되지 않음(목록 비용 보호).
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

### Export Session (Markdown, Step 12)

```http
GET /api/council-sessions/:id/export?format=markdown
```

완료된 세션을 **안전한 Markdown 문서**로 내보냅니다. 결정적(deterministic) 출력이며, 다음을 포함합니다: 세션 헤더(id/taskType/evidenceMode/status), 사용자 질문, 최종 결론, 업체 발송용 답변, 내부 메모, 근거 있는 주장/추정/누락 근거, 위험 표현/권장 안전 표현, **근거 커버리지**(`evidenceCoverageStatus` + `evidenceUsed` 참조 + 근거 연결/부족 주장)와 **근거 가드**(Retrieval Guard), **검증된 인용**(Verified Citations — `[C#]` 주장 ↔ `[E#]` 근거 연결), **인용 무결성 점검**(Citation Integrity — 문제/자문 분리), **근거 부록**(Evidence Appendix — deduped `[E#]` filename#chunkIndex·신뢰수준·검증상태), provider 요약. 인용 무결성·근거 부록은 `not_required` 가드 + 인용 주장 0건이면 생략(blocked 가드는 표시). chunkId/raw chunk 본문은 절대 미포함.

- `format` 기본값 `markdown` (`md` 도 허용). 그 외 → `400 invalid_format`.
- 세션 없음 → `404 not_found`.
- `finalAnswer` 아직 없음 → `409 not_ready`.
- 성공 → `200`, `Content-Type: text/markdown; charset=utf-8`, `Content-Disposition: attachment; filename="council-session-<id>.md"`.
- **제외**: raw provider 응답, parsed 디버그 페이로드, attempt 로그, chunk 전체 본문, 내부 전용 토큰. (builder 가 큐레이션된 필드만 읽음.)
- **미구현**: PDF / DOCX 내보내기.

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
  "message": "이 카탈로그 기반 기관 자동 출처 조회는 아직 구현되지 않았습니다(retrievalEnabled=false). 본 응답은 카탈로그 / 정책 메타데이터만 노출합니다. 사내 문서 키워드 검색과 사용자 제공 공식 URL 조회는 세션의 evidenceMode(internal_docs / internal_docs_web)로 별도 제공됩니다."
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
- 이 엔드포인트는 **키워드 전용**이다. 의미 기반 벡터/하이브리드 검색과 evidence bundle 조립·orchestrator preflight 연결은 evidence 경로(`/api/documents/evidence` + 세션 preflight)에서 제공된다. 후보 chunk 는 결정적 순서로 상한(200) 까지만 스캔 후 in-process 정렬.

```http
GET /api/documents/evidence?query=...&documentType=...&productName=...&issuer=...&limit=N
```

내부문서 검색 결과를 **내부문서 evidence 후보**로 정규화합니다 (`lib/documents/evidence-bundle.ts`). retrieval 경로는 `EVIDENCE_RETRIEVAL_MODE`(keyword/vector/**hybrid** 기본)로 선택되며, 각 hit 를 council 의 evidence 어휘(`lib/council/evidence.ts`)로 매핑합니다.

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
- retrieval 은 `EVIDENCE_RETRIEVAL_MODE`(keyword/vector/**hybrid** 기본)로 키워드·벡터·하이브리드 선택. **미구현**: pgvector 인덱스(앱레벨 코사인 사용), 검증된 citation 강제/grounding. (orchestrator 는 이 HTTP 엔드포인트를 직접 호출하지는 않지만, 동일한 내부 evidence bundle 은 세션 preflight(Step 7/8)에서 사용된다.)

```http
POST /api/documents/blob/upload
Content-Type: application/json
```

**Vercel Blob client-upload 핸들러 (Step 14)** — 대용량 **원본 파일**(PDF/DOCX 등)을 브라우저에서 Vercel Blob 으로 직접 업로드하기 위한 토큰 발급 + 완료 콜백 라우트입니다. 파일 본문이 Next.js 라우트를 경유하지 않습니다(`handleUpload`).

- `BLOB_READ_WRITE_TOKEN` 미설정 → `503 blob_not_configured`.
- JSON 파싱 실패 → `400 invalid_json`.
- 토큰 발급 전 `clientPayload`(`{ filename, contentType, sizeBytes }`)를 검증: 미지원 content type / 크기 초과(기본 25MB) / 형식 오류 → `400 blob_upload_error`.
- 업로드 완료 시(`onUploadCompleted`, Vercel → 서버 webhook) 원본 메타데이터를 `Document` 행(추출 가능 타입은 `status: "needs_extraction"`, 그 외 `original_uploaded`, **chunk 없음**)에 영속화.
- 클라이언트는 `@vercel/blob/client` 의 `upload(pathname, file, { handleUploadUrl: "/api/documents/blob/upload", clientPayload })` 로 호출합니다. `pathname` 은 `buildOriginalBlobPathname(filename)` 사용 권장.
- **원본 blob URL 은 내부값** 입니다 — 목록/검색/evidence 응답에 노출하지 않습니다.
- **지연 추출**: 저장된 원본은 `POST /api/documents/:id/extract` 로 text-layer/OCR 추출 후 chunk 부착 → `chunked` 승격. (OCR 미설정 시 503 `ocr_unavailable`.)
- **미구현**: pgvector 인덱스(앱레벨 코사인 사용), Blob 원본 공개 다운로드 UI. 기존 인라인 `text/plain`·`text/markdown` intake(256KB)는 변경 없음.

---

## Polling 정책

MVP에서는 polling으로 충분합니다.

```text
프론트엔드 polling interval: NEXT_PUBLIC_POLLING_INTERVAL_MS (기본 1500ms)
에러 재시도 cadence: max(2x interval, 3000ms) — 클라이언트가 자동 계산
최대 polling 시간: SESSION_TIMEOUT_MS + 30초
```

Production에서는 SSE 또는 WebSocket을 고려합니다 (`GET /:id/events` 형태로 추가 예정).
