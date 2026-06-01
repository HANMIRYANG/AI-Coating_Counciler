// Zod schemas for provider output.
// All provider responses MUST be validated through these schemas before being
// stored or used by downstream rounds. Validation failures are surfaced as
// `schema_invalid` status and never crash the whole session.

import { z } from "zod";

export const TaskTypeSchema = z.enum([
  "technical_review",
  "test_report_interpretation",
  "customer_reply",
  "proposal_copy",
  "risky_phrase_review",
  "application_ideas",
  "certification_checklist",
  "document_based_answer",
]);

export const EvidenceModeSchema = z.enum([
  "ai_only",
  "internal_docs",
  "internal_docs_web",
]);

export const ProviderIdSchema = z.enum(["gemini", "anthropic", "openai"]);

export const RiskLevelSchema = z.enum(["low", "medium", "high", "critical"]);

export const RiskItemSchema = z.object({
  description: z.string(),
  severity: RiskLevelSchema.optional(),
});

export const UnsafePhraseItemSchema = z.object({
  phrase: z.string(),
  reason: z.string().optional(),
  recommended: z.string().optional(),
});

export const TechnicalAssessmentItemSchema = z.object({
  topic: z.string(),
  detail: z.string(),
});

export const ProviderOpinionSchema = z.object({
  providerId: ProviderIdSchema,
  model: z.string().optional(),
  summary: z.string().min(1),
  technicalAssessment: z.array(TechnicalAssessmentItemSchema).default([]),
  evidenceBackedClaims: z.array(z.string()).default([]),
  assumptions: z.array(z.string()).default([]),
  missingEvidence: z.array(z.string()).default([]),
  risks: z.array(RiskItemSchema).default([]),
  unsafePhrases: z.array(UnsafePhraseItemSchema).default([]),
  recommendedAnswer: z.string().default(""),
  confidenceScore: z.number().min(0).max(1).default(0.5),
  followUpQuestions: z.array(z.string()).default([]),
});
export type ProviderOpinion = z.infer<typeof ProviderOpinionSchema>;

export const ProviderSpecificCritiqueSchema = z.object({
  targetProviderId: ProviderIdSchema,
  critique: z.string(),
});

export const UnsupportedClaimItemSchema = z.object({
  claim: z.string(),
  attributedTo: ProviderIdSchema.optional(),
  reason: z.string().optional(),
});

export const ProviderCritiqueSchema = z.object({
  providerId: ProviderIdSchema,
  model: z.string().optional(),
  agreements: z.array(z.string()).default([]),
  disagreements: z.array(z.string()).default([]),
  unsupportedClaims: z.array(UnsupportedClaimItemSchema).default([]),
  unsafePhrasesFound: z.array(UnsafePhraseItemSchema).default([]),
  missingEvidenceFound: z.array(z.string()).default([]),
  recommendedCorrections: z.array(z.string()).default([]),
  providerSpecificCritiques: z.array(ProviderSpecificCritiqueSchema).default([]),
  confidenceAdjustment: z.number().min(-1).max(1).default(0),
});
export type ProviderCritique = z.infer<typeof ProviderCritiqueSchema>;

// ── Evidence usage contract (Step 10) ─────────────────────────────────
// Structured, bounded references so the system can LATER render citations
// and claim coverage. This step defines + persists the shape only — there
// is no citation UI and no verified-citation enforcement yet. No full chunk
// bodies: references point at a chunk by id/filename/index only.

export const EvidenceCoverageStatusSchema = z.enum([
  "not_requested", // ai_only — evidence retrieval was never requested
  "no_evidence", // retrieval ran but matched nothing
  "partial", // some evidence retrieved; claim-level mapping not verified
  "sufficient", // explicit model-asserted full coverage (never auto-set)
  "unavailable", // retrieval failed / database unavailable
]);
export type EvidenceCoverageStatus = z.infer<
  typeof EvidenceCoverageStatusSchema
>;

// Lightweight pointer to an evidence candidate (no chunk body).
export const EvidenceUsedRefSchema = z.object({
  chunkId: z.string(),
  filename: z.string(),
  chunkIndex: z.number().int().nonnegative(),
  trustLevel: z.string().optional(),
  verificationStatus: z.string().optional(),
});
export type EvidenceUsedRef = z.infer<typeof EvidenceUsedRefSchema>;

