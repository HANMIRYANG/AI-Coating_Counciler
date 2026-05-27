// Evidence source catalog foundation.
//
// This module defines the typed primitives the council will use once it
// gains the ability to cite test reports / certifications / SDS / MSDS /
// TDS / technical datasheets.
//
// Scope (per docs/23_ideation_and_evidence_source_strategy.md):
//   - Provides a *seed* catalog of multiple Korean testing / certification
//     institutions. KCL is one source among many; NEVER privileged.
//   - Inclusion of an institution does NOT mean every report from that
//     institution is automatically valid for every claim. Each
//     SourceCatalogEntry carries an `inclusionWarning` to keep operators
//     honest.
//   - Defines a SourceRetrievalPolicy with bounded, nonzero defaults so a
//     future retrieval step cannot freeze a council session.
//
// NON-goals for this slice:
//   - No web crawling, no HTTP fetcher, no scraper.
//   - No RAG, no document upload, no embeddings.
//   - No internal_docs / internal_docs_web wiring on the orchestrator.
//   - This module MUST NOT import the orchestrator, rate limiter,
//     provider adapters, or model policy.

import { z } from "zod";
import {
  EVIDENCE_SOURCE_CATALOG_DATA,
  EVIDENCE_TRUST_LEVELS,
  type SourceCatalogEntryData,
} from "./evidenceCatalog";

// ─────────────────────────────────────────────────────────────────────
// 1. Primitive enums
// ─────────────────────────────────────────────────────────────────────

export const EvidenceDocumentTypeSchema = z.enum([
  "test_report",
  "certification",
  "sds",
  "msds",
  "tds",
  "technical_datasheet",
  "internal_memo",
  "catalog",
  "other",
]);
export type EvidenceDocumentType = z.infer<typeof EvidenceDocumentTypeSchema>;

/**
 * Trust level governs whether a piece of evidence may be cited in the
 * business-facing answer or only used as an internal lead. The literal
 * list lives in `evidenceCatalog.ts` so client-bundle code can reference
 * the same tokens without importing Zod.
 *
 *   - uploaded_original     사내가 보관한 원본 PDF/스캔
 *   - uploaded_copy         원본 파생 사본 (요약 / OCR). 표시 시 caveat 필요
 *   - official_registry     KOLAS/KATS 또는 인증기관 공식 등록부
 *   - official_public_page  인증기관 공식 홈페이지 공개 페이지
 *   - third_party_reference 기관 외 제3자의 인용/요약. 단서 한정
 *   - unverified_web        출처 미확인 웹 자료. 단서 한정
 */
export const EvidenceTrustLevelSchema = z.enum(EVIDENCE_TRUST_LEVELS);
export type EvidenceTrustLevel = z.infer<typeof EvidenceTrustLevelSchema>;

export const EvidenceVerificationStatusSchema = z.enum([
  "verified",
  "auto_extracted",
  "needs_review",
  "unverified",
]);
export type EvidenceVerificationStatus = z.infer<
  typeof EvidenceVerificationStatusSchema
>;

export const SourceUnavailableReasonSchema = z.enum([
  "timeout",
  "http_5xx",
  "http_4xx",
  "parse_error",
  "disabled",
]);
export type SourceUnavailableReason = z.infer<
  typeof SourceUnavailableReasonSchema
>;

// ─────────────────────────────────────────────────────────────────────
// 2. EvidenceItem
// ─────────────────────────────────────────────────────────────────────

/**
 * A single citable evidence record. Most string fields default to "" so a
 * partially-populated item can still pass parse during pipeline stages;
 * empty fields are treated as "unknown" by downstream consumers.
 *
 * `trustLevel` is mandatory — without it the orchestrator can't decide
 * whether the item is business-citable.
 */
export const EvidenceItemSchema = z.object({
  issuer: z.string().min(1),
  documentType: EvidenceDocumentTypeSchema,
  reportNumber: z.string().default(""),
  issuedDate: z.string().default(""),
  testMethod: z.string().default(""),
  standardCode: z.string().default(""),
  productName: z.string().default(""),
  substrate: z.string().default(""),
  coatingThickness: z.string().default(""),
  testCondition: z.string().default(""),
  resultSummary: z.string().default(""),
  pageNumber: z.number().int().nonnegative().optional(),
  sourceUrl: z.string().optional(),
  uploadedFileId: z.string().optional(),
  confidence: z.number().min(0).max(1).default(0.5),
  verificationStatus: EvidenceVerificationStatusSchema.default("unverified"),
  trustLevel: EvidenceTrustLevelSchema,
});
export type EvidenceItem = z.infer<typeof EvidenceItemSchema>;

// ─────────────────────────────────────────────────────────────────────
// 3. Source catalog
// ─────────────────────────────────────────────────────────────────────

