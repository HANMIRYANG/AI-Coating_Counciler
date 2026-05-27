"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { HomeWorkspace } from "@/components/design/CouncilDesign";
import type { EvidenceMode, TaskType } from "@/lib/council/types";

const DEFAULT_TASK_TYPE: TaskType = "technical_review";
// evidenceMode stays ai_only for this slice. internal_docs and
// internal_docs_web are Phase 2 (RAG / external sources not implemented yet).
const DEFAULT_EVIDENCE_MODE: EvidenceMode = "ai_only";

export default function HomePage() {
  const router = useRouter();
  const [prompt, setPrompt] = useState("");
  const [taskType, setTaskType] = useState<TaskType>(DEFAULT_TASK_TYPE);
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
          evidenceMode: DEFAULT_EVIDENCE_MODE,
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
      onSubmit={startSession}
      submitting={submitting}
      error={error}
    />
  );
}
