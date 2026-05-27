# 23. Ideation Mode + Evidence Source Strategy (Planning)

> **Status:** Planning document. The typed foundation is now in code
> (`apps/web/src/lib/council/evidence.ts`); fetchers / RAG / external
> retrieval are still **not** implemented.
> No web crawler, no real source fetcher, no orchestrator change. This
> document defines product behavior and the contract that a future
> implementation must follow.
>
> **Foundation modules:**
> - `apps/web/src/lib/council/evidenceCatalog.ts` (client-safe, Zod-free) holds the seed catalog data, the trust-level token list, and `EVIDENCE_SOURCE_DISPLAY_LABELS` derived from the enabled subset of the catalog. The home-page readiness panel reads from here so its label list cannot drift from the catalog.
> - `apps/web/src/lib/council/evidence.ts` (server-side, Zod) exposes the schemas and helpers: `EvidenceDocumentType`, `EvidenceTrustLevel`, `EvidenceVerificationStatus`, `EvidenceItem`, `SourceCatalogEntry`, `SourceUnavailableRecord`, `SourceRetrievalPolicy`, `DEFAULT_EVIDENCE_SOURCE_CATALOG`, `DEFAULT_SOURCE_RETRIEVAL_POLICY`, plus `isBusinessCitableTrustLevel`, `canUseEvidenceInBusinessAnswer`, `getSourceCatalogEntry`, and `validateSourceCatalog`.
> - **Future contract (not wired yet):** `evidence.ts` also exports `EvidenceCoverageStatus`, `EvidenceCoverageItem`, `EvidenceCoverageReport`, and `summarizeEvidenceCoverage(report)`. The orchestrator's `FinalAnswer` does NOT yet emit this report; the shape is published so UI / logs / exports can be coded against a stable contract before the retrieval pipeline lands.
> - Read-only `GET /api/evidence-sources` returns the seed catalog + bounded retrieval policy with `retrievalEnabled: false`. No external fetch happens.

---

## 1. Ideation Mode

### 1.1 목적

기존 시스템은 "기술검토 (technical_review)" 중심의 회의 도구입니다.
Ideation Mode 는 다음과 같은 **선행 단계** 작업을 지원합니다.

- 제품 / 적용 아이디어 발굴
- 새로운 코팅 사용 사례 (use case) 탐색
- 고객 제안 각도 (customer proposal angle) 설계
- 실험 / 시험 계획 (experiment / test plan) 초안

기술검토와 달리, ideation 은 **확정된 성능 주장이 아닌 가능성 / 가설** 을 다룹니다.

### 1.2 Ideation vs Technical Review

| 항목 | Ideation Mode | Technical Review |
|---|---|---|
| 출력 성격 | 가능성, 가설, 옵션 | 검증된 성능 표현 가능 (근거 있을 때) |
| 단정 표현 | **금지** — "검토 필요" / "가설 단계" 명시 | 시험성적서 인용 시 한정적 허용 |
| 시험성적서 인용 | 권장하지 않음 (보조 자료 한정) | 필수 |
| 위험 카테고리 (불연/배터리/인증/식품) | 안전 가드 그대로 적용 | 안전 가드 그대로 적용 |
| 최종 답변 톤 | 탐색적, 다중 옵션 | 합의된 결론 + 발송용 문장 |
| Round 2 critique 의 초점 | 너무 단정적이지 않은지 / 시험 조건 누락 표시 | 근거 부족 / 단정 표현 / 인증 표현 |

핵심 원칙:

- Ideation 은 **새 옵션을 제안**할 수 있다.
- Ideation 은 **인증된 성능 주장을 만들 수 없다.**
- 고위험 키워드 (불연, 배터리, 화재, 인증, 법령, SDS/MSDS, warranty 등)
  를 포함한 ideation 응답도 **`models.ts:inferAccuracyMode`** 의
  high-accuracy 라우팅 / safety guard 를 동일하게 거친다.

### 1.3 taskType 라우팅

`taskType` 값을 다음과 같이 사용한다. 모두 기존 schema 에 이미 존재한다.

