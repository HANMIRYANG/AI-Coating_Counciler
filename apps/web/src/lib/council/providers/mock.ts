// Mock provider used for tests and local development without API keys.
//
// Behavior is driven by environment variables (read at construction time) so
// tests and integration scripts can inject delays, failures, or hangs to
// validate orchestration:
//
//   MOCK_GEMINI_DELAY_MS=2500
//   MOCK_FAIL_PROVIDER=gemini     → throws non-retryable error
//   MOCK_TIMEOUT_PROVIDER=claude  → exceeds PROVIDER_TIMEOUT_MS
//   MOCK_HANG_PROVIDER=openai     → never resolves (deadline must trigger)

import type { AiProviderAdapter } from "../provider";
import type {
  CritiqueInput,
  InitialOpinionInput,
  ProviderCallOptions,
  ProviderId,
  SynthesisInput,
} from "../types";
import {
  CertificationChecklistFinalAnswerSchema,
  FinalAnswerSchema,
  IdeationFinalAnswerSchema,
  type CertificationChecklistFinalAnswer,
  type FinalAnswer,
  type IdeationFinalAnswer,
  type ProviderCritique,
  type ProviderOpinion,
  type SynthesisResult,
} from "../schemas";
import { sleep } from "../timeout";
import { detectUnsafePhrases } from "../safety";
import { markRateLimited } from "../rateLimiter";

type FailureMode =
  | "ok"
  | "fail"
  | "timeout"
  | "hang"
  | "rate_limit"
  | "retryable_5xx";

type MockConfig = {
  delayMs: number;
  failureMode: FailureMode;
  /**
   * Optional override applied only to `generateSynthesis`. Lets tests make
   * Round 1/2 succeed but synthesis fail (useful for sessionTimeoutMs tests).
   */
  synthesisFailureMode?: FailureMode;
  displayName: string;
  model: string;
};

const PROVIDER_ALIASES: Record<ProviderId, readonly string[]> = {
  gemini: ["gemini"],
  anthropic: ["claude", "anthropic"],
  openai: ["openai", "gpt"],
};

function envMatchesProvider(envVal: string | undefined, id: ProviderId) {
  if (!envVal) return false;
  const v = envVal.trim().toLowerCase();
  return PROVIDER_ALIASES[id].some((a) => a === v);
}

function readMockConfig(id: ProviderId): MockConfig {
  const env = (k: string) => process.env[k];

  const delays: Record<ProviderId, number> = {
    gemini: Number(env("MOCK_GEMINI_DELAY_MS") ?? 2500),
    anthropic: Number(env("MOCK_CLAUDE_DELAY_MS") ?? 3500),
    openai: Number(env("MOCK_OPENAI_DELAY_MS") ?? 4500),
  };

  let failureMode: MockConfig["failureMode"] = "ok";
  if (envMatchesProvider(env("MOCK_FAIL_PROVIDER"), id)) failureMode = "fail";
  else if (envMatchesProvider(env("MOCK_TIMEOUT_PROVIDER"), id))
    failureMode = "timeout";
  else if (envMatchesProvider(env("MOCK_HANG_PROVIDER"), id))
    failureMode = "hang";
  else if (envMatchesProvider(env("MOCK_RATE_LIMIT_PROVIDER"), id))
    failureMode = "rate_limit";

  const displayName: Record<ProviderId, string> = {
    gemini: "Gemini (mock)",
    anthropic: "Claude (mock)",
    openai: "GPT (mock)",
  };

  const model: Record<ProviderId, string> = {
    gemini: process.env.GEMINI_MODEL ?? "gemini-mock",
    anthropic: process.env.ANTHROPIC_MODEL ?? "claude-mock",
    openai: process.env.OPENAI_MODEL ?? "gpt-mock",
  };

  return {
    delayMs: delays[id],
    failureMode,
    displayName: displayName[id],
    model: model[id],
  };
}

export class MockProviderAdapter implements AiProviderAdapter {
  readonly id: ProviderId;
  readonly displayName: string;
  readonly model: string;
  private cfg: MockConfig;

  /**
   * Test-only call history per round. Each entry records the model the
   * orchestrator asked us to use (via options.model) so tests can assert
   * fallback-chain and high-accuracy routing.
   */
  public readonly callsByRound: {
    initial: Array<{ model: string }>;
    critique: Array<{ model: string }>;
    synthesis: Array<{ model: string }>;
  } = { initial: [], critique: [], synthesis: [] };

