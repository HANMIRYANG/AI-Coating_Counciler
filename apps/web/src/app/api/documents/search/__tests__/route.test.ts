// Route-level tests for GET /api/documents/search.
//
// DocumentService is mocked so these run without a real PostgreSQL
// connection. They cover the HTTP contract:
//   - 400 invalid_request for missing / empty q
//   - 503 database_unavailable when the service signals it
//   - 200 success response shape { query, count, results }
//   - filters + limit are forwarded to the service

import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET } from "../route";
import { DocumentServiceError } from "@/lib/documents/service";

const { searchMock } = vi.hoisted(() => ({ searchMock: vi.fn() }));

vi.mock("@/lib/documents/service", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/documents/service")
  >("@/lib/documents/service");
  return {
    ...actual,
    DocumentService: vi.fn().mockImplementation(() => ({
      search: searchMock,
    })),
  };
});

function getReq(query: string) {
  return new Request(`http://localhost/api/documents/search${query}`);
}

describe("GET /api/documents/search", () => {
  beforeEach(() => {
    searchMock.mockReset();
  });

  it("returns 400 invalid_request when q is missing", async () => {
    const res = await GET(getReq(""));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("invalid_request");
    expect(searchMock).not.toHaveBeenCalled();
  });

  it("returns 400 invalid_request when q is empty / whitespace", async () => {
    const res = await GET(getReq("?q=%20%20"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("invalid_request");
    expect(searchMock).not.toHaveBeenCalled();
  });

  it("maps DocumentServiceError(database_unavailable) to 503", async () => {
    searchMock.mockRejectedValueOnce(
      new DocumentServiceError(
        "database_unavailable",
        "Can't reach database server",
      ),
    );
    const res = await GET(getReq("?q=fire"));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toBe("database_unavailable");
    expect(body.message).toMatch(/DATABASE_URL|prisma|database/i);
  });

  it("returns 200 with { query, count, results } on success", async () => {
    const results = [
      {
        documentId: "doc_1",
        filename: "report.md",
        chunkId: "chunk_1",
        chunkIndex: 0,
        snippet: "…fire resistance result…",
        metadata: { issuer: "KCL" },
        score: 202,
      },
    ];
    searchMock.mockResolvedValueOnce(results);
    const res = await GET(getReq("?q=fire%20coating"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ query: "fire coating", count: 1, results });
  });

  it("forwards validated filters and limit to the service", async () => {
    searchMock.mockResolvedValueOnce([]);
    const res = await GET(
      getReq(
        "?q=fire&documentType=test_report&productName=HE-850A&issuer=KCL&limit=5",
      ),
    );
    expect(res.status).toBe(200);
    expect(searchMock).toHaveBeenCalledTimes(1);
    expect(searchMock).toHaveBeenCalledWith({
      q: "fire",
      documentType: "test_report",
      productName: "HE-850A",
      issuer: "KCL",
      limit: 5,
    });
  });

  it("treats blank filter params as absent", async () => {
    searchMock.mockResolvedValueOnce([]);
    await GET(getReq("?q=fire&productName=%20&issuer="));
    const arg = searchMock.mock.calls[0][0];
    expect(arg).toEqual({ q: "fire" });
  });

  it("returns 400 for an invalid documentType enum value", async () => {
    const res = await GET(getReq("?q=fire&documentType=not_a_type"));
    expect(res.status).toBe(400);
    expect(searchMock).not.toHaveBeenCalled();
  });
});
