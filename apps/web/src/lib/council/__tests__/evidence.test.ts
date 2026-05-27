// Evidence catalog foundation tests.
//
// This file verifies the typed primitives the council will use once it
// starts citing test reports / certifications / SDS / MSDS / TDS / etc.
// It does NOT exercise any external fetcher (none exists yet).

import { describe, it, expect } from "vitest";
import {
  DEFAULT_EVIDENCE_SOURCE_CATALOG,
  DEFAULT_SOURCE_RETRIEVAL_POLICY,
  EvidenceCoverageItemSchema,
  EvidenceCoverageReportSchema,
  EvidenceItemSchema,
  SourceCatalogEntrySchema,
  SourceRetrievalPolicySchema,
  SourceUnavailableRecordSchema,
  canUseEvidenceInBusinessAnswer,
  getSourceCatalogEntry,
  isBusinessCitableTrustLevel,
  summarizeEvidenceCoverage,
  validateSourceCatalog,
  type EvidenceCoverageItem,
  type EvidenceTrustLevel,
  type SourceCatalogEntry,
} from "../evidence";
import {
  EVIDENCE_SOURCE_DISPLAY_LABELS,
  shortSourceLabel,
} from "../evidenceCatalog";

const SEED_KEYS = [
  "kolas_kats",
  "kcl",
  "ktr",
  "ktc",
  "fiti",
  "katri",
  "kotiti",
  "kfi",
  "kict",
  "custom",
] as const;

describe("DEFAULT_EVIDENCE_SOURCE_CATALOG — seed coverage", () => {
  it("includes every required seed source key", () => {
    const keys = DEFAULT_EVIDENCE_SOURCE_CATALOG.map((e) => e.key);
    for (const k of SEED_KEYS) {
      expect(keys).toContain(k);
    }
  });

  it("is not KCL-only — KCL is one entry among many", () => {
    const kclEntries = DEFAULT_EVIDENCE_SOURCE_CATALOG.filter(
      (e) => e.key === "kcl",
    );
    expect(kclEntries.length).toBe(1);
    expect(DEFAULT_EVIDENCE_SOURCE_CATALOG.length).toBeGreaterThan(3);
  });

  it("uses the correct KOTITI display name", () => {
    const k = getSourceCatalogEntry("kotiti");
    expect(k?.displayName).toBe("KOTITI시험연구원 (KOTITI)");
  });

  it("every entry carries scopeNotes and an inclusionWarning", () => {
    for (const e of DEFAULT_EVIDENCE_SOURCE_CATALOG) {
      expect(e.scopeNotes.length).toBeGreaterThan(0);
      expect(e.inclusionWarning.length).toBeGreaterThan(0);
    }
  });

  it("every seed entry passes SourceCatalogEntrySchema", () => {
    for (const e of DEFAULT_EVIDENCE_SOURCE_CATALOG) {
      const parsed = SourceCatalogEntrySchema.safeParse(e);
      expect(parsed.success).toBe(true);
    }
  });

  it("'custom' is disabled by default (operator must opt in)", () => {
    const c = getSourceCatalogEntry("custom");
    expect(c?.enabled).toBe(false);
  });
});

describe("Trust-level citation rules", () => {
  const allowed: EvidenceTrustLevel[] = [
    "uploaded_original",
    "uploaded_copy",
    "official_registry",
    "official_public_page",
  ];
  const blocked: EvidenceTrustLevel[] = [
    "third_party_reference",
    "unverified_web",
  ];

  it.each(allowed)("isBusinessCitableTrustLevel(%s) → true", (lvl) => {
    expect(isBusinessCitableTrustLevel(lvl)).toBe(true);
  });

  it.each(blocked)("isBusinessCitableTrustLevel(%s) → false", (lvl) => {
    expect(isBusinessCitableTrustLevel(lvl)).toBe(false);
  });

  it("canUseEvidenceInBusinessAnswer mirrors isBusinessCitableTrustLevel", () => {
    expect(
      canUseEvidenceInBusinessAnswer({ trustLevel: "official_registry" }),
    ).toBe(true);
    expect(
      canUseEvidenceInBusinessAnswer({ trustLevel: "uploaded_copy" }),
    ).toBe(true);
    expect(
      canUseEvidenceInBusinessAnswer({ trustLevel: "third_party_reference" }),
    ).toBe(false);
    expect(
      canUseEvidenceInBusinessAnswer({ trustLevel: "unverified_web" }),
    ).toBe(false);
  });
});