  constructor(id: ProviderId, override?: Partial<MockConfig>) {
    this.id = id;
    this.cfg = { ...readMockConfig(id), ...override };
    this.displayName = this.cfg.displayName;
    this.model = this.cfg.model;
  }

  private resolveModel(opts: ProviderCallOptions): string {
    return opts.model ?? this.model;
  }

  /** Honors the AbortSignal so withTimeout can cancel us. */
  private async applyDelay(
    opts: ProviderCallOptions,
    modeOverride?: FailureMode,
  ): Promise<void> {
    const mode = modeOverride ?? this.cfg.failureMode;

    if (mode === "fail") {
      throw Object.assign(
        new Error(
          `Mock provider [${this.id}] forced failure (MOCK_FAIL_PROVIDER).`,
        ),
        { code: "mock_forced_failure", retryable: false },
      );
    }
    if (mode === "retryable_5xx") {
      throw Object.assign(
        new Error(`Mock provider [${this.id}] forced 503`),
        { status: 503, message: "service unavailable" },
      );
    }
    if (mode === "rate_limit") {
      throw markRateLimited(this.id, {
        retryAfterMs: 10,
        message: `Mock provider [${this.id}] forced 429 (MOCK_RATE_LIMIT_PROVIDER).`,
      });
    }
    if (mode === "hang") {
      await sleep(60 * 60 * 1000, opts.abortSignal);
      return;
    }
    if (mode === "timeout") {
      await sleep(opts.timeoutMs * 3, opts.abortSignal);
      return;
    }
    await sleep(this.cfg.delayMs, opts.abortSignal);
  }

  async generateInitialOpinion(
    input: InitialOpinionInput,
    options: ProviderCallOptions,
  ): Promise<ProviderOpinion> {
    const model = this.resolveModel(options);
    this.callsByRound.initial.push({ model });
    await this.applyDelay(options);
    const detected = detectUnsafePhrases(input.userPrompt);
    return buildMockOpinion(
      this.id,
      model,
      input,
      detected.map((d) => d.matchedText),
    );
  }

  async generateCritique(
    input: CritiqueInput,
    options: ProviderCallOptions,
  ): Promise<ProviderCritique> {
    const model = this.resolveModel(options);
    this.callsByRound.critique.push({ model });
    await this.applyDelay(options);
    return buildMockCritique(this.id, model, input);
  }

  async generateSynthesis(
    input: SynthesisInput,
    options: ProviderCallOptions,
  ): Promise<SynthesisResult> {
    const model = this.resolveModel(options);
    this.callsByRound.synthesis.push({ model });
    await this.applyDelay(options, this.cfg.synthesisFailureMode);
    if (input.taskType === "application_ideas") return buildMockIdeation(input);
    if (input.taskType === "certification_checklist")
      return buildMockChecklist(input);
    return buildMockSynthesis(this.id, input);
  }
}

// ───────────────────────── shaped mock outputs ─────────────────────────────

