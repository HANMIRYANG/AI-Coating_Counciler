// GET /api/council-sessions/:id/export?format=markdown
//
// Returns a safe, reviewer-facing Markdown artifact for a COMPLETED session
// (final answer + internal memo + evidence/missing-evidence/unsafe phrases +
// Step 10 evidence coverage). Raw provider responses, debug payloads, the
// attempt log, and full chunk bodies are never included (the builder reads
// only curated fields).
//
// Contract:
//   - unsupported format        → 400 invalid_format
//   - missing session           → 404 not_found
//   - finalAnswer not present    → 409 not_ready
//   - success                    → 200 text/markdown; charset=utf-8
//                                  + Content-Disposition attachment filename
//
// Scope reminder: Markdown only. PDF / DOCX export remains unimplemented.

import { NextResponse } from "next/server";

import { getSessionStore } from "@/lib/council/store";
import {
  buildSessionMarkdown,
  sessionMarkdownFilename,
} from "@/lib/council/sessionMarkdown";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  { params }: { params: { id: string } },
) {
  const format = (
    new URL(req.url).searchParams.get("format") ?? "markdown"
  ).toLowerCase();
  if (format !== "markdown" && format !== "md") {
    return NextResponse.json(
      {
        error: "invalid_format",
        message: "Only format=markdown is supported.",
      },
      { status: 400 },
    );
  }

  const sess = await getSessionStore().get(params.id);
  if (!sess) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (!sess.finalAnswer) {
    return NextResponse.json(
      {
        error: "not_ready",
        message: "Final answer is not available yet for this session.",
      },
      { status: 409 },
    );
  }

  const markdown = buildSessionMarkdown({
    id: sess.id,
    userPrompt: sess.userPrompt,
    taskType: sess.taskType,
    evidenceMode: sess.evidenceMode,
    status: sess.status,
    finalAnswer: sess.finalAnswer,
  });

  return new NextResponse(markdown, {
    status: 200,
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      "content-disposition": `attachment; filename="${sessionMarkdownFilename(sess.id)}"`,
      "cache-control": "no-store",
    },
  });
}
