# 13. RAG Document Strategy

> **현재 구현 상태 (2026-05-29, Step 3/4/5/6/7/8/9/10 foundation)**
>
> 구현됨:
> - **텍스트 전용 intake**: `POST /api/documents` 가 `text/plain` 과 `text/markdown` 만 수용. PDF/DOCX/이미지/기타 바이너리는 `415` 로 거부.
> - **결정적 chunking** (`lib/documents/chunker.ts`): 단락 분리 → 긴 단락은 문장 packing → 미세 tail merge. 순수 함수, `chunkIndex` 0..N-1 부여.
> - **Prisma 영속화** (`lib/documents/service.ts`): 기존 `Document` / `DocumentChunk` 모델 사용. `embedding` 컬럼은 항상 null. DB 미가용 시 메모리로 silent fallback 하지 않고 `503 database_unavailable` 응답.
> - **타입화된 메타데이터 스키마** (`lib/documents/schemas.ts`): issuer / testMethod / substrate / coatingThickness 등 검증.
> - **메타데이터 영속화 (Step 4)**: 검증된 metadata 블록을 `Document.metadata` (JSONB) 컬럼에 그대로 저장하고 `GET /api/documents` summary 에 노출. unknown 키는 Zod 가 저장 전에 제거. retrieval 에는 아직 사용하지 않음.
> - **키워드 검색 foundation (Step 5)** (`lib/documents/search.ts` + `GET /api/documents/search`): 영속화된 `DocumentChunk.content` 에 대한 결정적 키워드 매칭 + `Document.metadata` (documentType / productName / issuer) 필터. 점수·정렬·snippet 모두 순수 결정적. 임베딩/벡터 검색 아님.
> - **내부 evidence bundle foundation (Step 6)** (`lib/documents/evidence-bundle.ts` + `GET /api/documents/evidence`): 키워드 검색 결과를 내부문서 evidence 후보로 정규화. council evidence 어휘(`trustLevel: uploaded_copy`, `verificationStatus: auto_extracted`) 재사용. 결정적·bounded, chunk 전체 본문 미포함.
> - **세션 단위 evidence retrieval preview (Step 7)** (`lib/council/evidencePreview.ts` + orchestrator preflight + `GET /api/council-sessions/:id`): `evidenceMode !== "ai_only"` 세션은 시작 시 bounded·timeout-safe preflight 로 내부 evidence bundle 을 1회 조회하고, 그 상태(`not_requested`/`ok`/`no_matches`/`unavailable`/`failed`)와 bounded 후보(최대 5, snippet 만)를 세션 스냅샷에 노출. 검색 실패/무매칭이어도 세션은 계속 진행. `ai_only` 동작은 정확히 그대로 유지.
> - **프롬프트 단위 내부 evidence 컨텍스트 주입 (Step 8)** (`prompts.ts: formatEvidenceContextBlock` + orchestrator): Step 7 preview 후보를 Round 1/2/3 provider 프롬프트에 **읽기 전용 컨텍스트**(결정적 한국어 블록)로 주입. `ok` 면 bounded 후보(filename/chunkIndex/snippet/metadata/trust/verification — documentId/chunkId·전체 본문 제외)를 나열하고, `no_matches`/`unavailable`/`failed` 면 "사내 문서 근거 부족" 명시 지침을 제공. provider 는 스니펫을 '후보'로만 사용하고 미입증 주장은 assumptions/missingEvidence 로 분류하도록 지시받음. **키워드-스니펫 컨텍스트이며, 의미 기반 RAG 나 검증된 citation 생성이 아님.** `ai_only` 프롬프트는 byte 단위로 동일하게 유지.
> - **세션 UI evidence preview 표시 (Step 9)** (`components/council/EvidencePreviewPanel.tsx` + `evidencePreviewView.ts`): 세션 화면에서 `evidencePreview` 를 패널로 노출(상태/후보 목록/메타데이터/신뢰수준/snippet). `ok`/`no_matches`/`unavailable`/`failed` 상태별 표시, `ai_only`/`not_requested` 는 패널 비표시. **UI/상태 투명성 전용이며, 최종 답변의 citation 렌더링은 미구현.** chunk 전체 본문은 표시하지 않음.
> - **최종 답변 evidence usage 계약 (Step 10)** (`schemas.ts` + `evidenceUsage.ts` + Prisma `FinalAnswer`): `FinalAnswer` 에 `evidenceUsed`/`coveredClaims`/`uncoveredClaims`/`evidenceCoverageStatus` 를 추가(모두 optional/default, 하위호환). orchestrator 가 세션 evidence preview 로부터 결정론적으로 채움 — ai_only→`not_requested`, ok+모델매핑없음→보수적 `partial`(preview 후보를 참조로), no_matches→`no_evidence`, unavailable/failed→`unavailable`. `sufficient` 는 모델이 명시적으로 산출한 경우에만. **shape 정의/영속화만 구현하며, citation 렌더링 UI 와 검증된 citation 강제는 미구현.**
>
> 미구현 (범위 밖):
> - **PDF / DOCX 파서**: 모두 415 로 거부됨.
> - **임베딩 / 벡터 인덱스**: `DocumentChunk.embedding` 사용 안 함. 검색은 키워드 부분일치만.
> - **벡터 / 의미 기반 retrieval, 최종 RAG retrieval pipeline**.
> - **검증된 citation 생성 / citation 렌더링 UI**: 스니펫은 후보일 뿐 확정 인용이 아니며, 출력 JSON 스키마는 변경되지 않음.
> - **답변 본문의 evidence 근거 강제(grounding) / 자동 사실검증**: 컨텍스트는 제공되지만 모델이 이를 반드시 인용하도록 강제하거나 사후 검증하지는 않음.

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
