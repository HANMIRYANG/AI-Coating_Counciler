// Shared TypeScript types for the AI Council orchestration layer.
// These types are intentionally framework-agnostic so they can be reused by
// orchestrator, provider adapters, API routes, and frontend components.

// Type-only import (erased at runtime) — keeps types.ts free of any runtime
// dependency. The prompt-safe evidence context reuses the Step 7 preview.
import type { SessionEvidencePreview } from "./evidencePreview";

export type ProviderId = "gemini" | "anthropic" | "openai";

export type TaskType =
  | "technical_review"
  | "test_report_interpretation"
  | "customer_reply"
  | "proposal_copy"
  | "risky_phrase_review"
  | "application_ideas"
  | "certification_checklist"
  | "document_based_answer";

export type EvidenceMode = "ai_only" | "internal_docs" | "internal_docs_web";

export type ProviderStatus =
  | "pending"
  | "running"
  | "succeeded"
  | "failed"
  | "timed_out"
  | "schema_invalid"
  | "cancelled"
  | "rate_limited";

export type SessionStatus =
  | "created"
  | "preparing"
  | "round1_running"
  | "round1_completed"
  | "round1_partial"
  | "round1_limited"
  | "round2_running"
  | "round2_completed"
  | "round2_partial"
  | "round2_limited"
  | "synthesis_running"
  | "completed"
  | "partial_completed"
  | "limited_answer"
  | "failed"
  | "timed_out";

export type RoundKey = "initial" | "critique" | "synthesis";

export type RiskLevel = "low" | "medium" | "high" | "critical";

export type NormalizedProviderError = {
  providerId: ProviderId;
  errorType:
    | "timeout"
    | "rate_limit"
    | "auth"
    | "invalid_request"
    | "provider_5xx"
    | "schema_validation"
    | "model_policy"
    | "cancelled"
    | "unknown";
  message: string;
  retryable: boolean;
  retryAfterMs?: number;
  rawError?: unknown;
  /** Raw response text (populated for schema_validation cases). */
  rawText?: string;
  /** Partially-parsed JSON (populated when JSON.parse succeeded but Zod failed). */
  parsedJson?: unknown;
};

export type ProviderCallOptions = {
  timeoutMs: number;
  retryCount: number;
  abortSignal?: AbortSignal;
  sessionId: string;
  round: RoundKey;
  /**
   * Model name picked by the orchestrator for this hop of the fallback chain.
   * Adapters MUST honor this (use options.model ?? this.model) so model
   * fallback / high-accuracy routing reaches the SDK and the modelUsed log
   * accurately reflects what was called.
   */
  model?: string;
};

// Read-only internal-evidence context (Step 8). When present, the prompt
// builders render a compact Korean evidence block. Undefined for ai_only so
// that path is byte-for-byte unchanged. Snippets only — never full bodies.
export type EvidenceContext = SessionEvidencePreview;

export type InitialOpinionInput = {
  userPrompt: string;
  taskType: TaskType;
  evidenceMode: EvidenceMode;
  domainSafetyPolicySummary: string;
  evidenceContext?: EvidenceContext;
};

export type CritiqueInput = {
  userPrompt: string;
  taskType: TaskType;
  opinions: Array<{
    providerId: ProviderId;
    summary: string;
    recommendedAnswer: string;
    evidenceBackedClaims: string[];
    assumptions: string[];
    missingEvidence: string[];
    unsafePhrases: string[];
  }>;
  knownDangerousPhrases: string[];
  evidenceContext?: EvidenceContext;
};

export type SynthesisInput = {
  userPrompt: string;
  taskType: TaskType;
  opinions: CritiqueInput["opinions"];
  critiques: Array<{
    providerId: ProviderId;
    unsupportedClaims: string[];
    unsafePhrasesFound: string[];
    missingEvidenceFound: string[];
    recommendedCorrections: string[];
  }>;
  knownDangerousPhrases: string[];
  evidenceContext?: EvidenceContext;
};
