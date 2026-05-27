# 10. UI / UX Requirements

## 핵심 UX

사용자는 “AI가 멈춘 것 같다”는 느낌을 받으면 안 됩니다.  
따라서 각 AI Provider와 Round 상태를 명확히 표시합니다.

---

## 화면 1: Main Chat

구성:

```text
- 상단: AI Coating Council 로고/타이틀
- 중앙: 채팅형 입력창
- 하단: taskType 선택 (현재 chip 형태 segmented control, 8종 노출)
- AI 회의 시작 버튼
```

Task Type (현재 home 에 노출되는 8종, `lib/council/types.ts: TaskType` 와 1:1):

```text
기술검토            technical_review
적용 아이디어        application_ideas
시험성적서 해석      test_report_interpretation
인증/규격 체크리스트 certification_checklist
문서 기반 답변       document_based_answer
업체 답변 작성       customer_reply
제안서 문구 작성     proposal_copy
위험 표현 검토       risky_phrase_review
```

### 자료 사용 모드 (evidenceMode)

```text
- 현재 home UI 에는 selector 가 노출되지 않습니다.
- `app/page.tsx` 가 evidenceMode 를 ai_only 로 고정 송신합니다.
- internal_docs / internal_docs_web 는 Phase 2 (RAG / 외부 출처 retrieval)
  가 활성화될 때 selector 재도입 예정. 이때 docs/23 의 ideation/evidence
  전략 + DEFAULT_SOURCE_RETRIEVAL_POLICY 를 함께 따른다.
```

---

## 화면 2: Session Progress

Round별 상태를 보여줍니다.

```text
Round 1 독립 의견
  Gemini: 작성 중 / 완료 / timeout
  Claude: 작성 중 / 완료 / timeout
  GPT: 작성 중 / 완료 / timeout

Round 2 회의/상호비판
  Gemini: 회의 의견 작성 중
  Claude: 완료
  GPT: 완료

Round 3 최종 합의안
  최종 답변 생성 중
```

---

## 화면 3: Result

탭 구조 추천:

```text
[최종 답변]
[AI별 초안]
[회의/상호비판]
[근거/누락자료]
[위험표현]
[내부 메모]
```

---

## Provider Card

각 AI 카드에는 다음을 표시합니다.

```text
- Provider 이름
- 상태
- 소요 시간
- 요약
- 확신도
- 주요 주장
- 누락 근거
- 위험 표현
```

---

## Final Answer Panel

최종 답변은 두 가지 모드로 보여줍니다.

### 업체 발송용

외부 업체에 보낼 수 있는 정리된 문장입니다.

### 내부 검토용

근거, 불확실성, 추가 확인 자료, 위험 문구를 포함합니다.

---

## 디자인 톤

Claude Design 반영 전 기본 UI는 다음 원칙을 따릅니다.

```text
- 단색 중심
- 높은 가시성
- 텍스트 우선
- 카드 기반
- 진행 상태 명확화
- 부장님/실무자가 이해하기 쉬운 용어 사용
```
