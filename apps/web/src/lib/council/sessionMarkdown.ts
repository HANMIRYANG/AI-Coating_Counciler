// Deterministic Markdown export for a completed council session (Step 12).
//
// Pure, server-side, byte-for-byte stable (no clocks, no randomness) so it is
// easy to snapshot-test. Produces a reviewer-facing artifact containing the
// final answer, internal memo, evidence/missing-evidence/unsafe phrases, and
// the Step 10 evidence coverage contract.
//
// SAFETY: this intentionally reads ONLY the curated final-answer + session
// header fields. It NEVER includes raw provider responses, parsed debug
// payloads, the per-attempt forensic log, full chunk bodies, or any
// internal-only debug token.

import type { FinalAnswer } from "./schemas";

// Minimal structural input — a completed session snapshot. `finalAnswer` is
// required (the route returns 409 not_ready when it is absent).
export type ExportableSession = {
  id: string;
  userPrompt: string;
  taskType: string;
  evidenceMode: string;
  status: string;
  finalAnswer: FinalAnswer;
};

function bulletList(items: readonly string[]): string[] {
  const cleaned = items.filter((i) => i.trim().length > 0);
  return cleaned.length > 0 ? cleaned.map((i) => `- ${i}`) : ["- 없음"];
}

function unsafePhraseLines(phrases: FinalAnswer["unsafePhrases"]): string[] {
  if (phrases.length === 0) return ["- 없음"];
  return phrases.map((p) => {
    const extras: string[] = [];
    if (p.reason && p.reason.trim()) extras.push(`사유: ${p.reason}`);
    if (p.recommended && p.recommended.trim())
      extras.push(`권장: ${p.recommended}`);
    const tail = extras.length > 0 ? ` — ${extras.join(" · ")}` : "";
    return `- "${p.phrase}"${tail}`;
  });
}

function evidenceUsedLines(refs: FinalAnswer["evidenceUsed"]): string[] {
  if (refs.length === 0) return ["- 없음"];
  return refs.map((r) => {
    const trust = r.trustLevel ?? "—";
    const verification = r.verificationStatus ?? "—";
    return `- ${r.filename} #${r.chunkIndex} · 신뢰수준 ${trust} · ${verification}`;
  });
}

function coveredClaimLines(claims: FinalAnswer["coveredClaims"]): string[] {
  if (claims.length === 0) return ["- 없음"];
  return claims.map(
    (c) => `- ${c.claim} (근거 ${c.evidenceChunkIds.length}건)`,
  );
}

function providerSummaryLines(
  summary: FinalAnswer["providerSummary"],
): string[] {
  if (summary.length === 0) return ["- 없음"];
  return summary.map((p) => {
    const latency =
      p.latencyMs !== undefined ? ` (${p.latencyMs}ms)` : "";
    return `- ${p.providerId}: ${p.status}${latency}`;
  });
}

/**
 * Render a completed session into a deterministic Markdown document. The
 * section order is fixed so the output is stable across runs and easy to
 * snapshot in tests.
 */
export function buildSessionMarkdown(session: ExportableSession): string {
  const a = session.finalAnswer;

  const lines: string[] = [
    "# 기술검토 세션 내보내기",
    "",
    `- 세션 ID: ${session.id}`,
    `- 작업 유형: ${session.taskType}`,
    `- 근거 모드: ${session.evidenceMode}`,
    `- 상태: ${session.status}`,
    "",
    "## 사용자 질문",
    "",
    session.userPrompt,
    "",
    "## 최종 결론",
    "",
    a.conclusion,
    "",
    "## 업체 발송용 답변",
    "",
    a.businessReadyAnswer,
    "",
    "## 내부 검토 메모",
    "",
    a.internalMemo.trim().length > 0 ? a.internalMemo : "없음",
    "",
    "## 근거 있는 주장",
    "",
    ...bulletList(a.evidenceBackedClaims),
    "",
    "## 추정 / 가정",
    "",
    ...bulletList(a.assumptions),
    "",
    "## 누락 근거",
    "",
    ...bulletList(a.missingEvidence),
    "",
    "## 위험 표현",
    "",
    ...unsafePhraseLines(a.unsafePhrases),
    "",
    "## 권장 안전 표현",
    "",
    ...bulletList(a.recommendedSafeWording),
    "",
    "## 근거 커버리지",
    "",
    `- 상태: ${a.evidenceCoverageStatus}`,
    "",
    "### 사용된 근거",
    "",
    ...evidenceUsedLines(a.evidenceUsed),
    "",
    "### 근거 연결 주장",
    "",
    ...coveredClaimLines(a.coveredClaims),
    "",
    "### 근거 부족 항목",
    "",
    ...bulletList(a.uncoveredClaims),
    "",
    "## Provider 요약",
    "",
    ...providerSummaryLines(a.providerSummary),
    "",
  ];

  return lines.join("\n");
}

// Suggested download filename for a session export.
export function sessionMarkdownFilename(sessionId: string): string {
  return `council-session-${sessionId}.md`;
}
