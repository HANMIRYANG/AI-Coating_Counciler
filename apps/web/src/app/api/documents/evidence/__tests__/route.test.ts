// Route-level tests for GET /api/documents/evidence.
//
// EvidenceBundleService is mocked so these run without a real PostgreSQL
// connection. They cover the HTTP contract:
//   - 400 invalid_request for missing / empty query
//   - 503 database_unavailable when the service signals it
//   - 200 success response shape
//   - filters + limit are forwarded to the service

import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET } from "../route";
import { DocumentServiceError } from "@/lib/documents/service";

const { buildMock } = vi.hoisted(() => ({ buildMock: vi.fn() }));

vi.mock("@/lib/documents/evidence-bundle", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/documents/evidence-bundle")
  >("@/lib/documents/evidence-bundle");
  return {
    ...actual,
    EvidenceBundleService: vi.fn().mockImplementation(() => ({
      build: buildMock,
    })),
  };
});

function getReq(query: string) {
  return new Request(`http://localhost/api/documents/evidence${query}`);
}

const sampleBundle = {
  normalizedQuery: "fire coating",
  retrievalMode: "internal_documents_keyword" as const,
  retrievalStatus: "ok" as const,
  count: 1,
  candidates: [
    {
      sourceType: "internal_document" as const,
      documentId: "doc_1",
      filename: "report.md",
      chunkId: "chunk_1",
      chunkIndex: 0,
      snippet: "…fire resistance…",
      metadata: { issuer: "KCL" },
      score: 202,
      trustLevel: "uploaded_copy" as const,
      verificationStatus: "auto_extracted" as const,
    },
  ],
};

describe("GET /api/documents/evidence", () => {
  beforeEach(() => {
    buildMock.mockReset();
  });

  it("returns 400 invalid_request when query is missing", async () => {
    const res = await GET(getReq(""));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("invalid_request");
    expect(buildMock).not.toHaveBeenCalled();
  });

  it("returns 400 invalid_request when query is empty / whitespace", async () => {
    const res = await GET(getReq("?query=%20%20"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("invalid_request");
    expect(buildMock).not.toHaveBeenCalled();
  });

  it("maps DocumentServiceError(database_unavailable) to 503", async () => {
    buildMock.mockRejectedValueOnce(
      new DocumentServiceError(
        "database_unavailable",
        "Can't reach database server",
      ),
    );
    const res = await GET(getReq("?query=fire"));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toBe("database_unavailable");
    expect(body.message).toMatch(/DATABASE_URL|prisma|database/i);
  });

  it("returns 200 with query + bundle shape on success", async () => {
    buildMock.mockResolvedValueOnce(sampleBundle);
    const res = await GET(getReq("?query=fire%20coating"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ query: "fire coating", ...sampleBundle });
    expect(body.candidates[0].sourceType).toBe("internal_document");
    expect(body.retrievalMode).toBe("internal_documents_keyword");
  });

  it("forwards validated filters and limit to the service", async () => {
    buildMock.mockResolvedValueOnce({
      ...sampleBundle,
      count: 0,
      candidates: [],
      retrievalStatus: "no_matches",
    });
    const res = await GET(
      getReq(
        "?query=fire&documentType=test_report&productName=HE-850A&issuer=KCL&limit=5",
      ),
    );
    expect(res.status).toBe(200);
    expect(buildMock).toHaveBeenCalledTimes(1);
    expect(buildMock).toHaveBeenCalledWith({
      query: "fire",
      documentType: "test_report",
      productName: "HE-850A",
      issuer: "KCL",
      limit: 5,
    });
  });

  it("treats blank filter params as absent", async () => {
    buildMock.mockResolvedValueOnce(sampleBundle);
    await GET(getReq("?query=fire&productName=%20&issuer="));
    expect(buildMock.mock.calls[0][0]).toEqual({ query: "fire" });
  });

  it("returns 400 for an invalid documentType enum value", async () => {
    const res = await GET(getReq("?query=fire&documentType=not_a_type"));
    expect(res.status).toBe(400);
    expect(buildMock).not.toHaveBeenCalled();
  });
});
