// Route-level tests for POST /api/documents/parse.
//
// DocumentService and the text extractor are both mocked so these run without
// PostgreSQL or the real unpdf/mammoth libraries. They cover the HTTP
// contract: 400 (no file), 415 (unsupported), 422 (no text), 503 (db), 201.

import { describe, it, expect, vi, beforeEach } from "vitest";

const { createMock } = vi.hoisted(() => ({ createMock: vi.fn() }));
vi.mock("@/lib/documents/service", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/documents/service")>(
      "@/lib/documents/service",
    );
  return {
    ...actual,
    DocumentService: vi.fn().mockImplementation(() => ({ create: createMock })),
  };
});

const { extractMock } = vi.hoisted(() => ({ extractMock: vi.fn() }));
vi.mock("@/lib/documents/extract", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/documents/extract")>(
      "@/lib/documents/extract",
    );
  // Keep the real DocumentExtractError + mime helpers; only stub the extractor.
  return { ...actual, extractDocumentText: extractMock };
});

import { POST } from "../route";
import { DocumentServiceError } from "@/lib/documents/service";
import { DocumentExtractError } from "@/lib/documents/extract";

const PDF = "application/pdf";

function fileRequest(file: File | null, metadata?: string) {
  const fd = new FormData();
  if (file) fd.append("file", file);
  if (metadata !== undefined) fd.append("metadata", metadata);
  return new Request("http://localhost/api/documents/parse", {
    method: "POST",
    body: fd,
  });
}

function pdfFile(name = "report.pdf") {
  return new File([new Uint8Array([1, 2, 3, 4])], name, { type: PDF });
}

describe("POST /api/documents/parse", () => {
  beforeEach(() => {
    createMock.mockReset();
    extractMock.mockReset();
  });

  it("returns 400 when no file field is present", async () => {
    const res = await POST(fileRequest(null));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_request");
    expect(extractMock).not.toHaveBeenCalled();
  });

  it("returns 415 for an unsupported (non pdf/docx) file", async () => {
    const file = new File([new Uint8Array([1])], "notes.txt", {
      type: "text/plain",
    });
    const res = await POST(fileRequest(file));
    expect(res.status).toBe(415);
    expect((await res.json()).error).toBe("unsupported_media_type");
    expect(extractMock).not.toHaveBeenCalled();
  });

  it("returns 201 with chunk + extraction metadata on success", async () => {
    extractMock.mockResolvedValueOnce({
      text: "방오 코팅 시험 결과 본문",
      kind: "pdf",
      pageCount: 2,
    });
    createMock.mockResolvedValueOnce({ id: "doc_pdf", chunkCount: 4 });

    const res = await POST(fileRequest(pdfFile()));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toMatchObject({
      id: "doc_pdf",
      chunkCount: 4,
      status: "chunked",
      kind: "pdf",
      pageCount: 2,
    });
    // The extracted text flows into the inline-intake persistence path.
    const arg = createMock.mock.calls[0][0];
    expect(arg.mimeType).toBe("text/plain");
    expect(arg.content).toBe("방오 코팅 시험 결과 본문");
    expect(arg.category).toBe("parsed_pdf");
  });

  it("forwards validated metadata (unknown keys stripped)", async () => {
    extractMock.mockResolvedValueOnce({ text: "본문", kind: "pdf" });
    createMock.mockResolvedValueOnce({ id: "doc_meta", chunkCount: 1 });

    const res = await POST(
      fileRequest(
        pdfFile(),
        JSON.stringify({ issuer: "KCL", legacyField: "dropped" }),
      ),
    );
    expect(res.status).toBe(201);
    const arg = createMock.mock.calls[0][0];
    expect(arg.metadata).toEqual({ issuer: "KCL" });
    expect(arg.metadata).not.toHaveProperty("legacyField");
  });

  it("returns 422 when no text layer can be extracted", async () => {
    extractMock.mockRejectedValueOnce(
      new DocumentExtractError("no_text_extracted", "scanned"),
    );
    const res = await POST(fileRequest(pdfFile()));
    expect(res.status).toBe(422);
    expect((await res.json()).error).toBe("no_text_extracted");
    expect(createMock).not.toHaveBeenCalled();
  });

  it("maps DocumentServiceError(database_unavailable) to 503", async () => {
    extractMock.mockResolvedValueOnce({ text: "본문", kind: "pdf" });
    createMock.mockRejectedValueOnce(
      new DocumentServiceError("database_unavailable", "no db"),
    );
    const res = await POST(fileRequest(pdfFile()));
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("database_unavailable");
  });
});