| taskType | 사용 시나리오 | 출력 스키마 |
|---|---|---|
| `application_ideas` | 새로운 코팅 적용 아이디어 발굴 | Ideation 스키마 (1.4) |
| `technical_review` | 기존 제품의 적용성 검토 | ProviderOpinion / FinalAnswer |
| `test_report_interpretation` | 시험성적서 해석 / 인용 가능 표현 | FinalAnswer + 인용 근거 |
| `certification_checklist` | 인증/규격 체크리스트 작성 | 체크리스트 + 미충족 항목 |
| `document_based_answer` | 사내 자료 기반 답변 | 인용 evidence 포함 FinalAnswer |
| `customer_reply` | 업체 발송용 답변 | businessReadyAnswer 위주 |
| `proposal_copy` | 제안서 문구 | 안전 표현 강화 |
| `risky_phrase_review` | 단정 표현 검토 | 위험 표현 보정안 |

라우팅은 `apps/web/src/lib/council/orchestrator.ts` 의 round 입력 구성
시 task type 별 prompt template 와 후처리 룰을 갈라 적용한다.

### 1.4 Ideation 출력 구조 (제안)

기존 `ProviderOpinion` 위에 obscure 하게 끼워넣지 말고, ideation 전용
output 스키마를 두는 것을 권장한다.

```ts
type IdeationItem = {
  ideaSummary: string;            // 한 줄 요약
  targetApplication: string;      // 대상 적용처
  expectedBenefit: string;        // 기대 효과
  requiredEvidence: string[];     // 필요한 근거 / 시험 항목
  riskLevel: "low" | "medium" | "high" | "critical";
  recommendedNextExperiment: string; // 다음 실험 / 검증 1단계
  doNotClaim: string[];           // 이 단계에서 절대 단정해서는 안 되는 표현
};

type IdeationFinalAnswer = {
  ideas: IdeationItem[];
  unresolvedQuestions: string[];
  followUpResearch: string[];
  riskLevel: "low" | "medium" | "high" | "critical";
};
```

원칙:

- `expectedBenefit` 은 시험성적서 표현이 아니라 "가능성 / 추정" 어조로 작성.
- `doNotClaim` 은 safety guard 가 자동 채워준다. 예: `"100% 불연"`,
  `"배터리 화재 방지"`, `"인증 완료"`.
- `riskLevel` 은 항목별 + 전체 모두 계산한다.

### 1.5 Round 별 동작 차이

- **Round 1** Provider opinion 은 ideation 모드일 때 `IdeationItem[]`
  배열을 생성하도록 prompt template 분기.
- **Round 2** critique 는 단정 표현 / 시험 조건 누락만 보는 것이 아니라
  "이 아이디어가 실제로 검증 가능한가" 도 확인한다.
- **Round 3** synthesis 는 `IdeationFinalAnswer` 를 생성하고, 안전
  가드 (`detectUnsafePhrases`, `computeRiskLevel`) 를 그대로 통과시킨다.

---

## 2. Evidence Source Strategy

### 2.1 KCL 단일 의존 금지

현재 시스템 어느 곳에도 "KCL only" 라는 가정이 들어가서는 안 된다.
시험기관/인증기관은 다수이며, 시험 항목별로 권한과 인증 범위가 다르다.

### 2.2 Source Catalog (초기 목록)

다음 항목을 source catalog 의 시드로 포함한다. **포함되었다는 것은
"이 기관 보고서면 모든 클레임에 자동으로 유효" 라는 뜻이 절대 아니다.**
각 보고서는 (기관, 시험방법, 규격, 적용 조건) 단위로 별도 평가한다.

