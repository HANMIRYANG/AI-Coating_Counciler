import { describe, it, expect } from "vitest";

import {
  chunkEmbeddingModel,
  cosineSimilarity,
  decodeEmbedding,
  embeddingStamp,
  encodeEmbedding,
  mergeHybrid,
  rankByCosine,
  type VectorCandidate,
} from "../vectorSearch";
import type { DocumentSearchResult } from "../search";

function cand(over: Partial<VectorCandidate> & { vector: Float32Array }): VectorCandidate {
  return {
    chunkId: "c",
    chunkIndex: 0,
    documentId: "doc1",
    filename: "f.md",
    snippet: "snippet",
    metadata: null,
    ...over,
  };
}

function kwResult(over: Partial<DocumentSearchResult> = {}): DocumentSearchResult {
  return {
    documentId: "doc1",
    filename: "f.md",
    chunkId: "c",
    chunkIndex: 0,
    snippet: "s",
    metadata: null,
    score: 100,
    ...over,
  };
}

describe("encode/decode embedding", () => {
  it("round-trips a Float32 vector (LE, deterministic)", () => {
    const v = Float32Array.from([0.5, -0.25, 1, 0, 0.125]);
    const back = decodeEmbedding(encodeEmbedding(v));
    expect(Array.from(back)).toEqual(Array.from(v));
  });

  it("encodes 4 bytes per element", () => {
    expect(encodeEmbedding(Float32Array.from([1, 2, 3])).length).toBe(12);
  });
});

describe("cosineSimilarity", () => {
  it("is 1 for identical direction, 0 for orthogonal, -1 for opposite", () => {
    const a = Float32Array.from([1, 0]);
    expect(cosineSimilarity(a, Float32Array.from([2, 0]))).toBeCloseTo(1, 6);
    expect(cosineSimilarity(a, Float32Array.from([0, 5]))).toBeCloseTo(0, 6);
    expect(cosineSimilarity(a, Float32Array.from([-1, 0]))).toBeCloseTo(-1, 6);
  });

  it("returns 0 for zero vectors or length mismatch", () => {
    expect(cosineSimilarity(Float32Array.from([0, 0]), Float32Array.from([1, 1]))).toBe(0);
    expect(cosineSimilarity(Float32Array.from([1]), Float32Array.from([1, 1]))).toBe(0);
  });
});

describe("rankByCosine", () => {
  it("orders by similarity desc and drops non-positive, deterministic tie-break", () => {
    const q = Float32Array.from([1, 0]);
    const out = rankByCosine(
      [
        cand({ chunkId: "ortho", documentId: "d2", vector: Float32Array.from([0, 1]) }),
        cand({ chunkId: "near", documentId: "d1", vector: Float32Array.from([0.9, 0.1]) }),
        cand({ chunkId: "exact", documentId: "d0", vector: Float32Array.from([1, 0]) }),
        cand({ chunkId: "opp", documentId: "d3", vector: Float32Array.from([-1, 0]) }),
      ],
      q,
      10,
    );
    // orthogonal (score 0) and opposite (score <0) dropped.
    expect(out.map((r) => r.chunkId)).toEqual(["exact", "near"]);
    expect(out[0].score).toBeCloseTo(1, 6);
  });

  it("trims to limit", () => {
    const q = Float32Array.from([1, 0]);
    const out = rankByCosine(
      [
        cand({ chunkId: "a", documentId: "d0", vector: Float32Array.from([1, 0]) }),
        cand({ chunkId: "b", documentId: "d1", vector: Float32Array.from([0.9, 0.1]) }),
      ],
      q,
      1,
    );
    expect(out).toHaveLength(1);
    expect(out[0].chunkId).toBe("a");
  });
});

describe("mergeHybrid", () => {
  it("dedupes by chunkId and combines normalized scores", () => {
    const keyword = [kwResult({ chunkId: "shared", score: 300 }), kwResult({ chunkId: "kwOnly", chunkIndex: 1, score: 100 })];
    const vector = [kwResult({ chunkId: "shared", score: 0.9 }), kwResult({ chunkId: "vecOnly", chunkIndex: 2, score: 0.1 })];
    const out = mergeHybrid(keyword, vector, 10);
    // 3 distinct chunks.
    expect(out.map((r) => r.chunkId).sort()).toEqual(["kwOnly", "shared", "vecOnly"]);
    // shared appears once, ranked top (present in both lists at the high end).
    expect(out[0].chunkId).toBe("shared");
  });

  it("equals keyword ordering when vector is empty", () => {
    const keyword = [
      kwResult({ chunkId: "a", documentId: "d0", score: 300 }),
      kwResult({ chunkId: "b", documentId: "d1", chunkIndex: 1, score: 100 }),
    ];
    const out = mergeHybrid(keyword, [], 10);
    expect(out.map((r) => r.chunkId)).toEqual(["a", "b"]);
  });

  it("is deterministic on ties", () => {
    const a = mergeHybrid([kwResult({ chunkId: "x" })], [kwResult({ chunkId: "y", chunkIndex: 1 })], 10);
    const b = mergeHybrid([kwResult({ chunkId: "x" })], [kwResult({ chunkId: "y", chunkIndex: 1 })], 10);
    expect(a.map((r) => r.chunkId)).toEqual(b.map((r) => r.chunkId));
  });
});

describe("embedding stamp helpers", () => {
  it("stamps and reads back the model id", () => {
    const stamp = embeddingStamp({ id: "mock-hash-256", dims: 256 });
    expect(chunkEmbeddingModel(stamp)).toBe("mock-hash-256");
  });

  it("returns null for missing/!object metadata", () => {
    expect(chunkEmbeddingModel(null)).toBeNull();
    expect(chunkEmbeddingModel({ other: 1 })).toBeNull();
    expect(chunkEmbeddingModel("x")).toBeNull();
  });
});