function buildMockOpinion(
  providerId: ProviderId,
  model: string,
  input: InitialOpinionInput,
  detectedUnsafe: string[],
): ProviderOpinion {
  // Provider role flavoring matches docs/05_round_based_orchestration.md.
  const role: Record<ProviderId, string> = {
    gemini: "적용처 확장 및 시장/사례 관점 검토",
    anthropic: "기술 문서 품질 / 업체 발송 문장 톤 / 과장 표현 완화",
    openai: "구조화 / 위험 분리 / evidence vs assumption 구분",
  };

  return {
    providerId,
    model,
    summary: `[${providerId}] 사용자 질문에 대한 ${role[providerId]} 초안. 적용 가능성은 조건부로 존재하나 단정적 표현은 회피해야 합니다.`,
    technicalAssessment: [
      {
        topic: "적용 가능성",
        detail:
          "외피층 한정·도포 두께 100~150㎛ 조건에서 제한적 적용 가능성 검토.",
      },
      {
        topic: "성능 표현 수준",
        detail:
          "시험성적서 미확보 항목은 단정하지 않고 시험 조건 명시 후 인용 권장.",
      },
    ],
    evidenceBackedClaims: [
      "내부 기술자료에 기재된 도포 두께/기재 호환성 범위 내 적용 가능",
    ],
    assumptions: [
      "사용자가 언급한 적용 대상의 사용 환경 정보가 제한적임",
      "장기 신뢰성(>5년) 데이터는 본 응답에 포함되지 않았음",
    ],
    missingEvidence: [
      "시험성적서",
      "기재 호환성 시험 결과",
      "사용 환경(온도/습도/진동) 사양",
      "도포 두께 및 건조 조건",
    ],
    risks: [
      {
        description:
          "단정 표현이 외부 발송 시 클레임 또는 광고법 위반으로 이어질 수 있음.",
        severity: "high",
      },
    ],
    unsafePhrases: detectedUnsafe.map((p) => ({
      phrase: p,
      reason: "사용자 입력 또는 기존 답변에 위험 표현이 포함되어 있음.",
    })),
    recommendedAnswer:
      "현재 제공된 자료 기준으로는 외피층 적용에 한해 제한적으로 가능성 검토가 가능하며, 인증/시험 조건은 별도 확인이 필요합니다.",
    confidenceScore: 0.55 + (providerId === "openai" ? 0.05 : 0),
    followUpQuestions: [
      "적용 대상의 사용 온도 범위는 어떻게 됩니까?",
      "기존 패드 외피 소재(PE/EPDM/실리콘 등)는 무엇입니까?",
      "요청하시는 인증 규격(예: UN 38.3, KS F 2271)이 있습니까?",
    ],
  };
}

function buildMockCritique(
  providerId: ProviderId,
  model: string,
  input: CritiqueInput,
): ProviderCritique {
  const targets = input.opinions
    .map((o) => o.providerId)
    .filter((p) => p !== providerId);

  return {
    providerId,
    model,
    agreements: ["적용 가능성 자체는 모든 의견이 조건부로 인정"],
    disagreements: [
      "적용 범위(표면 전체 vs 외피층 한정)에 대한 견해 차이",
    ],
    unsupportedClaims: input.opinions.flatMap((o) =>
      o.evidenceBackedClaims
        .filter((c) => /보장|영구|완전|100\s*%/.test(c))
        .map((c) => ({
          claim: c,
          attributedTo: o.providerId,
          reason: "시험성적서 인용 없이 단정적으로 작성됨.",
        })),
    ),
    unsafePhrasesFound: input.opinions.flatMap((o) =>
      o.unsafePhrases.map((p) => ({ phrase: p })),
    ),
    missingEvidenceFound: [
      "장기 신뢰성(5년 이상) 시험 결과",
      "전해액 누액 환경 화학적 적합성",
    ],
    recommendedCorrections: [
      "성능 수치 인용 시 시험 조건(두께/기재/온도)을 함께 표기할 것.",
      "'영구', '100% 안전' 등 단정 표현 제거.",
    ],
    providerSpecificCritiques: targets.map((t) => ({
      targetProviderId: t,
      critique: `[${providerId}→${t}] 시험 조건 명시 없이 성능을 단정한 부분이 있어 표현 보강 필요.`,
    })),
    confidenceAdjustment: -0.05,
  };
}

