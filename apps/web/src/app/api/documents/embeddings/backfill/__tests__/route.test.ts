// Route tests for POST /api/documents/embeddings/backfill.
// DocumentService is mocked so these run without a database or embedder.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { backfillMock } = vi.hoisted(() => ({ backfillMock: vi.fn() }));

vi.mock("@/lib/documents/service", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/documents/service")>(
      "@/lib/documents/service",
    );
  return {
    ...actual,
    DocumentService: vi
      .fn()
      .mockImplementation(() => ({ backfillEmbeddings: backfillMock })),
  };
});

import { POST } from "../route";
import { DocumentServiceError } from "@/lib/documents/service";

function req(path = ""): Request {
  return new Request(
    `http://localhost/api/documents/embeddings/backfill${path}`,
    { method: "POST" },
  );
}

const ORIG_WRITE = process.env.API_WRITE_TOKEN;
beforeEach(() => {
  backfillMock.mockReset();
  delete process.env.API_WRITE_TOKEN;
});
afterEach(() => {
  if (ORIG_WRITE === undefined) delete process.env.API_WRITE_TOKEN;
  else process.env.API_WRITE_TOKEN = ORIG_WRITE;
});

describe("POST /api/documents/embeddings/backfill", () => {
  it("returns the backfill counts on success", async () => {
    backfillMock.mockResolvedValueOnce({ processed: 3, skipped: 0, remaining: 7 });
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ processed: 3, skipped: 0, remaining: 7 });
  });

  it("forwards a numeric ?limit to the service", async () => {
    backfillMock.mockResolvedValueOnce({ processed: 0, skipped: 0, remaining: 0 });
    await POST(req("?limit=25"));
    expect(backfillMock).toHaveBeenCalledWith({ limit: 25 });
  });

  it("ignores a non-numeric ?limit", async () => {
    backfillMock.mockResolvedValueOnce({ processed: 0, skipped: 0, remaining: 0 });
    await POST(req("?limit=abc"));
    expect(backfillMock).toHaveBeenCalledWith({ limit: undefined });
  });

  it("maps DocumentServiceError(database_unavailable) to 503", async () => {
    backfillMock.mockRejectedValueOnce(
      new DocumentServiceError("database_unavailable", "no db"),
    );
    const res = await POST(req());
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("database_unavailable");
  });

  it("requires the write token when API_WRITE_TOKEN is set", async () => {
    process.env.API_WRITE_TOKEN = "secret";
    const res = await POST(req());
    expect(res.status).toBe(401);
    expect(backfillMock).not.toHaveBeenCalled();
  });
});
