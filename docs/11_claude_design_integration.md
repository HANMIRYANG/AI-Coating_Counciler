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

## 현재 구현 상태 (2026-06-01)

**실제 라우트는 이미 Claude Design 기반 UI(`components/design/CouncilDesign.tsx`)
를 사용합니다.** 즉 이전 문서가 언급한 "Phase 1.5 라우트 전환"은 사실상 완료된
상태입니다.

- `/` → `HomeWorkspace` (`components/design/CouncilDesign.tsx`), `app/page.tsx` 에서 import.
- `/sessions/[id]` → `SessionWorkspace` (동일 파일), `app/sessions/[id]/page.tsx` 에서 import.

`CouncilDesign.tsx` 는 opinion/critique/final 카드를 **파일 내부에**
재구현(`AiOpinionCard`, `SynthCard`, `FinalAnswerCard`, `IdeationAnswerCard`)하고,
공용 패널은 `components/council/*` 에서 가져와 조합합니다.

권장 컴포넌트 ↔ 현재 구현 매핑:

| 권장 (이 문서) | 현재 구현 | 비고 |
|---|---|---|
| `CouncilChatLayout.tsx` | `CouncilDesign.tsx: HomeWorkspace` | 입력 폼 + 라우팅. `app/page.tsx` 는 얇은 래퍼. |
| `RoundProgressTimeline.tsx` | `CouncilDesign.tsx: StepperCard` | 디자인 컴포넌트 내부에 구현. |
| `ProviderOpinionCard.tsx` | `CouncilDesign.tsx: AiOpinionCard` | 동일. |
| `CritiqueCard.tsx` | `CouncilDesign.tsx: SynthCard` | 동일. |
| `FinalAnswerPanel.tsx` | `CouncilDesign.tsx: FinalAnswerCard` (+ ideation 시 `IdeationAnswerCard`) | `answerKind` 로 분기(docs/23). |
| `EvidencePanel.tsx` | `components/council/EvidencePanel.tsx` (별도 파일 — 구현됨) | `CouncilDesign` 이 import 해 사용. |
| `RiskPhrasePanel.tsx` | `components/council/RiskPhrasePanel.tsx` (별도 파일 — 구현됨) | `CouncilDesign` 이 import 해 사용. |

`CouncilDesign` 이 함께 사용하는 공용 패널: `EvidencePanel`, `RiskPhrasePanel`,
`EvidencePreviewPanel`, `FinalEvidenceCoveragePanel` (모두 `components/council/`).

### 레거시(현재 라우트 미사용) 컴포넌트

기능 우선 UI 시절의 `components/council/{RoundTimeline,ProviderCard,CritiquePanel,FinalAnswerPanel}.tsx`
는 현재 라우트에서 import 되지 않습니다(디자인 컴포넌트가 in-file 카드로 대체).
정리(삭제 또는 보관) 후보입니다.

### 현재 `components/design/` 의 파일

```text
components/design/icons.tsx         # 공통 아이콘 세트
components/design/CouncilDesign.tsx # 실제 라우트가 사용하는 Claude Design 기반 워크스페이스
```

### Claude Design export 위치

```text
design/claude-design-export/
  index.html
  views.jsx
  components.jsx
  data.jsx
  tweaks-panel.jsx
```

원본은 수정 금지. 리팩토링 시 참고용으로만 활용.

---

## 디자인 적용 시 주의사항

- 기능 로직과 UI 스타일을 섞지 않는다.
- Provider 상태 표시를 숨기지 않는다.
- 최종 답변만 예쁘게 보이고 회의 과정이 사라지면 안 된다.
- 위험표현/누락자료 패널은 반드시 보이게 둔다.
- 단색/고대비/가독성을 우선한다.
