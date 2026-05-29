# 14. Deployment — Vercel + Neon

이 문서는 현재 Next.js 앱(`apps/web`)을 **Vercel**(호스팅) + **Neon Postgres**(영속 DB)로
배포하기 위한 준비 사항을 정리합니다. 문서 intake/search/evidence/export 동작은 그대로
유지됩니다.

---

## 1. 핵심 결정 사항

### 1-1. 세션 백그라운드 실행 (Vercel-safe)

세션 생성/시작 라우트는 HTTP 응답으로 `sessionId` 를 즉시 반환한 뒤, **응답 이후**에
council 오케스트레이션을 백그라운드로 실행합니다(클라이언트는 polling 으로 상태 확인).

- 단순한 `void promise` 는 Vercel serverless 에서 **안전하지 않습니다** — 응답이 flush 되면
  함수가 동결/종료되어 진행 중인 작업이 죽을 수 있습니다.
- 따라서 `lib/runtime/backgroundTask.ts` 의 `runAfterResponse()` 를 사용합니다. 이는 Vercel
  요청 컨텍스트의 `waitUntil` (`Symbol.for("@vercel/request-context")`) 을 직접 읽어 함수
  수명을 연장하며, Vercel 이 아닌 환경(로컬 dev / `next start` / 테스트)에서는 in-process
  `void` 로 폴백합니다.
- 본 프로젝트의 Next 버전(14.2.x)에는 `next/server` 의 `unstable_after` 가 없으므로 위
  방식이 이 버전에서 지원되는 백그라운드 메커니즘입니다. (큐 벤더는 도입하지 않았습니다.)
- 생성/시작 라우트에는 `export const maxDuration = 300` 을 두었습니다. 백그라운드 작업은 이
  상한까지만 살아 있으며, **반드시 `SESSION_TIMEOUT_MS` 이상이고 Vercel 플랜의 함수 실행
  한도 이내**여야 합니다.

> **플랜 주의**: Hobby 플랜의 함수 실행 한도는 짧습니다(분 단위 미만). 실제 provider 로 전체
> 3-Round 세션(기본 `SESSION_TIMEOUT_MS=240000`)을 완료하려면 Pro 이상에서 `maxDuration`
> 을 허용하거나, timeout 값을 함수 한도 이내로 낮춰야 합니다.

### 1-2. 세션 저장소

- 프로덕션에서는 **`SESSION_STORE=prisma`** 가 필수입니다. serverless invocation 마다 새
  isolate 이므로 in-memory store 로는 poll-for-status 흐름을 invocation 간에 이어갈 수
  없습니다.
- `PrismaSessionStore` 는 `store.ts` 에서 `SESSION_STORE=prisma` 일 때 lazy-require 됩니다.

### 1-3. Neon 연결 (pooled vs direct)

`prisma/schema.prisma` 의 datasource:

```prisma
datasource db {
  provider  = "postgresql"
  url       = env("DATABASE_URL")  // 런타임 — Neon POOLED (pgbouncer)
  directUrl = env("DIRECT_URL")    // 마이그레이션 — Neon DIRECT (non-pooled)
}
```

- `DATABASE_URL`: Neon **pooled** 런타임 URL (`-pooler` 호스트, `?sslmode=require`).
- `DIRECT_URL`: Neon **direct** URL. `prisma migrate deploy` / introspection 전용.
- 로컬에서는 둘을 동일한 문자열로 두어도 됩니다.

---

## 2. Vercel 환경 변수

Vercel Project → Settings → Environment Variables 에 설정합니다.

