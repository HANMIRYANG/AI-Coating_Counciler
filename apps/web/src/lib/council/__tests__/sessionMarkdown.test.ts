import { describe, it, expect } from "vitest";

import {
  buildSessionMarkdown,
  sessionMarkdownFilename,
  type ExportableSession,
} from "../sessionMarkdown";
import { FinalAnswerSchema, type FinalAnswer } from "../schemas";

function finalAnswer(over: Partial<FinalAnswer> = {}): FinalAnswer {
  return FinalAnswerSchema.parse({
    conclusion: "조건부 적용 가능",
    finalMarkdown: "# 결론",
    businessReadyAnswer: "업체 발송용 본문입니다.",
    internalMemo: "내부 검토 메모입니다.",
    evidenceBackedClaims: ["근거 주장 1"],
    assumptions: ["가정 1"],
    missingEvidence: ["최신 시험성적서"],
    unsafePhrases: [
      { phrase: "완전 차단", reason: "단정 표현", recommended: "조건부 차단" },
    ],
    recommendedSafeWording: ["조건부 차단 가능성"],
    providerSummary: [
      { providerId: "openai", status: "succeeded", latencyMs: 1500 },
      { providerId: "gemini", status: "timed_out" },
    ],
    evidenceUsed: [
      {
        chunkId: "chunk_SECRET",
        filename: "kcl-report.md",
        chunkIndex: 0,
        trustLevel: "uploaded_copy",
        verificationStatus: "auto_extracted",
      },
    ],
    coveredClaims: [{ claim: "방오 성능 검토 가능", evidenceChunkIds: ["chunk_SECRET"] }],
    uncoveredClaims: ["장기 신뢰성 데이터"],
    evidenceCoverageStatus: "partial",
    ...over,
  });
}

function session(over: Partial<ExportableSession> = {}): ExportableSession {
  return {
    id: "cs_abc123",
    userPrompt: "방오 코팅 적용 검토 요청",
    taskType: "technical_review",
    evidenceMode: "internal_docs",
    status: "completed",
    finalAnswer: finalAnswer(),
    ...over,
  };
}

