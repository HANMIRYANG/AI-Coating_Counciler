// GET /api/council-sessions/:id/export?format=markdown route tests.
//
// Uses the global memory store (reset per test) — no database needed.

import { describe, it, expect, beforeEach } from "vitest";
import {
  getSessionStore,
  resetGlobalSessionStoreForTests,
  type SessionRecord,
} from "@/lib/council/store";
import { FinalAnswerSchema } from "@/lib/council/schemas";

function makeRecord(over: Partial<SessionRecord> = {}): SessionRecord {
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
    ...over,
  };
}

const finalAnswer = FinalAnswerSchema.parse({
  conclusion: "조건부 적용 가능",
  finalMarkdown: "# 결론",
  businessReadyAnswer: "업체 발송용 본문",
  internalMemo: "내부 메모",
  evidenceCoverageStatus: "partial",
});

async function callExport(id: string, query = "?format=markdown") {
  const { GET } = await import(
    "@/app/api/council-sessions/[id]/export/route"
  );
  return GET(
    new Request(`http://localhost/api/council-sessions/${id}/export${query}`),
    { params: { id } },
  );
}

describe("GET /api/council-sessions/:id/export", () => {
  beforeEach(() => {
    resetGlobalSessionStoreForTests();
  });

  it("returns 200 text/markdown with a Content-Disposition filename", async () => {
    const rec = makeRecord({ finalAnswer });
    await getSessionStore().create(rec);

    const res = await callExport(rec.id);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/markdown/);
    expect(res.headers.get("content-disposition")).toContain(
      `council-session-${rec.id}.md`,
    );
    const body = await res.text();
    expect(body).toContain("# 기술검토 세션 내보내기");
    expect(body).toContain(`- 세션 ID: ${rec.id}`);
    expect(body).toContain("## 근거 커버리지");
  });

  it("defaults to markdown when format is omitted", async () => {
    const rec = makeRecord({ finalAnswer });
    await getSessionStore().create(rec);
    const res = await callExport(rec.id, "");
    expect(res.status).toBe(200);
  });

  it("returns 404 not_found for a missing session", async () => {
    const res = await callExport("cs_does_not_exist");
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("not_found");
  });

  it("returns 409 not_ready when the final answer is absent", async () => {
    const rec = makeRecord({ status: "round1_running", finalAnswer: undefined });
    await getSessionStore().create(rec);
    const res = await callExport(rec.id);
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe("not_ready");
  });

  it("returns 400 invalid_format for an unsupported format", async () => {
    const rec = makeRecord({ finalAnswer });
    await getSessionStore().create(rec);
    const res = await callExport(rec.id, "?format=pdf");
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("invalid_format");
  });
});
