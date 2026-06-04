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
