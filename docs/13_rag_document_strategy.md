# 13. RAG Document Strategy

> **현재 구현 상태 (2026-06-04, Step 3~12/14 + PDF·DOCX 파싱 / OCR fallback / Blob 지연추출)**
>
> 구현됨:
> - **텍스트 전용 intake**: `POST /api/documents` 가 `text/plain` 과 `text/markdown` 만 수용. PDF/DOCX/이미지/기타 바이너리는 `415` 로 거부.
> - **결정적 chunking** (`lib/documents/chunker.ts`): 단락 분리 → 긴 단락은 문장 packing → 미세 tail merge. 순수 함수, `chunkIndex` 0..N-1 부여.
> - **Prisma 영속화** (`lib/documents/service.ts`): 기존 `Document` / `DocumentChunk` 모델 사용. `embedding` 컬럼은 인텍이크 시 best-effort 로 채워지고(실패 시 null, 키워드 검색은 계속), 기존 청크는 `POST /api/documents/embeddings/backfill` 로 채운다. DB 미가용 시 메모리로 silent fallback 하지 않고 `503 database_unavailable` 응답.
> - **타입화된 메타데이터 스키마** (`lib/documents/schemas.ts`): issuer / testMethod / substrate / coatingThickness 등 검증.
> - **메타데이터 영속화 (Step 4)**: 검증된 metadata 블록을 `Document.metadata` (JSONB) 컬럼에 그대로 저장하고 `GET /api/documents` summary 에 노출. unknown 키는 Zod 가 저장 전에 제거. metadata 필터(documentType / productName / issuer)는 키워드·벡터·하이브리드 retrieval 후보 스캔에 사용된다.
> - **키워드 검색 foundation (Step 5)** (`lib/documents/search.ts` + `GET /api/documents/search`): 영속화된 `DocumentChunk.content` 에 대한 결정적 키워드 매칭 + `Document.metadata` (documentType / productName / issuer) 필터. 점수·정렬·snippet 모두 순수 결정적. **이 모듈은 키워드 전용**이며, 의미 기반 벡터 검색은 아래 "의미 기반(하이브리드) 검색" 항목에서 별도 모듈로 추가됨.
> - **내부 evidence bundle foundation (Step 6)** (`lib/documents/evidence-bundle.ts` + `GET /api/documents/evidence`): 키워드 검색 결과를 내부문서 evidence 후보로 정규화. council evidence 어휘(`trustLevel: uploaded_copy`, `verificationStatus: auto_extracted`) 재사용. 결정적·bounded, chunk 전체 본문 미포함.
> - **세션 단위 evidence retrieval preview (Step 7)** (`lib/council/evidencePreview.ts` + orchestrator preflight + `GET /api/council-sessions/:id`): `evidenceMode !== "ai_only"` 세션은 시작 시 bounded·timeout-safe preflight 로 내부 evidence bundle 을 1회 조회하고, 그 상태(`not_requested`/`ok`/`no_matches`/`unavailable`/`failed`)와 bounded 후보(최대 5, snippet 만)를 세션 스냅샷에 노출. 검색 실패/무매칭이어도 세션은 계속 진행. `ai_only` 동작은 정확히 그대로 유지.
> - **프롬프트 단위 내부 evidence 컨텍스트 주입 (Step 8)** (`prompts.ts: formatEvidenceContextBlock` + orchestrator): Step 7 preview 후보를 Round 1/2/3 provider 프롬프트에 **읽기 전용 컨텍스트**(결정적 한국어 블록)로 주입. `ok` 면 bounded 후보(filename/chunkIndex/snippet/metadata/trust/verification — documentId/chunkId·전체 본문 제외)를 나열하고, `no_matches`/`unavailable`/`failed` 면 "사내 문서 근거 부족" 명시 지침을 제공. provider 는 스니펫을 '후보'로만 사용하고 미입증 주장은 assumptions/missingEvidence 로 분류하도록 지시받음. **제공되는 것은 후보 스니펫(현재 키워드+벡터 하이브리드 검색 결과)이며, 검증된 확정 citation 이 아니다(grounding 강제 없음).** `ai_only` 프롬프트는 byte 단위로 동일하게 유지.
> - **세션 UI evidence preview 표시 (Step 9)** (`components/council/EvidencePreviewPanel.tsx` + `evidencePreviewView.ts`): 세션 화면에서 `evidencePreview` 를 패널로 노출(상태/후보 목록/메타데이터/신뢰수준/snippet). `ok`/`no_matches`/`unavailable`/`failed` 상태별 표시, `ai_only`/`not_requested` 는 패널 비표시. **UI/상태 투명성 전용이며, 최종 답변의 citation 렌더링은 미구현.** chunk 전체 본문은 표시하지 않음.
> - **최종 답변 evidence usage 계약 (Step 10)** (`schemas.ts` + `evidenceUsage.ts` + Prisma `FinalAnswer`): `FinalAnswer` 에 `evidenceUsed`/`coveredClaims`/`uncoveredClaims`/`evidenceCoverageStatus` 를 추가(모두 optional/default, 하위호환). orchestrator 가 세션 evidence preview 로부터 결정론적으로 채움 — ai_only→`not_requested`, ok+모델매핑없음→보수적 `partial`(preview 후보를 참조로), no_matches→`no_evidence`, unavailable/failed→`unavailable`. `sufficient` 는 모델이 명시적으로 산출한 경우에만. **shape 정의/영속화만 구현.**
> - **최종 답변 evidence 커버리지 UI (Step 11)** (`components/council/FinalEvidenceCoveragePanel.tsx` + `finalEvidenceCoverageView.ts`): 내부 검토용 카드에서 Step 10 계약을 표시 전용으로 시각화 — 상태 라벨(`not_requested`/`no_evidence`/`partial`/`sufficient`/`unavailable`), evidence 참조(`filename #chunkIndex · 신뢰수준 · 검증상태`), 근거 연결/부족 주장. `not_requested` 는 비표시, 비충분 상태는 검토 경고 표시. chunk 전체 본문·내부 ID 비노출. **검증된 citation 강제·모델 재검증은 여전히 미구현(다음 슬라이스).**
> - **세션 Markdown 내보내기 (Step 12)** (`lib/council/sessionMarkdown.ts` + `GET /api/council-sessions/:id/export?format=markdown` + UI "MD 내보내기" 버튼): 완료 세션을 결정적 Markdown 으로 내보냄. 최종 답변/내부 메모/누락 근거/위험 표현과 함께 **근거 커버리지**(`evidenceCoverageStatus`/`evidenceUsed`/covered·uncovered claims)를 포함. raw provider 응답·디버그·attempt 로그·chunk 본문은 제외. **PDF/DOCX 내보내기는 미구현.**
>
> - **Vercel Blob 원본 파일 저장 foundation (Step 14)** (`lib/documents/blobStorage.ts` + `POST /api/documents/blob/upload` + `Document.originalBlob*` 컬럼): 대용량 바이너리 원본(PDF/DOCX/이미지)을 Vercel Blob client-upload 흐름으로 저장하고 메타데이터만 DB 에 남김(추출 가능 타입은 `status: "needs_extraction"`, 그 외 `original_uploaded`, chunk 없음). 원본 blob URL 은 내부값으로 목록/검색/evidence 에 노출 안 함. **추출/파싱/OCR 는 아래 별도 단계(`/api/documents/:id/extract`)로 구현됨 — 임베딩/벡터 RAG 만 미구현.** 기존 인라인 text/markdown intake(256KB)는 변경 없음.
>
> - **PDF / DOCX 파싱 + OCR fallback + Blob 지연추출** (`lib/documents/extract.ts` + `lib/documents/ocr.ts` + `POST /api/documents/parse` + `POST /api/documents/:id/extract`): 멀티파트 파일은 text-layer 추출 후 텍스트가 없으면 Google Document AI OCR 로 대체하고, 이미지는 곧바로 OCR 한다. Blob 원본은 `needs_extraction` 으로 등록했다가 지연 추출 시 `chunked` 로 승격한다. 추출 결과는 기존 결정적 chunking 경로로 흘러간다. 에러→HTTP status 매핑은 `extractErrorToStatus` 로 두 라우트가 공유(`ocr_unavailable`=503). **인라인 `POST /api/documents` (text/markdown 전용) 는 그대로 PDF/DOCX/이미지를 415 로 거부한다.**
>
> - **의미 기반(하이브리드) 검색** (`lib/documents/embeddings.ts` + `lib/documents/vectorSearch.ts` + `POST /api/documents/embeddings/backfill`): 청크를 임베딩(`OpenAI text-embedding-3-small`; `USE_MOCK_PROVIDERS=true`/키 없음 → 결정적 MockEmbedder)해 `DocumentChunk.embedding`(LE Float32, **마이그레이션 없음**)에 저장하고, **앱레벨 코사인**으로 벡터/하이브리드 검색을 수행한다. evidence 경로는 `EVIDENCE_RETRIEVAL_MODE`(keyword/vector/**hybrid** 기본)로 선택. 임베딩 없으면 hybrid/vector 는 키워드로 자연 degrade. 인텍이크 시 best-effort 임베딩(실패해도 문서 생성 계속), 기존 청크는 backfill 라우트로. `GET /api/documents/search`(키워드)는 불변.
>
> - **Retrieval Guard (인용 충분성 게이트)** (`lib/council/retrievalGuard.ts` + orchestrator + schemas `retrievalGuard` + sessionMarkdown + FinalEvidenceCoveragePanel): `applyEvidenceUsage` 직후 결정적으로 실행되어 최종 답변에 `retrievalGuard`(guardStatus `not_required|passed|warning|blocked`, reasons, requiredEvidence, **businessCitationReady**, recommendedAction)를 부착한다. 답변을 재작성하지 않고 분류만 한다. 정책(보수적): `ai_only`→not_required(필요 작업/고위험이면 warning), 고위험·`document_based_answer`·`certification_checklist`는 근거 필수 — 근거 없음/불가면 **blocked**, 부분이면 **warning**. `businessCitationReady=true` 는 `sufficient`(검증된 매핑·uncovered 0) + 업체-인용 가능 신뢰수준(uploaded/official)일 때만. `unverified_web` 단독은 절대 발송 가능 아님. 모든 답변 형식(standard/ideation/checklist) 하위호환(optional, 기존 저장 답변은 기본값으로 파싱).
>
> 미구현 (범위 밖):
> - **pgvector 인덱스**: 현재는 bounded 스캔 + 인프로세스 코사인. 대규모 코퍼스 확장 시 pgvector 로.
> - **검증된 citation 강제는 가드/상태 검증 수준**: Retrieval Guard 는 인용 충분성·유효성에 대한 결정적 게이트이며 사실의 **법적 인증이 아니다**. 모델이 답변 본문에서 특정 chunk 를 반드시 인용하도록 강제하는 grounding/자동 사실검증, citation 렌더링 UI 는 미구현.
> - **사용자 인증/RBAC**: write 엔드포인트는 선택적 공유 토큰(`API_WRITE_TOKEN`)만 — 전체 RBAC 는 향후 작업.

## Phase 2 목표

문서 기반 답변을 위해 내부 자료를 업로드하고 검색하는 기능을 추가합니다.

---

## 대상 문서

```text
- 제품 설명서
- 카탈로그
- TDS
- SDS/MSDS
- 시험성적서
- 인증서
- 특허
- 기존 제안서
- 업체 미팅자료
- 법령/규격 관련 참고자료
```

---

## RAG 원칙

AI가 내부 문서에 없는 주장을 하면 안 됩니다.

답변은 다음으로 구분합니다.

```text
1. 내부 문서로 확인된 내용
2. 문서에는 없지만 합리적 추정인 내용
3. 확인 불가능한 내용
4. 추가 자료가 필요한 내용
```

---

## Document Metadata

```text
productName
documentType
version
issuedDate
issuer
testMethod
substrate
coatingThickness
temperatureCondition
pageNumber
```

---

## Chunking Strategy

시험성적서와 제품 설명서는 일반 문서와 다르게 처리해야 합니다.

```text
- 시험 항목 단위
- 표 단위
- 결과값 단위
- 시험 조건 단위
- 결론/비고 단위
```

---

## Retrieval Guard

사용자 질문이 고위험 분야일 경우 반드시 문서 근거를 요구합니다.

```text
if task includes fireproofing / certification / safety:
  require evidence documents
else:
  allow general technical review with uncertainty
```

---

## RAG 적용 후 Council Workflow

```text
User Prompt
→ Query Analysis
→ Document Retrieval
→ Evidence Bundle 생성
→ Round 1 AI 독립 의견
→ Round 2 회의/비판
→ Final Synthesis with Evidence
```
