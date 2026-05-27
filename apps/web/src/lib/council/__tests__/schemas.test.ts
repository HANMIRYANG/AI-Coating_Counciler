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
