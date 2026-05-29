# 13. RAG Document Strategy

> **현재 구현 상태 (2026-05-29, Step 3/4/5 foundation)**
>
> 구현됨:
> - **텍스트 전용 intake**: `POST /api/documents` 가 `text/plain` 과 `text/markdown` 만 수용. PDF/DOCX/이미지/기타 바이너리는 `415` 로 거부.
> - **결정적 chunking** (`lib/documents/chunker.ts`): 단락 분리 → 긴 단락은 문장 packing → 미세 tail merge. 순수 함수, `chunkIndex` 0..N-1 부여.
> - **Prisma 영속화** (`lib/documents/service.ts`): 기존 `Document` / `DocumentChunk` 모델 사용. `embedding` 컬럼은 항상 null. DB 미가용 시 메모리로 silent fallback 하지 않고 `503 database_unavailable` 응답.
> - **타입화된 메타데이터 스키마** (`lib/documents/schemas.ts`): issuer / testMethod / substrate / coatingThickness 등 검증.
> - **메타데이터 영속화 (Step 4)**: 검증된 metadata 블록을 `Document.metadata` (JSONB) 컬럼에 그대로 저장하고 `GET /api/documents` summary 에 노출. unknown 키는 Zod 가 저장 전에 제거. retrieval 에는 아직 사용하지 않음.
> - **키워드 검색 foundation (Step 5)** (`lib/documents/search.ts` + `GET /api/documents/search`): 영속화된 `DocumentChunk.content` 에 대한 결정적 키워드 매칭 + `Document.metadata` (documentType / productName / issuer) 필터. 점수·정렬·snippet 모두 순수 결정적. 임베딩/벡터 검색 아님.
>
> 미구현 (범위 밖):
> - **PDF / DOCX 파서**: 모두 415 로 거부됨.
> - **임베딩 / 벡터 인덱스**: `DocumentChunk.embedding` 사용 안 함. 검색은 키워드 부분일치만.
> - **벡터 / 의미 기반 retrieval, evidence bundle 조립**.
> - **Orchestrator 와의 연결**: `evidenceMode` 가 `internal_docs` 라도 현재는 ai_only 와 동일하게 동작. 문서 intake/검색 과 council session 은 아직 무관.

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
