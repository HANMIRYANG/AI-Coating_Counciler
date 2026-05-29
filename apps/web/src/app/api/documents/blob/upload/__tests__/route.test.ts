// Route tests for POST /api/documents/blob/upload.
//
// `handleUpload` (@vercel/blob/client) and DocumentService are mocked so the
// route's wiring can be exercised without a real Blob token or database.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { handleUploadMock, recordOriginalUploadMock } = vi.hoisted(() => ({
  handleUploadMock: vi.fn(),
  recordOriginalUploadMock: vi.fn(),
}));

vi.mock("@vercel/blob/client", () => ({
  handleUpload: handleUploadMock,
}));

vi.mock("@/lib/documents/service", () => ({
  DocumentService: vi.fn().mockImplementation(() => ({
    recordOriginalUpload: recordOriginalUploadMock,
  })),
}));

import { POST } from "../route";

function req(body: unknown, init: { rawBody?: string } = {}) {
  return new Request("http://localhost/api/documents/blob/upload", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: init.rawBody ?? JSON.stringify(body),
  });
}

const ORIGINAL_TOKEN = process.env.BLOB_READ_WRITE_TOKEN;

beforeEach(() => {
  process.env.BLOB_READ_WRITE_TOKEN = "vercel_blob_rw_TESTONLY";
  handleUploadMock.mockReset();
  recordOriginalUploadMock.mockReset();
});

afterEach(() => {
  if (ORIGINAL_TOKEN === undefined) delete process.env.BLOB_READ_WRITE_TOKEN;
  else process.env.BLOB_READ_WRITE_TOKEN = ORIGINAL_TOKEN;
});

describe("POST /api/documents/blob/upload", () => {
  it("returns 503 when BLOB_READ_WRITE_TOKEN is not configured", async () => {
    delete process.env.BLOB_READ_WRITE_TOKEN;
    const res = await POST(req({ type: "blob.generate-client-token" }));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toBe("blob_not_configured");
    expect(handleUploadMock).not.toHaveBeenCalled();
  });

  it("returns 400 invalid_json for a malformed body", async () => {
    const res = await POST(req(null, { rawBody: "{not-json" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("invalid_json");
    expect(handleUploadMock).not.toHaveBeenCalled();
  });

  it("returns the handleUpload result on success (token generation)", async () => {
    handleUploadMock.mockResolvedValueOnce({
      type: "blob.generate-client-token",
      clientToken: "tkn_123",
    });
    const res = await POST(
      req({ type: "blob.generate-client-token", payload: {} }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      type: "blob.generate-client-token",
      clientToken: "tkn_123",
    });
  });

  it("validates the descriptor in onBeforeGenerateToken (rejects missing payload)", async () => {
    // Drive the real onBeforeGenerateToken with a null clientPayload.
    handleUploadMock.mockImplementationOnce(
      async (opts: {
        onBeforeGenerateToken: (
          p: string,
          c: string | null,
          m: boolean,
        ) => Promise<unknown>;
      }) => {
        return opts.onBeforeGenerateToken(
          "documents/originals/x.pdf",
          null,
          false,
        );
      },
    );
    const res = await POST(req({ type: "blob.generate-client-token" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("blob_upload_error");
    expect(body.message).toMatch(/descriptor/i);
  });

  it("issues a scoped token config for a valid descriptor", async () => {
    handleUploadMock.mockImplementationOnce(
      async (opts: {
        onBeforeGenerateToken: (
          p: string,
          c: string | null,
          m: boolean,
        ) => Promise<{
          allowedContentTypes?: string[];
          maximumSizeInBytes?: number;
          tokenPayload?: string | null;
        }>;
      }) => {
        const cfg = await opts.onBeforeGenerateToken(
          "documents/originals/report.pdf",
          JSON.stringify({
            filename: "report.pdf",
            contentType: "application/pdf",
            sizeBytes: 1000,
          }),
          false,
        );
        return { type: "echo", cfg };
      },
    );
    const res = await POST(req({ type: "blob.generate-client-token" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.cfg.allowedContentTypes).toContain("application/pdf");
    expect(body.cfg.maximumSizeInBytes).toBeGreaterThan(0);
    expect(JSON.parse(body.cfg.tokenPayload).filename).toBe("report.pdf");
  });

  it("records original metadata on upload completion", async () => {
    handleUploadMock.mockImplementationOnce(
      async (opts: {
        onUploadCompleted: (p: {
          blob: { url: string; pathname: string; contentType: string };
          tokenPayload?: string | null;
        }) => Promise<void>;
      }) => {
        await opts.onUploadCompleted({
          blob: {
            url: "https://blob.vercel-storage.com/documents/originals/report-abc.pdf",
            pathname: "documents/originals/report-abc.pdf",
            contentType: "application/pdf",
          },
          tokenPayload: JSON.stringify({
            filename: "report.pdf",
            contentType: "application/pdf",
            sizeBytes: 4096,
          }),
        });
        return { type: "blob.upload-completed", response: "ok" };
      },
    );

    const res = await POST(req({ type: "blob.upload-completed" }));
    expect(res.status).toBe(200);
    expect(recordOriginalUploadMock).toHaveBeenCalledTimes(1);
    expect(recordOriginalUploadMock).toHaveBeenCalledWith(
      expect.objectContaining({
        filename: "report.pdf",
        contentType: "application/pdf",
        sizeBytes: 4096,
        blobUrl:
          "https://blob.vercel-storage.com/documents/originals/report-abc.pdf",
        blobPath: "documents/originals/report-abc.pdf",
      }),
    );
  });
});