| key | 기관 | 비고 |
|---|---|---|
| `kolas_kats` | KOLAS / KATS accreditation registry | 인증 범위 / 시험 방법 확인 |
| `kcl` | 한국건설생활환경시험연구원 (KCL) | 건축자재, 난연/내화 등 |
| `ktr` | 한국화학융합시험연구원 (KTR) | 화학 / 환경 / 안전 시험 |
| `ktc` | 한국기계전기전자시험연구원 (KTC) | 전기/전자/기계 시험 |
| `fiti` | 한국FITI시험연구원 (FITI) | 섬유/화학 |
| `katri` | 한국의류시험연구원 (KATRI) | 섬유/의류 |
| `kotiti` | KOTITI시험연구원 (KOTITI) | 섬유/의류 |
| `kfi` | 한국소방산업기술원 (KFI / Korea Fire Institute) | 방염/내화/소방 |
| `kict` | 한국건설기술연구원 (KICT) | 건설 자재 |
| `custom` | 운영자가 설정으로 추가하는 KOLAS 인정 시험소 | sourceCatalog config |

운영자는 `sourceCatalog.json` 또는 환경별 설정으로 신규 KOLAS-accredited
laboratory 를 추가할 수 있다.

### 2.3 Evidence Item 스키마

각 인용 근거는 다음 필드를 갖는다. 누락 필드는 `null` 또는 빈 문자열
허용하지만, 누락 자체는 신뢰도 평가에 반영된다.

```ts
type EvidenceItem = {
  issuer: string;            // 기관명 (e.g. "KCL")
  documentType:              // 문서 유형
    | "test_report"
    | "certification"
    | "sds"
    | "msds"
    | "tds"
    | "technical_datasheet"
    | "internal_memo"
    | "catalog"
    | "other";
  reportNumber: string;
  issuedDate: string;        // ISO date
  testMethod: string;        // e.g. "KS F 2271"
  standardCode: string;      // 규격 코드
  productName: string;
  substrate: string;         // 기재
  coatingThickness: string;  // 도포 두께
  testCondition: string;     // 시험 조건 (온도/습도/시간 등)
  resultSummary: string;     // 결과 요약 (단정 표현 금지)
  pageNumber?: number;
  sourceUrl?: string;        // 외부 공식 페이지 URL
  uploadedFileId?: string;   // 사내 업로드 파일 ID
  confidence: number;        // 0.0 ~ 1.0
  verificationStatus:
    | "verified"             // 사람이 직접 확인 완료
    | "auto_extracted"       // 파싱/추출 결과
    | "needs_review"
    | "unverified";
};
```

---

## 3. Source Trust Levels

```text
uploaded_original       — 사내가 보관한 원본 PDF/스캔
uploaded_copy           — 원본 파생 사본 (요약, OCR 등). 표시 시 주의문구 필요
official_registry       — KOLAS/KATS 또는 인증기관의 공식 등록부 페이지
official_public_page    — 인증기관 공식 홈페이지의 공개 페이지
third_party_reference   — 기관 외 제3자의 인용/요약 (블로그, 뉴스 등)
unverified_web          — 출처 미확인 웹 자료
```

### 3.1 인용 가능성 규칙

| Trust Level | 업체 발송용 답변에 인용 | 내부 검토 메모 | 비고 |
|---|---|---|---|
| `uploaded_original` | ✅ | ✅ | 기준 |
| `uploaded_copy` | ⚠ 가능하나 "사본 기준" 명시 필수 | ✅ | 원본 대조 권장 |
| `official_registry` | ✅ | ✅ | URL/등록번호 함께 인용 |
| `official_public_page` | ✅ | ✅ | URL + 접속일 함께 인용 |
| `third_party_reference` | ❌ | ⚠ 단서로만 사용 | 단정 인용 금지 |
| `unverified_web` | ❌ | ⚠ 단서로만 사용 | 안전성 / 인증 클레임에 사용 금지 |

### 3.2 근거 부족 시

근거가 없으면 **만들어내지 않는다**. 최종 답변에는 반드시 다음을 분리해 표기한다.

- `evidenceBackedClaims` — 인용 가능한 주장
- `assumptions` — 가설/추정 (단정 표현 금지)
- `missingEvidence` — 무엇이 없는지를 명시 (예: "기재 PE 일 때의 시험성적서 없음")
- `unsafePhrases` — 자동 탐지된 단정/과장 표현

---

## 4. Timeout / Reliability Policy (외부 evidence 조회)

