// GET /api/evidence-sources
//
// Read-only catalog + policy metadata endpoint. This endpoint serves the
// SEED source catalog (KOLAS/KATS, KCL, KTR, KTC, FITI, KATRI, KOTITI,
// KFI, KICT, custom) and the bounded retrieval policy that a future
// retrieval step MUST honor.
//
// Important:
//   - No external fetch happens here. We return static, server-side
//     metadata only.
//   - `retrievalEnabled` is hard-coded to `false`. This flag covers ONLY the
//     catalog-driven AUTOMATIC official-source lookup, which is not built.
//     (Session-level keyword RAG over uploaded docs and server-side fetch of
//     user-provided official URLs already exist via evidenceMode — see
//     evidencePreview.ts / sourceFetch.ts.)
//   - No auth gate: this endpoint exposes only public-ish catalog metadata
//     (institution display names, scope notes, inclusion warnings, and
//     numeric policy defaults). When retrieval ships, the operator should
//     re-evaluate exposure (e.g. add admin-only gating for site-specific
//     policy overrides).

import { NextResponse } from "next/server";
import {
  DEFAULT_EVIDENCE_SOURCE_CATALOG,
  DEFAULT_SOURCE_RETRIEVAL_POLICY,
} from "@/lib/council/evidence";

// The response is fully static — Next.js can cache / pre-render it. No
// `force-dynamic`. No reads from cookies / headers / searchParams. When
// retrieval ships and starts depending on per-request state (auth, tenant,
// etc.), re-evaluate this and add the appropriate dynamic / runtime hints.
export const runtime = "nodejs";

const RETRIEVAL_NOT_READY_KO =
  "이 카탈로그 기반 기관 자동 출처 조회는 아직 구현되지 않았습니다(retrievalEnabled=false). 본 응답은 카탈로그 / 정책 메타데이터만 노출합니다. 사내 문서 키워드 검색과 사용자 제공 공식 URL 조회는 세션의 evidenceMode(internal_docs / internal_docs_web)로 별도 제공됩니다.";

export async function GET() {
  return NextResponse.json({
    sources: DEFAULT_EVIDENCE_SOURCE_CATALOG,
    retrievalPolicy: DEFAULT_SOURCE_RETRIEVAL_POLICY,
    retrievalEnabled: false,
    message: RETRIEVAL_NOT_READY_KO,
  });
}
