import { describe, it, expect } from "vitest";
import {
  CreateDocumentRequestSchema,
  DocumentMetadataSchema,
  KNOWN_UNSUPPORTED_DOCUMENT_MIMES,
  MAX_DOCUMENT_BYTES,
  SupportedDocumentMimeSchema,
  isKnownUnsupportedMime,
} from "../schemas";

describe("documents/schemas", () => {
  it("accepts text/plain and text/markdown via SupportedDocumentMimeSchema", () => {
    expect(SupportedDocumentMimeSchema.safeParse("text/plain").success).toBe(
      true,
    );
    expect(SupportedDocumentMimeSchema.safeParse("text/markdown").success).toBe(
      true,
    );
  });

  it("rejects binary / image mime types", () => {
    for (const mime of KNOWN_UNSUPPORTED_DOCUMENT_MIMES) {
      const result = SupportedDocumentMimeSchema.safeParse(mime);
      expect(result.success).toBe(false);
      expect(isKnownUnsupportedMime(mime)).toBe(true);
    }
  });

  it("isKnownUnsupportedMime returns false for an unknown random string", () => {
    expect(isKnownUnsupportedMime("text/plain")).toBe(false);
    expect(isKnownUnsupportedMime("application/unknown-format")).toBe(false);
  });

  it("CreateDocumentRequest accepts a minimal valid payload", () => {
    const parsed = CreateDocumentRequestSchema.safeParse({
      filename: "tds.txt",
      mimeType: "text/plain",
      content: "방오 코팅 기술 데이터 시트 본문.",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.filename).toBe("tds.txt");
      // originalName is optional — service layer defaults to filename.
      expect(parsed.data.originalName).toBeUndefined();
    }
  });

  it("CreateDocumentRequest accepts a full payload with rich metadata", () => {
    const parsed = CreateDocumentRequestSchema.safeParse({
      filename: "report.md",
      originalName: "KCL-2024-001-report.md",
      mimeType: "text/markdown",
      content: "# 시험성적서\n\n결과 요약 본문.",
      category: "test_report",
      version: "v1",
      metadata: {
        productName: "HE-850A",
        documentType: "test_report",
        issuer: "KCL",
        testMethod: "KS F 2271",
        substrate: "강판",
        coatingThickness: "120 μm",
      },
    });
    expect(parsed.success).toBe(true);
  });

  it("CreateDocumentRequest rejects empty content", () => {
    const parsed = CreateDocumentRequestSchema.safeParse({
      filename: "a.txt",
      mimeType: "text/plain",
      content: "",
    });
    expect(parsed.success).toBe(false);
  });

  it("CreateDocumentRequest rejects ASCII content whose byte length exceeds 256KB", () => {
    // ASCII byte length == JS length, so the cap fires the moment we
    // cross MAX_DOCUMENT_BYTES.
    const tooBig = "x".repeat(MAX_DOCUMENT_BYTES + 1);
    expect(Buffer.byteLength(tooBig, "utf8")).toBe(MAX_DOCUMENT_BYTES + 1);
    const parsed = CreateDocumentRequestSchema.safeParse({
      filename: "a.txt",
      mimeType: "text/plain",
      content: tooBig,
    });
    expect(parsed.success).toBe(false);
  });

  it("CreateDocumentRequest rejects multibyte (Korean) content whose JS length is under the cap but UTF-8 byte length exceeds it", () => {
    // Each Hangul syllable is 1 UTF-16 code unit but 3 UTF-8 bytes. With
    // 87_400 chars: JS length 87_400 (way under cap), UTF-8 bytes 262_200
    // (over the 262_144 cap). This is exactly the case the old
    // `.max(string)` validator missed.
    const koreanChar = "가";
    const content = koreanChar.repeat(87_400);
    expect(content.length).toBeLessThanOrEqual(MAX_DOCUMENT_BYTES);
    expect(Buffer.byteLength(content, "utf8")).toBeGreaterThan(
      MAX_DOCUMENT_BYTES,
    );

    const parsed = CreateDocumentRequestSchema.safeParse({
      filename: "k.txt",
      mimeType: "text/plain",
      content,
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      const message = parsed.error.issues.map((i) => i.message).join(" | ");
      expect(message).toMatch(/utf8|byte/i);
    }
  });

  it("CreateDocumentRequest accepts a small text payload comfortably under the byte cap", () => {
    const content = "방오 코팅 적용 검토 메모.";
    expect(Buffer.byteLength(content, "utf8")).toBeLessThan(MAX_DOCUMENT_BYTES);
    const parsed = CreateDocumentRequestSchema.safeParse({
      filename: "ok.txt",
      mimeType: "text/plain",
      content,
    });
    expect(parsed.success).toBe(true);
  });

  it("CreateDocumentRequest rejects unsupported mime types", () => {
    const parsed = CreateDocumentRequestSchema.safeParse({
      filename: "a.pdf",
      mimeType: "application/pdf",
      content: "irrelevant",
    });
    expect(parsed.success).toBe(false);
  });

  it("CreateDocumentRequest preserves validated metadata and strips unknown keys", () => {
    // Proves metadata survives schema validation intact (the values the
    // service persists) while unknown keys are dropped before they could
    // reach the metadata column.
    const parsed = CreateDocumentRequestSchema.safeParse({
      filename: "report.md",
      mimeType: "text/markdown",
      content: "# 시험성적서\n\n결과.",
      metadata: {
        productName: "HE-850A",
        documentType: "test_report",
        issuer: "KCL",
        testMethod: "KS F 2271",
        substrate: "강판",
        coatingThickness: "120 μm",
        legacyField: "should be dropped",
      },
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.metadata).toEqual({
        productName: "HE-850A",
        documentType: "test_report",
        issuer: "KCL",
        testMethod: "KS F 2271",
        substrate: "강판",
        coatingThickness: "120 μm",
      });
      expect(parsed.data.metadata).not.toHaveProperty("legacyField");
    }
  });

  it("DocumentMetadata ignores extra unknown fields", () => {
    // By default Zod strips unknown keys; we rely on that so a caller
    // including an old field doesn't break.
    const parsed = DocumentMetadataSchema.safeParse({
      productName: "HE-850A",
      unknownField: "ignored",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data).not.toHaveProperty("unknownField");
    }
  });
});