export const SourceCatalogEntrySchema = z.object({
  /** Stable key used by retrieval policy / config / logs. */
  key: z.string().min(1),
  /** Human-readable name shown in the UI. */
  displayName: z.string().min(1),
  /** Free-form description of what kinds of reports this issuer covers. */
  scopeNotes: z.string().min(1),
  /** Where retrieved evidence sits on the trust ladder by default. */
  defaultTrustLevel: EvidenceTrustLevelSchema,
  /**
   * Operator-facing warning that catalog inclusion is NOT a blanket
   * statement of validity. Required for every entry.
   */
  inclusionWarning: z.string().min(1),
  enabled: z.boolean().default(true),
});
export type SourceCatalogEntry = z.infer<typeof SourceCatalogEntrySchema>;

/**
 * Seed catalog. The actual data lives in `evidenceCatalog.ts` so the same
 * rows can be consumed by client-bundle code without dragging in Zod.
 *
 * Here we run the data through `SourceCatalogEntrySchema.array().parse(...)`
 * at module load. That gives us a defensive validation step — if a future
 * edit to `evidenceCatalog.ts` produces a malformed row, the server-side
 * import will throw immediately rather than ship invalid data. The
 * returned value is a fresh, mutable `SourceCatalogEntry[]`.
 */
export const DEFAULT_EVIDENCE_SOURCE_CATALOG: SourceCatalogEntry[] =
  SourceCatalogEntrySchema.array().parse(
    EVIDENCE_SOURCE_CATALOG_DATA as readonly SourceCatalogEntryData[],
  );

// ─────────────────────────────────────────────────────────────────────
// 4. Retrieval policy + unavailable record
// ─────────────────────────────────────────────────────────────────────

/**
 * Bounded retrieval policy.
 *
 * Per-field rules:
 *   - perSourceFetchTimeoutMs >= 1000   (sub-second timeouts are almost
 *     always a misconfig — they would silently turn every fetch into a
 *     "timeout" and starve evidence retrieval).
 *   - totalRetrievalBudgetMs   >= 1000
 *   - maxSourcesPerSession      positive int
 *   - maxParallelSourceFetch    positive int
 *   - sourceRetryLimit          >= 0 (0 = "do not retry")
 *
 * Cross-field rule:
 *   - maxParallelSourceFetch <= maxSourcesPerSession
 *     (we can't dispatch more concurrent fetches than the total quota for
 *     a session — that would always be at least one wasted slot).
 *
 * These rules exist so a future retrieval step cannot quietly stall a
 * council session.
 */
export const SourceRetrievalPolicySchema = z
  .object({
    perSourceFetchTimeoutMs: z.number().int().min(1000),
    totalRetrievalBudgetMs: z.number().int().min(1000),
    maxSourcesPerSession: z.number().int().positive(),
    maxParallelSourceFetch: z.number().int().positive(),
    sourceRetryLimit: z.number().int().nonnegative(),
  })
  .superRefine((v, ctx) => {
    if (v.maxParallelSourceFetch > v.maxSourcesPerSession) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `maxParallelSourceFetch (${v.maxParallelSourceFetch}) must be <= maxSourcesPerSession (${v.maxSourcesPerSession}).`,
        path: ["maxParallelSourceFetch"],
      });
    }
  });
export type SourceRetrievalPolicy = z.infer<typeof SourceRetrievalPolicySchema>;

export const DEFAULT_SOURCE_RETRIEVAL_POLICY: SourceRetrievalPolicy = {
  perSourceFetchTimeoutMs: 8_000,
  totalRetrievalBudgetMs: 20_000,
  maxSourcesPerSession: 6,
  maxParallelSourceFetch: 3,
  // Default = 0 (no retries). External sources are best-effort; the
  // orchestrator falls back to "evidence missing / cannot confirm" rather
  // than burning the session budget on retries.
  sourceRetryLimit: 0,
};

/**
 * Cross-field rules:
 *   - endedAt   >= startedAt
 *   - latencyMs === endedAt - startedAt   (strict — these are all
 *     server-generated wall-clock values written from a single Date.now()
 *     pair, so any drift is a bug, not a tolerance issue).
 */
export const SourceUnavailableRecordSchema = z
  .object({
    /** Catalog key (e.g. "kcl"). */
    source: z.string().min(1),
    reason: SourceUnavailableReasonSchema,
    startedAt: z.number().int().nonnegative(),
    endedAt: z.number().int().nonnegative(),
    latencyMs: z.number().int().nonnegative(),
    /** Optional free-text message; useful for parse_error / http_4xx detail. */
    message: z.string().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.endedAt < v.startedAt) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `endedAt (${v.endedAt}) must be >= startedAt (${v.startedAt}).`,
        path: ["endedAt"],
      });
      // If endedAt is bad, the derived latency check is meaningless —
      // skip it so we surface ONE issue per record.
      return;
    }
    const expected = v.endedAt - v.startedAt;
    if (v.latencyMs !== expected) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `latencyMs (${v.latencyMs}) must equal endedAt - startedAt (${expected}).`,
        path: ["latencyMs"],
      });
    }
  });
