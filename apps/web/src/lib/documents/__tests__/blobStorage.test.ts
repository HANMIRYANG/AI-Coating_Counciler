import { describe, it, expect } from "vitest";

import {
  buildOriginalBlobPathname,
  isSupportedOriginalMime,
  MAX_ORIGINAL_BLOB_BYTES,
  toOriginalBlobMetadata,
  validateOriginalUpload,
} from "../blobStorage";

describe("buildOriginalBlobPathname", () => {
  it("namespaces under documents/originals and sanitizes the basename", () => {
    expect(buildOriginalBlobPathname("KCL Report 2024.PDF")).toBe(
      "documents/originals/kcl-report-2024.pdf",
    );
  });

  it("strips any directory components", () => {
    expect(buildOriginalBlobPathname("C:\\uploads\\spec final.docx")).toBe(
      "documents/originals/spec-final.docx",
    );
    expect(buildOriginalBlobPathname("/tmp/a/b/report.pdf")).toBe(
      "documents/originals/report.pdf",
    );
  });

  it("trims leading/trailing separators and falls back when empty", () => {
    expect(buildOriginalBlobPathname("---")).toBe(
      "documents/originals/original",
    );
  });

  it("is deterministic", () => {
    expect(buildOriginalBlobPathname("a b.pdf")).toBe(
      buildOriginalBlobPathname("a b.pdf"),
    );
  });
});

describe("isSupportedOriginalMime", () => {
  it("accepts pdf / docx / images / text", () => {
    expect(isSupportedOriginalMime("application/pdf")).toBe(true);
    expect(
      isSupportedOriginalMime(
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ),
    ).toBe(true);
    expect(isSupportedOriginalMime("image/png")).toBe(true);
    expect(isSupportedOriginalMime("text/markdown")).toBe(true);
  });

  it("rejects unknown types", () => {
    expect(isSupportedOriginalMime("application/x-msdownload")).toBe(false);
    expect(isSupportedOriginalMime("video/mp4")).toBe(false);
  });
});

describe("validateOriginalUpload", () => {
  const good = JSON.stringify({
    filename: "report.pdf",
    contentType: "application/pdf",
    sizeBytes: 1_000_000,
  });

  it("accepts a valid descriptor", () => {
    const r = validateOriginalUpload(good);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.descriptor.filename).toBe("report.pdf");
  });

  it("rejects a missing payload", () => {
    expect(validateOriginalUpload(null).ok).toBe(false);
    expect(validateOriginalUpload(undefined).ok).toBe(false);
    expect(validateOriginalUpload("").ok).toBe(false);
  });

  it("rejects non-JSON and malformed shapes", () => {
    expect(validateOriginalUpload("{not json").ok).toBe(false);
    expect(
      validateOriginalUpload(JSON.stringify({ filename: "x" })).ok,
    ).toBe(false);
  });

  it("rejects an unsupported content type", () => {
    const r = validateOriginalUpload(
      JSON.stringify({
        filename: "a.exe",
        contentType: "application/x-msdownload",
        sizeBytes: 10,
      }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/unsupported/i);
  });

  it("rejects an oversize upload", () => {
    const r = validateOriginalUpload(
      JSON.stringify({
        filename: "big.pdf",
        contentType: "application/pdf",
        sizeBytes: MAX_ORIGINAL_BLOB_BYTES + 1,
      }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/max original size/i);
  });

  it("rejects a non-positive size", () => {
    expect(
      validateOriginalUpload(
        JSON.stringify({
          filename: "z.pdf",
          contentType: "application/pdf",
          sizeBytes: 0,
        }),
      ).ok,
    ).toBe(false);
  });
});

describe("toOriginalBlobMetadata", () => {
  it("maps a completed upload into the persisted shape", () => {
    const uploadedAt = new Date(1_700_000_000_000);
    expect(
      toOriginalBlobMetadata({
        url: "https://blob.vercel-storage.com/documents/originals/report-abc.pdf",
        pathname: "documents/originals/report-abc.pdf",
        contentType: "application/pdf",
        sizeBytes: 1234,
        uploadedAt,
      }),
    ).toEqual({
      originalBlobUrl:
        "https://blob.vercel-storage.com/documents/originals/report-abc.pdf",
      originalBlobPath: "documents/originals/report-abc.pdf",
      originalBlobSizeBytes: 1234,
      originalBlobContentType: "application/pdf",
      originalUploadedAt: uploadedAt,
    });
  });
});
