// GET /api/council-sessions/:id — session snapshot evidence preview (Step 7).
//
// Confirms the single-session snapshot surfaces the bounded evidence preview
// and that NO raw full chunk content leaks through it.

import { describe, it, expect, beforeEach } from "vitest";
import {
  getSessionStore,
  resetGlobalSessionStoreForTests,
  type SessionRecord,
} from "@/lib/council/store";
import type { SessionEvidencePreview } from "@/lib/council/evidencePreview";

function makeRecord(overrides: Partial<SessionRecord> = {}): SessionRecord {
  return {
    id: `cs_${Math.random().toString(36).slice(2, 10)}`,
    userPrompt: "방오 코팅 검토",
    taskType: "technical_review",
    evidenceMode: "internal_docs",
    status: "completed",
    createdAt: Date.now(),
    startedAt: Date.now(),
    deadlineAt: Date.now() + 60_000,
    providerCalls: [],
    attempts: [],
    opinions: [],
    critiques: [],
    ...overrides,
  };
}

const preview: SessionEvidencePreview = {
  mode: "internal_docs",
  retrievalStatus: "ok",
  count: 3,
  candidates: [
    {
      documentId: "doc_1",
      filename: "kcl-report.md",
      chunkId: "chunk_1",
      chunkIndex: 0,
      snippet: "…방오 코팅의 부착 성능…",
      metadata: { issuer: "KCL", documentType: "test_report" },
      score: 202,
      trustLevel: "uploaded_copy",
      verificationStatus: "auto_extracted",
    },
  ],
};

describe("GET /api/council-sessions/:id evidence preview", () => {
  beforeEach(() => {
    resetGlobalSessionStoreForTests();
  });

  it("includes the bounded evidence preview in the snapshot", async () => {
    const store = getSessionStore();
    const rec = makeRecord({ evidencePreview: preview });
    await store.create(rec);

    const { GET } = await import("@/app/api/council-sessions/[id]/route");
    const res = await GET(
      new Request(`http://localhost/api/council-sessions/${rec.id}`),
      { params: { id: rec.id } },
    );
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.evidencePreview).toBeTruthy();
    expect(body.evidencePreview.retrievalStatus).toBe("ok");
    expect(body.evidencePreview.count).toBe(3);
    expect(body.evidencePreview.candidates).toHaveLength(1);

    const c = body.evidencePreview.candidates[0];
    expect(c.snippet).toBe("…방오 코팅의 부착 성능…");
    expect(c.trustLevel).toBe("uploaded_copy");
    // No raw full chunk body must ever be exposed.
    expect(c).not.toHaveProperty("content");
    expect(c).not.toHaveProperty("chunks");
  });

  it("returns evidencePreview: null for a session without one (ai_only legacy)", async () => {
    const store = getSessionStore();
    const rec = makeRecord({ evidenceMode: "ai_only", evidencePreview: undefined });
    await store.create(rec);

    const { GET } = await import("@/app/api/council-sessions/[id]/route");
    const res = await GET(
      new Request(`http://localhost/api/council-sessions/${rec.id}`),
      { params: { id: rec.id } },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.evidencePreview).toBeNull();
  });
});