describe("EvidenceItemSchema", () => {
  it("accepts a fully populated evidence record", () => {
    const item = EvidenceItemSchema.parse({
      issuer: "KCL",
      documentType: "test_report",
      reportNumber: "KCL-2026-12345",
      issuedDate: "2026-04-28",
      testMethod: "KS F 2271",
      standardCode: "KS F 2271",
      productName: "HE-850A",
      substrate: "STEEL",
      coatingThickness: "120 µm",
      testCondition: "30 min, 750°C",
      resultSummary: "30분 내화 시험 기준 표면 균열 없음",
      pageNumber: 3,
      sourceUrl: "https://example.kr/report/12345",
      confidence: 0.9,
      verificationStatus: "verified",
      trustLevel: "official_public_page",
    });
    expect(item.testMethod).toBe("KS F 2271");
    expect(item.trustLevel).toBe("official_public_page");
  });

  it("accepts a minimal record and applies safe defaults", () => {
    const item = EvidenceItemSchema.parse({
      issuer: "내부",
      documentType: "internal_memo",
      trustLevel: "uploaded_original",
    });
    expect(item.confidence).toBe(0.5);
    expect(item.verificationStatus).toBe("unverified");
    expect(item.testMethod).toBe("");
  });

  it("rejects when trustLevel is missing", () => {
    const r = EvidenceItemSchema.safeParse({
      issuer: "KCL",
      documentType: "test_report",
    });
    expect(r.success).toBe(false);
  });

  it("rejects an unknown documentType", () => {
    const r = EvidenceItemSchema.safeParse({
      issuer: "KCL",
      documentType: "bogus_type",
      trustLevel: "uploaded_original",
    });
    expect(r.success).toBe(false);
  });
});

