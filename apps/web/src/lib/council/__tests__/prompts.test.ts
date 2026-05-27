// Robust JSON extraction tests — covers the scenarios called out in the
// follow-up review (malformed JSON → JsonParseError, prose + fenced JSON
// success, multiple fences with only the later one being JSON).

import { describe, it, expect } from "vitest";
import {
  buildCritiqueMessages,
  buildInitialOpinionMessages,
  buildSynthesisMessages,
  extractJsonObject,
  JsonParseError,
  taskTypeGuidance,
} from "../prompts";
import type {
  CritiqueInput,
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
