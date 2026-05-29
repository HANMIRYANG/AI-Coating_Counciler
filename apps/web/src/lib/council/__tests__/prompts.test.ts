// Robust JSON extraction tests — covers the scenarios called out in the
// follow-up review (malformed JSON → JsonParseError, prose + fenced JSON
// success, multiple fences with only the later one being JSON).

import { describe, it, expect } from "vitest";
import {
  buildCritiqueMessages,
  buildInitialOpinionMessages,
  buildSynthesisMessages,
  extractJsonObject,
  formatEvidenceContextBlock,
  JsonParseError,
  taskTypeGuidance,
} from "../prompts";
import type {
  CritiqueInput,
  EvidenceContext,
  InitialOpinionInput,
  SynthesisInput,
  TaskType,
} from "../types";

function initial(taskType: TaskType): InitialOpinionInput {
  return {
    userPrompt: "테스트 입력",
    taskType,
    evidenceMode: "ai_only",
    domainSafetyPolicySummary: "테스트",
  };
}

function critiqueInput(taskType: TaskType): CritiqueInput {
  return {
    userPrompt: "테스트 입력",
    taskType,
    opinions: [],
    knownDangerousPhrases: [],
  };
}

function synthesisInput(taskType: TaskType): SynthesisInput {
  return {
    userPrompt: "테스트 입력",
    taskType,
    opinions: [],
    critiques: [],
    knownDangerousPhrases: [],
  };
}

describe("extractJsonObject", () => {
  it("parses a plain JSON string", () => {
    const r = extractJsonObject('{"a": 1, "b": "two"}');
    expect(r.parsed).toEqual({ a: 1, b: "two" });
    expect(r.raw).toBe('{"a": 1, "b": "two"}');
  });

  it("parses JSON wrapped in prose with a ```json fence", () => {
    const text =
      "안녕하세요. 결과는 다음과 같습니다.\n\n```json\n{\"summary\": \"ok\", \"score\": 0.7}\n```\n감사합니다.";
    const r = extractJsonObject(text);
    expect(r.parsed).toEqual({ summary: "ok", score: 0.7 });
  });

  it("prefers a later JSON fence when the first fence is non-JSON", () => {
    const text =
      "참고용 예시:\n```\nplain text without braces\n```\n실제 응답:\n```json\n{\"x\": 42}\n```";
    const r = extractJsonObject(text);
    expect(r.parsed).toEqual({ x: 42 });
  });

  it("survives braces inside string values (string-aware brace balance)", () => {
    const text = '{"note": "this } looks like end but is not", "v": 1}';
    const r = extractJsonObject(text);
    expect(r.parsed).toEqual({
      note: "this } looks like end but is not",
      v: 1,
    });
  });

  it("survives escaped quotes inside strings", () => {
    const text = '{"q": "he said \\"hi\\" }", "v": 1}';
    const r = extractJsonObject(text);
    expect((r.parsed as { q: string }).q).toBe('he said "hi" }');
  });

  it("tolerates trailing commas before closing brace", () => {
    const r = extractJsonObject('{"a": 1, "b": 2,}');
    expect(r.parsed).toEqual({ a: 1, b: 2 });
  });

  it("throws JsonParseError for empty input", () => {
    expect(() => extractJsonObject("")).toThrow(JsonParseError);
    expect(() => extractJsonObject("   ")).toThrow(JsonParseError);
  });

  it("throws JsonParseError for malformed JSON and carries raw text", () => {
    const bad = "{ not json at all }";
    try {
      extractJsonObject(bad);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(JsonParseError);
      expect((err as JsonParseError).rawText).toBe(bad);
    }
  });

  it("throws JsonParseError when no '{' is present", () => {
    expect(() => extractJsonObject("just prose, no JSON")).toThrow(
      JsonParseError,
    );
  });

  it("returns the first balanced object even with trailing garbage", () => {
    const r = extractJsonObject('{"a": 1} then some prose afterwards');
    expect(r.parsed).toEqual({ a: 1 });
  });
});

// ─────────────────────────────────────────────────────────────────────
// Task-type-specific prompt guidance
// ─────────────────────────────────────────────────────────────────────