function buildMockSynthesis(
  providerId: ProviderId,
  input: SynthesisInput,
): FinalAnswer {
  const opinionCount = input.opinions.length;
  const conclusion =
    "현재 제공된 자료 기준으로는 외피층 한정 적용 가능성이 있으며, 시험성적서·기재 호환성·사용 환경 확인 후 단계적 적용 검토가 필요합니다.";

  const businessReady = [
    "안녕하십니까. 문의 주신 적용 가능 여부에 대해 검토 의견을 안내드립니다.",
    "현재 제공된 자료 기준으로 당사 코팅제의 외피층 적용 가능성은 검토 가능하며, 적용 환경(사용 온도, 두께, 부착 조건 등)에 따라 성능 편차가 있을 수 있습니다.",
    "구체적인 적용 검토를 위해 적용 대상의 사용 환경/요구 사양/관련 인증 요구사항을 공유 부탁드리며, 시험성적서 확보 후 단계적으로 안내드리겠습니다.",
  ].join("\n\n");

  // Parse through the schema so the new evidence-usage fields (Step 10)
  // pick up their defaults — the literal below intentionally omits them, and
  // the orchestrator populates the real contract afterward.
  return FinalAnswerSchema.parse({
    conclusion,
    finalMarkdown: [
      `## 최종 합의 결론`,
      conclusion,
      ``,
      `## 업체 발송용 초안`,
      businessReady,
      ``,
      `## 내부 검토 메모`,
      `- ${opinionCount}개 AI 의견 및 상호 비판 결과 종합.`,
      `- 단정 표현·인증 완료 표현은 모두 제거함.`,
      `- 추가 시험 조건이 명확해질 때까지 외부 광고/제안서 사용은 보류 권장.`,
    ].join("\n"),
    businessReadyAnswer: businessReady,
    internalMemo:
      "내부 기술자료(TS-COAT-2026-017) 기준 외피층 적용 한정. 시험성적서 신규 확보 필요. 인증기관(UN 38.3 / KS F 2271 등) 별도 확인 필요.",
    evidenceBackedClaims: [
      "내부 기술자료에 명시된 두께 100~150㎛ 도포 조건에서 외피층 적용 가능성 검토 가능",
    ],
    assumptions: [
      "적용 대상의 운용 환경이 일반 EV 배터리팩 표준 조건과 유사하다고 가정",
    ],
    missingEvidence: [
      "최신 시험성적서(요청 조건 기준)",
      "기재별 부착·박리 시험 데이터",
      "장기 신뢰성(>5년) 검증 결과",
      "전해액 누액 환경 화학적 적합성 데이터",
    ],
    unsafePhrases: [],
    recommendedSafeWording: [
      "‘완전 방지’ → ‘특정 시험 조건에서 화염 확산 지연 가능성’",
      "‘100% 안전’ → ‘사용 환경에 따라 안전성 평가 가능’",
      "‘인증 완료’ → ‘인증기관 확인 필요’",
    ],
    riskLevel: "medium",
    confidenceScore: 0.62,
    followUpQuestions: [
      "요청하시는 인증 규격이 있습니까?",
      "셀 패드 외피 소재 및 두께 사양은 어떻게 됩니까?",
    ],
    unresolvedDisagreements: [
      "적용 부위 범위(표면 vs 외피층) 권고 수준 — 추가 시험으로 해소 권장.",
    ],
    providerSummary: input.opinions.map((o) => ({
      providerId: o.providerId,
      status: "succeeded",
    })),
    sessionStatus: opinionCount === 3 ? "completed" : "partial_completed",
  });
}

