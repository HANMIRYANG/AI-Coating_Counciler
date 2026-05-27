# 03. AI Council Workflow

## 핵심 개념

이 시스템은 “AI 3개에게 동시에 물어본다”가 아닙니다.

정확한 구조는 다음입니다.

```text
Round 1: 독립 의견
Round 2: 회의/상호비판
Round 3: 최종 합의안
```

---

## 전체 흐름

```text
[사용자 질문 입력]
        ↓
[CouncilSession 생성]
        ↓
[질문 유형 / 위험도 / 필요한 자료 분류]
        ↓
[Round 1: Independent Opinions]
        ↓
[Round 1 결과 저장]
        ↓
[Round 2: Cross Critique / Meeting]
        ↓
[Round 2 결과 저장]
        ↓
[Round 3: Final Synthesis]
        ↓
[Safety Guard / Unsafe Phrase Check]
        ↓
[FinalAnswer 저장]
        ↓
[UI 출력]
```

---

## Round 1: Independent Opinions

### 목적

각 AI가 서로의 영향을 받지 않고 사용자 질문에 대한 독립 의견을 냅니다.

### 입력

- userPrompt
- taskType
- domainSafetyPolicy
- availableDocumentSummary, Phase 2
- output schema

### 출력

각 Provider는 아래를 생성해야 합니다.

```text
summary
technicalAssessment
evidenceBackedClaims
assumptions
missingEvidence
risks
unsafePhrases
recommendedAnswer
confidenceScore
followUpQuestions
```

---

## Round 2: Cross Critique / Meeting

### 목적

각 AI에게 Round 1의 전체 의견을 다시 제공하고, 다음을 수행하게 합니다.

- 다른 AI 답변의 근거 부족 지적
- 과장 표현 탐지
- 누락된 시험 조건 탐지
- 업체 발송 시 위험한 문장 탐지
- 더 안전한 표현 제안
- 의견 불일치 정리

### 입력

- userPrompt
- allProviderOpinions
- taskType
- domainSafetyPolicy
- knownDangerousPhrases
- output schema

### 출력

```text
agreements
disagreements
unsupportedClaims
unsafePhrasesFound
missingEvidenceFound
recommendedCorrections
providerSpecificCritiques
confidenceAdjustment
```

---

## Round 3: Final Synthesis

### 목적

최종 의장/합성기가 다음 기준으로 최종 답변을 생성합니다.

- Round 1의 독립 의견
- Round 2의 회의/상호비판
- 근거 있는 주장
- 추정
- 누락 자료
- 위험 문장
- 업체 발송 가능 문장

### 출력

```text
conclusion
finalMarkdown
businessReadyAnswer
internalMemo
evidenceBackedClaims
assumptions
missingEvidence
unsafePhrases
recommendedSafeWording
riskLevel
confidenceScore
followUpQuestions
unresolvedDisagreements
```

---

## Round별 최소 성공 조건

```text
Round 1:
- 3개 성공: best
- 2개 성공: proceed
- 1개 성공: limited mode
- 0개 성공: fail

Round 2:
- 3개 critique 성공: best
- 2개 critique 성공: proceed
- 1개 critique 성공: limited synthesis
- 0개 critique 성공: synthesize from Round 1 only, warning required

Round 3:
- synthesis 성공: complete
- synthesis 실패: fallback deterministic summary
```