describe("taskTypeGuidance", () => {
  it("returns ideation-specific guidance for application_ideas", () => {
    const g = taskTypeGuidance("application_ideas");
    expect(g).toContain("application_ideas");
    expect(g).toContain("아이디어");
    // Ideation must surface 'next experiment' / required evidence / non-claimable.
    expect(g).toMatch(/다음 실험/);
    expect(g).toMatch(/missingEvidence/);
    // Safety rule: ideation must NOT make certified claims.
    expect(g).toMatch(/단정.*금지|단정 표현/);
  });

  it("returns test-report citation guidance for test_report_interpretation", () => {
    const g = taskTypeGuidance("test_report_interpretation");
    expect(g).toContain("test_report_interpretation");
    expect(g).toMatch(/시험 방법|test method/i);
    expect(g).toMatch(/시험 조건|test condition/i);
    expect(g).toMatch(/기재|substrate/i);
    expect(g).toMatch(/도포 두께|coating thickness/i);
    expect(g).toMatch(/인용/);
  });

  it("returns certification guidance for certification_checklist", () => {
    const g = taskTypeGuidance("certification_checklist");
    expect(g).toContain("certification_checklist");
    expect(g).toMatch(/체크리스트/);
    expect(g).toMatch(/누락|missing/i);
    expect(g).toMatch(/인증기관 확인 필요/);
  });

  it("explicitly handles the no-RAG limitation for document_based_answer", () => {
    const g = taskTypeGuidance("document_based_answer");
    expect(g).toContain("document_based_answer");
    expect(g).toMatch(/RAG/i);
    expect(g).toMatch(/문서가 업로드|검색되지 않/);
    expect(g).toMatch(/단정 표현|단정/);
  });

  it("returns conservative review guidance for technical_review", () => {
    const g = taskTypeGuidance("technical_review");
    expect(g).toContain("technical_review");
    expect(g).toMatch(/evidenceBackedClaims/);
    expect(g).toMatch(/assumptions/);
    expect(g).toMatch(/missingEvidence/);
  });
});

describe("prompt builders inject task-type guidance", () => {
  it("initial opinion prompt for application_ideas includes ideation guidance", () => {
    const { system } = buildInitialOpinionMessages(
      "test",
      initial("application_ideas"),
    );
    expect(system).toContain("application_ideas");
    expect(system).toMatch(/아이디어/);
  });

  it("initial opinion prompt for test_report_interpretation includes citation guidance", () => {
    const { system } = buildInitialOpinionMessages(
      "test",
      initial("test_report_interpretation"),
    );
    expect(system).toContain("test_report_interpretation");
    expect(system).toMatch(/시험 방법/);
    expect(system).toMatch(/시험 조건/);
  });

  it("initial opinion prompt for certification_checklist includes checklist guidance", () => {
    const { system } = buildInitialOpinionMessages(
      "test",
      initial("certification_checklist"),
    );
    expect(system).toContain("certification_checklist");
    expect(system).toMatch(/체크리스트/);
  });

  it("initial opinion prompt for document_based_answer flags the no-RAG limitation", () => {
    const { system } = buildInitialOpinionMessages(
      "test",
      initial("document_based_answer"),
    );
    expect(system).toContain("document_based_answer");
    expect(system).toMatch(/RAG/i);
    expect(system).toMatch(/업로드|검색되지 않/);
  });

  it("critique builder also carries task-type guidance", () => {
    const { system } = buildCritiqueMessages(
      "test",
      critiqueInput("application_ideas"),
    );
    expect(system).toContain("application_ideas");
  });

  it("synthesis builder also carries task-type guidance", () => {
    const { system } = buildSynthesisMessages(
      "test",
      synthesisInput("document_based_answer"),
    );
    expect(system).toContain("document_based_answer");
    expect(system).toMatch(/RAG/i);
  });

  it("ai_only initial prompt does NOT include an evidence block", () => {
    const { user, system } = buildInitialOpinionMessages(
      "test",
      initial("technical_review"),
    );
    expect(user).not.toMatch(/사내 문서 근거 컨텍스트/);
    expect(system).not.toMatch(/사내 문서 근거 컨텍스트/);
  });

  it("not_requested context omits the evidence block entirely", () => {
    expect(
      formatEvidenceContextBlock({
        mode: "ai_only",
        retrievalStatus: "not_requested",
        count: 0,
        candidates: [],
      }),
    ).toBe("");
  });
});

// ─────────────────────────────────────────────────────────────────────
// Step 8 — internal evidence context injection
// ─────────────────────────────────────────────────────────────────────

const okContext: EvidenceContext = {
  mode: "internal_docs",
  retrievalStatus: "ok",
  count: 3,
  candidates: [
    {
      documentId: "doc_SECRET_ID",
      filename: "kcl-report.md",
      chunkId: "chunk_SECRET_ID",
      chunkIndex: 2,
      snippet: "방오 코팅의 부착 성능 시험 결과 요약",
      metadata: { issuer: "KCL", documentType: "test_report", productName: "HE-850A" },
      score: 202,
      trustLevel: "uploaded_copy",
      verificationStatus: "auto_extracted",
    },
  ],
};

