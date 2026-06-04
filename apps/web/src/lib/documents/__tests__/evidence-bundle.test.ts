import { describe, it, expect, vi, afterEach } from "vitest";

import {
  EvidenceBundleService,
  INTERNAL_DOCUMENT_TRUST_LEVEL,
  INTERNAL_DOCUMENT_VERIFICATION_STATUS,
  toEvidenceCandidate,
  toEvidenceCandidates,
} from "../evidence-bundle";
import type { DocumentSearchResult } from "../search";
import type { DocumentService } from "../service";

const ORIG_MODE = process.env.EVIDENCE_RETRIEVAL_MODE;
afterEach(() => {
  if (ORIG_MODE === undefined) delete process.env.EVIDENCE_RETRIEVAL_MODE;
  else process.env.EVIDENCE_RETRIEVAL_MODE = ORIG_MODE;
});

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

// A DocumentService stub exposing only the retrieval methods the bundle uses
// for the mode under test. No database involved.
function stubDocuments(
  methods: Partial<
    Pick<DocumentService, "search" | "vectorSearch" | "hybridSearch">
  >,
): DocumentService {
  return methods as unknown as DocumentService;
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
  it("defaults to hybrid retrieval and reports internal_documents_hybrid", async () => {
    delete process.env.EVIDENCE_RETRIEVAL_MODE;
    const hybridMock = vi
      .fn()
      .mockResolvedValue([result({ chunkId: "x" }), result({ chunkId: "y" })]);
    const service = new EvidenceBundleService(
      stubDocuments({ hybridSearch: hybridMock }),
    );

    const bundle = await service.build({ query: "  Fire   COATING " });

    expect(hybridMock).toHaveBeenCalledWith({
      q: "  Fire   COATING ",
      documentType: undefined,
      productName: undefined,
      issuer: undefined,
      limit: undefined,
    });
    expect(bundle.normalizedQuery).toBe("fire coating");
    expect(bundle.retrievalMode).toBe("internal_documents_hybrid");
    expect(bundle.retrievalStatus).toBe("ok");
    expect(bundle.count).toBe(2);
    expect(bundle.candidates[0].sourceType).toBe("internal_document");
  });

  it("forwards query + filters as { q, ... } (keyword mode)", async () => {
    process.env.EVIDENCE_RETRIEVAL_MODE = "keyword";
    const searchMock = vi.fn().mockResolvedValue([]);
    const service = new EvidenceBundleService(
      stubDocuments({ search: searchMock }),
    );

    const bundle = await service.build({
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
    expect(bundle.retrievalMode).toBe("internal_documents_keyword");
  });

  it("uses vector retrieval when EVIDENCE_RETRIEVAL_MODE=vector", async () => {
    process.env.EVIDENCE_RETRIEVAL_MODE = "vector";
    const vectorMock = vi.fn().mockResolvedValue([result({ chunkId: "v" })]);
    const service = new EvidenceBundleService(
      stubDocuments({ vectorSearch: vectorMock }),
    );
    const bundle = await service.build({ query: "fire" });
    expect(vectorMock).toHaveBeenCalledTimes(1);
    expect(bundle.retrievalMode).toBe("internal_documents_vector");
  });

  it("reports retrievalStatus no_matches when retrieval returns nothing", async () => {
    delete process.env.EVIDENCE_RETRIEVAL_MODE;
    const service = new EvidenceBundleService(
      stubDocuments({ hybridSearch: vi.fn().mockResolvedValue([]) }),
    );
    const bundle = await service.build({ query: "nothing" });
    expect(bundle.retrievalStatus).toBe("no_matches");
    expect(bundle.count).toBe(0);
    expect(bundle.candidates).toEqual([]);
  });

  it("propagates DocumentService errors (no swallowing)", async () => {
    delete process.env.EVIDENCE_RETRIEVAL_MODE;
    const service = new EvidenceBundleService(
      stubDocuments({ hybridSearch: vi.fn().mockRejectedValue(new Error("boom")) }),
    );
    await expect(service.build({ query: "fire" })).rejects.toThrow("boom");
  });
});
