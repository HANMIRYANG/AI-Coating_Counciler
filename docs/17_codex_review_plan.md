# 17. Codex Review Plan

## Codex 역할

Codex는 구현자가 아니라 **검증자/리뷰어**로 사용합니다.

---

## 1차 리뷰

기본 구조 검증:

```text
- Provider Adapter 패턴이 지켜졌는가
- API Key가 서버에서만 사용되는가
- Zod 검증이 있는가
- Prisma 모델이 라운드 구조를 지원하는가
- UI와 서버 로직이 분리되었는가
```

---

## 2차 리뷰

Timeout / 병렬성 검증:

```text
- 순차 await가 없는가
- Promise.allSettled 또는 동등 구조를 사용하는가
- Provider별 timeout이 있는가
- Round timeout이 있는가
- Session timeout이 있는가
- 하나의 Provider 실패가 전체 실패를 만들지 않는가
- Mock Provider로 병렬성 테스트가 가능한가
```

---

## 3차 리뷰

도메인 안전성 검증:

```text
- 위험 표현 탐지 여부
- 누락 자료 표시 여부
- 불연/인증/법령 관련 단정 방지
- 업체 발송용 답변과 내부 메모 분리
```

---

## 4차 리뷰

실제 사용성 검증:

```text
- 부장님이 쓰기 쉬운가
- 진행 상황이 보이는가
- 결과가 너무 복잡하지 않은가
- 최종 답변을 복사하기 쉬운가
```
