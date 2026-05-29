import { describe, it, expect, vi } from "vitest";

import {
  EvidenceBundleService,
  INTERNAL_DOCUMENT_TRUST_LEVEL,
  INTERNAL_DOCUMENT_VERIFICATION_STATUS,
  RETRIEVAL_MODE,
  toEvidenceCandidate,
  toEvidenceCandidates,
} from "../evidence-bundle";
import type { DocumentSearchResult } from "../search";
import type { DocumentService } from "../service";

function result(over: Partial<DocumentSearchResult> = {}): DocumentSearchResult {
  return {
    documentId: "doc1",
    filename: "report.md",
    chunkId: "chunk1",
    chunkIndex: 0,
    snippet: "…fire resistance result…",
    metadata: { issuer: "KCL", documentType: "test_report" },
    score: 202,
    ...over,
  };
}

// A DocumentService stub that only implements .search — enough for the
// bundle service, which never touches the rest. No database involved.
function stubDocuments(search: DocumentService["search"]): DocumentService {
  return { search } as unknown as DocumentService;
}

describe("toEvidenceCandidate", () => {
  it("stamps internal-document source/trust/verification and copies fields", () => {
    const candidate = toEvidenceCandidate(result());
    expect(candidate).toEqual({
      sourceType: "internal_document",
      documentId: "doc1",
      filename: "report.md",
      chunkId: "chunk1",
      chunkIndex: 0,
      snippet: "…fire resistance result…",
      metadata: { issuer: "KCL", documentType: "test_report" },
      score: 202,
      trustLevel: INTERNAL_DOCUMENT_TRUST_LEVEL,
      verificationStatus: INTERNAL_DOCUMENT_VERIFICATION_STATUS,
    });
  });

  it("uses uploaded_copy + auto_extracted as the internal-document tokens", () => {
    expect(INTERNAL_DOCUMENT_TRUST_LEVEL).toBe("uploaded_copy");
    expect(INTERNAL_DOCUMENT_VERIFICATION_STATUS).toBe("auto_extracted");
  });

  it("never carries a full chunk body", () => {
    const candidate = toEvidenceCandidate(result());
    expect(candidate).not.toHaveProperty("content");
  });

  it("preserves null metadata", () => {
    expect(toEvidenceCandidate(result({ metadata: null })).metadata).toBeNull();
  });
});

describe("toEvidenceCandidates", () => {
  it("preserves the search ordering", () => {
    const results = [
      result({ chunkId: "a", score: 300 }),
      result({ chunkId: "b", score: 200 }),
      result({ chunkId: "c", score: 100 }),
    ];
    expect(toEvidenceCandidates(results).map((c) => c.chunkId)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("maps an empty list to an empty list", () => {
    expect(toEvidenceCandidates([])).toEqual([]);
  });
});

describe("EvidenceBundleService.build", () => {
  it("forwards query + filters to DocumentService.search as { q, ... }", async () => {
    const searchMock = vi.fn().mockResolvedValue([]);
    const service = new EvidenceBundleService(stubDocuments(searchMock));

    await service.build({
      query: "fire coating",
      documentType: "test_report",
      productName: "HE-850A",
      issuer: "KCL",
      limit: 5,
    });

    expect(searchMock).toHaveBeenCalledWith({
      q: "fire coating",
      documentType: "test_report",
      productName: "HE-850A",
      issuer: "KCL",
      limit: 5,
    });
  });

  it("returns a bounded bundle with normalized query + retrieval metadata", async () => {
    const searchMock = vi
      .fn()
      .mockResolvedValue([result({ chunkId: "x" }), result({ chunkId: "y" })]);
    const service = new EvidenceBundleService(stubDocuments(searchMock));

    const bundle = await service.build({ query: "  Fire   COATING " });

    expect(bundle.normalizedQuery).toBe("fire coating");
    expect(bundle.retrievalMode).toBe(RETRIEVAL_MODE);
    expect(bundle.retrievalStatus).toBe("ok");
    expect(bundle.count).toBe(2);
    expect(bundle.candidates).toHaveLength(2);
    expect(bundle.candidates[0].sourceType).toBe("internal_document");
  });

  it("reports retrievalStatus no_matches when search returns nothing", async () => {
    const service = new EvidenceBundleService(
      stubDocuments(vi.fn().mockResolvedValue([])),
    );
    const bundle = await service.build({ query: "nothing" });
    expect(bundle.retrievalStatus).toBe("no_matches");
    expect(bundle.count).toBe(0);
    expect(bundle.candidates).toEqual([]);
  });

  it("propagates DocumentService errors (no swallowing)", async () => {
    const service = new EvidenceBundleService(
      stubDocuments(vi.fn().mockRejectedValue(new Error("boom"))),
    );
    await expect(service.build({ query: "fire" })).rejects.toThrow("boom");
  });
});
