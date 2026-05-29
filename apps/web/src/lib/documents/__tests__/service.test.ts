// Fast unit tests for DocumentService metadata persistence semantics.
//
// These use a hand-rolled mock PrismaClient (injected via the service
// constructor) so they run without a database — complementing the
// PRISMA_INTEGRATION=1 integration suite, which exercises a real round-trip.

import { describe, it, expect, vi } from "vitest";
import { Prisma } from "@prisma/client";

import { DocumentService } from "../service";

type CreateArgs = { data: Record<string, unknown> };

function makeService() {
  const createMock = vi.fn(async (_args: CreateArgs) => ({ id: "doc_1" }));
  const prisma = {
    document: { create: createMock },
  } as unknown as ConstructorParameters<typeof DocumentService>[0];
  return { service: new DocumentService(prisma), createMock };
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

describe("DocumentService.recordOriginalUpload — Blob original (Step 14)", () => {
  it("persists blob metadata as an original_uploaded document with no chunks", async () => {
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
      status: "original_uploaded",
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
