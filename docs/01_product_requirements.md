# 01. Product Requirements

## 제품 정의

**AI Coating Council**은 기능성 특수 페인트/코팅제 분야에 특화된 AI 기술검토 회의 시스템입니다.

사용자는 일반 채팅처럼 질문을 입력하지만, 내부적으로는 다음 절차를 거칩니다.

```text
사용자 프롬프트
→ 질문 유형 분류
→ 관련 자료/정책 컨텍스트 구성
→ Round 1: AI별 독립 의견 생성
→ Round 2: AI별 회의/상호비판
→ Round 3: 최종 합성
→ 안전 문구/누락 자료/업체 발송용 답변 출력
```

## MVP 목표

MVP는 다음을 만족해야 합니다.

- 사용자가 한국어로 질문 입력
- taskType 선택
- Gemini / Claude / GPT 병렬 호출
- Round 1 독립 의견 저장
- Round 2 상호비판 저장
- Round 3 최종 답변 생성
- Provider별 timeout 및 partial completion 지원
- 결과 화면에서 각 단계 확인
- Mock Provider 모드 지원
- 특수도료 안전 표현 검사

## 지원 Task Type

```text
technical_review
test_report_interpretation
customer_reply
proposal_copy
risky_phrase_review
application_ideas
certification_checklist
document_based_answer
```

## MVP에서 하지 않는 것

- 완전한 사내 문서 검색 RAG 구현
- PDF/DOCX 자동 생성
- 사용자 권한별 결재 플로우
- 외부 법령 자동 검증
- 인증기관 API 연동

위 항목은 Phase 2 이후에 구현합니다.
