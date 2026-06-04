// Fast unit tests for DocumentService metadata persistence semantics.
//
// These use a hand-rolled mock PrismaClient (injected via the service
// constructor) so they run without a database — complementing the
// PRISMA_INTEGRATION=1 integration suite, which exercises a real round-trip.

import { describe, it, expect, vi } from "vitest";
import { Prisma } from "@prisma/client";

import { DocumentService, DocumentServiceError } from "../service";

type CreateArgs = { data: Record<string, unknown> };
type TxCallback = (tx: Record<string, unknown>) => Promise<unknown>;
type UpdateArgs = {
  where: Record<string, unknown>;
  data: {
    status?: string;
    category?: string | null;
    metadata?: unknown;
    chunks?: { create: Array<{ content: string }> };
  };
};

function makeService() {
  const createMock = vi.fn(async (_args: CreateArgs) => ({ id: "doc_1" }));
  const prisma = {
    document: { create: createMock },
  } as unknown as ConstructorParameters<typeof DocumentService>[0];
  return { service: new DocumentService(prisma), createMock };
}

function makeExtractionService() {
  const findUniqueMock = vi.fn();
  const updateMock = vi.fn(async (_args: UpdateArgs) => ({ id: "doc_1" }));
  const deleteManyMock = vi.fn(
    async (_args: { where: { documentId: string } }) => ({ count: 0 }),
  );
  const prismaMock: Record<string, unknown> = {
    document: { findUnique: findUniqueMock, update: updateMock },
    documentChunk: { deleteMany: deleteManyMock },
  };
  prismaMock.$transaction = vi.fn(async (fn: TxCallback) => fn(prismaMock));
  const prisma =
    prismaMock as unknown as ConstructorParameters<typeof DocumentService>[0];
  return {
    service: new DocumentService(prisma),
    findUniqueMock,
    updateMock,
    deleteManyMock,
  };
}

describe("DocumentService.create — metadata persistence", () => {
  it("passes validated metadata into document.create verbatim", async () => {
    const { service, createMock } = makeService();
    const metadata = {
      productName: "HE-850A",
      documentType: "test_report",
      issuer: "KCL",
      testMethod: "KS F 2271",
    } as const;

    await service.create({
      filename: "report.md",
      mimeType: "text/markdown",
      content: "# 시험성적서\n\n결과.",
      metadata,
    });

    expect(createMock).toHaveBeenCalledTimes(1);
    const args = createMock.mock.calls[0][0] as CreateArgs;
    expect(args.data.metadata).toEqual(metadata);
  });

  it("writes Prisma.DbNull (SQL NULL) when metadata is omitted", async () => {
    const { service, createMock } = makeService();

    await service.create({
      filename: "plain.txt",
      mimeType: "text/plain",
      content: "메타데이터 없는 문서 본문.",
    });

    const args = createMock.mock.calls[0][0] as CreateArgs;
    // Distinct from a JSON `null` literal — this is the SQL-NULL sentinel.
    expect(args.data.metadata).toBe(Prisma.DbNull);
    expect(args.data.metadata).not.toBe(Prisma.JsonNull);
  });
});