외부 source 조회 단계가 **회의를 정지시키지 않도록** 한다.
현재 `provider rate limiter / orchestrator / model policy` 는 그대로
사용한다. 외부 evidence 는 별도 사이드카 단계로 둔다.

### 4.1 권장 설정값 (Phase 2 도입 시)

```text
SOURCE_FETCH_TIMEOUT_MS=8000          # 개별 source 호출 timeout
EVIDENCE_RETRIEVAL_BUDGET_MS=20000    # 전체 retrieval 단계 deadline
MAX_SOURCES_PER_SESSION=6             # 한 세션이 조회하는 최대 source 수
MAX_PARALLEL_SOURCE_FETCH=3           # 동시 fetch 상한
SOURCE_RETRY_LIMIT=0                  # 외부 source 는 재시도하지 않음 (기본)
```

### 4.2 실패 / 부분 성공 처리

- 각 source 호출은 **개별 timeout** 으로 캡쳐. `Promise.allSettled` 사용.
- 한 source 가 실패 / timeout 이면 다른 source 의 결과는 계속 사용.
- 실패한 source 는 세션 상태에 `sourceUnavailable` 레코드로 남긴다.
  ```
  {
    "source": "kfi",
    "reason": "timeout|http_5xx|http_4xx|parse_error|disabled",
    "startedAt": ..., "endedAt": ..., "latencyMs": ...
  }
  ```
- **무한 재시도 금지**. `SOURCE_RETRY_LIMIT=0` 이 기본. 운영자가 명시적으로
  올릴 수 있으나, 절대 budget 을 초과해서는 안 된다.
- Evidence retrieval 이 **부분만 성공**해도 Round 1/2/3 은 계속 진행한다.
- 모든 source 가 실패한 경우 final synthesis 는 "근거 없음 / 확정 불가" 로 작성하고,
  고위험 카테고리 (불연 / 배터리 / 화재 / 인증 / 식품 / 법령) 에서는 단정 표현을 절대
  생성하지 않는다 — `computeRiskLevel` 이 `high`/`critical` 로 격상.

### 4.3 사이드카 / 인라인

> Phase 2 구현 시 권장: evidence retrieval 을 별도 단계 (`Round 0.5`) 로 두고,
> orchestrator 의 sessionDeadline 안에 포함되도록 한다.
> 단, 이 단계가 자체 deadline 을 가지므로 Round 1 시작 시점에는 이미 종료된다.

---

## 5. Future RAG Integration Flow

```text
User Prompt
   │
   ▼
Task Classification (technical_review / application_ideas / ...)
   │
   ▼
Evidence Requirement Detection
   - taskType + 위험 키워드 → 어떤 종류의 근거가 필요한지 추론
   - 예: "배터리팩 외장재 불연" → 난연 시험성적서 + 기재 호환성 + 사용 환경
   │
   ▼
Internal Document Search (RAG, sandbox)
   - Document / DocumentChunk + embedding
   - top-k 청크 + 메타데이터 추출
   │
   ▼
Optional Official Source Lookup (Phase 2)
   - source catalog (KOLAS/KATS, KCL, KTR, KTC, FITI, KATRI, KOTITI, KFI, KICT, custom)
   - 4.1 timeout/budget 적용
   │
   ▼
Evidence Bundle Assembly
   - EvidenceItem[] (2.3 스키마) + Trust Level (3) 표시
   - sourceUnavailable 목록 동봉
   │
   ▼
Round 1: Provider Opinions  (Gemini / Claude / GPT 병렬)
   - 입력에 evidence bundle 포함
   - 안전 가드 / domain safety policy 그대로 적용
   │
   ▼
Round 2: Cross Critique
   - 인용된 evidence 가 실제 클레임을 뒷받침하는지 확인
   - 단정 표현 / 인증 표현 / 시험 조건 누락 탐지
   │
   ▼
Round 3: Final Synthesis
   - businessReadyAnswer + internalMemo
   - source coverage report:
       coveredClaims, uncoveredClaims, contestedClaims
   - missingEvidence 명시
   - unsafePhrases 자동 탐지 결과 그대로 노출
```

