import { describe, it, expect } from "vitest";

import {
  failedPreview,
  notRequestedPreview,
  previewFromBundle,
  unavailablePreview,
  MAX_PREVIEW_CANDIDATES,
} from "../evidencePreview";
import type {
  EvidenceBundle,
  InternalEvidenceCandidate,
} from "@/lib/documents/evidence-bundle";

function candidate(i: number): InternalEvidenceCandidate {
  return {
    sourceType: "internal_document",
    documentId: `doc${i}`,
    filename: `f${i}.md`,
    chunkId: `c${i}`,
    chunkIndex: i,
    snippet: `…snippet ${i}…`,
    metadata: { issuer: "KCL", documentType: "test_report" },
    score: 100 - i,
    trustLevel: "uploaded_copy",
    verificationStatus: "auto_extracted",
  };
}

function bundle(count: number, n: number = count): EvidenceBundle {
  return {
    normalizedQuery: "방오 코팅",
    retrievalMode: "internal_documents_keyword",
    retrievalStatus: count > 0 ? "ok" : "no_matches",
    count,
    candidates: Array.from({ length: n }, (_, i) => candidate(i)),
  };
}

describe("notRequestedPreview", () => {
  it("marks ai_only retrieval as not_requested with no candidates", () => {
    expect(notRequestedPreview("ai_only")).toEqual({
      mode: "ai_only",
      retrievalStatus: "not_requested",
      count: 0,
      candidates: [],
    });
  });
});

describe("previewFromBundle", () => {
  it("maps a populated bundle to ok and bounds the candidate list", () => {
    const preview = previewFromBundle("internal_docs", bundle(7));
    expect(preview.retrievalStatus).toBe("ok");
    // count reflects the full bundle, candidates are truncated.
    expect(preview.count).toBe(7);
    expect(preview.candidates).toHaveLength(MAX_PREVIEW_CANDIDATES);
    expect(preview.mode).toBe("internal_docs");
  });

  it("maps an empty bundle to no_matches", () => {
    const preview = previewFromBundle("internal_docs", bundle(0, 0));
    expect(preview.retrievalStatus).toBe("no_matches");
    expect(preview.count).toBe(0);
    expect(preview.candidates).toEqual([]);
  });

  it("keeps only lightweight fields — never a full chunk body", () => {
    const preview = previewFromBundle("internal_docs", bundle(1));
    const c = preview.candidates[0];
    expect(c).not.toHaveProperty("content");
    expect(c).not.toHaveProperty("sourceType");
    expect(c.snippet).toBe("…snippet 0…");
    expect(c.trustLevel).toBe("uploaded_copy");
    expect(c.verificationStatus).toBe("auto_extracted");
    expect(c.metadata).toEqual({ issuer: "KCL", documentType: "test_report" });
  });
});

describe("unavailablePreview / failedPreview", () => {
  it("carry the error message and an empty bounded candidate list", () => {
    expect(unavailablePreview("internal_docs", "db down")).toEqual({
      mode: "internal_docs",
      retrievalStatus: "unavailable",
      count: 0,
      candidates: [],
      errorMessage: "db down",
    });
    expect(failedPreview("internal_docs", "boom")).toEqual({
      mode: "internal_docs",
      retrievalStatus: "failed",
      count: 0,
      candidates: [],
      errorMessage: "boom",
    });
  });
});
