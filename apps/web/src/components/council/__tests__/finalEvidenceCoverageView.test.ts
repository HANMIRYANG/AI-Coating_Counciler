import { describe, it, expect } from "vitest";

import { buildFinalEvidenceCoverageView } from "../finalEvidenceCoverageView";
import type { FinalAnswer } from "@/lib/council/schemas";

function coverage(
  over: Partial<
    Pick<
      FinalAnswer,
      | "evidenceCoverageStatus"
      | "evidenceUsed"
      | "coveredClaims"
      | "uncoveredClaims"
    >
  >,
) {
  return {
    evidenceCoverageStatus: "not_requested" as const,
    evidenceUsed: [],
    coveredClaims: [],
    uncoveredClaims: [],
    ...over,
  };
}

const ref = {
  chunkId: "chunk_SECRET",
  filename: "kcl-report.md",
  chunkIndex: 2,
  trustLevel: "uploaded_copy",
  verificationStatus: "auto_extracted",
};

describe("buildFinalEvidenceCoverageView — hidden", () => {
  it("not_requested is quiet (not visible)", () => {
    expect(buildFinalEvidenceCoverageView(coverage({})).visible).toBe(false);
  });

  it("null/undefined input is quiet", () => {
    expect(buildFinalEvidenceCoverageView(null).visible).toBe(false);
    expect(buildFinalEvidenceCoverageView(undefined).visible).toBe(false);
  });
});

describe("buildFinalEvidenceCoverageView — partial", () => {
  const view = buildFinalEvidenceCoverageView(
    coverage({
      evidenceCoverageStatus: "partial",
      evidenceUsed: [ref],
      uncoveredClaims: ["장기 신뢰성 데이터"],
    }),
  );

  it("is visible, warn-toned, and carries a review warning", () => {
    expect(view.visible).toBe(true);
    expect(view.tone).toBe("warn");
    expect(view.statusLabel).toBe("부분 근거");
    expect(view.warning).toMatch(/사람 검토/);
  });

  it("maps evidence refs to display rows without bodies or raw ids", () => {
    expect(view.evidenceRefs).toHaveLength(1);
    const r = view.evidenceRefs[0];
    expect(r.title).toBe("kcl-report.md #2");
    expect(r.trustLevel).toBe("uploaded_copy");
    expect(r.verificationStatus).toBe("auto_extracted");
    // chunkId only lives in the React key, never in a displayed field.
    expect(r).not.toHaveProperty("chunkId");
    expect(r).not.toHaveProperty("snippet");
    expect(r).not.toHaveProperty("content");
    // The key is the chunkId, but the title never embeds it.
    expect(r.title).not.toContain("chunk_SECRET");
  });

  it("passes uncovered claims through", () => {
    expect(view.uncoveredClaims).toEqual(["장기 신뢰성 데이터"]);
  });
});

describe("buildFinalEvidenceCoverageView — no_evidence / unavailable", () => {
  for (const status of ["no_evidence", "unavailable"] as const) {
    it(`${status} is visible, warn-toned, with a warning and no refs`, () => {
      const view = buildFinalEvidenceCoverageView(
        coverage({ evidenceCoverageStatus: status }),
      );
      expect(view.visible).toBe(true);
      expect(view.tone).toBe("warn");
      expect(view.warning).toBeTruthy();
      expect(view.evidenceRefs).toEqual([]);
    });
  }
});

describe("buildFinalEvidenceCoverageView — sufficient", () => {
  const view = buildFinalEvidenceCoverageView(
    coverage({
      evidenceCoverageStatus: "sufficient",
      evidenceUsed: [ref],
      coveredClaims: [{ claim: "방오 성능 검토 가능", evidenceChunkIds: ["chunk_SECRET", "c2"] }],
    }),
  );

  it("is a good state without a warning", () => {
    expect(view.visible).toBe(true);
    expect(view.tone).toBe("good");
    expect(view.statusLabel).toBe("근거 충분");
    expect(view.warning).toBeUndefined();
  });

  it("summarizes covered claims with a ref count (no chunk ids exposed)", () => {
    expect(view.coveredClaims).toEqual([
      { claim: "방오 성능 검토 가능", refCount: 2 },
    ]);
    expect(view.coveredClaims[0]).not.toHaveProperty("evidenceChunkIds");
  });
});

