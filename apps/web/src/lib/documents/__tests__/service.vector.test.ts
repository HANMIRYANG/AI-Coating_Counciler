// Unit tests for DocumentService vector + hybrid retrieval and the embedding
// intake/backfill paths. A hand-rolled prisma mock (injected) + the real
// deterministic MockEmbedder (injected) keep these DB-free and reproducible.

import { describe, it, expect, vi } from "vitest";

import { DocumentService } from "../service";
import {
  MOCK_EMBEDDER_DIMS,
  MOCK_EMBEDDER_ID,
  MockEmbedder,
  mockEmbedText,
} from "../embeddings";
import { encodeEmbedding } from "../vectorSearch";

// An embedder whose embed() is a spy, so tests can assert it is NOT called on
// the query-embedding degradation path.
function spyEmbedder() {
  return {
    id: MOCK_EMBEDDER_ID,
    dims: MOCK_EMBEDDER_DIMS,
    embed: vi.fn(async (texts: string[]) => texts.map((t) => mockEmbedText(t))),
  };
}

function embeddedChunkRow(opts: {
  id: string;
  documentId: string;
  chunkIndex: number;
  content: string;
  model?: string;
  filename?: string;
}) {
  return {
    id: opts.id,
    chunkIndex: opts.chunkIndex,
    content: opts.content,
    embedding: encodeEmbedding(mockEmbedText(opts.content)),
    metadata: { embeddingModel: opts.model ?? MOCK_EMBEDDER_ID },
    document: {
      id: opts.documentId,
      filename: opts.filename ?? `${opts.documentId}.md`,
      metadata: null,
    },
  };
}

describe("DocumentService.vectorSearch", () => {
  it("cosine-ranks comparable chunks, drops orthogonal, skips model mismatch", async () => {
    const findMany = vi.fn().mockResolvedValue([
      embeddedChunkRow({ id: "exact", documentId: "d0", chunkIndex: 0, content: "불연 코팅 시험" }),
      embeddedChunkRow({ id: "overlap", documentId: "d1", chunkIndex: 0, content: "불연 코팅" }),
      embeddedChunkRow({ id: "disjoint", documentId: "d2", chunkIndex: 0, content: "배송 견적 일정" }),
      embeddedChunkRow({ id: "mismatch", documentId: "d3", chunkIndex: 0, content: "불연 코팅 시험", model: "other-model" }),
    ]);
    const prisma = { documentChunk: { findMany } } as never;
    const service = new DocumentService(prisma, new MockEmbedder());

    const results = await service.vectorSearch({ q: "불연 코팅 시험" });

    // exact (cosine 1) first, overlap next; disjoint dropped (cosine 0);
    // mismatch skipped (different embedding model).
    expect(results.map((r) => r.chunkId)).toEqual(["exact", "overlap"]);
    expect(results[0].score).toBeCloseTo(1, 6);
    // The where clause requires a stored embedding.
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ embedding: { not: null } }) }),
    );
  });

  it("returns [] for an empty query without touching the DB", async () => {
    const findMany = vi.fn();
    const service = new DocumentService({ documentChunk: { findMany } } as never, new MockEmbedder());
    expect(await service.vectorSearch({ q: "   " })).toEqual([]);
    expect(findMany).not.toHaveBeenCalled();
  });

  it("does NOT embed the query when the candidate scan returns no rows", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const embedder = spyEmbedder();
    const service = new DocumentService({ documentChunk: { findMany } } as never, embedder);

    const res = await service.vectorSearch({ q: "불연 코팅" });

    expect(res).toEqual([]);
    expect(findMany).toHaveBeenCalledTimes(1);
    expect(embedder.embed).not.toHaveBeenCalled();
  });

  it("does NOT embed the query when every row has a mismatched embeddingModel", async () => {
    const findMany = vi.fn().mockResolvedValue([
      embeddedChunkRow({ id: "m1", documentId: "d0", chunkIndex: 0, content: "불연 코팅", model: "other-model" }),
      embeddedChunkRow({ id: "m2", documentId: "d1", chunkIndex: 0, content: "난연", model: "legacy-v1" }),
    ]);
    const embedder = spyEmbedder();
    const service = new DocumentService({ documentChunk: { findMany } } as never, embedder);

    const res = await service.vectorSearch({ q: "불연 코팅" });

    expect(res).toEqual([]);
    expect(embedder.embed).not.toHaveBeenCalled();
  });

  it("embeds the query exactly once when a comparable candidate exists", async () => {
    const findMany = vi.fn().mockResolvedValue([
      embeddedChunkRow({ id: "a", documentId: "d0", chunkIndex: 0, content: "불연 코팅 시험" }),
    ]);
    const embedder = spyEmbedder();
    const service = new DocumentService({ documentChunk: { findMany } } as never, embedder);

    const res = await service.vectorSearch({ q: "불연 코팅 시험" });

    expect(embedder.embed).toHaveBeenCalledTimes(1);
    expect(res.map((r) => r.chunkId)).toEqual(["a"]);
  });
});

