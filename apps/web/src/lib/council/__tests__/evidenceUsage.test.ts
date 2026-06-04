import { describe, it, expect } from "vitest";

import {
  applyEvidenceUsage,
  UNVERIFIED_CLAIM_MAPPING_NOTE,
} from "../evidenceUsage";
import { FinalAnswerSchema, type FinalAnswer } from "../schemas";
import type { SessionEvidencePreview } from "../evidencePreview";

function answer(over: Partial<FinalAnswer> = {}): FinalAnswer {
  return FinalAnswerSchema.parse({
    conclusion: "결론",
    finalMarkdown: "본문",
    businessReadyAnswer: "발송용",
    missingEvidence: ["최신 시험성적서", "장기 신뢰성 데이터"],
    ...over,
  });
}

function candidate(i: number): SessionEvidencePreview["candidates"][number] {
  return {
    documentId: `doc${i}`,
    filename: `report${i}.md`,
    chunkIndex: i,
    chunkId: `chunk${i}`,
    snippet: `…방오 ${i}…`,
    metadata: { issuer: "KCL" },
    score: 100 - i,
    trustLevel: "uploaded_copy",
    verificationStatus: "auto_extracted",
  };
}

function preview(
  retrievalStatus: SessionEvidencePreview["retrievalStatus"],
  candidates: SessionEvidencePreview["candidates"] = [],
  count = candidates.length,
): SessionEvidencePreview {
  return { mode: "internal_docs", retrievalStatus, count, candidates };
}