export type SourceUnavailableRecord = z.infer<
  typeof SourceUnavailableRecordSchema
>;

// ─────────────────────────────────────────────────────────────────────
// 5. Helpers
// ─────────────────────────────────────────────────────────────────────

/**
 * Trust levels acceptable in the BUSINESS-FACING (외부 발송용) answer.
 *
 * `uploaded_copy` is included by policy (allowed with a caveat). UI is
 * responsible for surfacing the caveat next to the citation.
 */
export function isBusinessCitableTrustLevel(
  level: EvidenceTrustLevel,
): boolean {
  switch (level) {
    case "uploaded_original":
    case "uploaded_copy":
    case "official_registry":
    case "official_public_page":
      return true;
    case "third_party_reference":
    case "unverified_web":
      return false;
  }
}

export function canUseEvidenceInBusinessAnswer(
  item: Pick<EvidenceItem, "trustLevel">,
): boolean {
  return isBusinessCitableTrustLevel(item.trustLevel);
}

export function getSourceCatalogEntry(
  key: string,
  catalog: SourceCatalogEntry[] = DEFAULT_EVIDENCE_SOURCE_CATALOG,
): SourceCatalogEntry | undefined {
  return catalog.find((e) => e.key === key);
}

// ─────────────────────────────────────────────────────────────────────
// 6. Evidence coverage report (future data contract)
// ─────────────────────────────────────────────────────────────────────
//
// This describes a forensic report the final synthesis stage will emit
// when evidence retrieval ships. NOT WIRED INTO ORCHESTRATOR YET. The
// shape is published now so consumers (UI, logs, exports) can be written
// against a stable contract before the retrieval pipeline lands.

export const EvidenceCoverageStatusSchema = z.enum([
  "covered",
  "missing",
  "contested",
  "not_applicable",
]);
export type EvidenceCoverageStatus = z.infer<
  typeof EvidenceCoverageStatusSchema
>;

export const EvidenceCoverageItemSchema = z.object({
  /** The user-facing claim being evaluated (often a sentence from the answer). */
  claim: z.string().min(1),
  status: EvidenceCoverageStatusSchema,
  /** EvidenceItem IDs that back this claim. May be empty. */
  evidenceIds: z.array(z.string()).default([]),
  /** Free-form list of missing evidence types (test method, certification, etc.). */
  missingEvidence: z.array(z.string()).default([]),
  notes: z.string().default(""),
});
export type EvidenceCoverageItem = z.infer<typeof EvidenceCoverageItemSchema>;

export const EvidenceCoverageReportSchema = z.object({
  /** Claims backed by at least one citable EvidenceItem. */
  coveredClaims: z.array(EvidenceCoverageItemSchema).default([]),
  /** Claims with no usable evidence available. */
  uncoveredClaims: z.array(EvidenceCoverageItemSchema).default([]),
  /** Claims with conflicting evidence — orchestrator must surface, not pick. */
  contestedClaims: z.array(EvidenceCoverageItemSchema).default([]),
  /** Per-source failures from the retrieval step. */
  sourceUnavailable: z.array(SourceUnavailableRecordSchema).default([]),
});
export type EvidenceCoverageReport = z.infer<
  typeof EvidenceCoverageReportSchema
>;

export type EvidenceCoverageSummary = {
  covered: number;
  uncovered: number;
  contested: number;
  unavailableSources: number;
};

/** Numeric rollup of a coverage report — handy for log lines / UI badges. */
export function summarizeEvidenceCoverage(
  report: EvidenceCoverageReport,
): EvidenceCoverageSummary {
  return {
    covered: report.coveredClaims.length,
    uncovered: report.uncoveredClaims.length,
    contested: report.contestedClaims.length,
    unavailableSources: report.sourceUnavailable.length,
  };
}

export type SourceCatalogValidationResult = {
  valid: boolean;
  errors: string[];
};

/**
 * Validate a catalog the operator wants to load. Checks per-entry shape
 * via Zod and rejects duplicate keys.
 */
export function validateSourceCatalog(
  entries: SourceCatalogEntry[],
): SourceCatalogValidationResult {
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const e of entries) {
    const parse = SourceCatalogEntrySchema.safeParse(e);
    if (!parse.success) {
      errors.push(
        `Invalid catalog entry "${e?.key ?? "(no key)"}": ${parse.error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; ")}`,
      );
      continue;
    }
    if (seen.has(e.key)) {
      errors.push(`Duplicate catalog key: ${e.key}`);
    }
    seen.add(e.key);
  }
  return { valid: errors.length === 0, errors };
}
