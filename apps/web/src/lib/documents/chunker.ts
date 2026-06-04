// Deterministic text chunker for internal document intake.
//
// Algorithm:
//   1. Normalize CRLF -> LF, strip trailing whitespace per line, collapse
//      runs of >=3 blank lines down to 2 (paragraph boundary).
//   2. Split on blank lines into paragraphs.
//   3. For each paragraph:
//        - if length <= maxChars: emit as-is.
//        - else: pack sentences into windows up to maxChars; any single
//          sentence longer than maxChars is hard-split by characters.
//   4. Within a single split paragraph's pieces, merge any trailing piece
//      shorter than minChars into the previous piece when the combined
//      size still fits maxChars (avoids "trailing fragment" micro-chunks
//      from sentence packing). Paragraph boundaries are NEVER crossed by
//      the merge — a short standalone paragraph stays its own chunk so
//      authored structure (headers, list bullets separated by blank
//      lines, etc.) is preserved.
//   5. Assign 0-based chunkIndex in emission order.
//
// Determinism: the function is pure. Same input -> same output, byte-for-
// byte. No clocks, no randomness, no environment reads.
//
// What this chunker is NOT:
//   - It does not parse Markdown structure (headings, tables, code fences).
//     A markdown-aware tier can layer on top later — paragraph splitting is
//     a sound first cut that already keeps lists and tables intact when
//     they are not separated by blank lines.
//   - It does not emit embeddings or vectors itself. Embedding happens in the
//     service layer at persistence time (lib/documents/embeddings.ts), which
//     fills `DocumentChunk.embedding` best-effort.

export type Chunk = {
  /** 0-based emission order. */
  index: number;
  content: string;
  /** Optional page number when the upstream knows it (PDF parser, etc.). */
  pageNumber?: number;
};

export type ChunkOptions = {
  /** Hard upper bound on chunk length in characters. Default 1200. */
  maxChars?: number;
  /**
   * Tail-merge threshold. Chunks shorter than this are folded into the
   * previous chunk when the combined length still fits maxChars.
   * Default 80.
   */
  minChars?: number;
};

const DEFAULT_MAX = 1200;
const DEFAULT_MIN = 80;

export function chunkText(text: string, options: ChunkOptions = {}): Chunk[] {
  const maxChars = options.maxChars ?? DEFAULT_MAX;
  const minChars = options.minChars ?? DEFAULT_MIN;
  if (!Number.isInteger(maxChars) || maxChars <= 0) {
    throw new RangeError("maxChars must be a positive integer");
  }
  if (!Number.isInteger(minChars) || minChars < 0) {
    throw new RangeError("minChars must be a non-negative integer");
  }
  if (minChars > 0 && maxChars < minChars * 2) {
    throw new RangeError("maxChars must be at least 2 * minChars");
  }

  const normalized = normalize(text);
  if (normalized.length === 0) return [];

  const paragraphs = normalized
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  const all: string[] = [];
  for (const para of paragraphs) {
    if (para.length <= maxChars) {
      all.push(para);
    } else {
      const pieces = splitLongParagraph(para, maxChars);
      all.push(...mergeShortTailWithinParagraph(pieces, maxChars, minChars));
    }
  }

  return all.map((content, index) => ({ index, content }));
}

/**
 * Within the pieces produced from splitting ONE long paragraph, fold a
 * trailing short piece back into its predecessor when the combined length
 * still fits maxChars. This only applies inside the same paragraph — never
 * across paragraph boundaries — so authored blank-line structure is
 * preserved end-to-end.
 */
function mergeShortTailWithinParagraph(
  pieces: string[],
  maxChars: number,
  minChars: number,
): string[] {
  if (pieces.length === 0) return pieces;
  const out: string[] = [pieces[0]];
  for (let i = 1; i < pieces.length; i++) {
    const piece = pieces[i];
    const last = out[out.length - 1];
    if (
      piece.length < minChars &&
      last.length + 1 + piece.length <= maxChars
    ) {
      out[out.length - 1] = `${last} ${piece}`;
      continue;
    }
    out.push(piece);
  }
  return out;
}

function normalize(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/\s+$/, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Split a paragraph that exceeds maxChars into sentence-packed windows.
 * Handles English (`. ! ?`) and CJK (`。 ! ?`) sentence enders. Single
 * sentences longer than maxChars are hard-split by character count so the
 * function always makes progress.
 */
function splitLongParagraph(text: string, maxChars: number): string[] {
  const sentences = text
    .split(/(?<=[.!?。!?])\s+|(?<=[。!?])(?=\S)/u)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  const out: string[] = [];
  let buf = "";
  for (const sentence of sentences) {
    if (sentence.length > maxChars) {
      if (buf.length > 0) {
        out.push(buf);
        buf = "";
      }
      for (let i = 0; i < sentence.length; i += maxChars) {
        out.push(sentence.slice(i, i + maxChars));
      }
      continue;
    }
    const candidate = buf.length === 0 ? sentence : `${buf} ${sentence}`;
    if (candidate.length > maxChars) {
      out.push(buf);
      buf = sentence;
    } else {
      buf = candidate;
    }
  }
  if (buf.length > 0) out.push(buf);
  return out;
}