---

## 6. UI Planning

### 6.1 task type selector

홈 화면의 "task type" 선택 UI 는 다음 라벨을 사용한다.
(내부 값은 기존 schema 와 동일하게 유지.)

| 라벨 | taskType |
|---|---|
| 검토 | `technical_review` |
| 아이디어 | `application_ideas` |
| 성적서 해석 | `test_report_interpretation` |
| 인증 체크 | `certification_checklist` |
| 문서 기반 답변 | `document_based_answer` |
| (existing) 업체 답변 | `customer_reply` |
| (existing) 제안서 문구 | `proposal_copy` |
| (existing) 위험 표현 검토 | `risky_phrase_review` |

> **현재 상태:** home 페이지의 taskType selector 가 이미 노출되어 있으며
> 위 표의 **8종 모두**를 chip 형태로 선택할 수 있다 (`apps/web/src/components/design/CouncilDesign.tsx: TASK_MODES`).
> Phase 2 추가 작업은 selector 재도입이 아니라 (a) `application_ideas`
> 전용 출력 스키마 (§1.4 `IdeationFinalAnswer`) 와 (b) evidenceMode selector
> 활성화 (RAG 연결 후) 두 가지이다.

### 6.2 evidence mode selector

| 라벨 | evidenceMode |
|---|---|
| AI 만 사용 | `ai_only` |
| 사내 자료 사용 | `internal_docs` |
| 사내 자료 + 공식 출처 조회 | `internal_docs_web` |

각 모드의 동작 / 한계를 selector 옆 도움말로 노출한다.

### 6.3 최종 답변 패널 (확장)

- 인용된 근거 (`evidenceBackedClaims` + 각 항목별 EvidenceItem 링크/번호)
- 누락된 근거 (`missingEvidence`)
- source 가용 상태 (어떤 기관이 응답했고 어떤 기관이 `sourceUnavailable` 인지)
- claim safety status: `safe` / `needs_review` / `cannot_claim`
- 모든 인용에 trust level 뱃지 (`uploaded_original`, `official_registry` 등)

---

## 7. 호환성 / 비-회귀 보장

이 문서가 정의하는 모든 신규 동작은 다음을 침범하지 않는다.

- `lib/council/rateLimiter.ts` — provider 단위 동시성/cooldown/health.
- `lib/council/orchestrator.ts` — Round 1/2/3 deadline 관리, partial completion, attempt log.
- `lib/council/models.ts` — model policy / fallback chain / preview/experimental/latest 차단.
- `lib/council/safety.ts` — 위험 표현 탐지 / riskLevel 계산.
- Codex 가 도입한 Claude Design 통합 컴포넌트 (`components/design/*`).

외부 evidence 단계는 위 모듈들 **앞단** 의 사이드카로 추가되며, 실패가
회의를 중단시켜서는 안 된다.

---

## 8. Open Questions (Phase 2 검토 시 답해야 할 항목)

- 사내 PDF 업로드 권한 / RBAC. 현재 placeholder.
- 인증기관 공식 페이지의 robots.txt / 이용약관 확인. 자동 조회 허용 여부.
- KOLAS/KATS 등록부 API 또는 공개 페이지의 가용성과 SLA.
- evidence cache: 같은 reportNumber 를 재조회할 때 TTL.
- 한국어 OCR 품질 / 시험성적서 표 추출 정확도.
- evidence 별 다국어 표기 (영문 사본 / 국문 사본 매핑).

---

## 9. 관련 문서

- `docs/03_ai_council_workflow.md` — Round 정의
- `docs/04_timeout_and_parallel_execution_policy.md` — 기존 timeout 계층
- `docs/07_provider_adapter_design.md` — Provider 어댑터
- `docs/12_domain_safety_policy.md` — 안전 표현 정책
- `docs/13_rag_document_strategy.md` — RAG 계획 (이 문서가 후속)
- `docs/18_implementation_roadmap.md` — 로드맵 (Phase 2 섹션 추가)
