import { describe, it, expect } from "vitest";
import {
  DocumentExtractError,
  MAX_EXTRACTED_CHARS,
  extractDocumentText,
  inferMimeFromFilename,
  isParseableMime,
  type Extractors,
} from "../extract";

const PDF = "application/pdf";
const DOCX =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

// Injected stub extractors so the dispatch / normalization logic is exercised
// without the real unpdf / mammoth libraries.
function stub(opts: {
  pdfText?: string;
  pdfPages?: number;
  docxText?: string;
  throwIn?: "pdf" | "docx";
}): Extractors {
  return {
    pdf: async () => {
      if (opts.throwIn === "pdf") throw new Error("boom-pdf");
      return { text: opts.pdfText ?? "", pageCount: opts.pdfPages };
    },
    docx: async () => {
      if (opts.throwIn === "docx") throw new Error("boom-docx");
      return { text: opts.docxText ?? "" };
    },
  };
}

const buf = Buffer.from("dummy");

describe("extractDocumentText", () => {
  it("extracts PDF text + page count", async () => {
    const r = await extractDocumentText(
      buf,
      PDF,
      stub({ pdfText: "방오 코팅 시험 결과", pdfPages: 3 }),
    );
    expect(r.kind).toBe("pdf");
    expect(r.text).toBe("방오 코팅 시험 결과");
    expect(r.pageCount).toBe(3);
  });

  it("extracts DOCX text", async () => {
    const r = await extractDocumentText(
      buf,
      DOCX,
      stub({ docxText: "제안서 본문" }),
    );
    expect(r.kind).toBe("docx");
    expect(r.text).toBe("제안서 본문");
  });

  it("normalizes CRLF and trims surrounding whitespace", async () => {
    const r = await extractDocumentText(
      buf,
      PDF,
      stub({ pdfText: "  줄1\r\n줄2  " }),
    );
    expect(r.text).toBe("줄1\n줄2");
  });

  it("rejects an unsupported mime type", async () => {
    await expect(
      extractDocumentText(buf, "text/plain", stub({})),
    ).rejects.toMatchObject({ code: "unsupported_type" });
  });

  it("flags an empty extraction (scanned/no text layer)", async () => {
    await expect(
      extractDocumentText(buf, PDF, stub({ pdfText: "   " })),
    ).rejects.toMatchObject({ code: "no_text_extracted" });
  });

  it("wraps a parser failure as parse_failed", async () => {
    const err = await extractDocumentText(buf, PDF, stub({ throwIn: "pdf" })).catch(
      (e) => e,
    );
    expect(err).toBeInstanceOf(DocumentExtractError);
    expect(err.code).toBe("parse_failed");
  });

  it("rejects text over the extracted-char cap", async () => {
    const big = "가".repeat(MAX_EXTRACTED_CHARS + 1);
    await expect(
      extractDocumentText(buf, PDF, stub({ pdfText: big })),
    ).rejects.toMatchObject({ code: "parse_failed" });
  });
});

describe("mime helpers", () => {
  it("isParseableMime recognizes pdf/docx only", () => {
    expect(isParseableMime(PDF)).toBe(true);
    expect(isParseableMime(DOCX)).toBe(true);
    expect(isParseableMime("text/plain")).toBe(false);
    expect(isParseableMime("application/vnd.ms-excel")).toBe(false);
  });

  it("inferMimeFromFilename maps extensions", () => {
    expect(inferMimeFromFilename("report.PDF")).toBe(PDF);
    expect(inferMimeFromFilename("memo.docx")).toBe(DOCX);
    expect(inferMimeFromFilename("notes.txt")).toBeUndefined();
  });
});
