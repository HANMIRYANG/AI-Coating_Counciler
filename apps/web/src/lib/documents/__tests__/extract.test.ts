import { describe, it, expect } from "vitest";
import {
  DocumentExtractError,
  MAX_EXTRACTED_CHARS,
  extractDocumentText,
  extractDocumentTextWithOcrFallback,
  extractErrorToStatus,
  inferMimeFromFilename,
  isParseableMime,
  type Extractors,
} from "../extract";
import { DocumentOcrError, type OcrEngine } from "../ocr";

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

const ocr = (text: string): OcrEngine => async () => ({
  text,
  pageCount: 2,
  provider: "google_document_ai",
});

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

describe("extractDocumentTextWithOcrFallback", () => {
  it("keeps text-layer PDF extraction as the first path", async () => {
    let ocrCalled = false;
    const r = await extractDocumentTextWithOcrFallback(buf, PDF, {
      extractors: stub({ pdfText: "text layer", pdfPages: 1 }),
      ocr: async () => {
        ocrCalled = true;
        return { text: "ocr", provider: "google_document_ai" };
      },
    });
    expect(r.text).toBe("text layer");
    expect(r.extractionMethod).toBe("text_layer");
    expect(ocrCalled).toBe(false);
  });

  it("falls back to OCR when a PDF has no text layer", async () => {
    const r = await extractDocumentTextWithOcrFallback(buf, PDF, {
      extractors: stub({ pdfText: "   " }),
      ocr: ocr("OCR 본문"),
    });
    expect(r.text).toBe("OCR 본문");
    expect(r.kind).toBe("pdf");
    expect(r.pageCount).toBe(2);
    expect(r.extractionMethod).toBe("ocr");
    expect(r.ocrProvider).toBe("google_document_ai");
  });

  it("runs OCR directly for supported images", async () => {
    const r = await extractDocumentTextWithOcrFallback(buf, "image/png", {
      extractors: stub({}),
      ocr: ocr("이미지 OCR"),
    });
    expect(r.kind).toBe("image");
    expect(r.text).toBe("이미지 OCR");
    expect(r.extractionMethod).toBe("ocr");
  });

  it("maps disabled OCR to ocr_unavailable", async () => {
    const err = await extractDocumentTextWithOcrFallback(buf, PDF, {
      extractors: stub({ pdfText: "" }),
      ocr: async () => {
        throw new DocumentOcrError("disabled", "disabled");
      },
    }).catch((e) => e);
    expect(err).toBeInstanceOf(DocumentExtractError);
    expect(err.code).toBe("ocr_unavailable");
  });
});

describe("extractErrorToStatus", () => {
  it("maps every error code to the shared HTTP status", () => {
    expect(extractErrorToStatus("unsupported_type")).toBe(415);
    expect(extractErrorToStatus("ocr_unavailable")).toBe(503);
    expect(extractErrorToStatus("ocr_failed")).toBe(502);
    expect(extractErrorToStatus("no_text_extracted")).toBe(422);
    expect(extractErrorToStatus("parse_failed")).toBe(422);
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
    expect(inferMimeFromFilename("scan.PNG")).toBe("image/png");
    expect(inferMimeFromFilename("notes.txt")).toBeUndefined();
  });
});
