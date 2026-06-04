import { describe, it, expect, afterEach } from "vitest";

import {
  MOCK_EMBEDDER_DIMS,
  MOCK_EMBEDDER_ID,
  MockEmbedder,
  buildEmbedder,
  isMockEmbedderEnabled,
  mockEmbedText,
} from "../embeddings";

const ORIG = {
  useMock: process.env.USE_MOCK_PROVIDERS,
  key: process.env.OPENAI_API_KEY,
};

afterEach(() => {
  if (ORIG.useMock === undefined) delete process.env.USE_MOCK_PROVIDERS;
  else process.env.USE_MOCK_PROVIDERS = ORIG.useMock;
  if (ORIG.key === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = ORIG.key;
});

describe("mockEmbedText", () => {
  it("is deterministic — same text → identical vector", () => {
    const a = mockEmbedText("불연 코팅 시험성적서");
    const b = mockEmbedText("불연 코팅 시험성적서");
    expect(Array.from(a)).toEqual(Array.from(b));
    expect(a.length).toBe(MOCK_EMBEDDER_DIMS);
  });

  it("is L2-normalized (unit length) for non-empty text", () => {
    const v = mockEmbedText("난연 페인트");
    let norm = 0;
    for (const x of v) norm += x * x;
    expect(Math.sqrt(norm)).toBeCloseTo(1, 6);
  });

  it("returns a zero vector for token-less text", () => {
    const v = mockEmbedText("   !!!   ");
    expect(v.every((x) => x === 0)).toBe(true);
  });

  it("shared tokens → higher cosine than disjoint tokens", () => {
    const dot = (a: Float32Array, b: Float32Array) => {
      let s = 0;
      for (let i = 0; i < a.length; i++) s += a[i] * b[i];
      return s;
    };
    const base = mockEmbedText("불연 코팅 난연 시험");
    const overlap = mockEmbedText("불연 코팅 보고서");
    const disjoint = mockEmbedText("배송 일정 견적");
    expect(dot(base, overlap)).toBeGreaterThan(dot(base, disjoint));
  });
});

describe("MockEmbedder", () => {
  it("embeds in input order and exposes id/dims", async () => {
    const e = new MockEmbedder();
    expect(e.id).toBe(MOCK_EMBEDDER_ID);
    expect(e.dims).toBe(MOCK_EMBEDDER_DIMS);
    const [a, b] = await e.embed(["x", "y"]);
    expect(Array.from(a)).toEqual(Array.from(mockEmbedText("x")));
    expect(Array.from(b)).toEqual(Array.from(mockEmbedText("y")));
  });
});

describe("buildEmbedder / isMockEmbedderEnabled", () => {
  it("uses the mock when USE_MOCK_PROVIDERS!=false", () => {
    process.env.USE_MOCK_PROVIDERS = "true";
    process.env.OPENAI_API_KEY = "sk-test";
    expect(isMockEmbedderEnabled()).toBe(true);
    expect(buildEmbedder()).toBeInstanceOf(MockEmbedder);
  });

  it("uses the mock when the real key is absent even if mock disabled", () => {
    process.env.USE_MOCK_PROVIDERS = "false";
    delete process.env.OPENAI_API_KEY;
    expect(isMockEmbedderEnabled()).toBe(true);
    expect(buildEmbedder()).toBeInstanceOf(MockEmbedder);
  });
});
