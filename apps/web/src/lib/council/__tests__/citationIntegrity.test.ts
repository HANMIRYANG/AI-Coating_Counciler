import { describe, it, expect } from "vitest";

import {
  evaluateCitationIntegrity,
  type CitationIntegrityInput,
} from "../citationIntegrity";
import type { EvidenceUsedRef, RetrievalGuardResult } from "../schemas";

function ref(chunkId: string): EvidenceUsedRef {
  return {
    chunkId,
    filename: "kcl.md",
    chunkIndex: 0,
    trustLevel: "uploaded_copy",
    verificationStatus: "auto_extracted",
  };
}

function guard(over: Partial<RetrievalGuardResult> = {}): RetrievalGuardResult {
  return {
    guardStatus: "passed",
    reasons: [],
    requiredEvidence: true,
    businessCitationReady: true,
    recommendedAction: "발송 가능",
    ...over,
  };
}

function input(over: Partial<CitationIntegrityInput> = {}): CitationIntegrityInput {
  return {
    evidenceUsed: [],
    coveredClaims: [],
    uncoveredClaims: [],
    ...over,
  };
}

function codes(r: ReturnType<typeof evaluateCitationIntegrity>) {
  return r.issues.map((i) => i.code);
}

describe("evaluateCitationIntegrity", () => {
  it("ready: business-ready guard, all claims resolved, no uncovered, body has labels", () => {
    const r = evaluateCitationIntegrity(
      input({
        finalMarkdown: "결론 본문 [C1] 인용 포함",
        evidenceUsed: [ref("a")],
        coveredClaims: [{ claim: "난연 충족", evidenceChunkIds: ["a"] }],
        retrievalGuard: guard(),
      }),
    );
    expect(r.integrityStatus).toBe("ready");
    expect(r.exportReady).toBe(true);
    expect(r.reviewRequired).toBe(false);
    expect(r.issues).toHaveLength(0);
  });

  it("blocked: guard.guardStatus === 'blocked'", () => {
    const r = evaluateCitationIntegrity(
      input({
        evidenceUsed: [],
        coveredClaims: [],
        uncoveredClaims: ["근거 필요"],
        retrievalGuard: guard({
          guardStatus: "blocked",
          businessCitationReady: false,
        }),
      }),
    );
    expect(r.integrityStatus).toBe("blocked");
    expect(r.exportReady).toBe(false);
  });

  it("blocked: required evidence + citation not ready", () => {
    const r = evaluateCitationIntegrity(
      input({
        evidenceUsed: [ref("a")],
        coveredClaims: [{ claim: "x", evidenceChunkIds: ["a"] }],
        uncoveredClaims: ["미연결"],
        // guard not blocked, but requiredEvidence true and citation not ready
        // (uncovered present → citationReady false)
        retrievalGuard: guard({
          guardStatus: "warning",
          businessCitationReady: false,
          requiredEvidence: true,
        }),
      }),
    );
    expect(r.integrityStatus).toBe("blocked");
  });

  it("review_required: legacy answer with no retrievalGuard", () => {
    const r = evaluateCitationIntegrity(
      input({
        evidenceUsed: [ref("a")],
        coveredClaims: [{ claim: "x", evidenceChunkIds: ["a"] }],
        // retrievalGuard omitted
      }),
    );
    expect(r.integrityStatus).toBe("review_required");
    expect(codes(r)).toContain("unguarded_legacy_answer");
  });

  it("body without [C1] labels is an ADVISORY issue only (does not downgrade ready)", () => {
    const r = evaluateCitationIntegrity(
      input({
        finalMarkdown: "라벨 없는 본문",
        businessReadyAnswer: "발송본(라벨 없음)",
        evidenceUsed: [ref("a")],
        coveredClaims: [{ claim: "난연 충족", evidenceChunkIds: ["a"] }],
        retrievalGuard: guard(),
      }),
    );
    expect(r.integrityStatus).toBe("ready");
    expect(r.exportReady).toBe(true);
    expect(codes(r)).toEqual(["body_has_no_citation_labels"]);
  });

  it("advisory body_missing_citation_labels when body omits a generated [C#] (still ready)", () => {
    const r = evaluateCitationIntegrity(
      input({
        finalMarkdown: "본문 [C1] 만 표기",
        evidenceUsed: [ref("a"), ref("b")],
        coveredClaims: [
          { claim: "주장1", evidenceChunkIds: ["a"] },
          { claim: "주장2", evidenceChunkIds: ["b"] },
        ],
        retrievalGuard: guard(),
      }),
    );
    expect(r.integrityStatus).toBe("ready");
    expect(r.exportReady).toBe(true);
    expect(codes(r)).toContain("body_missing_citation_labels");
    expect(codes(r)).not.toContain("body_has_no_citation_labels");
  });

  it("advisory body_has_unknown_citation_labels when body cites [C99] (still ready)", () => {
    const r = evaluateCitationIntegrity(
      input({
        finalMarkdown: "본문 [C1] 그리고 [C99]",
        evidenceUsed: [ref("a")],
        coveredClaims: [{ claim: "주장1", evidenceChunkIds: ["a"] }],
        retrievalGuard: guard(),
      }),
    );
    expect(r.integrityStatus).toBe("ready");
    expect(r.exportReady).toBe(true);
    expect(codes(r)).toContain("body_has_unknown_citation_labels");
    expect(codes(r)).not.toContain("body_missing_citation_labels");
  });

  it("advisory inline-label issues never change exportReady when citationReady is otherwise true", () => {
    const base = {
      evidenceUsed: [ref("a")],
      coveredClaims: [{ claim: "주장1", evidenceChunkIds: ["a"] }],
      retrievalGuard: guard(),
    };
    const noLabels = evaluateCitationIntegrity(input({ ...base, finalMarkdown: "라벨 없음" }));
    const unknown = evaluateCitationIntegrity(input({ ...base, finalMarkdown: "[C1] [C9]" }));
    const good = evaluateCitationIntegrity(input({ ...base, finalMarkdown: "[C1]" }));
    expect(noLabels.exportReady).toBe(true);
    expect(unknown.exportReady).toBe(true);
    expect(good.exportReady).toBe(true);
    expect(good.issues).toHaveLength(0);
  });

  it("flags unresolved + missing-ref + no-cited-claims appropriately", () => {
    const r = evaluateCitationIntegrity(
      input({
        evidenceUsed: [],
        coveredClaims: [],
        uncoveredClaims: ["근거 필요 1"],
        retrievalGuard: guard({ guardStatus: "warning", businessCitationReady: false }),
      }),
    );
    expect(codes(r)).toContain("no_cited_claims");
    expect(codes(r)).toContain("unresolved_claim");
    expect(codes(r)).toContain("not_business_ready_guard");
    expect(r.recommendations.length).toBeGreaterThan(0);
  });

  it("classifies inline-label findings as advisory (ready, no inline labels)", () => {
    const r = evaluateCitationIntegrity(
      input({
        finalMarkdown: "라벨 없는 본문",
        evidenceUsed: [ref("a")],
        coveredClaims: [{ claim: "난연 충족", evidenceChunkIds: ["a"] }],
        retrievalGuard: guard(),
      }),
    );
    expect(r.integrityStatus).toBe("ready");
    expect(r.exportReady).toBe(true);
    expect(r.problemCount).toBe(0);
    expect(r.advisoryCount).toBeGreaterThan(0);
    expect(r.advisoryIssues.every((i) => i.severity === "advisory")).toBe(true);
    expect(r.problemIssues).toHaveLength(0);
  });

  it("missing generated label is advisory only (no readiness downgrade)", () => {
    const r = evaluateCitationIntegrity(
      input({
        finalMarkdown: "본문 [C1] 만",
        evidenceUsed: [ref("a"), ref("b")],
        coveredClaims: [
          { claim: "주장1", evidenceChunkIds: ["a"] },
          { claim: "주장2", evidenceChunkIds: ["b"] },
        ],
        retrievalGuard: guard(),
      }),
    );
    expect(r.integrityStatus).toBe("ready");
    expect(r.exportReady).toBe(true);
    expect(r.problemCount).toBe(0);
    expect(r.advisoryIssues.map((i) => i.code)).toContain(
      "body_missing_citation_labels",
    );
  });

  it("unknown [C99] label is advisory only (no readiness downgrade)", () => {
    const r = evaluateCitationIntegrity(
      input({
        finalMarkdown: "본문 [C1] [C99]",
        evidenceUsed: [ref("a")],
        coveredClaims: [{ claim: "주장1", evidenceChunkIds: ["a"] }],
        retrievalGuard: guard(),
      }),
    );
    expect(r.integrityStatus).toBe("ready");
    expect(r.exportReady).toBe(true);
    expect(r.problemCount).toBe(0);
    expect(r.advisoryIssues.map((i) => i.code)).toContain(
      "body_has_unknown_citation_labels",
    );
  });

  it("a real unresolved claim is a PROBLEM (not advisory-only)", () => {
    const r = evaluateCitationIntegrity(
      input({
        finalMarkdown: "본문 [C1]",
        evidenceUsed: [ref("a")],
        coveredClaims: [{ claim: "주장1", evidenceChunkIds: ["a"] }],
        uncoveredClaims: ["장기 신뢰성 데이터"],
        // not business-ready, evidence NOT required → review_required
        retrievalGuard: guard({
          guardStatus: "warning",
          businessCitationReady: false,
          requiredEvidence: false,
        }),
      }),
    );
    expect(r.integrityStatus).toBe("review_required");
    expect(r.problemCount).toBeGreaterThan(0);
    expect(r.problemIssues.map((i) => i.code)).toContain("unresolved_claim");
    expect(r.summary).toContain("문제");
  });

  it("summary never labels advisory-only findings as 문제", () => {
    const r = evaluateCitationIntegrity(
      input({
        finalMarkdown: "라벨 없음",
        evidenceUsed: [ref("a")],
        coveredClaims: [{ claim: "주장1", evidenceChunkIds: ["a"] }],
        retrievalGuard: guard(),
      }),
    );
    expect(r.summary).not.toContain("문제");
    expect(r.summary).toContain("양호");
    expect(r.summary).toContain("자문");
  });

  it("contradictory blocked guard (businessCitationReady:true) stays blocked with problems", () => {
    const r = evaluateCitationIntegrity(
      input({
        finalMarkdown: "본문 [C1]",
        evidenceUsed: [ref("a")],
        coveredClaims: [{ claim: "주장1", evidenceChunkIds: ["a"] }],
        // Inconsistent payload: blocked verdict but the flag says ready.
        retrievalGuard: guard({ guardStatus: "blocked", businessCitationReady: true }),
      }),
    );
    expect(r.integrityStatus).toBe("blocked");
    expect(r.exportReady).toBe(false);
    expect(r.problemCount).toBeGreaterThan(0);
    expect(r.problemIssues.map((i) => i.code)).toContain(
      "not_business_ready_guard",
    );
  });

  it("contradictory warning guard (businessCitationReady:true) does not become ready/exportReady", () => {
    const r = evaluateCitationIntegrity(
      input({
        finalMarkdown: "본문 [C1]",
        evidenceUsed: [ref("a")],
        coveredClaims: [{ claim: "주장1", evidenceChunkIds: ["a"] }],
        retrievalGuard: guard({ guardStatus: "warning", businessCitationReady: true }),
      }),
    );
    expect(r.integrityStatus).not.toBe("ready");
    expect(r.exportReady).toBe(false);
    expect(r.problemCount).toBeGreaterThan(0);
  });

  it("never emits raw chunkId or chunk body text", () => {
    const r = evaluateCitationIntegrity(
      input({
        finalMarkdown: "[C1]",
        evidenceUsed: [ref("secret-chunk-id")],
        coveredClaims: [{ claim: "x", evidenceChunkIds: ["secret-chunk-id"] }],
        retrievalGuard: guard(),
      }),
    );
    const json = JSON.stringify(r);
    expect(json).not.toContain("secret-chunk-id");
    expect(json).not.toContain("content");
    expect(json).not.toContain("snippet");
  });
});
