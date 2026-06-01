// Pure presentation logic for the session evidence preview panel (Step 9).
//
// The React component (`EvidencePreviewPanel.tsx`) is a thin renderer over
// the view-model produced here. Keeping the decision logic pure + framework-
// free lets it be unit-tested under the repo's node-env vitest setup (no DOM
// / RTL required), matching the search.ts / evidence-bundle.ts pattern.
//
// This is UI/status transparency only — it surfaces the Step 7/8 preview.
// It never renders full chunk bodies (only the bounded snippets already in
// the preview), and it never fabricates citations.

import type {
  EvidencePreviewCandidate,
  SessionEvidencePreview,
} from "@/lib/council/evidencePreview";

export type EvidencePreviewTone = "info" | "muted" | "warn";

export type EvidenceCandidateView = {
  key: string;
  title: string; // internal: "filename #chunkIndex" · external: page title
  snippet: string;
  metaSummary: string;
  trustLevel: string;
  verificationStatus: string;
  sourceType: "internal_document" | "external_url";
  url?: string; // present for external sources
};

export type EvidencePreviewView = {
  // Whether the panel renders at all. ai_only / not_requested / missing →
  // false so the ai_only UI stays quiet (no noisy empty panel).
  visible: boolean;
  statusLabel: string;
  tone: EvidencePreviewTone;
  summary: string;
  showCandidates: boolean;
  candidates: EvidenceCandidateView[];
  errorMessage?: string;
  // Guidance line for non-ok retrieval (missing-evidence state).
  note?: string;
};

const HIDDEN_VIEW: EvidencePreviewView = {
  visible: false,
  statusLabel: "",
  tone: "muted",
  summary: "",
  showCandidates: false,
  candidates: [],
};

const STATUS_LABEL: Record<string, string> = {
  ok: "근거 검색됨",
  no_matches: "근거 없음",
  unavailable: "검색 불가",
  failed: "검색 실패",
  not_requested: "요청 안 함",
};

// Compact, deterministic Korean metadata summary. Fixed key order; omits
// absent fields. Falls back to a neutral label when nothing is present.
export function formatCandidateMetadata(
  metadata: EvidencePreviewCandidate["metadata"],
): string {
  if (!metadata) return "메타데이터 없음";
  const parts: string[] = [];
  if (metadata.productName) parts.push(`제품 ${metadata.productName}`);
  if (metadata.documentType) parts.push(`유형 ${metadata.documentType}`);
  if (metadata.issuer) parts.push(`발급 ${metadata.issuer}`);
  if (metadata.testMethod) parts.push(`시험 ${metadata.testMethod}`);
  if (metadata.substrate) parts.push(`기재 ${metadata.substrate}`);
  if (metadata.coatingThickness)
    parts.push(`두께 ${metadata.coatingThickness}`);
  return parts.length > 0 ? parts.join(" · ") : "메타데이터 없음";
}

function toCandidateView(c: EvidencePreviewCandidate): EvidenceCandidateView {
  const isExternal = c.sourceType === "external_url";
  return {
    key: c.chunkId,
    title: isExternal ? c.filename : `${c.filename} #${c.chunkIndex}`,
    snippet: c.snippet,
    metaSummary: isExternal
      ? "외부 공식 출처"
      : formatCandidateMetadata(c.metadata),
    trustLevel: c.trustLevel,
    verificationStatus: c.verificationStatus,
    sourceType: isExternal ? "external_url" : "internal_document",
    url: c.url,
  };
}

const NON_OK_NOTE =
  "내부 문서 근거가 충분하지 않습니다. 최종 답변은 사내 문서 근거 부족을 명시하고, 추가 문서 확보가 필요합니다.";

/**
 * Derive the panel view-model from a session's evidence preview.
 *
 *   - undefined / `not_requested` (ai_only) → hidden (visible:false).
 *   - `ok` → candidate list shown.
 *   - `no_matches` → concise missing-evidence state, no candidates.
 *   - `unavailable` / `failed` → warning state with the error message.
 */
export function buildEvidencePreviewView(
  preview: SessionEvidencePreview | null | undefined,
): EvidencePreviewView {
  if (!preview || preview.retrievalStatus === "not_requested") {
    return HIDDEN_VIEW;
  }

  const statusLabel =
    STATUS_LABEL[preview.retrievalStatus] ?? preview.retrievalStatus;

  if (preview.retrievalStatus === "ok") {
    return {
      visible: true,
      statusLabel,
      tone: "info",
      summary: `내부 문서 후보 ${preview.count}건 (표시 ${preview.candidates.length}건)`,
      showCandidates: true,
      candidates: preview.candidates.map(toCandidateView),
    };
  }

  if (preview.retrievalStatus === "no_matches") {
    return {
      visible: true,
      statusLabel,
      tone: "muted",
      summary: "내부 문서 검색 결과가 없습니다.",
      showCandidates: false,
      candidates: [],
      note: NON_OK_NOTE,
    };
  }

  // unavailable | failed
  const summary =
    preview.retrievalStatus === "unavailable"
      ? "내부 문서 검색을 일시적으로 사용할 수 없습니다."
      : "내부 문서 검색에 실패했습니다.";
  return {
    visible: true,
    statusLabel,
    tone: "warn",
    summary,
    showCandidates: false,
    candidates: [],
    errorMessage: preview.errorMessage,
    note: NON_OK_NOTE,
  };
}
