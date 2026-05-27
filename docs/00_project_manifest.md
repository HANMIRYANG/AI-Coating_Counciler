# 00. Project Manifest

## 프로젝트명

```text
ai-coating-council-starter
```

## 목적

기능성 특수 페인트/코팅제 관련 질문에 대해 Gemini, Claude, GPT가 각자 독립 의견을 낸 뒤, 다시 회의/상호비판을 수행하고, 최종적으로 안전하고 근거 중심의 답변을 생성하는 시스템입니다.

## 주요 대상 사용자

- 특수도료 제조사 부장/임원
- 기술영업 담당자
- 연구소/품질 담당자
- 제안서 작성 담당자
- 시험성적서/제품자료를 기반으로 업체 답변을 만들어야 하는 실무자

## 핵심 문제

Gemini 단독 사용 시 다음 문제가 발생합니다.

- 그럴듯하지만 근거 없는 답변
- 불연/화재방지/인증 관련 과장 표현
- 시험 조건 누락
- 내부 제품자료와 맞지 않는 문장 생성
- 업체에 그대로 보내기 위험한 답변

## 핵심 해결 방식

- Multi-provider consensus
- Round-based deliberation
- Provider-level timeout
- Partial completion
- RAG-ready document evidence model
- Domain safety guard
- Audit log