describe("DocumentService.hybridSearch", () => {
  it("merges keyword + vector results (degrades to keyword when no embeddings)", async () => {
    // search() (keyword) and vectorSearch() both call documentChunk.findMany.
    // First call → keyword candidate scan; second → vector scan (no embeddings).
    const findMany = vi
      .fn()
      .mockResolvedValueOnce([
        { id: "k1", chunkIndex: 0, content: "불연 코팅 시험 결과", document: { id: "d0", filename: "a.md", metadata: null } },
      ])
      .mockResolvedValueOnce([]); // vector scan: no embedded chunks
    const service = new DocumentService({ documentChunk: { findMany } } as never, new MockEmbedder());

    const out = await service.hybridSearch({ q: "불연 시험" });
    expect(out.map((r) => r.chunkId)).toEqual(["k1"]);
    expect(findMany).toHaveBeenCalledTimes(2);
  });
});

describe("DocumentService.backfillEmbeddings", () => {
  it("embeds null-embedding chunks and reports counts", async () => {
    const findMany = vi.fn().mockResolvedValue([
      { id: "c1", content: "불연 코팅" },
      { id: "c2", content: "난연 페인트" },
    ]);
    const update = vi.fn().mockResolvedValue({});
    const count = vi.fn().mockResolvedValue(0);
    const prisma = { documentChunk: { findMany, update, count } } as never;
    const service = new DocumentService(prisma, new MockEmbedder());

    const res = await service.backfillEmbeddings({ limit: 50 });
    expect(res).toEqual({ processed: 2, skipped: 0, remaining: 0 });
    expect(update).toHaveBeenCalledTimes(2);
    // Each update writes embedding bytes + the model stamp.
    const firstData = update.mock.calls[0][0].data;
    expect(Buffer.isBuffer(firstData.embedding)).toBe(true);
    expect(firstData.metadata).toMatchObject({ embeddingModel: MOCK_EMBEDDER_ID });
  });

  it("no-ops cleanly when nothing needs embedding", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const service = new DocumentService({ documentChunk: { findMany } } as never, new MockEmbedder());
    expect(await service.backfillEmbeddings()).toEqual({ processed: 0, skipped: 0, remaining: 0 });
  });

  it("skips (does not throw) when the embedder fails", async () => {
    const failing = {
      id: "boom",
      dims: 4,
      embed: async () => {
        throw new Error("no key");
      },
    };
    const findMany = vi.fn().mockResolvedValue([{ id: "c1", content: "x" }]);
    const update = vi.fn();
    const count = vi.fn().mockResolvedValue(1);
    const service = new DocumentService(
      { documentChunk: { findMany, update, count } } as never,
      failing,
    );
    const res = await service.backfillEmbeddings();
    expect(res).toEqual({ processed: 0, skipped: 1, remaining: 1 });
    expect(update).not.toHaveBeenCalled();
  });
});

describe("DocumentService.create — embedding intake", () => {
  it("stores embedding bytes + model stamp on each chunk", async () => {
    const create = vi.fn().mockResolvedValue({ id: "doc_1" });
    const service = new DocumentService({ document: { create } } as never, new MockEmbedder());

    await service.create({
      filename: "tds.md",
      mimeType: "text/markdown",
      content: "불연 코팅 시험 결과 본문입니다.",
    });

    const chunkCreate = create.mock.calls[0][0].data.chunks.create;
    expect(chunkCreate.length).toBeGreaterThan(0);
    expect(Buffer.isBuffer(chunkCreate[0].embedding)).toBe(true);
    expect(chunkCreate[0].metadata).toMatchObject({ embeddingModel: MOCK_EMBEDDER_ID });
  });

  it("persists the document even when the embedder fails (null embedding)", async () => {
    const create = vi.fn().mockResolvedValue({ id: "doc_1" });
    const failing = {
      id: "boom",
      dims: 4,
      embed: async () => {
        throw new Error("provider down");
      },
    };
    const service = new DocumentService({ document: { create } } as never, failing);

    const res = await service.create({
      filename: "tds.md",
      mimeType: "text/markdown",
      content: "본문",
    });
    expect(res.id).toBe("doc_1");
    const chunkCreate = create.mock.calls[0][0].data.chunks.create;
    expect(chunkCreate[0].embedding).toBeNull();
  });
});
