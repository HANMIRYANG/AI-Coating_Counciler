import { describe, it, expect } from "vitest";

import {
  buildEvidencePreviewView,
  formatCandidateMetadata,
} from "../evidencePreviewView";
import type { SessionEvidencePreview } from "@/lib/council/evidencePreview";

function candidate(i: number): SessionEvidencePreview["candidates"][number] {
  return {
    documentId: `doc${i}`,
    filename: `report${i}.md`,
    chunkIndex: i,
    chunkId: `chunk${i}`,
    snippet: `…방오 코팅 결과 ${i}…`,
    metadata: { issuer: "KCL", documentType: "test_report", productName: "HE-850A" },
    score: 100 - i,
    trustLevel: "uploaded_copy",
    verificationStatus: "auto_extracted",
  };
}

describe("buildEvidencePreviewView — hidden states", () => {
  it("hides the panel for undefined preview (ai_only legacy)", () => {
    expect(buildEvidencePreviewView(undefined).visible).toBe(false);
    expect(buildEvidencePreviewView(null).visible).toBe(false);
  });

  it("hides the panel for not_requested (ai_only)", () => {
    const view = buildEvidencePreviewView({
      mode: "ai_only",
      retrievalStatus: "not_requested",
      count: 0,
      candidates: [],
    });
    expect(view.visible).toBe(false);
    expect(view.candidates).toEqual([]);
  });
});

describe("buildEvidencePreviewView — ok", () => {
  const preview: SessionEvidencePreview = {
    mode: "internal_docs",
    retrievalStatus: "ok",
    count: 4,
    candidates: [candidate(0), candidate(1)],
  };

  it("is visible, info-toned, and lists candidates", () => {
    const view = buildEvidencePreviewView(preview);
    expect(view.visible).toBe(true);
    expect(view.tone).toBe("info");
    expect(view.statusLabel).toBe("근거 검색됨");
    expect(view.summary).toBe("내부 문서 후보 4건 (표시 2건)");
    expect(view.showCandidates).toBe(true);
    expect(view.candidates).toHaveLength(2);
  });

  it("maps candidate fields into a display row without internal ids or bodies", () => {
    const [first] = buildEvidencePreviewView(preview).candidates;
    expect(first.title).toBe("report0.md #0");
    expect(first.snippet).toBe("…방오 코팅 결과 0…");
    expect(first.metaSummary).toContain("제품 HE-850A");
    expect(first.metaSummary).toContain("발급 KCL");
    expect(first.trustLevel).toBe("uploaded_copy");
    expect(first.verificationStatus).toBe("auto_extracted");
    // key is the chunkId but the rendered row exposes no documentId field.
    expect(first).not.toHaveProperty("documentId");
    expect(first).not.toHaveProperty("content");
  });
});

describe("buildEvidencePreviewView — no_matches", () => {
  it("shows a concise missing-evidence state with no candidates", () => {
    const view = buildEvidencePreviewView({
      mode: "internal_docs",
      retrievalStatus: "no_matches",
      count: 0,
      candidates: [],
    });
    expect(view.visible).toBe(true);
    expect(view.tone).toBe("muted");
    expect(view.showCandidates).toBe(false);
    expect(view.summary).toMatch(/검색 결과가 없습니다/);
    expect(view.note).toMatch(/추가 문서 확보/);
  });
});

describe("buildEvidencePreviewView — unavailable / failed", () => {
  for (const status of ["unavailable", "failed"] as const) {
    it(`${status} is warn-toned and surfaces the error message`, () => {
      const view = buildEvidencePreviewView({
        mode: "internal_docs",
        retrievalStatus: status,
        count: 0,
        candidates: [],
        errorMessage: "boom",
      });
      expect(view.visible).toBe(true);
      expect(view.tone).toBe("warn");
      expect(view.showCandidates).toBe(false);
      expect(view.errorMessage).toBe("boom");
      expect(view.note).toBeTruthy();
    });
  }
});

describe("formatCandidateMetadata", () => {
  it("joins present fields in a fixed order", () => {
    expect(
      formatCandidateMetadata({
        productName: "HE-850A",
        documentType: "test_report",
        issuer: "KCL",
      }),
    ).toBe("제품 HE-850A · 유형 test_report · 발급 KCL");
  });

  it("falls back to a neutral label when metadata is null or empty", () => {
    expect(formatCandidateMetadata(null)).toBe("메타데이터 없음");
    expect(formatCandidateMetadata({})).toBe("메타데이터 없음");
  });
});
