import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  getBlobMock,
  getOriginalForExtractionMock,
  attachExtractedTextToOriginalMock,
  extractMock,
} = vi.hoisted(() => ({
  getBlobMock: vi.fn(),
  getOriginalForExtractionMock: vi.fn(),
  attachExtractedTextToOriginalMock: vi.fn(),
  extractMock: vi.fn(),
}));

vi.mock("@vercel/blob", () => ({
  get: getBlobMock,
}));

vi.mock("@/lib/documents/service", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/documents/service")>(
      "@/lib/documents/service",
    );
  return {
    ...actual,
    DocumentService: vi.fn().mockImplementation(() => ({
      getOriginalForExtraction: getOriginalForExtractionMock,
      attachExtractedTextToOriginal: attachExtractedTextToOriginalMock,
    })),
  };
});

vi.mock("@/lib/documents/extract", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/documents/extract")>(
      "@/lib/documents/extract",
    );
  return {
    ...actual,
    extractDocumentTextWithOcrFallback: extractMock,
  };
});

import { POST } from "../route";
import { DocumentExtractError } from "@/lib/documents/extract";
import { DocumentServiceError } from "@/lib/documents/service";

function req() {
  return new Request("http://localhost/api/documents/doc_1/extract", {
    method: "POST",
  });
}

function params(id = "doc_1") {
  return { params: { id } };
}

function streamFromText(text: string) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(Buffer.from(text, "utf8"));
      controller.close();
    },
  });
}

function original(overrides: Record<string, unknown> = {}) {
  return {
    id: "doc_1",
    filename: "report.pdf",
    originalName: "report.pdf",
    mimeType: "application/pdf",
    category: null,
    version: null,
    metadata: { issuer: "KCL" },
    originalBlobUrl: "https://blob/x.pdf",
    originalBlobPath: "documents/originals/x.pdf",
    originalBlobContentType: "application/pdf",
    originalBlobSizeBytes: 4096,
    ...overrides,
  };
}

beforeEach(() => {
  getBlobMock.mockReset();
  getOriginalForExtractionMock.mockReset();
  attachExtractedTextToOriginalMock.mockReset();
  extractMock.mockReset();
});

describe("POST /api/documents/[id]/extract", () => {
  it("fetches the private Blob, extracts text, and attaches chunks", async () => {
    getOriginalForExtractionMock.mockResolvedValueOnce(original());
    getBlobMock.mockResolvedValueOnce({
      statusCode: 200,
      stream: streamFromText("pdf bytes"),
      blob: {
        size: 9,
        contentType: "application/pdf",
      },
    });
    extractMock.mockResolvedValueOnce({
      text: "OCR text body",
      kind: "pdf",
      pageCount: 2,
      extractionMethod: "ocr",
      ocrProvider: "google_document_ai",
    });
    attachExtractedTextToOriginalMock.mockResolvedValueOnce({
      id: "doc_1",
      chunkCount: 3,
    });

    const res = await POST(req(), params());

    expect(res.status).toBe(200);
    expect(getBlobMock).toHaveBeenCalledWith("documents/originals/x.pdf", {
      access: "private",
      useCache: false,
    });
    expect(extractMock).toHaveBeenCalledWith(
      expect.any(Buffer),
      "application/pdf",
      { filename: "report.pdf" },
    );
    expect(attachExtractedTextToOriginalMock).toHaveBeenCalledWith({
      id: "doc_1",
      content: "OCR text body",
      category: "parsed_pdf_ocr",
      metadata: {
        issuer: "KCL",
        extractionMethod: "ocr",
        ocrProvider: "google_document_ai",
      },
    });
    expect(await res.json()).toMatchObject({
      id: "doc_1",
      chunkCount: 3,
      status: "chunked",
      kind: "pdf",
      extractionMethod: "ocr",
      ocrProvider: "google_document_ai",
    });
  });

  it("maps missing documents to 404", async () => {
    getOriginalForExtractionMock.mockRejectedValueOnce(
      new DocumentServiceError("not_found", "missing"),
    );

    const res = await POST(req(), params("missing"));

    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("not_found");
    expect(getBlobMock).not.toHaveBeenCalled();
  });

  it("maps non-extractable originals to 422", async () => {
    getOriginalForExtractionMock.mockRejectedValueOnce(
      new DocumentServiceError("not_extractable", "not supported"),
    );

    const res = await POST(req(), params());

    expect(res.status).toBe(422);
    expect((await res.json()).error).toBe("not_extractable");
  });

  it("maps unavailable OCR config to 503", async () => {
    getOriginalForExtractionMock.mockResolvedValueOnce(original());
    getBlobMock.mockResolvedValueOnce({
      statusCode: 200,
      stream: streamFromText("pdf bytes"),
      blob: {
        size: 9,
        contentType: "application/pdf",
      },
    });
    extractMock.mockRejectedValueOnce(
      new DocumentExtractError("ocr_unavailable", "OCR disabled"),
    );

    const res = await POST(req(), params());

    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("ocr_unavailable");
    expect(attachExtractedTextToOriginalMock).not.toHaveBeenCalled();
  });
});