describe("formatEvidenceContextBlock — ok", () => {
  it("lists candidates with snippet, metadata, trust + verification", () => {
    const block = formatEvidenceContextBlock(okContext);
    expect(block).toMatch(/사내 문서 근거 컨텍스트/);
    expect(block).toMatch(/검색 상태: ok \(총 3건 중 1건 표시\)/);
    expect(block).toContain("kcl-report.md #2");
    expect(block).toContain("trust=uploaded_copy");
    expect(block).toContain("verification=auto_extracted");
    expect(block).toContain("issuer=KCL");
    expect(block).toContain("type=test_report");
    expect(block).toContain("방오 코팅의 부착 성능 시험 결과 요약");
  });

  it("does NOT leak internal identifiers or any full chunk body", () => {
    const block = formatEvidenceContextBlock(okContext);
    expect(block).not.toContain("doc_SECRET_ID");
    expect(block).not.toContain("chunk_SECRET_ID");
    expect(block).not.toMatch(/documentId|chunkId|content/);
  });

  it("instructs candidate-only usage and conservative classification", () => {
    const block = formatEvidenceContextBlock(okContext);
    expect(block).toMatch(/확정 증거가 아닙니다/);
    expect(block).toMatch(/assumptions 또는 missingEvidence/);
    expect(block).toMatch(/인증·성능·안전 단정 표현/);
  });

  it("is byte-for-byte deterministic", () => {
    expect(formatEvidenceContextBlock(okContext)).toBe(
      formatEvidenceContextBlock(okContext),
    );
  });
});

describe("formatEvidenceContextBlock — non-ok retrieval", () => {
  for (const status of ["no_matches", "unavailable", "failed"] as const) {
    it(`${status} instructs explicit missing-evidence handling`, () => {
      const block = formatEvidenceContextBlock({
        mode: "internal_docs",
        retrievalStatus: status,
        count: 0,
        candidates: [],
        errorMessage: "x",
      });
      expect(block).toMatch(new RegExp(`검색 상태: ${status}`));
      expect(block).toMatch(/missingEvidence에 "사내 문서 근거 부족/);
      expect(block).toMatch(/추가 문서 확보 필요/);
      // No candidate list / body when retrieval was not ok.
      expect(block).not.toMatch(/후보 목록:/);
    });
  }
});

describe("prompt builders inject the evidence block for internal_docs", () => {
  it("initial opinion includes the evidence block when context is ok", () => {
    const { user } = buildInitialOpinionMessages("test", {
      ...initial("document_based_answer"),
      evidenceContext: okContext,
    });
    expect(user).toMatch(/사내 문서 근거 컨텍스트/);
    expect(user).toContain("kcl-report.md #2");
    expect(user).not.toContain("doc_SECRET_ID");
  });

  it("critique includes the evidence block when context is ok", () => {
    const { user } = buildCritiqueMessages("test", {
      ...critiqueInput("technical_review"),
      evidenceContext: okContext,
    });
    expect(user).toMatch(/사내 문서 근거 컨텍스트/);
    expect(user).toContain("방오 코팅의 부착 성능");
  });

  it("synthesis includes the evidence block when context is ok", () => {
    const { user } = buildSynthesisMessages("test", {
      ...synthesisInput("technical_review"),
      evidenceContext: okContext,
    });
    expect(user).toMatch(/사내 문서 근거 컨텍스트/);
    expect(user).toContain("trust=uploaded_copy");
  });

  it("omits the block for ai_only (undefined context) across all builders", () => {
    const i = buildInitialOpinionMessages("t", initial("technical_review"));
    const c = buildCritiqueMessages("t", critiqueInput("technical_review"));
    const s = buildSynthesisMessages("t", synthesisInput("technical_review"));
    for (const { user } of [i, c, s]) {
      expect(user).not.toMatch(/사내 문서 근거 컨텍스트/);
    }
  });
});

describe("noop-guard for original suite tail", () => {
  it("safety rules apply across task types (JSON_RULES still inlined)", () => {
    // 단정/과장 표현 금지 line is part of JSON_RULES — must remain present
    // for every task type, including ideation.
    for (const t of [
      "application_ideas",
      "technical_review",
      "test_report_interpretation",
      "certification_checklist",
      "document_based_answer",
    ] as const) {
      const { system } = buildInitialOpinionMessages("test", initial(t));
      expect(system).toMatch(/단정·과장 표현을 사용하지 마세요|unsafePhrases/);
    }
  });
});
