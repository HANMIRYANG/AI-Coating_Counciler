import { describe, it, expect } from "vitest";
import {
  CreateSessionRequestSchema,
  FinalAnswerSchema,
  ProviderOpinionSchema,
} from "../schemas";

describe("Zod schema validation", () => {
  it("accepts a valid ProviderOpinion and rejects bad shapes", () => {
    const good = ProviderOpinionSchema.safeParse({
      providerId: "openai",
      summary: "ok",
    });
    expect(good.success).toBe(true);

    const bad = ProviderOpinionSchema.safeParse({
      providerId: "claude", // not a permitted ProviderId
      summary: "ok",
    });
    expect(bad.success).toBe(false);
  });

  it("FinalAnswerSchema requires conclusion + business answer", () => {
    const r = FinalAnswerSchema.safeParse({
      conclusion: "",
      finalMarkdown: "x",
      businessReadyAnswer: "y",
    });
    expect(r.success).toBe(false);
  });

  it("FinalAnswer without the Step 10 evidence-usage fields still parses (defaults applied)", () => {
    const r = FinalAnswerSchema.safeParse({
      conclusion: "결론",
      finalMarkdown: "본문",
      businessReadyAnswer: "발송용",
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.evidenceUsed).toEqual([]);
      expect(r.data.coveredClaims).toEqual([]);
      expect(r.data.uncoveredClaims).toEqual([]);
      expect(r.data.evidenceCoverageStatus).toBe("not_requested");
    }
  });

  it("FinalAnswer accepts populated Step 10 evidence-usage fields", () => {
    const r = FinalAnswerSchema.safeParse({
      conclusion: "결론",
      finalMarkdown: "본문",
      businessReadyAnswer: "발송용",
      evidenceUsed: [
        {
          chunkId: "c1",
          filename: "report.md",
          chunkIndex: 0,
          trustLevel: "uploaded_copy",
          verificationStatus: "auto_extracted",
        },
      ],
      coveredClaims: [{ claim: "방오 성능 검토 가능", evidenceChunkIds: ["c1"] }],
      uncoveredClaims: ["장기 신뢰성 데이터"],
      evidenceCoverageStatus: "partial",
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.evidenceUsed).toHaveLength(1);
      expect(r.data.coveredClaims[0].evidenceChunkIds).toEqual(["c1"]);
      expect(r.data.evidenceCoverageStatus).toBe("partial");
    }
  });

  it("FinalAnswer rejects an invalid evidenceCoverageStatus", () => {
    const r = FinalAnswerSchema.safeParse({
      conclusion: "결론",
      finalMarkdown: "본문",
      businessReadyAnswer: "발송용",
      evidenceCoverageStatus: "totally_sufficient",
    });
    expect(r.success).toBe(false);
  });

  it("CreateSessionRequestSchema requires a non-empty prompt + valid taskType", () => {
    const ok = CreateSessionRequestSchema.safeParse({
      prompt: "안녕하세요. 검토 요청드립니다.",
      taskType: "technical_review",
    });
    expect(ok.success).toBe(true);

    const bad = CreateSessionRequestSchema.safeParse({
      prompt: "",
      taskType: "something_invalid",
    });
    expect(bad.success).toBe(false);
  });
});
