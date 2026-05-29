import { describe, it, expect } from "vitest";

import {
  buildChunkWhere,
  buildSnippet,
  clampSearchLimit,
  normalizeQuery,
  rankCandidates,
  scoreChunkContent,
  SEARCH_DEFAULT_LIMIT,
  SEARCH_MAX_LIMIT,
  SEARCH_MAX_TERMS,
  SNIPPET_MAX_CHARS,
  type SearchCandidate,
} from "../search";

describe("normalizeQuery", () => {
  it("lowercases, splits on whitespace, and drops empties", () => {
    expect(normalizeQuery("  Fire  RESISTANT  coating ")).toEqual([
      "fire",
      "resistant",
      "coating",
    ]);
  });

  it("de-duplicates terms preserving first-seen order", () => {
    expect(normalizeQuery("coating Coating COATING fire")).toEqual([
      "coating",
      "fire",
    ]);
  });

  it("returns an empty array for a whitespace-only query", () => {
    expect(normalizeQuery("   \t  ")).toEqual([]);
  });

  it("caps the number of distinct terms at SEARCH_MAX_TERMS", () => {
    const many = Array.from({ length: SEARCH_MAX_TERMS + 5 }, (_, i) => `t${i}`);
    expect(normalizeQuery(many.join(" "))).toHaveLength(SEARCH_MAX_TERMS);
  });

  it("keeps non-spaced multibyte tokens intact", () => {
    expect(normalizeQuery("방오 코팅")).toEqual(["방오", "코팅"]);
  });
});

describe("scoreChunkContent", () => {
  it("scores distinct-term coverage above raw frequency", () => {
    const terms = ["fire", "coating"];
    const both = scoreChunkContent("fire coating on steel", terms);
    const repeated = scoreChunkContent("fire fire fire fire", terms);
    expect(both.matchedTerms).toBe(2);
    expect(repeated.matchedTerms).toBe(1);
    // 2*100 + 2 = 202 beats 1*100 + 4 = 104
    expect(both.score).toBe(202);
    expect(repeated.score).toBe(104);
    expect(both.score).toBeGreaterThan(repeated.score);
  });

  it("is case-insensitive and counts every occurrence", () => {
    const r = scoreChunkContent("Coating COATING coating", ["coating"]);
    expect(r.matchedTerms).toBe(1);
    expect(r.occurrences).toBe(3);
    expect(r.score).toBe(103);
  });

  it("returns zero when no term matches", () => {
    expect(scoreChunkContent("unrelated text", ["fire"]).score).toBe(0);
  });
});

describe("buildSnippet", () => {
  it("centers on the first match and bounds the length", () => {
    const content =
      "intro padding ".repeat(20) + "the FIRE resistance result " + "tail ".repeat(40);
    const snippet = buildSnippet(content, ["fire"]);
    expect(snippet.toLowerCase()).toContain("fire");
    // Bounded by SNIPPET_MAX_CHARS plus up to two ellipsis characters.
    expect(snippet.length).toBeLessThanOrEqual(SNIPPET_MAX_CHARS + 2);
    expect(snippet.startsWith("…")).toBe(true);
    expect(snippet.endsWith("…")).toBe(true);
  });

  it("collapses whitespace in the snippet", () => {
    const snippet = buildSnippet("fire    \n\n   coating   test", ["fire"]);
    expect(snippet).not.toMatch(/\s{2,}/);
  });

  it("falls back to the head when no term matches", () => {
    const snippet = buildSnippet("alpha beta gamma", ["zeta"]);
    expect(snippet.startsWith("alpha")).toBe(true);
  });

  it("is deterministic for identical inputs", () => {
    const a = buildSnippet("fire resistant coating result", ["coating"]);
    const b = buildSnippet("fire resistant coating result", ["coating"]);
    expect(a).toBe(b);
  });
});

describe("clampSearchLimit", () => {
  it("defaults when undefined or non-positive", () => {
    expect(clampSearchLimit(undefined)).toBe(SEARCH_DEFAULT_LIMIT);
    expect(clampSearchLimit(0)).toBe(SEARCH_DEFAULT_LIMIT);
    expect(clampSearchLimit(-5)).toBe(SEARCH_DEFAULT_LIMIT);
  });

  it("caps at the max", () => {
    expect(clampSearchLimit(9999)).toBe(SEARCH_MAX_LIMIT);
    expect(clampSearchLimit(3)).toBe(3);
  });
});

function candidate(
  over: Partial<SearchCandidate> & { content: string },
): SearchCandidate {
  return {
    chunkId: "c1",
    chunkIndex: 0,
    documentId: "doc1",
    filename: "f.txt",
    metadata: null,
    ...over,
  };
}

describe("rankCandidates", () => {
  it("sorts by score desc then documentId then chunkIndex, dropping non-matches", () => {
    const terms = ["fire", "coating"];
    const candidates: SearchCandidate[] = [
      candidate({ chunkId: "a", documentId: "doc2", chunkIndex: 1, content: "fire only" }),
      candidate({ chunkId: "b", documentId: "doc1", chunkIndex: 0, content: "fire coating combo" }),
      candidate({ chunkId: "c", documentId: "doc3", chunkIndex: 0, content: "nothing relevant" }),
      candidate({ chunkId: "d", documentId: "doc1", chunkIndex: 0, content: "fire only too" }),
    ];
    const ranked = rankCandidates(candidates, terms, 10);
    // 'c' dropped (score 0). Highest score (both terms) first.
    expect(ranked.map((r) => r.chunkId)).toEqual(["b", "d", "a"]);
    expect(ranked.every((r) => r.score > 0)).toBe(true);
  });

  it("respects the limit", () => {
    const terms = ["x"];
    const candidates = Array.from({ length: 5 }, (_, i) =>
      candidate({ chunkId: `c${i}`, documentId: `doc${i}`, content: "x match" }),
    );
    expect(rankCandidates(candidates, terms, 2)).toHaveLength(2);
  });

  it("never includes the full content body in a result", () => {
    const long = "fire " + "x".repeat(5000);
    const ranked = rankCandidates([candidate({ content: long })], ["fire"], 10);
    expect(ranked[0].snippet.length).toBeLessThanOrEqual(SNIPPET_MAX_CHARS + 2);
    expect(ranked[0]).not.toHaveProperty("content");
  });
});

describe("buildChunkWhere", () => {
  it("builds an OR of case-insensitive content contains for each term", () => {
    const where = buildChunkWhere(["fire", "coating"], {});
    expect(where.OR).toEqual([
      { content: { contains: "fire", mode: "insensitive" } },
      { content: { contains: "coating", mode: "insensitive" } },
    ]);
    // No metadata filters → no document constraint.
    expect(where.document).toBeUndefined();
  });

  it("adds metadata AND conditions for each provided filter", () => {
    const where = buildChunkWhere(["fire"], {
      documentType: "test_report",
      productName: "HE-850A",
      issuer: "KCL",
    });
    expect(where.document).toEqual({
      AND: [
        { metadata: { path: ["documentType"], equals: "test_report" } },
        { metadata: { path: ["productName"], equals: "HE-850A" } },
        { metadata: { path: ["issuer"], equals: "KCL" } },
      ],
    });
  });

  it("includes only the filters that are provided", () => {
    const where = buildChunkWhere(["fire"], { issuer: "KCL" });
    expect(where.document).toEqual({
      AND: [{ metadata: { path: ["issuer"], equals: "KCL" } }],
    });
  });
});