describe("applyEvidenceUsage", () => {
  it("ai_only / undefined preview → not_requested with no references", () => {
    for (const p of [
      undefined,
      preview("not_requested"),
    ] as const) {
      const out = applyEvidenceUsage(answer(), p);
      expect(out.evidenceCoverageStatus).toBe("not_requested");
      expect(out.evidenceUsed).toEqual([]);
      expect(out.coveredClaims).toEqual([]);
      expect(out.uncoveredClaims).toEqual([]);
    }
  });

  it("ok preview without model mapping → conservative partial with refs from candidates", () => {
    const out = applyEvidenceUsage(
      answer(),
      preview("ok", [candidate(0), candidate(1)], 5),
    );
    expect(out.evidenceCoverageStatus).toBe("partial");
    expect(out.evidenceUsed.map((r) => r.chunkId)).toEqual(["chunk0", "chunk1"]);
    // No chunk body leaks into a reference.
    for (const ref of out.evidenceUsed) {
      expect(ref).not.toHaveProperty("snippet");
      expect(ref).not.toHaveProperty("content");
    }
    // Uncovered derived from missingEvidence.
    expect(out.uncoveredClaims).toEqual([
      "최신 시험성적서",
      "장기 신뢰성 데이터",
    ]);
    // Never auto-asserts sufficient.
    expect(out.evidenceCoverageStatus).not.toBe("sufficient");
  });

  it("ok preview falls back to the generic note when there is no missingEvidence", () => {
    const out = applyEvidenceUsage(
      answer({ missingEvidence: [] }),
      preview("ok", [candidate(0)]),
    );
    expect(out.uncoveredClaims).toEqual([UNVERIFIED_CLAIM_MAPPING_NOTE]);
  });

  it("ok preview WITH explicit model mapping is respected (incl. sufficient)", () => {
    const modelled = answer({
      missingEvidence: [],
      coveredClaims: [{ claim: "방오 성능 시험 결과가 있습니다.", evidenceChunkIds: ["E1"] }],
      evidenceCoverageStatus: "sufficient",
    });
    const out = applyEvidenceUsage(modelled, preview("ok", [candidate(0)]));
    expect(out.evidenceCoverageStatus).toBe("sufficient");
    expect(out.evidenceUsed.map((r) => r.chunkId)).toEqual(["chunk0"]);
    expect(out.coveredClaims).toEqual([
      {
        claim: "방오 성능 시험 결과가 있습니다.",
        evidenceChunkIds: ["chunk0"],
      },
    ]);
    expect(out.uncoveredClaims).toEqual([]);
  });

  it("ok preview resolves bracketed evidence IDs and de-dupes refs", () => {
    const modelled = answer({
      missingEvidence: [],
      coveredClaims: [
        {
          claim: "두 후보가 같은 주장을 보강합니다.",
          evidenceChunkIds: ["[E1]", "근거 E2", "E1"],
        },
      ],
      evidenceCoverageStatus: "sufficient",
    });
    const out = applyEvidenceUsage(
      modelled,
      preview("ok", [candidate(0), candidate(1)]),
    );
    expect(out.evidenceUsed.map((r) => r.chunkId)).toEqual(["chunk0", "chunk1"]);
    expect(out.coveredClaims[0].evidenceChunkIds).toEqual([
      "chunk0",
      "chunk1",
    ]);
  });

  it("ok preview downgrades invented evidence IDs into uncovered claims", () => {
    const modelled = answer({
      missingEvidence: [],
      coveredClaims: [
        { claim: "존재하지 않는 근거에 연결된 주장", evidenceChunkIds: ["E99"] },
      ],
      uncoveredClaims: ["모델이 이미 표시한 미근거 주장"],
      evidenceCoverageStatus: "sufficient",
    });
    const out = applyEvidenceUsage(modelled, preview("ok", [candidate(0)]));
    expect(out.evidenceCoverageStatus).toBe("partial");
    expect(out.evidenceUsed).toEqual([]);
    expect(out.coveredClaims).toEqual([]);
    expect(out.uncoveredClaims).toEqual([
      "모델이 이미 표시한 미근거 주장",
      "존재하지 않는 근거에 연결된 주장",
    ]);
  });

  it("ok preview downgrades sufficient when missing evidence remains", () => {
    const modelled = answer({
      coveredClaims: [{ claim: "근거 연결 주장", evidenceChunkIds: ["E1"] }],
      evidenceCoverageStatus: "sufficient",
    });
    const out = applyEvidenceUsage(modelled, preview("ok", [candidate(0)]));
    expect(out.evidenceCoverageStatus).toBe("partial");
    expect(out.coveredClaims[0].evidenceChunkIds).toEqual(["chunk0"]);
    expect(out.uncoveredClaims).toEqual([
      "최신 시험성적서",
      "장기 신뢰성 데이터",
    ]);
  });

  it("no_matches → no_evidence with uncovered claims, no references", () => {
    const out = applyEvidenceUsage(answer(), preview("no_matches"));
    expect(out.evidenceCoverageStatus).toBe("no_evidence");
    expect(out.evidenceUsed).toEqual([]);
    expect(out.uncoveredClaims.length).toBeGreaterThan(0);
  });

  it("unavailable / failed → unavailable, no references", () => {
    for (const status of ["unavailable", "failed"] as const) {
      const out = applyEvidenceUsage(answer(), preview(status));
      expect(out.evidenceCoverageStatus).toBe("unavailable");
      expect(out.evidenceUsed).toEqual([]);
      expect(out.uncoveredClaims.length).toBeGreaterThan(0);
    }
  });

  it("bounds the uncovered-claim list", () => {
    const many = Array.from({ length: 25 }, (_, i) => `누락 ${i}`);
    const out = applyEvidenceUsage(
      answer({ missingEvidence: many }),
      preview("no_matches"),
    );
    expect(out.uncoveredClaims.length).toBeLessThanOrEqual(10);
  });

  it("preserves the rest of the final answer untouched", () => {
    const a = answer();
    const out = applyEvidenceUsage(a, preview("ok", [candidate(0)]));
    expect(out.conclusion).toBe(a.conclusion);
    expect(out.businessReadyAnswer).toBe(a.businessReadyAnswer);
    expect(out.missingEvidence).toEqual(a.missingEvidence);
  });
});