export const CoveredClaimSchema = z.object({
  claim: z.string(),
  // chunkIds of the evidence references that back this claim.
  evidenceChunkIds: z.array(z.string()).default([]),
});
export type CoveredClaim = z.infer<typeof CoveredClaimSchema>;

export const FinalAnswerSchema = z.object({
  // Discriminator for the synthesis output union. Standard technical-review
  // style answers are tagged "standard"; ideation-mode answers use the
  // separate IdeationFinalAnswerSchema tagged "ideation". Defaulted so that
  // existing producers/fixtures that omit it remain valid.
  answerKind: z.literal("standard").default("standard"),
  conclusion: z.string().min(1),
  finalMarkdown: z.string().min(1),
  businessReadyAnswer: z.string().min(1),
  internalMemo: z.string().default(""),
  evidenceBackedClaims: z.array(z.string()).default([]),
  assumptions: z.array(z.string()).default([]),
  missingEvidence: z.array(z.string()).default([]),
  unsafePhrases: z.array(UnsafePhraseItemSchema).default([]),
  recommendedSafeWording: z.array(z.string()).default([]),
  riskLevel: RiskLevelSchema.default("low"),
  confidenceScore: z.number().min(0).max(1).default(0.5),
  followUpQuestions: z.array(z.string()).default([]),
  unresolvedDisagreements: z.array(z.string()).default([]),
  providerSummary: z
    .array(
      z.object({
        providerId: ProviderIdSchema,
        status: z.string(),
        latencyMs: z.number().int().nonnegative().optional(),
      }),
    )
    .default([]),
  sessionStatus: z.string().optional(),
  // Evidence usage contract (Step 10). All optional/defaulted so existing
  // provider outputs (which omit them) remain valid. Populated
  // deterministically by the orchestrator from the session evidence preview.
  evidenceUsed: z.array(EvidenceUsedRefSchema).default([]),
  coveredClaims: z.array(CoveredClaimSchema).default([]),
  uncoveredClaims: z.array(z.string()).default([]),
  evidenceCoverageStatus: EvidenceCoverageStatusSchema.default("not_requested"),
});
export type FinalAnswer = z.infer<typeof FinalAnswerSchema>;

// ── Ideation mode output (docs/23) ────────────────────────────────────
// taskType=application_ideas produces a DISTINCT synthesis shape: a list of
// pre-validation idea options rather than a single business-ready answer.
//
// Per docs/12 + CLAUDE.md non-negotiable #5, the ideation answer MUST still
// carry the shared domain-safety surface (unsafePhrases / recommendedSafeWording
// / missingEvidence / riskLevel) so `applySafetyGuard` can run and the risk /
// missing-evidence panels stay populated. Ideas are hypotheses only — each
// idea additionally records `doNotClaim` to keep unverified performance /
// certification claims out of any downstream copy.

export const IdeationItemSchema = z.object({
  ideaSummary: z.string().min(1),
  targetApplication: z.string().default(""),
  expectedBenefit: z.string().default(""),
  requiredEvidence: z.array(z.string()).default([]),
  riskLevel: RiskLevelSchema.default("medium"),
  recommendedNextExperiment: z.string().default(""),
  doNotClaim: z.array(z.string()).default([]),
});
export type IdeationItem = z.infer<typeof IdeationItemSchema>;

export const IdeationFinalAnswerSchema = z.object({
  answerKind: z.literal("ideation").default("ideation"),
  // docs/23 core ideation fields.
  ideas: z.array(IdeationItemSchema).default([]),
  unresolvedQuestions: z.array(z.string()).default([]),
  followUpResearch: z.array(z.string()).default([]),
  // Rendering + disclaimer carrier. `finalMarkdown` is where the safety guard
  // appends the mandatory disclaimer, mirroring FinalAnswer.
  conclusion: z.string().default(""),
  finalMarkdown: z.string().default(""),
  // Shared domain-safety surface (CLAUDE.md non-negotiable #5).
  missingEvidence: z.array(z.string()).default([]),
  unsafePhrases: z.array(UnsafePhraseItemSchema).default([]),
  recommendedSafeWording: z.array(z.string()).default([]),
  riskLevel: RiskLevelSchema.default("medium"),
  confidenceScore: z.number().min(0).max(1).default(0.5),
  // Provider/session bookkeeping — kept parallel to FinalAnswer so the store,
  // API serializer and markdown export can treat both shapes uniformly.
  providerSummary: z
    .array(
      z.object({
        providerId: ProviderIdSchema,
        status: z.string(),
        latencyMs: z.number().int().nonnegative().optional(),
      }),
    )
    .default([]),
  sessionStatus: z.string().optional(),
  // Step 10 evidence usage parity (populated deterministically by orchestrator).
  evidenceUsed: z.array(EvidenceUsedRefSchema).default([]),
  coveredClaims: z.array(CoveredClaimSchema).default([]),
  uncoveredClaims: z.array(z.string()).default([]),
  evidenceCoverageStatus: EvidenceCoverageStatusSchema.default("not_requested"),
});
export type IdeationFinalAnswer = z.infer<typeof IdeationFinalAnswerSchema>;

