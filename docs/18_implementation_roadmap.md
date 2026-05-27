# 18. Implementation Roadmap

## Day 1: 프로젝트 생성

```text
- Next.js 프로젝트 생성
- Tailwind/shadcn 설정
- Prisma 설정
- 기본 폴더 구조 생성
- Mock Provider 구현
```

## Day 2: Orchestrator

```text
- CouncilSession 생성
- ProviderExecutionService
- withTimeout
- executeRoundInParallel
- Round 1 구현
```

## Day 3: Round 2 / Round 3

```text
- Critique round 구현
- Synthesis round 구현
- partial completion 정책 구현
- safety guard 기본 구현
```

## Day 4: UI

```text
- Prompt input
- Task selector
- Provider status cards
- Round timeline
- Final answer panel
```

## Day 5: 검증

```text
- Mock delay 테스트
- one provider timeout 테스트
- dangerous phrase 테스트
- Codex 리뷰
- 수정사항 반영
```

---

## Phase 2

```text
- 문서 업로드
- PDF parser
- chunking
- embeddings
- RAG retrieval
- evidence bundle
```

### Phase 2 — Ideation Mode + Evidence Source Strategy

세부 설계는 `docs/23_ideation_and_evidence_source_strategy.md` 참조.
이 sub-phase 는 backend 오케스트레이터 / rate limiter / model policy
와 **상호 침범하지 않게** 추가해야 한다.

```text
1. Ideation 모드 UI 노출
   - **현재 상태:** home 의 task type selector 에 8종이 모두 노출되어 있다
     (`apps/web/src/components/design/CouncilDesign.tsx: TASK_MODES`,
     `lib/council/types.ts: TaskType`). 라벨 / 내부값은 docs/23 §6.1 표와 일치.
   - Phase 2 의 잔여 작업은 selector 재도입이 아니라
     **`application_ideas` 전용 출력 스키마 (IdeationFinalAnswer) 활성화**
     이다 (현재는 ProviderOpinion / FinalAnswer 공용 스키마로 fallback).

2. taskType 라우팅
   - prompt template 분기 (application_ideas / certification_checklist /
     test_report_interpretation / document_based_answer).
   - Ideation 출력 스키마 (IdeationItem[] / IdeationFinalAnswer).
   - 안전 가드 (computeRiskLevel, detectUnsafePhrases) 는 그대로 적용.

3. Evidence source catalog
   - sourceCatalog.json 또는 환경 설정.
   - 시드: kolas_kats / kcl / ktr / ktc / fiti / katri / kotiti / kfi /
     kict / custom. KCL 단독 의존 금지.
   - 각 항목 인증 범위 / 시험 방법 명시 (운영자가 verify 책임).

4. 문서 업로드 / RAG
   - Prisma Document, DocumentChunk wiring.
   - PDF/DOCX parser → chunking → embedding → top-k retrieval.
   - 결과는 EvidenceItem[] 으로 정규화.

5. Timeout-safe source retrieval
   - SOURCE_FETCH_TIMEOUT_MS / EVIDENCE_RETRIEVAL_BUDGET_MS /
     MAX_SOURCES_PER_SESSION / MAX_PARALLEL_SOURCE_FETCH.
   - Promise.allSettled, sourceUnavailable 레코드.
   - 부분 성공이면 Round 1 그대로 진행. 전 source 실패는 "근거 없음".

6. Source trust + citation policy
   - Trust levels: uploaded_original / uploaded_copy / official_registry /
     official_public_page / third_party_reference / unverified_web.
   - 업체 발송용 답변은 official + uploaded 한정. third_party / unverified
     는 단서로만.
   - 인용 시 EvidenceItem 의 reportNumber, testMethod, standardCode 동봉.

7. 최종 답변 패널 확장
   - 인용 evidence, 누락 evidence, source 가용 상태, claim safety status.
   - trust level 뱃지.
```

## Phase 3

```text
- PDF/DOCX 출력
- 고객별 프로젝트 관리
- late response revision
- 사용자 권한
```
