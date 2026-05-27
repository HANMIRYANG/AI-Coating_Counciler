# 13. RAG Document Strategy

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