describe("buildSessionMarkdown", () => {
  const md = buildSessionMarkdown(session());

  it("includes the session header fields", () => {
    expect(md).toContain("# 기술검토 세션 내보내기");
    expect(md).toContain("- 세션 ID: cs_abc123");
    expect(md).toContain("- 작업 유형: technical_review");
    expect(md).toContain("- 근거 모드: internal_docs");
    expect(md).toContain("- 상태: completed");
  });

  it("includes prompt, conclusion, business answer, and internal memo", () => {
    expect(md).toContain("## 사용자 질문");
    expect(md).toContain("방오 코팅 적용 검토 요청");
    expect(md).toContain("## 최종 결론");
    expect(md).toContain("조건부 적용 가능");
    expect(md).toContain("## 업체 발송용 답변");
    expect(md).toContain("업체 발송용 본문입니다.");
    expect(md).toContain("## 내부 검토 메모");
    expect(md).toContain("내부 검토 메모입니다.");
  });

  it("includes evidence-backed claims, assumptions, and missing evidence", () => {
    expect(md).toContain("## 근거 있는 주장");
    expect(md).toContain("- 근거 주장 1");
    expect(md).toContain("## 추정 / 가정");
    expect(md).toContain("- 가정 1");
    expect(md).toContain("## 누락 근거");
    expect(md).toContain("- 최신 시험성적서");
  });

  it("includes unsafe phrases with reason and recommendation", () => {
    expect(md).toContain("## 위험 표현");
    expect(md).toContain('- "완전 차단" — 사유: 단정 표현 · 권장: 조건부 차단');
    expect(md).toContain("## 권장 안전 표현");
    expect(md).toContain("- 조건부 차단 가능성");
  });

  it("includes the evidence coverage contract", () => {
    expect(md).toContain("## 근거 커버리지");
    expect(md).toContain("- 상태: partial");
    expect(md).toContain("### 사용된 근거");
    expect(md).toContain(
      "- kcl-report.md #0 · 신뢰수준 uploaded_copy · auto_extracted",
    );
    expect(md).toContain("### 근거 연결 주장");
    expect(md).toContain("- 방오 성능 검토 가능 (근거 1건)");
    expect(md).toContain("### 근거 부족 항목");
    expect(md).toContain("- 장기 신뢰성 데이터");
  });

  it("includes a provider summary (status + latency, no raw responses)", () => {
    expect(md).toContain("## Provider 요약");
    expect(md).toContain("- openai: succeeded (1500ms)");
    expect(md).toContain("- gemini: timed_out");
  });

  it("excludes raw / debug / internal payloads", () => {
    expect(md).not.toMatch(/rawResponse|parsedResponse/i);
    expect(md).not.toContain("attempts");
    // chunk id is internal — the coverage refs show filename/index, not ids.
    expect(md).not.toContain("chunk_SECRET");
    expect(md).not.toMatch(/snippet|chunk 본문/);
  });

  it("renders 없음 for empty list sections", () => {
    const empty = buildSessionMarkdown(
      session({
        finalAnswer: finalAnswer({
          evidenceBackedClaims: [],
          missingEvidence: [],
          unsafePhrases: [],
          evidenceUsed: [],
          coveredClaims: [],
          uncoveredClaims: [],
        }),
      }),
    );
    expect(empty).toContain("## 근거 있는 주장\n\n- 없음");
  });

  it("is byte-for-byte deterministic", () => {
    expect(buildSessionMarkdown(session())).toBe(buildSessionMarkdown(session()));
  });

  it("renders the retrieval guard section when present", () => {
    const withGuard = buildSessionMarkdown(
      session({
        finalAnswer: finalAnswer({
          retrievalGuard: {
            guardStatus: "blocked",
            reasons: ["내부 문서 근거가 검색되지 않았습니다."],
            requiredEvidence: true,
            businessCitationReady: false,
            recommendedAction: "업체 발송 금지. 근거 문서를 확보하세요.",
          },
        }),
      }),
    );
    expect(withGuard).toContain("### 근거 가드 (Retrieval Guard)");
    expect(withGuard).toContain("- 상태: blocked");
    expect(withGuard).toContain("- 업체 발송 가능: 아니오");
    expect(withGuard).toContain("- 권장 조치: 업체 발송 금지. 근거 문서를 확보하세요.");
    expect(withGuard).toContain("  - 내부 문서 근거가 검색되지 않았습니다.");
  });

  it("omits the guard section when absent (backward compatible)", () => {
    expect(buildSessionMarkdown(session())).not.toContain("근거 가드");
  });

  it("renders a Verified Citations section with labeled claim→evidence", () => {
    // Default fixture: one covered claim backed by kcl-report.md #0, one
    // uncovered claim, and no retrievalGuard → citation not ready.
    expect(md).toContain("## 검증된 인용 (Verified Citations)");
    expect(md).toContain("- 인용 준비 상태: 검토 필요");
    expect(md).toContain(
      "- [C1] 방오 성능 검토 가능 — 근거: kcl-report.md#0 (신뢰수준 uploaded_copy · auto_extracted)",
    );
    expect(md).toContain("### 근거 미연결 주장");
    expect(md).toContain("- 장기 신뢰성 데이터");
    // Still no internal chunk id leaked.
    expect(md).not.toContain("chunk_SECRET");
  });

  it("marks citations ready when the guard is business-ready", () => {
    const ready = buildSessionMarkdown(
      session({
        finalAnswer: finalAnswer({
          evidenceCoverageStatus: "sufficient",
          uncoveredClaims: [],
          retrievalGuard: {
            guardStatus: "passed",
            reasons: [],
            requiredEvidence: true,
            businessCitationReady: true,
            recommendedAction: "발송 가능",
          },
        }),
      }),
    );
    expect(ready).toContain("- 인용 준비 상태: 가능");
  });

  it("omits the citations section when there are no claims (backward compatible)", () => {
    const empty = buildSessionMarkdown(
      session({
        finalAnswer: finalAnswer({ coveredClaims: [], uncoveredClaims: [] }),
      }),
    );
    expect(empty).not.toContain("검증된 인용");
  });
});

describe("sessionMarkdownFilename", () => {
  it("derives a filename from the session id", () => {
    expect(sessionMarkdownFilename("cs_abc123")).toBe(
      "council-session-cs_abc123.md",
    );
  });
});