function buildMockIdeation(input: SynthesisInput): IdeationFinalAnswer {
  const opinionCount = input.opinions.length;
  const conclusion =
    "검증 전 단계의 적용 아이디어 옵션을 제시합니다. 모든 아이디어는 가설이며, 단정적 성능/인증 표현은 추가 시험 후에만 사용 가능합니다.";

  // Parse through the schema so defaults (answerKind, evidence-usage fields)
  // are applied; the orchestrator populates the real evidence contract after.
  return IdeationFinalAnswerSchema.parse({
    ideas: [
      {
        ideaSummary:
          "방열 코팅을 배터리 모듈 간 절연 보조 용도로 외피층에 한정 적용 검토",
        targetApplication: "EV 배터리팩 모듈 외피층(셀 직접 접촉 제외)",
        expectedBenefit: "방열 보조 및 표면 보호 가능성(시험 조건에서 확인 필요)",
        requiredEvidence: [
          "방열 성능 시험성적서(시험 조건 명시)",
          "기재 호환성/부착 시험 결과",
          "전해액 누액 환경 화학적 적합성 데이터",
        ],
        riskLevel: "high",
        recommendedNextExperiment:
          "대표 기재에 도포 후 열전도/표면온도 비교 시험(조건 고정)부터 진행",
        doNotClaim: [
          "배터리 화재를 방지한다",
          "열폭주를 막는다",
          "100% 안전",
        ],
      },
      {
        ideaSummary: "제안서용 표현은 '검토 단계 가설'로만 한정해 사용",
        targetApplication: "영업/제안 커뮤니케이션",
        expectedBenefit: "과장·단정 표현으로 인한 광고법/클레임 위험 회피",
        requiredEvidence: ["검증된 시험성적서 확보 여부"],
        riskLevel: "medium",
        recommendedNextExperiment:
          "시험성적서 확보 전까지 외부 발송 문구에 단정 표현 미사용 원칙 수립",
        doNotClaim: ["인증 완료", "완전 방지"],
      },
    ].slice(0, opinionCount > 0 ? 2 : 1),
    unresolvedQuestions: [
      "적용 대상의 사용 온도/진동/누액 환경 사양은 무엇입니까?",
      "요청 인증 규격(UN 38.3 / KS F 2271 등)이 있습니까?",
    ],
    followUpResearch: [
      "방열 성능 시험 방법/규격 후보 조사",
      "유사 적용 사례 및 실패 사례 수집",
    ],
    conclusion,
    finalMarkdown: [
      `## (아이디어 모드) 검토 전 적용 아이디어`,
      conclusion,
      ``,
      `### 다음 실험 우선순위`,
      `- 대표 기재 도포 후 표면온도/열전도 비교 시험(조건 고정)`,
      ``,
      `### 주의`,
      `- 모든 아이디어는 가설 단계이며 단정 표현 금지.`,
    ].join("\n"),
    missingEvidence: [
      "방열 성능 시험성적서(시험 조건 명시)",
      "기재 호환성 시험 결과",
      "전해액 누액 환경 화학적 적합성 데이터",
    ],
    unsafePhrases: [],
    recommendedSafeWording: [
      "‘화재 방지’ → ‘특정 시험 조건에서 표면 보호/방열 보조 가능성’",
      "‘인증 완료’ → ‘인증기관 확인 필요’",
    ],
    riskLevel: "high",
    confidenceScore: 0.5,
    providerSummary: input.opinions.map((o) => ({
      providerId: o.providerId,
      status: "succeeded",
    })),
    sessionStatus: opinionCount === 3 ? "completed" : "partial_completed",
  });
}

function buildMockChecklist(
  input: SynthesisInput,
): CertificationChecklistFinalAnswer {
  const opinionCount = input.opinions.length;
  const conclusion =
    "해당 적용 분야에 필요한 인증/규격/시험 체크리스트입니다. 미충족·미확인 항목은 인증기관 확인 및 시험성적서 확보가 필요합니다.";

  return CertificationChecklistFinalAnswerSchema.parse({
    items: [
      {
        requirement: "UL 94 난연 등급 (V-0 등)",
        category: "시험",
        status: "unknown",
        evidence: "",
        gap: "대상 기재/두께 조건의 난연 시험성적서 확보 필요",
        issuingBody: "공인 시험기관",
      },
      {
        requirement: "KS F 2271 가스 유해성 / 내화 시험",
        category: "규격",
        status: "unknown",
        evidence: "",
        gap: "적용 조건 기준 시험 결과 확인 필요",
        issuingBody: "KCL/KTR 등",
      },
      {
        requirement: "SDS/MSDS 화학 안전 자료",
        category: "인증",
        status: "unmet",
        evidence: "",
        gap: "최신 SDS 발급/갱신 필요",
        issuingBody: "제조사/시험기관",
      },
    ],
    metRequirements: [],
    unmetRequirements: [
      "난연 시험성적서",
      "KS F 2271 시험 결과",
      "최신 SDS",
    ],
    conclusion,
    finalMarkdown: [
      `## 인증/규격 체크리스트`,
      conclusion,
      ``,
      `- [ ] UL 94 난연 등급 — 확인 필요`,
      `- [ ] KS F 2271 — 확인 필요`,
      `- [ ] SDS/MSDS — 미충족`,
    ].join("\n"),
    missingEvidence: [
      "난연 시험성적서(기재/두께 조건)",
      "KS F 2271 시험 결과",
      "최신 SDS",
    ],
    unsafePhrases: [],
    recommendedSafeWording: [
      "‘인증 완료’ → ‘인증기관 확인 필요’",
      "‘난연 보장’ → ‘특정 시험 조건에서 화염 확산 지연 가능성’",
    ],
    riskLevel: "high",
    confidenceScore: 0.5,
    providerSummary: input.opinions.map((o) => ({
      providerId: o.providerId,
      status: "succeeded",
    })),
    sessionStatus: opinionCount === 3 ? "completed" : "partial_completed",
  });
}
