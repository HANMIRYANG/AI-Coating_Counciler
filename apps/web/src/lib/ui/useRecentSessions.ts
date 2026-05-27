"use client";

// Tiny hook for the sidebar's recent-session list. Fetches once on mount
// (and whenever `limit` changes). Polling is NOT done here — refresh is
// driven by component remount (a hard reload, or navigation that
// re-mounts the sidebar). That's enough for the current MVP slice.

import { useEffect, useState } from "react";
import type { SessionSummary } from "@/lib/council/store";

export type UseRecentSessionsResult = {
  sessions: SessionSummary[];
  loading: boolean;
  error: string | null;
};

export function useRecentSessions(limit = 8): UseRecentSessionsResult {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetch(`/api/council-sessions?limit=${limit}`, { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return (await res.json()) as unknown;
      })
      .then((body) => {
        if (cancelled) return;
        // Defensive shape guard: if the response is not the documented
        // `{ sessions: SessionSummary[] }` shape, surface an explicit
        // error string instead of silently rendering an empty sidebar.
        if (
          !body ||
          typeof body !== "object" ||
          !Array.isArray((body as { sessions?: unknown }).sessions)
        ) {
          setSessions([]);
          setError("invalid_response");
          setLoading(false);
          return;
        }
        setSessions(
          (body as { sessions: SessionSummary[] }).sessions,
        );
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "fetch_failed");
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [limit]);

  return { sessions, loading, error };
}
