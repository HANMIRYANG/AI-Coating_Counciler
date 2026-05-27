# 11. Claude Design Integration

## 목적

디자인은 Claude Design으로 별도 제작 예정입니다.  
개발 초기에는 기능 우선 UI를 만들고, Claude Design 결과물을 추후 반영합니다.

---

## Claude Design 산출물 보관 위치

```text
design/claude-design-export/
```

권장 구조:

```text
design/
  claude-design-export/
    2026-05-26-v1/
      original/
      screenshots/
      tokens/
      notes/
```

---

## 개발 참고 이미지 위치

Next.js 앱에서 바로 참고할 수 있도록 복사합니다.

```text
apps/web/public/design-reference/
```

예시:

```text
main-chat-layout.png
council-progress-layout.png
result-dashboard-layout.png
```

---

## 실제 구현 컴포넌트 위치

```text
apps/web/src/components/design/
```

추천 컴포넌트:

```text
CouncilChatLayout.tsx
RoundProgressTimeline.tsx
ProviderOpinionCard.tsx
CritiqueCard.tsx
FinalAnswerPanel.tsx
EvidencePanel.tsx
RiskPhrasePanel.tsx
```

---

## Claude Code에게 줄 디자인 반영 지시

```text
Claude Design 산출물은 /design/claude-design-export/ 에 있습니다.
원본 파일은 수정하지 말고 참고만 하세요.
스크린샷은 /apps/web/public/design-reference/ 로 복사해 개발 중 확인 가능하게 하세요.
기능 구조와 데이터 흐름은 유지하고, UI 레이아웃/스타일만 Claude Design 기준으로 반영하세요.
```

---

## 디자인 적용 시 주의사항

- 기능 로직과 UI 스타일을 섞지 않는다.
- Provider 상태 표시를 숨기지 않는다.
- 최종 답변만 예쁘게 보이고 회의 과정이 사라지면 안 된다.
- 위험표현/누락자료 패널은 반드시 보이게 둔다.
- 단색/고대비/가독성을 우선한다.
