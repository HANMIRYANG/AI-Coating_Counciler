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
