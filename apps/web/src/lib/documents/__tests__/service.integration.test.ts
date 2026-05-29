// DocumentService integration test.
//
// Skipped unless PRISMA_INTEGRATION=1 + a reachable PostgreSQL listener.
// Mirrors the pattern in prisma_session_store.integration.test.ts so the
// default `npm test` run stays DB-free.
//
// To run locally:
//   docker compose up -d                                   (repo root)
//   cd apps/web && npx prisma migrate dev
//   PRISMA_INTEGRATION=1 DATABASE_URL="postgresql://postgres:postgres@localhost:5432/ai_coating_council?schema=public" \
//     npx vitest run src/lib/documents/__tests__/service.integration.test.ts

import { describe, it, expect, beforeAll, afterAll } from "vitest";

const RUN = process.env.PRISMA_INTEGRATION === "1";
const describeIf = RUN ? describe : describe.skip;

type AnyService = import("../service").DocumentService;
let service: AnyService;
const createdIds: string[] = [];

describeIf("DocumentService (integration, PRISMA_INTEGRATION=1)", () => {
  beforeAll(async () => {
    const mod = await import("../service");
    service = new mod.DocumentService();
  });

  afterAll(async () => {
    if (!RUN) return;
    const { getPrismaClient } = await import("../../db");
    const client = getPrismaClient();
    for (const id of createdIds) {
      await client.document.delete({ where: { id } }).catch(() => undefined);
    }
    await client.$disconnect();
  });

  it("create persists the Document + DocumentChunk rows and reports chunkCount", async () => {
    const content = [
      "HE-850A 방오 코팅 적용 검토 메모.",
      "",
      "표면 처리 조건은 SUS304 기재에 한해 검증되었습니다.",
      "",
      "추가 시험성적서 확보 후 단계적 확장 권장.",
    ].join("\n");

    const { id, chunkCount } = await service.create({
      filename: "memo.txt",
      mimeType: "text/plain",
      content,
    });
    createdIds.push(id);

    expect(typeof id).toBe("string");
    expect(chunkCount).toBeGreaterThanOrEqual(1);

    const { getPrismaClient } = await import("../../db");
    const client = getPrismaClient();
    const doc = await client.document.findUnique({
      where: { id },
      select: {
        filename: true,
        originalName: true,
        mimeType: true,
        status: true,
        _count: { select: { chunks: true } },
      },
    });
    expect(doc?.filename).toBe("memo.txt");
    expect(doc?.originalName).toBe("memo.txt"); // default to filename
    expect(doc?.mimeType).toBe("text/plain");
    expect(doc?.status).toBe("chunked");
    expect(doc?._count.chunks).toBe(chunkCount);
  });

  it("create persists validated metadata and list reads it back", async () => {
    const { id } = await service.create({
      filename: "report.md",
      mimeType: "text/markdown",
      content: "# 시험성적서\n\nKS F 2271 결과 요약.",
      metadata: {
        productName: "HE-850A",
        documentType: "test_report",
        issuer: "KCL",
        testMethod: "KS F 2271",
        substrate: "강판",
        coatingThickness: "120 μm",
      },
    });
    createdIds.push(id);

    // Read back through the raw client to confirm the column is populated.
    const { getPrismaClient } = await import("../../db");
    const client = getPrismaClient();
    const doc = await client.document.findUnique({
      where: { id },
      select: { metadata: true },
    });
    expect(doc?.metadata).toEqual({
      productName: "HE-850A",
      documentType: "test_report",
      issuer: "KCL",
      testMethod: "KS F 2271",
      substrate: "강판",
      coatingThickness: "120 μm",
    });

    // And surfaced through the service list summary.
    const rows = await service.list(50);
    const row = rows.find((r) => r.id === id);
    expect(row?.metadata).toEqual({
      productName: "HE-850A",
      documentType: "test_report",
      issuer: "KCL",
      testMethod: "KS F 2271",
      substrate: "강판",
      coatingThickness: "120 μm",
    });
  });

  it("create without metadata stores null and list reports null", async () => {
    const { id } = await service.create({
      filename: "plain.txt",
      mimeType: "text/plain",
      content: "메타데이터 없는 문서 본문.",
    });
    createdIds.push(id);

    const rows = await service.list(50);
    const row = rows.find((r) => r.id === id);
    expect(row).toBeDefined();
    expect(row?.metadata).toBeNull();
  });

  it("list returns newest-first summaries without chunk content", async () => {
    const a = await service.create({
      filename: "a.txt",
      mimeType: "text/plain",
      content: "첫 문서 본문.",
    });
    createdIds.push(a.id);

    // 1ms separation so createdAt differs deterministically.
    await new Promise((r) => setTimeout(r, 5));

    const b = await service.create({
      filename: "b.txt",
      mimeType: "text/plain",
      content: "두 번째 문서 본문.",
    });
    createdIds.push(b.id);

    const rows = await service.list(50);
    const idxA = rows.findIndex((r) => r.id === a.id);
    const idxB = rows.findIndex((r) => r.id === b.id);
    expect(idxA).toBeGreaterThanOrEqual(0);
    expect(idxB).toBeGreaterThanOrEqual(0);
    // newest first
    expect(idxB).toBeLessThan(idxA);

    const bRow = rows[idxB];
    expect(bRow.chunkCount).toBeGreaterThanOrEqual(1);
    // Summary must not include raw content.
    expect(bRow).not.toHaveProperty("chunks");
    expect(bRow).not.toHaveProperty("content");
  });

  it("search finds matching chunks and metadata filters narrow results", async () => {
    const kcl = await service.create({
      filename: "kcl-report.md",
      mimeType: "text/markdown",
      content:
        "이 시험성적서는 방오 코팅의 부착 성능을 KCL 기준으로 평가한 결과를 담고 있습니다.",
      metadata: {
        productName: "HE-850A",
        documentType: "test_report",
        issuer: "KCL",
      },
    });
    createdIds.push(kcl.id);

    const katsa = await service.create({
      filename: "kats-report.md",
      mimeType: "text/markdown",
      content: "방오 코팅 일반 설명 자료. 발급기관은 KATS 입니다.",
      metadata: {
        productName: "HE-850A",
        documentType: "catalog",
        issuer: "KATS",
      },
    });
    createdIds.push(katsa.id);

    // Unfiltered keyword search hits both documents (both mention 방오).
    const broad = await service.search({ q: "방오 코팅" });
    const broadDocIds = new Set(broad.map((r) => r.documentId));
    expect(broadDocIds.has(kcl.id)).toBe(true);
    expect(broadDocIds.has(katsa.id)).toBe(true);
    // Results carry a snippet + score, never the raw chunk body.
    for (const r of broad) {
      expect(typeof r.snippet).toBe("string");
      expect(r.score).toBeGreaterThan(0);
      expect(r).not.toHaveProperty("content");
    }

    // issuer filter narrows to the KCL document only.
    const filtered = await service.search({ q: "방오 코팅", issuer: "KCL" });
    const filteredDocIds = new Set(filtered.map((r) => r.documentId));
    expect(filteredDocIds.has(kcl.id)).toBe(true);
    expect(filteredDocIds.has(katsa.id)).toBe(false);

    // documentType filter is independent and also narrows correctly.
    const byType = await service.search({
      q: "방오 코팅",
      documentType: "catalog",
    });
    const byTypeDocIds = new Set(byType.map((r) => r.documentId));
    expect(byTypeDocIds.has(katsa.id)).toBe(true);
    expect(byTypeDocIds.has(kcl.id)).toBe(false);
  });
});
