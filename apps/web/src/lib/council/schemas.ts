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

export const FinalAnswerSchema = z.object({
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
});
export type FinalAnswer = z.infer<typeof FinalAnswerSchema>;

export const CreateSessionRequestSchema = z.object({
  prompt: z.string().min(1).max(8000),
  taskType: TaskTypeSchema,
  evidenceMode: EvidenceModeSchema.default("ai_only"),
});
export type CreateSessionRequest = z.infer<typeof CreateSessionRequestSchema>;