describe("SourceUnavailableRecordSchema", () => {
  const reasons = [
    "timeout",
    "http_5xx",
    "http_4xx",
    "parse_error",
    "disabled",
  ] as const;

  it.each(reasons)("accepts reason=%s", (reason) => {
    const r = SourceUnavailableRecordSchema.parse({
      source: "kcl",
      reason,
      startedAt: 1,
      endedAt: 2,
      latencyMs: 1,
    });
    expect(r.reason).toBe(reason);
  });

  it("rejects an unknown reason", () => {
    const r = SourceUnavailableRecordSchema.safeParse({
      source: "kcl",
      reason: "bogus",
      startedAt: 0,
      endedAt: 0,
      latencyMs: 0,
    });
    expect(r.success).toBe(false);
  });

  it("rejects endedAt earlier than startedAt", () => {
    const r = SourceUnavailableRecordSchema.safeParse({
      source: "kcl",
      reason: "timeout",
      startedAt: 100,
      endedAt: 50,
      latencyMs: 0,
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(
        r.error.issues.some((i) =>
          /endedAt.*must be >= startedAt/.test(i.message),
        ),
      ).toBe(true);
    }
  });

  it("rejects latencyMs that disagrees with endedAt - startedAt", () => {
    const r = SourceUnavailableRecordSchema.safeParse({
      source: "kcl",
      reason: "timeout",
      startedAt: 100,
      endedAt: 250,
      latencyMs: 999, // expected 150, intentional drift
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(
        r.error.issues.some((i) =>
          /latencyMs.*must equal endedAt - startedAt/.test(i.message),
        ),
      ).toBe(true);
    }
  });

  it("accepts consistent latencyMs = endedAt - startedAt", () => {
    const r = SourceUnavailableRecordSchema.safeParse({
      source: "kcl",
      reason: "http_5xx",
      startedAt: 1000,
      endedAt: 1234,
      latencyMs: 234,
    });
    expect(r.success).toBe(true);
  });
});

describe("SourceRetrievalPolicy defaults", () => {
  it("defaults are bounded and nonzero (retry limit may be zero)", () => {
    const r = SourceRetrievalPolicySchema.safeParse(
      DEFAULT_SOURCE_RETRIEVAL_POLICY,
    );
    expect(r.success).toBe(true);
    expect(DEFAULT_SOURCE_RETRIEVAL_POLICY.perSourceFetchTimeoutMs)
      .toBeGreaterThan(0);
    expect(DEFAULT_SOURCE_RETRIEVAL_POLICY.totalRetrievalBudgetMs)
      .toBeGreaterThan(0);
    expect(DEFAULT_SOURCE_RETRIEVAL_POLICY.maxSourcesPerSession)
      .toBeGreaterThan(0);
    expect(DEFAULT_SOURCE_RETRIEVAL_POLICY.maxParallelSourceFetch)
      .toBeGreaterThan(0);
    expect(DEFAULT_SOURCE_RETRIEVAL_POLICY.sourceRetryLimit)
      .toBeGreaterThanOrEqual(0);
  });

  it("rejects a zero perSourceFetchTimeoutMs (would freeze the session)", () => {
    const bad = SourceRetrievalPolicySchema.safeParse({
      ...DEFAULT_SOURCE_RETRIEVAL_POLICY,
      perSourceFetchTimeoutMs: 0,
    });
    expect(bad.success).toBe(false);
  });

  it("rejects sub-second perSourceFetchTimeoutMs (< 1000)", () => {
    const bad = SourceRetrievalPolicySchema.safeParse({
      ...DEFAULT_SOURCE_RETRIEVAL_POLICY,
      perSourceFetchTimeoutMs: 200,
    });
    expect(bad.success).toBe(false);
  });

  it("rejects sub-second totalRetrievalBudgetMs (< 1000)", () => {
    const bad = SourceRetrievalPolicySchema.safeParse({
      ...DEFAULT_SOURCE_RETRIEVAL_POLICY,
      totalRetrievalBudgetMs: 500,
    });
    expect(bad.success).toBe(false);
  });

  it("rejects maxParallelSourceFetch > maxSourcesPerSession", () => {
    const bad = SourceRetrievalPolicySchema.safeParse({
      ...DEFAULT_SOURCE_RETRIEVAL_POLICY,
      maxSourcesPerSession: 2,
      maxParallelSourceFetch: 5,
    });
    expect(bad.success).toBe(false);
    if (!bad.success) {
      expect(
        bad.error.issues.some((i) =>
          /maxParallelSourceFetch.*must be <= maxSourcesPerSession/.test(
            i.message,
          ),
        ),
      ).toBe(true);
    }
  });

  it("accepts maxParallelSourceFetch == maxSourcesPerSession (boundary)", () => {
    const ok = SourceRetrievalPolicySchema.safeParse({
      ...DEFAULT_SOURCE_RETRIEVAL_POLICY,
      maxSourcesPerSession: 3,
      maxParallelSourceFetch: 3,
    });
    expect(ok.success).toBe(true);
  });

  it("allows sourceRetryLimit=0 (no retry by default)", () => {
    const ok = SourceRetrievalPolicySchema.safeParse({
      ...DEFAULT_SOURCE_RETRIEVAL_POLICY,
      sourceRetryLimit: 0,
    });
    expect(ok.success).toBe(true);
  });
});

describe("GET /api/evidence-sources (read-only catalog endpoint)", () => {
  it("returns the seed catalog, the default policy, and retrievalEnabled=false", async () => {
    const { GET } = await import("@/app/api/evidence-sources/route");
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      sources: Array<{ key: string; displayName: string }>;
      retrievalPolicy: {
        perSourceFetchTimeoutMs: number;
        totalRetrievalBudgetMs: number;
        maxSourcesPerSession: number;
        maxParallelSourceFetch: number;
        sourceRetryLimit: number;
      };
      retrievalEnabled: boolean;
      message: string;
    };

    // Catalog round-trips: every seed key is present.
    const keys = body.sources.map((s) => s.key);
    for (const k of SEED_KEYS) expect(keys).toContain(k);

    // KOTITI display name is correct.
    const kotiti = body.sources.find((s) => s.key === "kotiti");
    expect(kotiti?.displayName).toBe("KOTITI시험연구원 (KOTITI)");

    // Policy defaults round-trip and respect cross-field rule.
    expect(body.retrievalPolicy.perSourceFetchTimeoutMs).toBeGreaterThanOrEqual(
      1000,
    );
    expect(body.retrievalPolicy.totalRetrievalBudgetMs).toBeGreaterThanOrEqual(
      1000,
    );
    expect(body.retrievalPolicy.maxParallelSourceFetch).toBeLessThanOrEqual(
      body.retrievalPolicy.maxSourcesPerSession,
    );

    // Retrieval feature is not enabled yet.
    expect(body.retrievalEnabled).toBe(false);
    expect(body.message).toMatch(/구현되지 않/);
  });
});

describe("validateSourceCatalog", () => {
  it("accepts the default catalog", () => {
    const r = validateSourceCatalog(DEFAULT_EVIDENCE_SOURCE_CATALOG);
    expect(r.valid).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it("flags duplicate keys", () => {
    const dup: SourceCatalogEntry[] = [
      ...DEFAULT_EVIDENCE_SOURCE_CATALOG,
      { ...DEFAULT_EVIDENCE_SOURCE_CATALOG[0] },
    ];
    const r = validateSourceCatalog(dup);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => /duplicate/i.test(e))).toBe(true);
  });

  it("flags entries with missing required fields", () => {
    const bad = [
      {
        key: "broken",
        displayName: "",
        scopeNotes: "x",
        defaultTrustLevel: "official_public_page",
        inclusionWarning: "y",
      },
    ] as unknown as SourceCatalogEntry[];
    const r = validateSourceCatalog(bad);
    expect(r.valid).toBe(false);
    expect(r.errors[0]).toMatch(/displayName/);
  });
});

describe("Catalog ↔ display-label consistency", () => {
  it("display labels are derived from the catalog (no drift)", () => {
    const expected = DEFAULT_EVIDENCE_SOURCE_CATALOG.filter((e) => e.enabled)
      .map((e) => shortSourceLabel(e.key));
    expect([...EVIDENCE_SOURCE_DISPLAY_LABELS]).toEqual(expected);
  });

  it("kolas_kats short label uses the slash form", () => {
    expect(shortSourceLabel("kolas_kats")).toBe("KOLAS/KATS");
  });

  it("does not surface disabled catalog entries", () => {
    expect(EVIDENCE_SOURCE_DISPLAY_LABELS).not.toContain("CUSTOM");
    expect(EVIDENCE_SOURCE_DISPLAY_LABELS).not.toContain("custom");
  });
});

// ─────────────────────────────────────────────────────────────────────
// Evidence coverage report contract (future data shape; not wired yet)
// ─────────────────────────────────────────────────────────────────────

describe("EvidenceCoverageItem / EvidenceCoverageReport", () => {
  const allStatuses = [
    "covered",
    "missing",
    "contested",
    "not_applicable",
  ] as const;

  it.each(allStatuses)("accepts coverage status=%s", (status) => {
    const r = EvidenceCoverageItemSchema.safeParse({
      claim: "테스트 클레임",
      status,
    });
    expect(r.success).toBe(true);
  });

  it("rejects an unknown coverage status", () => {
    const r = EvidenceCoverageItemSchema.safeParse({
      claim: "x",
      status: "bogus",
    });
    expect(r.success).toBe(false);
  });

  it("requires a non-empty claim", () => {
    const r = EvidenceCoverageItemSchema.safeParse({
      claim: "",
      status: "covered",
    });
    expect(r.success).toBe(false);
  });

  it("applies array/string defaults for optional fields", () => {
    const r = EvidenceCoverageItemSchema.parse({
      claim: "x",
      status: "missing",
    });
    expect(r.evidenceIds).toEqual([]);
    expect(r.missingEvidence).toEqual([]);
    expect(r.notes).toBe("");
  });

  it("EvidenceCoverageReportSchema accepts covered / uncovered / contested / sourceUnavailable", () => {
    const r = EvidenceCoverageReportSchema.safeParse({
      coveredClaims: [
        { claim: "A", status: "covered", evidenceIds: ["e1"] },
      ],
      uncoveredClaims: [{ claim: "B", status: "missing" }],
      contestedClaims: [
        { claim: "C", status: "contested", evidenceIds: ["e2", "e3"] },
      ],
      sourceUnavailable: [
        {
          source: "kcl",
          reason: "timeout",
          startedAt: 100,
          endedAt: 350,
          latencyMs: 250,
        },
      ],
    });
    expect(r.success).toBe(true);
  });

  it("EvidenceCoverageReportSchema propagates SourceUnavailable timing invariants", () => {
    // endedAt < startedAt must be rejected even when nested inside the report.
    const bad = EvidenceCoverageReportSchema.safeParse({
      coveredClaims: [],
      uncoveredClaims: [],
      contestedClaims: [],
      sourceUnavailable: [
        {
          source: "kcl",
          reason: "timeout",
          startedAt: 500,
          endedAt: 100,
          latencyMs: 0,
        },
      ],
    });
    expect(bad.success).toBe(false);

    // latencyMs inconsistent with endedAt - startedAt must also be rejected.
    const drift = EvidenceCoverageReportSchema.safeParse({
      coveredClaims: [],
      uncoveredClaims: [],
      contestedClaims: [],
      sourceUnavailable: [
        {
          source: "kcl",
          reason: "http_5xx",
          startedAt: 100,
          endedAt: 200,
          latencyMs: 999,
        },
      ],
    });
    expect(drift.success).toBe(false);
  });

  it("EvidenceCoverageReportSchema applies array defaults", () => {
    const r = EvidenceCoverageReportSchema.parse({});
    expect(r.coveredClaims).toEqual([]);
    expect(r.uncoveredClaims).toEqual([]);
    expect(r.contestedClaims).toEqual([]);
    expect(r.sourceUnavailable).toEqual([]);
  });
});

describe("summarizeEvidenceCoverage", () => {
  it("returns zeros for an empty report", () => {
    expect(
      summarizeEvidenceCoverage({
        coveredClaims: [],
        uncoveredClaims: [],
        contestedClaims: [],
        sourceUnavailable: [],
      }),
    ).toEqual({
      covered: 0,
      uncovered: 0,
      contested: 0,
      unavailableSources: 0,
    });
  });

  it("counts each bucket independently", () => {
    const mk = (n: number, status: EvidenceCoverageItem["status"]) =>
      Array.from({ length: n }, (_, i) => ({
        claim: `claim-${status}-${i}`,
        status,
        evidenceIds: [],
        missingEvidence: [],
        notes: "",
      })) as EvidenceCoverageItem[];

    const summary = summarizeEvidenceCoverage({
      coveredClaims: mk(3, "covered"),
      uncoveredClaims: mk(2, "missing"),
      contestedClaims: mk(1, "contested"),
      sourceUnavailable: [
        {
          source: "kcl",
          reason: "timeout",
          startedAt: 0,
          endedAt: 100,
          latencyMs: 100,
        },
        {
          source: "kfi",
          reason: "http_4xx",
          startedAt: 0,
          endedAt: 50,
          latencyMs: 50,
        },
      ],
    });
    expect(summary).toEqual({
      covered: 3,
      uncovered: 2,
      contested: 1,
      unavailableSources: 2,
    });
  });
});
