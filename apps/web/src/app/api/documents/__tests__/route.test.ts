// Route-level tests for /api/documents.
//
// The DocumentService is mocked so these tests run without a real
// PostgreSQL connection. They cover the HTTP contract:
//   - 415 for known binary mime types
//   - 400 invalid_json for malformed bodies
//   - 400 invalid_request for Zod failures
//   - 503 database_unavailable when the service signals it
//   - 201 on success

import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST, GET } from "../route";
import { DocumentServiceError } from "@/lib/documents/service";

// `vi.mock` is hoisted to the top of the file by vitest. The factory below
// runs before the route module is evaluated, so the route's
// `new DocumentService()` call sees our mock. We use `vi.hoisted` for the
// per-test mock fns so they exist by the time the factory runs.
const { createMock, listMock } = vi.hoisted(() => ({
  createMock: vi.fn(),
  listMock: vi.fn(),
}));

vi.mock("@/lib/documents/service", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/documents/service")
  >("@/lib/documents/service");
  return {
    // Keep the real DocumentServiceError so `instanceof` checks in the
    // route's handleServiceError continue to work.
    ...actual,
    DocumentService: vi.fn().mockImplementation(() => ({
      create: createMock,
      list: listMock,
    })),
  };
});

function jsonRequest(body: unknown, init: { rawBody?: string } = {}) {
  return new Request("http://localhost/api/documents", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: init.rawBody ?? JSON.stringify(body),
  });
}

describe("POST /api/documents", () => {
  beforeEach(() => {
    createMock.mockReset();
    listMock.mockReset();
  });

  it("returns 415 unsupported_media_type for application/pdf", async () => {
    const req = jsonRequest({
      filename: "spec.pdf",
      mimeType: "application/pdf",
      content: "%PDF-1.4...",
    });
    const res = await POST(req);
    expect(res.status).toBe(415);
    const body = await res.json();
    expect(body.error).toBe("unsupported_media_type");
    // Helpful hint about the binary nature is in the message.
    expect(body.message).toMatch(/binary|text\/plain|text\/markdown/i);
    expect(createMock).not.toHaveBeenCalled();
  });

  it("returns 400 invalid_json for malformed body", async () => {
    const req = jsonRequest(null, { rawBody: "{not-json" });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("invalid_json");
    expect(createMock).not.toHaveBeenCalled();
  });

  it("returns 400 invalid_request when Zod validation fails (empty filename)", async () => {
    const req = jsonRequest({
      filename: "",
      mimeType: "text/plain",
      content: "hello",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("invalid_request");
    expect(body.details).toBeDefined();
    expect(createMock).not.toHaveBeenCalled();
  });

  it("maps DocumentServiceError(database_unavailable) to 503", async () => {
    createMock.mockRejectedValueOnce(
      new DocumentServiceError(
        "database_unavailable",
        "Can't reach database server",
      ),
    );
    const req = jsonRequest({
      filename: "ok.txt",
      mimeType: "text/plain",
      content: "본문",
    });
    const res = await POST(req);
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toBe("database_unavailable");
    expect(body.message).toMatch(/DATABASE_URL|prisma|database/i);
  });

  it("returns 500 for a non-database internal error from the service", async () => {
    createMock.mockRejectedValueOnce(
      new DocumentServiceError("internal_error", "boom"),
    );
    const req = jsonRequest({
      filename: "ok.txt",
      mimeType: "text/plain",
      content: "본문",
    });
    const res = await POST(req);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("internal_error");
  });

  it("returns 201 with id + chunkCount on success", async () => {
    createMock.mockResolvedValueOnce({ id: "doc_abc", chunkCount: 3 });
    const req = jsonRequest({
      filename: "memo.txt",
      mimeType: "text/plain",
      content: "방오 코팅 적용 검토.",
    });
    const res = await POST(req);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toEqual({
      id: "doc_abc",
      chunkCount: 3,
      status: "chunked",
    });
    expect(createMock).toHaveBeenCalledTimes(1);
    // The route forwards exactly the validated input shape.
    const callArg = createMock.mock.calls[0][0];
    expect(callArg.filename).toBe("memo.txt");
    expect(callArg.mimeType).toBe("text/plain");
  });
});

describe("GET /api/documents", () => {
  beforeEach(() => {
    createMock.mockReset();
    listMock.mockReset();
  });

  it("maps DocumentServiceError(database_unavailable) to 503", async () => {
    listMock.mockRejectedValueOnce(
      new DocumentServiceError(
        "database_unavailable",
        "Environment variable not found: DATABASE_URL",
      ),
    );
    const res = await GET(new Request("http://localhost/api/documents"));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toBe("database_unavailable");
  });

  it("returns the documents list on success", async () => {
    const summaries = [
      {
        id: "doc_1",
        filename: "a.txt",
        originalName: "a.txt",
        mimeType: "text/plain",
        sizeBytes: 12,
        category: null,
        version: null,
        status: "chunked",
        chunkCount: 1,
        createdAt: 1_700_000_000_000,
      },
    ];
    listMock.mockResolvedValueOnce(summaries);
    const res = await GET(
      new Request("http://localhost/api/documents?limit=10"),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ documents: summaries });
    expect(listMock).toHaveBeenCalledWith(10);
  });
});