| 변수 | 필수 | 설명 |
| --- | --- | --- |
| `DATABASE_URL` | ✅ | Neon **pooled** 런타임 URL |
| `DIRECT_URL` | ✅ | Neon **direct** URL (마이그레이션용) |
| `SESSION_STORE` | ✅ | 프로덕션에서는 `prisma` |
| `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `GEMINI_API_KEY` | 실호출 시 | provider API 키 |
| `USE_MOCK_PROVIDERS` | 선택 | 데모 시 `true` (키 없이 mock 흐름) |
| `*_PRIMARY_MODEL` / `*_FALLBACK_MODEL` / `*_FAST_FALLBACK_MODEL` / `*_HIGH_ACCURACY_MODEL` | 선택 | 모델 라우팅 오버라이드 (`.env.example` 참고) |
| `ALLOW_PREVIEW_MODELS` / `ALLOW_EXPERIMENTAL_MODELS` / `ALLOW_LATEST_MODELS` | 선택 | 프로덕션에서는 모두 `false` |
| `PROVIDER_TIMEOUT_MS` / `ROUND_TIMEOUT_MS` / `SYNTHESIS_TIMEOUT_MS` / `SESSION_TIMEOUT_MS` | 선택 | **함수 `maxDuration` 이내로 조정** |
| `MAX_PROVIDER_RETRIES` / `RETRY_BASE_DELAY_MS` / `RETRY_MAX_DELAY_MS` | 선택 | 재시도 정책 |
| `MIN_INITIAL_OPINIONS_FOR_MEETING` / `MIN_CRITIQUES_FOR_SYNTHESIS` | 선택 | 부분완료 임계값 |
| `RATE_LIMIT_*` | 선택 | provider별 동시성/쿨다운 |
| `NEXT_PUBLIC_POLLING_INTERVAL_MS` | 선택 | 클라이언트 polling 간격 (빌드 타임 인라인) |
| `ADMIN_DEBUG_TOKEN` | 권장 | `?debug=1` 페이로드 보호. 미설정 시 운영(`NODE_ENV=production`)에서는 debug 차단 |
| `BLOB_READ_WRITE_TOKEN` | 원본 업로드 시 | Vercel Blob 스토어 read-write 토큰. `POST /api/documents/blob/upload` 가 사용. 미설정 시 해당 라우트 `503`. |

> `ADMIN_DEBUG_TOKEN` 을 설정하지 않으면 운영에서 `?debug=1` 이 자동 차단되어 raw/forensic
> 페이로드가 노출되지 않습니다. 신뢰 네트워크 밖에 노출하기 전 반드시 검토하세요.

---

## 3. 마이그레이션 / 빌드

- 마이그레이션은 **`DIRECT_URL`** 로 실행합니다: `prisma migrate deploy`.
- Vercel 빌드시 Prisma Client 가 생성되어야 합니다. `postinstall` 또는 빌드 단계에서
  `prisma generate` 가 실행되는지 확인하세요(권장: build command 에 `prisma generate` 포함).
- Edge 런타임을 쓰지 않습니다 — Prisma 가 필요한 라우트는 `export const runtime = "nodejs"`
  로 고정되어 있습니다.

---

## 4. 대용량 원본 파일 저장 (Vercel Blob, Step 14)

- 현재 **인라인 문서 intake** (`POST /api/documents`) 는 여전히 **`text/plain` / `text/markdown`**
  본문만 받으며, 크기 상한은 기존 `MAX_DOCUMENT_BYTES`(256KB UTF-8) 그대로입니다. PDF/DOCX/
  이미지는 인라인 경로에서 415 로 거부됩니다.
- 대용량 **바이너리 원본**(PDF/DOCX/이미지 등)은 **Vercel Blob** 에 client-upload 흐름으로
  저장합니다:
  - 라우트: `POST /api/documents/blob/upload` (`@vercel/blob/client` 의 `handleUpload`). 파일
    본문은 라우트를 경유하지 않고 브라우저 → Blob 으로 직접 업로드됩니다.
  - 토큰 발급 전에 filename / content type / size(기본 상한 25MB)를 검증합니다.
  - 업로드 완료 시 원본 메타데이터를 `Document`(`status: "original_uploaded"`, **chunk 없음**)에
    영속화하고, blob URL 은 내부값으로만 보관합니다(목록/검색/evidence 비노출).
- **Blob 스토어는 PRIVATE 접근**으로 생성하는 것을 권장합니다(시험성적서 등 기밀 가능). 코드는
  blob URL 을 공개 응답에 노출하지 않습니다.
- 설정: Vercel 대시보드에서 Blob 스토어 생성 후 `BLOB_READ_WRITE_TOKEN` 을 환경변수로
  추가합니다. 미설정 시 업로드 라우트는 `503` 을 반환합니다.
- **미구현**: 원본에 대한 파싱/OCR/추출, 바이너리 chunking/임베딩/검색, 공개 다운로드 UI.
  Blob 은 현재 **원본 보관 전용**입니다.

---

## 5. 프로덕션 스모크 체크리스트

배포 파이프라인/수동 점검 순서:

```text
1. prisma migrate deploy          # DIRECT_URL 사용, 스키마 적용
2. npx prisma validate            # DATABASE_URL + DIRECT_URL 필요
3. npx tsc --noEmit               # 타입 점검
4. npm test --workspace apps/web  # 단위 테스트
5. npm run test:e2e --workspace apps/web   # 홈 스모크(E2E)
6. SESSION_STORE=prisma + USE_MOCK_PROVIDERS=true 로 mock 세션 1건 생성
   - POST /api/council-sessions → 201 { sessionId }
   - GET  /api/council-sessions/:id 로 status 가 terminal 까지 진행되는지 polling
7. 완료 세션 export 확인
   - GET /api/council-sessions/:id/export?format=markdown → 200 text/markdown
```

---

## 6. 범위 밖 (이번 단계 미구현)

- PDF/DOCX 파싱
- Blob 업로드 UI / 공개 다운로드 UI
- 임베딩 / 벡터 검색
- 외부 웹 조회
- 큐(provider) 통합
- 검증된 citation 강제