describe("DocumentService lazy original extraction", () => {
  it("returns original blob metadata for extractable documents", async () => {
    const { service, findUniqueMock } = makeExtractionService();
    findUniqueMock.mockResolvedValueOnce({
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
    });

    const row = await service.getOriginalForExtraction("doc_1");

    expect(row.originalBlobUrl).toBe("https://blob/x.pdf");
    expect(row.metadata).toEqual({ issuer: "KCL" });
  });

  it("rejects documents without a blob original", async () => {
    const { service, findUniqueMock } = makeExtractionService();
    findUniqueMock.mockResolvedValueOnce({
      id: "doc_1",
      filename: "memo.txt",
      originalName: "memo.txt",
      mimeType: "text/plain",
      category: null,
      version: null,
      metadata: null,
      originalBlobUrl: null,
      originalBlobPath: null,
      originalBlobContentType: null,
      originalBlobSizeBytes: null,
    });

    await expect(service.getOriginalForExtraction("doc_1")).rejects.toEqual(
      expect.objectContaining({ code: "not_extractable" }),
    );
  });

  it("attaches extracted text chunks to the existing document", async () => {
    const { service, updateMock, deleteManyMock } = makeExtractionService();

    const result = await service.attachExtractedTextToOriginal({
      id: "doc_1",
      content: "Extracted coating report body.",
      category: "parsed_pdf_ocr",
      metadata: { extractionMethod: "ocr", ocrProvider: "google_document_ai" },
    });

    expect(result.id).toBe("doc_1");
    expect(result.chunkCount).toBe(1);
    expect(deleteManyMock).toHaveBeenCalledWith({
      where: { documentId: "doc_1" },
    });
    const updateArgs = updateMock.mock.calls[0]?.[0];
    expect(updateArgs).toBeDefined();
    expect(updateArgs.where).toEqual({ id: "doc_1" });
    expect(updateArgs.data.status).toBe("chunked");
    expect(updateArgs.data.category).toBe("parsed_pdf_ocr");
    expect(updateArgs.data.metadata).toEqual({
      extractionMethod: "ocr",
      ocrProvider: "google_document_ai",
    });
    expect(updateArgs.data.chunks?.create[0].content).toBe(
      "Extracted coating report body.",
    );
  });

  it("surfaces typed not_found for missing documents", async () => {
    const { service, findUniqueMock } = makeExtractionService();
    findUniqueMock.mockResolvedValueOnce(null);

    await expect(
      service.getOriginalForExtraction("missing"),
    ).rejects.toEqual(expect.objectContaining({ code: "not_found" }));
    await expect(
      service.getOriginalForExtraction("missing"),
    ).rejects.toBeInstanceOf(DocumentServiceError);
  });
});

describe("DocumentService.recordOriginalUpload — Blob original (Step 14)", () => {
  it("persists extractable blob metadata as needs_extraction with no chunks", async () => {
    const { service, createMock } = makeService();
    const uploadedAt = new Date(1_700_000_000_000);

    const { id } = await service.recordOriginalUpload({
      filename: "report.pdf",
      contentType: "application/pdf",
      sizeBytes: 2048,
      blobUrl: "https://blob.vercel-storage.com/documents/originals/report-x.pdf",
      blobPath: "documents/originals/report-x.pdf",
      uploadedAt,
    });
    expect(id).toBe("doc_1");

    const args = createMock.mock.calls[0][0] as CreateArgs;
    expect(args.data).toMatchObject({
      filename: "report.pdf",
      originalName: "report.pdf",
      mimeType: "application/pdf",
      sizeBytes: 2048,
      status: "needs_extraction",
      originalBlobUrl:
        "https://blob.vercel-storage.com/documents/originals/report-x.pdf",
      originalBlobPath: "documents/originals/report-x.pdf",
      originalBlobSizeBytes: 2048,
      originalBlobContentType: "application/pdf",
      originalUploadedAt: uploadedAt,
    });
    // No chunks are created for a binary original.
    expect(args.data).not.toHaveProperty("chunks");
  });

  it("keeps non-extractable originals as original_uploaded", async () => {
    const { service, createMock } = makeService();
    await service.recordOriginalUpload({
      filename: "sheet.xlsx",
      contentType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      sizeBytes: 2048,
      blobUrl: "https://blob/x",
      blobPath: "documents/originals/sheet.xlsx",
    });

    const args = createMock.mock.calls[0][0] as CreateArgs;
    expect(args.data.status).toBe("original_uploaded");
  });

  it("defaults uploadedAt when omitted", async () => {
    const { service, createMock } = makeService();
    await service.recordOriginalUpload({
      filename: "a.pdf",
      contentType: "application/pdf",
      sizeBytes: 1,
      blobUrl: "https://blob/x",
      blobPath: "documents/originals/a.pdf",
    });
    const args = createMock.mock.calls[0][0] as CreateArgs;
    expect(args.data.originalUploadedAt).toBeInstanceOf(Date);
  });
});
