import { describe, it, expect } from "vitest";
import { chunkText } from "../chunker";

describe("documents/chunker", () => {
  it("returns [] for empty or whitespace input", () => {
    expect(chunkText("")).toEqual([]);
    expect(chunkText("   \n   \n  ")).toEqual([]);
  });

  it("emits a single chunk for short text", () => {
    const out = chunkText("한 단락짜리 짧은 문서.");
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({ index: 0, content: "한 단락짜리 짧은 문서." });
  });

  it("splits at paragraph boundaries (blank lines)", () => {
    const text = ["첫 번째 단락.", "", "두 번째 단락.", "", "세 번째 단락."].join(
      "\n",
    );
    const out = chunkText(text);
    expect(out.map((c) => c.content)).toEqual([
      "첫 번째 단락.",
      "두 번째 단락.",
      "세 번째 단락.",
    ]);
    expect(out.map((c) => c.index)).toEqual([0, 1, 2]);
  });

  it("normalizes CRLF and collapses 3+ blank line runs", () => {
    const text = "A\r\n\r\n\r\n\r\nB";
    const out = chunkText(text);
    expect(out.map((c) => c.content)).toEqual(["A", "B"]);
  });

  it("splits a single long paragraph by sentence packing under maxChars", () => {
    const sentences = Array.from({ length: 10 }, (_, i) => `문장 ${i}.`);
    const text = sentences.join(" ");
    // sentence-pack into windows of maxChars=20
    const out = chunkText(text, { maxChars: 20, minChars: 0 });
    expect(out.length).toBeGreaterThan(1);
    for (const c of out) {
      expect(c.content.length).toBeLessThanOrEqual(20);
    }
    // Round-trip: joining the chunks recovers all sentences in order.
    const recovered = out.map((c) => c.content).join(" ");
    for (const s of sentences) {
      expect(recovered).toContain(s);
    }
  });

  it("hard-splits a single sentence that exceeds maxChars", () => {
    const text = "x".repeat(2500);
    const out = chunkText(text, { maxChars: 1000, minChars: 0 });
    expect(out.length).toBe(3);
    expect(out[0].content.length).toBe(1000);
    expect(out[1].content.length).toBe(1000);
    expect(out[2].content.length).toBe(500);
  });

  it("preserves paragraph boundaries even when a paragraph is short", () => {
    // A blank line in the source is treated as authored structure (a list
    // item, a heading, etc.). Two short paragraphs separated by a blank
    // line must therefore remain two chunks, not get glued together.
    const long = "가".repeat(800);
    const tail = "짧음";
    const out = chunkText(`${long}\n\n${tail}`, {
      maxChars: 1200,
      minChars: 80,
    });
    expect(out).toHaveLength(2);
    expect(out[0].content).toBe(long);
    expect(out[1].content).toBe(tail);
  });

  it("folds a tail fragment back into its sentence-packed predecessor", () => {
    // ASCII sentences here — the regex sentence splitter handles `. ` cleanly.
    // The intent: one long paragraph that splits into a big window plus a
    // short trailing fragment. The trailing fragment must merge into the
    // previous piece because it is below minChars and the combined length
    // still fits maxChars. This proves the tail-merge logic is alive but
    // scoped to within one paragraph.
    const big = "Lorem ipsum dolor sit amet. ".repeat(40); // ~1120 chars
    const short = "Tail.";
    const para = `${big}${short}`;
    const out = chunkText(para, { maxChars: 1200, minChars: 80 });
    expect(out.length).toBe(1);
    expect(out[0].content.endsWith("Tail.")).toBe(true);
    expect(out[0].content.length).toBeLessThanOrEqual(1200);
  });

  it("assigns chunkIndex 0..N-1 in emission order", () => {
    const text = ["A", "B", "C", "D"].join("\n\n");
    const out = chunkText(text);
    expect(out.map((c) => c.index)).toEqual([0, 1, 2, 3]);
  });

  it("is deterministic — same input -> same output across calls", () => {
    const text = [
      "이것은 결정성 테스트.",
      "",
      "두 번째 단락에는 여러 문장이 있다. 그리고 또 다른 문장.",
      "",
      "마지막 단락.",
    ].join("\n");
    const a = chunkText(text);
    const b = chunkText(text);
    const c = chunkText(text);
    expect(a).toEqual(b);
    expect(b).toEqual(c);
  });

  it("rejects invalid options early", () => {
    expect(() => chunkText("hi", { maxChars: 0 })).toThrow(RangeError);
    expect(() => chunkText("hi", { minChars: -1 })).toThrow(RangeError);
    expect(() => chunkText("hi", { maxChars: 50, minChars: 100 })).toThrow(
      RangeError,
    );
  });
});
