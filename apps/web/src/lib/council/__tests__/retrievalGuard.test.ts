import { describe, it, expect } from "vitest";

import {
  evaluateRetrievalGuard,
  applyRetrievalGuard,
  type GuardAnswerFields,
} from "../retrievalGuard";
import type { EvidenceUsedRef } from "../schemas";

function ans(over: Partial<GuardAnswerFields> = {}): GuardAnswerFields {
  return {
    evidenceCoverageStatus: "not_requested",
    evidenceUsed: [],
    coveredClaims: [],
    uncoveredClaims: [],
    missingEvidence: [],
    riskLevel: "low",
    confidenceScore: 0.5,
    ...over,
  };
}

function ref(trustLevel: string): EvidenceUsedRef {
  return {
    chunkId: `c-${trustLevel}`,
    filename: "report.md",
    chunkIndex: 0,
    trustLevel,
    verificationStatus: "auto_extracted",
  };
}

// A fully-validated "sufficient" answer: one covered claim backed by a
// business-citable trust level, no uncovered claims.
function sufficientAnswer(trustLevel = "uploaded_copy"): GuardAnswerFields {
  return ans({
    evidenceCoverageStatus: "sufficient",
    evidenceUsed: [ref(trustLevel)],
    coveredClaims: [{ claim: "난연 등급 충족", evidenceChunkIds: [`c-${trustLevel}`] }],
    uncoveredClaims: [],
  });
}

describe("evaluateRetrievalGuard — ai_only", () => {
  it("is not_required for a normal ai_only answer", () => {
    const r = evaluateRetrievalGuard({
      taskType: "technical_review",
      evidenceMode: "ai_only",
      answer: ans(),
    });
    expect(r.guardStatus).toBe("not_required");
    expect(r.businessCitationReady).toBe(false);
  });

  it("warns when an ai_only answer unexpectedly claims sufficient/evidence", () => {
    const r = evaluateRetrievalGuard({
      taskType: "technical_review",
      evidenceMode: "ai_only",
      answer: ans({ evidenceCoverageStatus: "sufficient", evidenceUsed: [ref("uploaded_copy")] }),
    });
    expect(r.guardStatus).toBe("warning");
    expect(r.businessCitationReady).toBe(false);
  });

  it("warns for an evidence-required task in ai_only mode", () => {
    const r = evaluateRetrievalGuard({
      taskType: "document_based_answer",
      evidenceMode: "ai_only",
      answer: ans(),
    });
    expect(r.guardStatus).toBe("warning");
    expect(r.requiredEvidence).toBe(true);
    expect(r.businessCitationReady).toBe(false);
  });
});

describe("evaluateRetrievalGuard — internal_docs no/insufficient evidence", () => {
  it("no_evidence on a non-required task → warning, not business-ready", () => {
    const r = evaluateRetrievalGuard({
      taskType: "technical_review",
      evidenceMode: "internal_docs",
      retrievalStatus: "no_matches",
      answer: ans({ evidenceCoverageStatus: "no_evidence", uncoveredClaims: ["x"] }),
    });
    expect(r.guardStatus).toBe("warning");
    expect(r.businessCitationReady).toBe(false);
  });

  it("no_evidence on document_based_answer → blocked", () => {
    const r = evaluateRetrievalGuard({
      taskType: "document_based_answer",
      evidenceMode: "internal_docs",
      retrievalStatus: "no_matches",
      answer: ans({ evidenceCoverageStatus: "no_evidence" }),
    });
    expect(r.guardStatus).toBe("blocked");
    expect(r.requiredEvidence).toBe(true);
    expect(r.businessCitationReady).toBe(false);
  });

  it("unavailable on certification_checklist → blocked", () => {
    const r = evaluateRetrievalGuard({
      taskType: "certification_checklist",
      evidenceMode: "internal_docs",
      retrievalStatus: "unavailable",
      answer: ans({ evidenceCoverageStatus: "unavailable" }),
    });
    expect(r.guardStatus).toBe("blocked");
  });

  it("high/critical risk with no_evidence → blocked even for a normal task", () => {
    const r = evaluateRetrievalGuard({
      taskType: "technical_review",
      evidenceMode: "internal_docs",
      retrievalStatus: "no_matches",
      answer: ans({ evidenceCoverageStatus: "no_evidence", riskLevel: "critical" }),
    });
    expect(r.guardStatus).toBe("blocked");
    expect(r.requiredEvidence).toBe(true);
  });

  it("partial (e.g. invented E99 downgraded) → warning, not business-ready", () => {
    const r = evaluateRetrievalGuard({
      taskType: "technical_review",
      evidenceMode: "internal_docs",
      retrievalStatus: "ok",
      answer: ans({
        evidenceCoverageStatus: "partial",
        evidenceUsed: [ref("uploaded_copy")],
        coveredClaims: [],
        uncoveredClaims: ["근거 미연결 주장"],
      }),
    });
    expect(r.guardStatus).toBe("warning");
    expect(r.businessCitationReady).toBe(false);
  });
});

describe("evaluateRetrievalGuard — sufficient", () => {
  it("valid sufficient mapping with business-citable evidence → passed + business-ready", () => {
    const r = evaluateRetrievalGuard({
      taskType: "document_based_answer",
      evidenceMode: "internal_docs",
      retrievalStatus: "ok",
      answer: sufficientAnswer("uploaded_copy"),
    });
    expect(r.guardStatus).toBe("passed");
    expect(r.businessCitationReady).toBe(true);
  });

  it("high-risk sufficient + valid covered claim → passed", () => {
    const r = evaluateRetrievalGuard({
      taskType: "technical_review",
      evidenceMode: "internal_docs_web",
      retrievalStatus: "ok",
      answer: { ...sufficientAnswer("official_registry"), riskLevel: "high" },
    });
    expect(r.guardStatus).toBe("passed");
    expect(r.businessCitationReady).toBe(true);
  });

  it("sufficient but only unverified_web evidence → NOT business-ready (warning)", () => {
    const r = evaluateRetrievalGuard({
      taskType: "technical_review",
      evidenceMode: "internal_docs_web",
      retrievalStatus: "ok",
      answer: sufficientAnswer("unverified_web"),
    });
    expect(r.businessCitationReady).toBe(false);
    expect(r.guardStatus).toBe("warning");
  });

  it("sufficient but with an uncovered claim → NOT business-ready", () => {
    const r = evaluateRetrievalGuard({
      taskType: "technical_review",
      evidenceMode: "internal_docs",
      retrievalStatus: "ok",
      answer: { ...sufficientAnswer("uploaded_copy"), uncoveredClaims: ["미연결"] },
    });
    expect(r.businessCitationReady).toBe(false);
  });
});

describe("applyRetrievalGuard", () => {
  it("attaches a retrievalGuard verdict without mutating other fields", () => {
    const answer = sufficientAnswer("uploaded_copy");
    const out = applyRetrievalGuard(answer, {
      taskType: "document_based_answer",
      evidenceMode: "internal_docs",
      retrievalStatus: "ok",
    });
    expect(out.retrievalGuard.guardStatus).toBe("passed");
    expect(out.evidenceCoverageStatus).toBe("sufficient");
    // original object not mutated
    expect("retrievalGuard" in answer).toBe(false);
  });
});
