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

import type {
  CertificationChecklistFinalAnswer,
  FinalAnswer,
  IdeationFinalAnswer,
  SynthesisResult,
} from "./schemas";

// Minimal structural input — a completed session snapshot. `finalAnswer` is
// required (the route returns 409 not_ready when it is absent).
export type ExportableSession = {
  id: string;
  userPrompt: string;
  taskType: string;
  evidenceMode: string;
  status: string;
  finalAnswer: SynthesisResult;
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

function retrievalGuardLines(
  guard: SynthesisResult["retrievalGuard"],
): string[] {
  if (!guard) return [];
  const lines = [
    "",
    "### 근거 가드 (Retrieval Guard)",
    "",
    `- 상태: ${guard.guardStatus}`,
    `- 업체 발송 가능: ${guard.businessCitationReady ? "예" : "아니오"}`,
    `- 권장 조치: ${guard.recommendedAction.trim().length > 0 ? guard.recommendedAction : "없음"}`,
  ];
  if (guard.reasons.length > 0) {
    lines.push("- 사유:");
    lines.push(...guard.reasons.map((r) => `  - ${r}`));
  }
  return lines;
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

  // Non-standard kinds (docs/23) render their own document shape.
  if (a.answerKind === "ideation") return buildIdeationMarkdown(session, a);
  if (a.answerKind === "certification_checklist")
    return buildChecklistMarkdown(session, a);

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
    ...retrievalGuardLines(a.retrievalGuard),
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

function ideaLines(ideas: IdeationFinalAnswer["ideas"]): string[] {
  if (ideas.length === 0) return ["- 없음"];
  const out: string[] = [];
  ideas.forEach((idea, i) => {
    out.push(`### 아이디어 ${i + 1}: ${idea.ideaSummary}`);
    out.push("");
    out.push(`- 위험도: ${idea.riskLevel}`);
    if (idea.targetApplication.trim())
      out.push(`- 대상 적용처: ${idea.targetApplication}`);
    if (idea.expectedBenefit.trim())
      out.push(`- 기대 효과: ${idea.expectedBenefit}`);
    if (idea.recommendedNextExperiment.trim())
      out.push(`- 다음 실험: ${idea.recommendedNextExperiment}`);
    out.push("- 필요 근거:");
    out.push(...bulletList(idea.requiredEvidence).map((l) => `  ${l}`));
    out.push("- 주장 금지 (doNotClaim):");
    out.push(...bulletList(idea.doNotClaim).map((l) => `  ${l}`));
    out.push("");
  });
  return out;
}

/**
 * Ideation-mode export (docs/23, taskType=application_ideas). Same header /
 * safety / coverage / provider sections as the standard export, with the
 * business-answer sections replaced by the idea list. Deterministic.
 */
function buildIdeationMarkdown(
  session: ExportableSession,
  a: IdeationFinalAnswer,
): string {
  const lines: string[] = [
    "# 기술검토 세션 내보내기 (아이디어 모드)",
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
    "## 적용 아이디어 옵션",
    "",
    ...ideaLines(a.ideas),
    "## 미해결 질문",
    "",
    ...bulletList(a.unresolvedQuestions),
    "",
    "## 후속 조사",
    "",
    ...bulletList(a.followUpResearch),
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
    ...retrievalGuardLines(a.retrievalGuard),
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

function checklistItemLines(
  items: CertificationChecklistFinalAnswer["items"],
): string[] {
  if (items.length === 0) return ["- 없음"];
  const label: Record<string, string> = {
    met: "충족",
    unmet: "미충족",
    unknown: "확인 필요",
  };
  return items.map((it) => {
    const parts = [`[${label[it.status] ?? it.status}] ${it.requirement}`];
    if (it.category.trim()) parts.push(`분류: ${it.category}`);
    if (it.issuingBody.trim()) parts.push(`기관: ${it.issuingBody}`);
    if (it.gap.trim()) parts.push(`필요: ${it.gap}`);
    if (it.evidence.trim()) parts.push(`근거: ${it.evidence}`);
    return `- ${parts.join(" · ")}`;
  });
}

/**
 * Certification-checklist export (docs/23, taskType=certification_checklist).
 * Deterministic; same header / safety / coverage / provider sections as the
 * other exports, with the body replaced by the structured checklist.
 */
function buildChecklistMarkdown(
  session: ExportableSession,
  a: CertificationChecklistFinalAnswer,
): string {
  const lines: string[] = [
    "# 기술검토 세션 내보내기 (인증/규격 체크리스트)",
    "",
    `- 세션 ID: ${session.id}`,
    `- 작업 유형: ${session.taskType}`,
    `- 근거 모드: ${session.evidenceMode}`,
    `- 상태: ${session.status}`,
    "",
    "## 최종 결론",
    "",
    a.conclusion,
    "",
    "## 체크리스트",
    "",
    ...checklistItemLines(a.items),
    "",
    "## 충족 항목",
    "",
    ...bulletList(a.metRequirements),
    "",
    "## 미충족 항목",
    "",
    ...bulletList(a.unmetRequirements),
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
    ...retrievalGuardLines(a.retrievalGuard),
    "",
    "### 사용된 근거",
    "",
    ...evidenceUsedLines(a.evidenceUsed),
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