describe("buildFinalEvidenceCoverageView — retrieval guard", () => {
  it("surfaces a passed guard (business-ready) on a visible view", () => {
    const view = buildFinalEvidenceCoverageView({
      ...coverage({
        evidenceCoverageStatus: "sufficient",
        evidenceUsed: [ref],
        coveredClaims: [{ claim: "x", evidenceChunkIds: ["chunk_SECRET"] }],
      }),
      retrievalGuard: {
        guardStatus: "passed",
        reasons: ["검증됨"],
        requiredEvidence: true,
        businessCitationReady: true,
        recommendedAction: "발송 가능",
      },
    });
    expect(view.guard).toBeDefined();
    expect(view.guard?.statusLabel).toBe("발송 가능");
    expect(view.guard?.tone).toBe("good");
    expect(view.guard?.businessReady).toBe(true);
  });

  it("maps a blocked guard to a warn tone", () => {
    const view = buildFinalEvidenceCoverageView({
      ...coverage({ evidenceCoverageStatus: "no_evidence" }),
      retrievalGuard: {
        guardStatus: "blocked",
        reasons: ["근거 없음"],
        requiredEvidence: true,
        businessCitationReady: false,
        recommendedAction: "발송 금지",
      },
    });
    expect(view.guard?.statusLabel).toBe("발송 차단");
    expect(view.guard?.tone).toBe("warn");
    expect(view.guard?.businessReady).toBe(false);
  });

  it("omits guard when the answer carries none", () => {
    const view = buildFinalEvidenceCoverageView(
      coverage({ evidenceCoverageStatus: "partial", evidenceUsed: [ref] }),
    );
    expect(view.guard).toBeUndefined();
  });
});

describe("buildFinalEvidenceCoverageView — verified citations", () => {
  it("builds citation rows (ready) when guard is business-ready", () => {
    const view = buildFinalEvidenceCoverageView({
      ...coverage({
        evidenceCoverageStatus: "sufficient",
        evidenceUsed: [ref],
        coveredClaims: [{ claim: "방오 성능 검토 가능", evidenceChunkIds: ["chunk_SECRET"] }],
      }),
      retrievalGuard: {
        guardStatus: "passed",
        reasons: [],
        requiredEvidence: true,
        businessCitationReady: true,
        recommendedAction: "발송 가능",
      },
    });
    expect(view.citations).toBeDefined();
    expect(view.citations?.citationReady).toBe(true);
    expect(view.citations?.readyLabel).toBe("인용 가능");
    expect(view.citations?.tone).toBe("good");
    const row = view.citations?.citedClaims[0];
    expect(row?.label).toBe("C1");
    expect(row?.evidence[0].title).toBe("kcl-report.md#2");
    // no internal chunk id surfaced
    expect(JSON.stringify(view.citations)).not.toContain("chunk_SECRET");
  });

  it("marks citations 검토 필요 when there is no business-ready guard", () => {
    const view = buildFinalEvidenceCoverageView(
      coverage({
        evidenceCoverageStatus: "partial",
        evidenceUsed: [ref],
        coveredClaims: [{ claim: "x", evidenceChunkIds: ["chunk_SECRET"] }],
        uncoveredClaims: ["미연결 주장"],
      }),
    );
    expect(view.citations?.citationReady).toBe(false);
    expect(view.citations?.readyLabel).toBe("검토 필요");
    expect(view.citations?.unresolvedClaims).toEqual(["미연결 주장"]);
  });

  it("omits citations for ai_only (not_requested → hidden view)", () => {
    const view = buildFinalEvidenceCoverageView(coverage({}));
    expect(view.visible).toBe(false);
    expect(view.citations).toBeUndefined();
  });
});

