import { describe, it, expect } from "vitest";

import {
  buildVerifiedCitations,
  type CitationInput,
} from "../verifiedCitations";
import type { EvidenceUsedRef, RetrievalGuardResult } from "../schemas";

function ref(over: Partial<EvidenceUsedRef> & { chunkId: string }): EvidenceUsedRef {
  return {
    filename: "kcl.md",
    chunkIndex: 0,
    trustLevel: "uploaded_copy",
    verificationStatus: "auto_extracted",
    ...over,
  };
}

function passedGuard(): RetrievalGuardResult {
  return {
    guardStatus: "passed",
    reasons: [],
    requiredEvidence: true,
    businessCitationReady: true,
    recommendedAction: "발송 가능",
  };
}

function input(over: Partial<CitationInput> = {}): CitationInput {
  return {
    evidenceUsed: [],
    coveredClaims: [],
    uncoveredClaims: [],
    ...over,
  };
}

describe("buildVerifiedCitations", () => {
  it("is citationReady when the guard is business-ready and every claim resolves", () => {
    const c = buildVerifiedCitations(
      input({
        evidenceUsed: [ref({ chunkId: "a", chunkIndex: 1 })],
        coveredClaims: [{ claim: "난연 충족", evidenceChunkIds: ["a"] }],
        retrievalGuard: passedGuard(),
      }),
    );
    expect(c.citationReady).toBe(true);
    expect(c.citedClaims).toHaveLength(1);
    expect(c.citedClaims[0].label).toBe("C1");
    expect(c.citedClaims[0].evidence[0].label).toBe("E1");
    expect(c.citedClaims[0].evidence[0].title).toBe("kcl.md#1");
    expect(c.evidenceRefs).toHaveLength(1);
  });

  it("is NOT citationReady when a covered claim has no matching evidenceUsed ref", () => {
    const c = buildVerifiedCitations(
      input({
        evidenceUsed: [ref({ chunkId: "a" })],
        // claim points at a chunk that is not in evidenceUsed
        coveredClaims: [{ claim: "근거 없는 주장", evidenceChunkIds: ["missing"] }],
        retrievalGuard: passedGuard(),
      }),
    );
    expect(c.citationReady).toBe(false);
    expect(c.citedClaims[0].evidence).toHaveLength(0);
  });

  it("is NOT citationReady when uncovered claims remain (even if guard is business-ready)", () => {
    const c = buildVerifiedCitations(
      input({
        evidenceUsed: [ref({ chunkId: "a" })],
        coveredClaims: [{ claim: "난연 충족", evidenceChunkIds: ["a"] }],
        uncoveredClaims: ["장기 신뢰성 데이터"],
        retrievalGuard: passedGuard(),
      }),
    );
    // Every cited claim resolves, guard says ready — but an unresolved claim
    // remains, so the citation view must defensively report not-ready.
    expect(c.citedClaims[0].evidence).toHaveLength(1);
    expect(c.citationReady).toBe(false);
    expect(c.unresolvedClaims).toEqual(["장기 신뢰성 데이터"]);
  });

  it("is NOT citationReady when the guard is not business-ready (e.g. warning)", () => {
    const c = buildVerifiedCitations(
      input({
        evidenceUsed: [ref({ chunkId: "a" })],
        coveredClaims: [{ claim: "x", evidenceChunkIds: ["a"] }],
        retrievalGuard: { ...passedGuard(), guardStatus: "warning", businessCitationReady: false },
      }),
    );
    expect(c.citationReady).toBe(false);
  });

  it("is NOT citationReady for a contradictory guard (business-ready but not 'passed')", () => {
    const c = buildVerifiedCitations(
      input({
        evidenceUsed: [ref({ chunkId: "a" })],
        coveredClaims: [{ claim: "x", evidenceChunkIds: ["a"] }],
        // businessCitationReady stays true but guardStatus is warning.
        retrievalGuard: { ...passedGuard(), guardStatus: "warning" },
      }),
    );
    expect(c.citationReady).toBe(false);
  });

  it("dedupes evidence refs deterministically (same chunk → one ref, one label)", () => {
    const c = buildVerifiedCitations(
      input({
        evidenceUsed: [ref({ chunkId: "a" }), ref({ chunkId: "b", chunkIndex: 2 })],
        coveredClaims: [
          { claim: "주장1", evidenceChunkIds: ["a", "a", "b"] },
          { claim: "주장2", evidenceChunkIds: ["b", "a"] },
        ],
        retrievalGuard: passedGuard(),
      }),
    );
    // a → E1, b → E2 (first-appearance order); union deduped to 2.
    expect(c.evidenceRefs.map((e) => e.label)).toEqual(["E1", "E2"]);
    // claim1 cites a(E1) once + b(E2); claim2 cites b(E2)+a(E1).
    expect(c.citedClaims[0].evidence.map((e) => e.label)).toEqual(["E1", "E2"]);
    expect(c.citedClaims[1].evidence.map((e) => e.label)).toEqual(["E2", "E1"]);
    // Deterministic across runs.
    const again = buildVerifiedCitations(
      input({
        evidenceUsed: [ref({ chunkId: "a" }), ref({ chunkId: "b", chunkIndex: 2 })],
        coveredClaims: [
          { claim: "주장1", evidenceChunkIds: ["a", "a", "b"] },
          { claim: "주장2", evidenceChunkIds: ["b", "a"] },
        ],
        retrievalGuard: passedGuard(),
      }),
    );
    expect(again.evidenceRefs).toEqual(c.evidenceRefs);
  });

  it("preserves uncovered claims as unresolvedClaims (dropping blanks)", () => {
    const c = buildVerifiedCitations(
      input({ uncoveredClaims: ["장기 신뢰성 데이터", "   ", "추가 시험"] }),
    );
    expect(c.unresolvedClaims).toEqual(["장기 신뢰성 데이터", "추가 시험"]);
  });

  it("never emits raw chunk body or internal chunkId fields", () => {
    const c = buildVerifiedCitations(
      input({
        evidenceUsed: [ref({ chunkId: "secret-chunk-id" })],
        coveredClaims: [{ claim: "x", evidenceChunkIds: ["secret-chunk-id"] }],
        retrievalGuard: passedGuard(),
      }),
    );
    const evRef = c.evidenceRefs[0];
    expect(evRef).not.toHaveProperty("chunkId");
    expect(evRef).not.toHaveProperty("content");
    expect(evRef).not.toHaveProperty("snippet");
    expect(JSON.stringify(c)).not.toContain("secret-chunk-id");
  });

  it("exposes deterministic derived fields (labels + resolved flags)", () => {
    const c = buildVerifiedCitations(
      input({
        evidenceUsed: [ref({ chunkId: "a" }), ref({ chunkId: "b", chunkIndex: 3 })],
        coveredClaims: [
          { claim: "주장1", evidenceChunkIds: ["a"] },
          { claim: "주장2", evidenceChunkIds: ["b"] },
        ],
        uncoveredClaims: ["미연결"],
        retrievalGuard: passedGuard(),
      }),
    );
    expect(c.citationLabels).toEqual(["C1", "C2"]);
    expect(c.evidenceLabels).toEqual(["E1", "E2"]);
    expect(c.allCitedClaimsResolved).toBe(true);
    expect(c.hasUnresolvedClaims).toBe(true);
    // unresolved present → not ready despite resolved claims.
    expect(c.citationReady).toBe(false);
  });

  it("allCitedClaimsResolved is false when a claim has no resolvable ref", () => {
    const c = buildVerifiedCitations(
      input({
        evidenceUsed: [ref({ chunkId: "a" })],
        coveredClaims: [{ claim: "x", evidenceChunkIds: ["missing"] }],
        retrievalGuard: passedGuard(),
      }),
    );
    expect(c.allCitedClaimsResolved).toBe(false);
  });

  it("older answers without a retrievalGuard are not citationReady (no crash)", () => {
    const c = buildVerifiedCitations(
      input({
        evidenceUsed: [ref({ chunkId: "a" })],
        coveredClaims: [{ claim: "x", evidenceChunkIds: ["a"] }],
        // retrievalGuard omitted (legacy answer)
      }),
    );
    expect(c.citationReady).toBe(false);
    expect(c.citedClaims).toHaveLength(1);
  });
});
