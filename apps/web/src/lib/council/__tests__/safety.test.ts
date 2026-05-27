import { describe, it, expect } from "vitest";
import { computeRiskLevel, detectUnsafePhrases } from "../safety";

describe("detectUnsafePhrases", () => {
  it("flags 단정/과장 표현 in Korean text", () => {
    const findings = detectUnsafePhrases(
      "이 코팅제는 배터리 화재를 완전 방지하며 100% 안전합니다. 인증 완료.",
    );
    const matched = findings.map((f) => f.matchedText);
    expect(matched).toEqual(
      expect.arrayContaining(["완전 방지", "100% 안전", "인증 완료"]),
    );
  });

  it("returns empty array for safe text", () => {
    const findings = detectUnsafePhrases(
      "특정 시험 조건에서 화염 확산 지연 가능성이 있으며 추가 시험이 필요합니다.",
    );
    expect(findings).toEqual([]);
  });

  it("tolerates inserted whitespace inside the phrase", () => {
    const findings = detectUnsafePhrases("100   % 안전 표현 검출 필요");
    expect(findings.some((f) => /100/.test(f.matchedText))).toBe(true);
  });
});

describe("computeRiskLevel", () => {
  it("returns critical when fire/cert claim combines with absolute wording", () => {
    const text = "화재 완전 방지 100% 안전";
    const findings = detectUnsafePhrases(text);
    expect(
      computeRiskLevel({
        unsafePhrases: findings,
        missingEvidence: [],
        taskType: "technical_review",
        text,
      }),
    ).toBe("critical");
  });

  it("returns high when fire/cert wording is present alone", () => {
    const findings = detectUnsafePhrases("인증 완료");
    expect(
      computeRiskLevel({
        unsafePhrases: findings,
        missingEvidence: [],
        taskType: "technical_review",
      }),
    ).toBe("high");
  });

  it("returns low when no unsafe phrases and few missing fields", () => {
    expect(
      computeRiskLevel({
        unsafePhrases: [],
        missingEvidence: ["시험성적서"],
        taskType: "technical_review",
      }),
    ).toBe("low");
  });
});
