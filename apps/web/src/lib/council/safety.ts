// Domain safety policy for functional / special coatings & paints.
// See docs/12_domain_safety_policy.md and prompts/* for the source of truth.

import type { RiskLevel } from "./types";

export const UNSAFE_PHRASES_KO: string[] = [
  "완전 방지",
  "100% 안전",
  "100퍼센트 안전",
  "불에 타지 않음",
  "불에 안 탑니다",
  "화재를 막음",
  "화재를 막아",
  "폭발 방지",
  "열폭주 방지",
  "인증 완료",
  "법적으로 문제 없음",
  "모든 소재 적용 가능",
  "반영구적",
  "무조건 불연",
  "무조건 효과",
  "절대 안전",
  "영구 단열",
  "영구적 단열",
  "세계 최고",
  "업계 최고",
  "검증 완료",
  "완벽한 단열",
];

export const RECOMMENDED_SAFE_WORDINGS: Array<{
  unsafe: RegExp;
  safer: string;
}> = [
  {
    unsafe: /완전\s*방지|완벽한\s*단열|영구\s*단열/g,
    safer: "특정 시험 조건에서 확인 필요",
  },
  {
    unsafe: /100\s*%?\s*안전|100\s*퍼센트\s*안전|절대\s*안전/g,
    safer: "사용 환경 및 시험 조건에 따라 제한적으로 안전성 평가 가능",
  },
  {
    unsafe: /불에\s*타지\s*않(음|습니다)|무조건\s*불연/g,
    safer: "화염 확산 지연 가능성 (시험성적서 기준 표현 필요)",
  },
  {
    unsafe: /화재를\s*막(음|아|는)/g,
    safer: "특정 조건 하에서 화염 확산 지연에 기여할 수 있음",
  },
  {
    unsafe: /폭발\s*방지|열폭주\s*방지/g,
    safer: "셀 단위 열 전파 지연 가능성 (시험 조건 명시 필요)",
  },
  {
    unsafe: /인증\s*완료|법적으로\s*문제\s*없음/g,
    safer: "인증기관 확인 필요 / 시험성적서 확보 후 표현 가능",
  },
  {
    unsafe: /모든\s*소재\s*적용\s*가능/g,
    safer: "기재별 호환성 시험 필요",
  },
  {
    unsafe: /반영구적/g,
    safer: "도포 조건 및 사용 환경에 따라 성능 상이",
  },
  {
    unsafe: /업계\s*최고|세계\s*최고/g,
    safer: "동급 제품 대비 우수 가능성 (비교 조건 명시 필요)",
  },
  {
    unsafe: /검증\s*완료/g,
    safer: "내부 시험 기준으로 확인됨 (제3자 검증 별도 필요)",
  },
];

export const REQUIRED_EVIDENCE_KEYS = [
  "시험성적서",
  "시험 방법",
  "시험 조건",
  "기재 종류",
  "도포 두께",
  "건조/경화 조건",
  "SDS/MSDS",
  "TDS",
  "인증서",
  "사용 환경",
] as const;

export const FINAL_ANSWER_DISCLAIMER_KO = `본 답변은 현재 제공된 자료와 AI 검토를 기반으로 한 기술 검토 초안입니다.
인증, 법령, 화학안전, 성능 보증, 광고 문구로 사용하기 전에는 시험기관/인증기관/전문가 검토가 필요합니다.`;

export const DOMAIN_SAFETY_POLICY_SUMMARY = `당신은 한국 기능성 특수 페인트/코팅제 분야의 기술검토 보조자입니다.

다음 사항을 반드시 지키세요.
1. 불연·난연·화재방지·폭발방지·인증·법령 관련 표현을 단정적으로 작성하지 마세요.
2. 시험성적서·시험 방법·기재·도포 두께·건조 조건이 없으면 확정 답변을 만들지 마세요.
3. "100% 안전", "완전 방지", "영구", "절대" 같은 표현은 사용하지 마세요.
4. 출력은 evidenceBackedClaims / assumptions / missingEvidence / unsafePhrases / risks를 명확히 분리해 제공하세요.
5. 자신 없는 부분은 followUpQuestions로 사용자에게 되묻도록 작성하세요.`;

export type UnsafePhraseFinding = {
  phrase: string;
  matchedText: string;
  recommended?: string;
  source: "checklist" | "model";
};

/**
 * Scan free-form Korean text for known dangerous phrasing.
 * Returns one entry per match. Case- and whitespace-insensitive.
 */
export function detectUnsafePhrases(text: string): UnsafePhraseFinding[] {
  if (!text) return [];
  const findings: UnsafePhraseFinding[] = [];

  for (const phrase of UNSAFE_PHRASES_KO) {
    // Allow flexible whitespace BETWEEN ALL non-whitespace characters of
    // the phrase. The unsafe-phrase list itself uses single-space tokens,
    // but real text often inserts arbitrary whitespace (e.g. "100   %  안전").
    const cleaned = phrase.replace(/\s+/g, "");
    const pattern = new RegExp(
      Array.from(cleaned).map(escapeRegExp).join("\\s*"),
      "g",
    );
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(text)) !== null) {
      const recommended = RECOMMENDED_SAFE_WORDINGS.find((r) =>
        r.unsafe.test(m![0]),
      )?.safer;
      // Reset lastIndex on the recommended regex (we test() above).
      for (const r of RECOMMENDED_SAFE_WORDINGS) r.unsafe.lastIndex = 0;

      findings.push({
        phrase,
        matchedText: m[0],
        recommended,
        source: "checklist",
      });
      // Avoid infinite loops on zero-length matches.
      if (m.index === pattern.lastIndex) pattern.lastIndex++;
    }
  }
  return findings;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Compute a riskLevel based on findings and missing evidence.
 * Rules of thumb (see docs/12_domain_safety_policy.md):
 *   - any unsafe phrase referencing 불연/화재/폭발/인증/법령 → at least "high"
 *   - >=3 missing evidence items → at least "medium"
 *   - critical reserved for combinations of fire/cert/safety claims
 */
export function computeRiskLevel(args: {
  unsafePhrases: UnsafePhraseFinding[];
  missingEvidence: string[];
  taskType: string;
  /**
   * Optional original text. When provided, fire/cert keyword scanning runs
   * on this full text in addition to the matched-phrase texts — so risk is
   * correctly elevated when an unsafe-absolute claim ("100% 안전") appears
   * alongside fire/cert vocabulary ("화재") even if neither alone matched
   * an entry in the unsafe-phrase list.
   */
  text?: string;
}): RiskLevel {
  const fireCertRe = /불연|난연|화재|폭발|열폭주|인증|법령|법적/;
  const absoluteRe = /100|완전|절대|영구|반영구/;

  const matchedTexts = args.unsafePhrases.map((f) => f.matchedText).join(" ");
  const haystack = `${args.text ?? ""} ${matchedTexts}`;

  const fireOrCert = fireCertRe.test(haystack);
  const safety100 = absoluteRe.test(haystack);

  if (fireOrCert && safety100) return "critical";
  if (fireOrCert && args.unsafePhrases.length > 0) return "high";
  if (args.unsafePhrases.length > 0) return "medium";
  if (args.missingEvidence.length >= 4) return "medium";
  return "low";
}