// ── Certification checklist output (docs/23) ──────────────────────────
// taskType=certification_checklist produces a structured checklist of the
// certifications / standards / tests required for an application, each marked
// met / unmet / unknown — a genuinely different shape from prose FinalAnswer.
//
// As with ideation, it carries the shared domain-safety surface (CLAUDE.md #5)
// so the safety guard runs and the risk / missing-evidence panels stay
// populated. Unmet/unknown items must never be described as "보유/확보됨".

export const ChecklistItemStatusSchema = z.enum(["met", "unmet", "unknown"]);
export type ChecklistItemStatus = z.infer<typeof ChecklistItemStatusSchema>;

export const ChecklistItemSchema = z.object({
  requirement: z.string().min(1), // 규격/인증/시험 항목명
  category: z.string().default(""), // 예: 인증 / 시험 / 규격 / 사용환경
  status: ChecklistItemStatusSchema.default("unknown"),
  evidence: z.string().default(""), // 충족 근거(보유 성적서/인증 등)
  gap: z.string().default(""), // 미충족 시 추가로 필요한 것
  issuingBody: z.string().default(""), // 발급/확인 기관
});
export type ChecklistItem = z.infer<typeof ChecklistItemSchema>;

export const CertificationChecklistFinalAnswerSchema = z.object({
  answerKind: z.literal("certification_checklist").default("certification_checklist"),
  // docs/23 core checklist fields.
  items: z.array(ChecklistItemSchema).default([]),
  metRequirements: z.array(z.string()).default([]),
  unmetRequirements: z.array(z.string()).default([]),
  // Rendering + disclaimer carrier.
  conclusion: z.string().default(""),
  finalMarkdown: z.string().default(""),
  // Shared domain-safety surface (CLAUDE.md non-negotiable #5).
  missingEvidence: z.array(z.string()).default([]),
  unsafePhrases: z.array(UnsafePhraseItemSchema).default([]),
  recommendedSafeWording: z.array(z.string()).default([]),
  riskLevel: RiskLevelSchema.default("medium"),
  confidenceScore: z.number().min(0).max(1).default(0.5),
  // Provider/session bookkeeping — parallel to FinalAnswer.
  providerSummary: z
    .array(
      z.object({
        providerId: ProviderIdSchema,
        status: z.string(),
        latencyMs: z.number().int().nonnegative().optional(),
      }),
    )
    .default([]),
  sessionStatus: z.string().optional(),
  // Step 10 evidence usage parity.
  evidenceUsed: z.array(EvidenceUsedRefSchema).default([]),
  coveredClaims: z.array(CoveredClaimSchema).default([]),
  uncoveredClaims: z.array(z.string()).default([]),
  evidenceCoverageStatus: EvidenceCoverageStatusSchema.default("not_requested"),
});
export type CertificationChecklistFinalAnswer = z.infer<
  typeof CertificationChecklistFinalAnswerSchema
>;

// Discriminated (by `answerKind`) union of the synthesis output shapes.
// Branch at runtime with `result.answerKind === "..."`. Each provider parses
// with the concrete schema for its taskType, so this stays a TS-level union
// (avoids ZodDefault-on-discriminator pitfalls of z.discriminatedUnion).
export type SynthesisResult =
  | FinalAnswer
  | IdeationFinalAnswer
  | CertificationChecklistFinalAnswer;

export const CreateSessionRequestSchema = z.object({
  prompt: z.string().min(1).max(8000),
  taskType: TaskTypeSchema,
  evidenceMode: EvidenceModeSchema.default("ai_only"),
  // Optional official-source URLs for internal_docs_web (docs/23). Fetched
  // server-side as a side-car; capped at 6. Ignored for other evidence modes.
  sourceUrls: z.array(z.string().url().max(2000)).max(6).optional(),
});
export type CreateSessionRequest = z.infer<typeof CreateSessionRequestSchema>;
