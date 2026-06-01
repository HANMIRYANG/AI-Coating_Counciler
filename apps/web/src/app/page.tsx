"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { HomeWorkspace } from "@/components/design/CouncilDesign";
import type { EvidenceMode, TaskType } from "@/lib/council/types";

const DEFAULT_TASK_TYPE: TaskType = "technical_review";
// internal_docs is now user-selectable (keyword RAG over uploaded internal
// docs). internal_docs_web (external official-source lookup) is not wired yet
// and is offered as a disabled "준비 중" option in the selector.
const DEFAULT_EVIDENCE_MODE: EvidenceMode = "ai_only";

export default function HomePage() {
  const router = useRouter();
  const [prompt, setPrompt] = useState("");
  const [taskType, setTaskType] = useState<TaskType>(DEFAULT_TASK_TYPE);
  const [evidenceMode, setEvidenceMode] =
    useState<EvidenceMode>(DEFAULT_EVIDENCE_MODE);
  // Raw textarea (one URL per line) for internal_docs_web external sources.
  const [sourceUrlsText, setSourceUrlsText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function startSession() {
    const trimmed = prompt.trim();
    if (trimmed.length < 4 || submitting) return;

    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/council-sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          prompt: trimmed,
          taskType,
          evidenceMode,
          ...(evidenceMode === "internal_docs_web"
            ? {
                sourceUrls: sourceUrlsText
                  .split(/\r?\n/)
                  .map((s) => s.trim())
                  .filter((s) => s.length > 0)
                  .slice(0, 6),
              }
            : {}),
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error ?? `HTTP ${res.status}`);
      }
      const { sessionId } = (await res.json()) as { sessionId: string };
      router.push(`/sessions/${sessionId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "unknown_error");
      setSubmitting(false);
    }
  }

  return (
    <HomeWorkspace
      prompt={prompt}
      setPrompt={setPrompt}
      taskType={taskType}
      setTaskType={setTaskType}
      evidenceMode={evidenceMode}
      setEvidenceMode={setEvidenceMode}
      sourceUrlsText={sourceUrlsText}
      setSourceUrlsText={setSourceUrlsText}
      onSubmit={startSession}
      submitting={submitting}
      error={error}
    />
  );
}