describe("buildFinalEvidenceCoverageView — citation integrity", () => {
  it("integrity ready (good tone, exportReady) with a business-ready guard", () => {
    const view = buildFinalEvidenceCoverageView({
      ...coverage({
        evidenceCoverageStatus: "sufficient",
        evidenceUsed: [ref],
        coveredClaims: [{ claim: "x", evidenceChunkIds: ["chunk_SECRET"] }],
      }),
      finalMarkdown: "본문 [C1]",
      retrievalGuard: {
        guardStatus: "passed",
        reasons: [],
        requiredEvidence: true,
        businessCitationReady: true,
        recommendedAction: "발송 가능",
      },
    });
    expect(view.integrity).toBeDefined();
    expect(view.integrity?.statusLabel).toBe("양호");
    expect(view.integrity?.tone).toBe("good");
    expect(view.integrity?.exportReady).toBe(true);
    // body "[C1]" matches the single generated label → no advisory, no problem.
    expect(view.integrity?.problemCount).toBe(0);
    expect(view.integrity?.advisoryCount).toBe(0);
  });

  it("integrity stays ready (good) with advisory-only inline-label findings", () => {
    const view = buildFinalEvidenceCoverageView({
      ...coverage({
        evidenceCoverageStatus: "sufficient",
        evidenceUsed: [ref],
        coveredClaims: [{ claim: "x", evidenceChunkIds: ["chunk_SECRET"] }],
      }),
      finalMarkdown: "라벨 없는 본문", // no [C#]
      retrievalGuard: {
        guardStatus: "passed",
        reasons: [],
        requiredEvidence: true,
        businessCitationReady: true,
        recommendedAction: "발송 가능",
      },
    });
    expect(view.integrity?.statusLabel).toBe("양호");
    expect(view.integrity?.tone).toBe("good");
    expect(view.integrity?.exportReady).toBe(true);
    expect(view.integrity?.problemCount).toBe(0);
    expect(view.integrity?.advisoryCount).toBeGreaterThan(0);
    expect(view.integrity?.advisoryRecommendations.length).toBeGreaterThan(0);
    expect(view.integrity?.problemRecommendations).toHaveLength(0);
  });

  it("integrity review_required for a legacy answer without a guard", () => {
    const view = buildFinalEvidenceCoverageView(
      coverage({
        evidenceCoverageStatus: "partial",
        evidenceUsed: [ref],
        coveredClaims: [{ claim: "x", evidenceChunkIds: ["chunk_SECRET"] }],
      }),
    );
    expect(view.integrity?.statusLabel).toBe("검토 필요");
    expect(view.integrity?.tone).toBe("warn");
    expect(view.integrity?.exportReady).toBe(false);
    expect(view.integrity?.issueCount).toBeGreaterThan(0);
    expect(view.integrity?.problemCount).toBeGreaterThan(0);
  });

  it("omits integrity for a not_required guard with no cited/unresolved claims", () => {
    const view = buildFinalEvidenceCoverageView({
      ...coverage({ evidenceCoverageStatus: "partial", coveredClaims: [], uncoveredClaims: [] }),
      retrievalGuard: {
        guardStatus: "not_required",
        reasons: [],
        requiredEvidence: false,
        businessCitationReady: false,
        recommendedAction: "",
      },
    });
    expect(view.integrity).toBeUndefined();
  });

  it("integrity blocked when guard is blocked", () => {
    const view = buildFinalEvidenceCoverageView({
      ...coverage({ evidenceCoverageStatus: "no_evidence", uncoveredClaims: ["근거 필요"] }),
      retrievalGuard: {
        guardStatus: "blocked",
        reasons: ["근거 없음"],
        requiredEvidence: true,
        businessCitationReady: false,
        recommendedAction: "발송 금지",
      },
    });
    expect(view.integrity?.statusLabel).toBe("차단");
    expect(view.integrity?.exportReady).toBe(false);
  });
});
