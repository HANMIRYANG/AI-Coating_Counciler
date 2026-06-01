import { describe, it, expect } from "vitest";
import {
  externalPreviewCandidate,
  withExternalCandidates,
  notRequestedPreview,
  type SessionEvidencePreview,
} from "../evidencePreview";

describe("externalPreviewCandidate", () => {
  it("maps a fetched source into an external candidate", () => {
    const c = externalPreviewCandidate({
      url: "https://www.kcl.re.kr/x",
      title: "KCL 난연 시험",
      snippet: "도포 두께 100㎛ 결과",
      trustLevel: "official_public_page",
    });
    expect(c.sourceType).toBe("external_url");
    expect(c.url).toBe("https://www.kcl.re.kr/x");
    expect(c.filename).toBe("KCL 난연 시험");
    expect(c.trustLevel).toBe("official_public_page");
    expect(c.verificationStatus).toBe("auto_extracted");
  });

  it("falls back to the URL when there is no title", () => {
    const c = externalPreviewCandidate({
      url: "https://ul.com/x",
      title: "",
      snippet: "s",
      trustLevel: "official_public_page",
    });
    expect(c.filename).toBe("https://ul.com/x");
  });
});

describe("withExternalCandidates", () => {
  const base: SessionEvidencePreview = {
    mode: "internal_docs_web",
    retrievalStatus: "no_matches",
    count: 0,
    candidates: [],
  };

  it("returns the base unchanged when there are no external candidates", () => {
    expect(withExternalCandidates(base, [])).toBe(base);
  });

  it("merges external candidates ahead and forces status ok", () => {
    const ext = externalPreviewCandidate({
      url: "https://law.go.kr/x",
      title: "법령",
      snippet: "조문",
      trustLevel: "official_registry",
    });
    const merged = withExternalCandidates(base, [ext]);
    expect(merged.retrievalStatus).toBe("ok");
    expect(merged.count).toBe(1);
    expect(merged.candidates[0].sourceType).toBe("external_url");
  });

  it("keeps external candidates before internal ones and sums the count", () => {
    const internalBase: SessionEvidencePreview = {
      mode: "internal_docs_web",
      retrievalStatus: "ok",
      count: 2,
      candidates: [
        {
          documentId: "d1",
          filename: "report.md",
          chunkId: "c1",
          chunkIndex: 0,
          snippet: "내부",
          metadata: null,
          score: 10,
          trustLevel: "uploaded_copy",
          verificationStatus: "auto_extracted",
          sourceType: "internal_document",
        },
      ],
    };
    const ext = externalPreviewCandidate({
      url: "https://ul.com/x",
      title: "UL",
      snippet: "ul",
      trustLevel: "official_public_page",
    });
    const merged = withExternalCandidates(internalBase, [ext]);
    expect(merged.count).toBe(3);
    expect(merged.candidates[0].sourceType).toBe("external_url");
    expect(merged.candidates[1].sourceType).toBe("internal_document");
  });

  it("type-checks against a not_requested base too", () => {
    const merged = withExternalCandidates(notRequestedPreview("ai_only"), []);
    expect(merged.retrievalStatus).toBe("not_requested");
  });
});
