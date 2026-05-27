"use client";

import type { SessionStatus } from "@/lib/council/types";
import { cn } from "@/lib/ui/cn";

const STEPS: Array<{ id: string; label: string; statuses: SessionStatus[] }> = [
  {
    id: "round1",
    label: "Round 1 · 독립 의견",
    statuses: [
      "round1_running",
      "round1_completed",
      "round1_partial",
      "round1_limited",
    ],
  },
  {
    id: "round2",
    label: "Round 2 · 회의/상호비판",
    statuses: [
      "round2_running",
      "round2_completed",
      "round2_partial",
      "round2_limited",
    ],
  },
  {
    id: "round3",
    label: "Round 3 · 최종 합성",
    statuses: ["synthesis_running"],
  },
  {
    id: "done",
    label: "결과 준비 완료",
    statuses: ["completed", "partial_completed", "limited_answer"],
  },
];

const PRECEDENCE: SessionStatus[] = [
  "created",
  "preparing",
  "round1_running",
  "round1_partial",
  "round1_limited",
  "round1_completed",
  "round2_running",
  "round2_partial",
  "round2_limited",
  "round2_completed",
  "synthesis_running",
  "completed",
  "partial_completed",
  "limited_answer",
];

export function RoundTimeline({ status }: { status: SessionStatus }) {
  const rank = PRECEDENCE.indexOf(status);

  return (
    <ol className="grid grid-cols-1 gap-3 md:grid-cols-4">
      {STEPS.map((s) => {
        const active = s.statuses.includes(status);
        const done =
          !active &&
          (status === "completed" ||
            status === "partial_completed" ||
            status === "limited_answer" ||
            s.statuses.some(
              (st) =>
                PRECEDENCE.indexOf(st) >= 0 &&
                PRECEDENCE.indexOf(st) < rank,
            ));

        return (
          <li
            key={s.id}
            className={cn(
              "rounded-md border px-3 py-2 text-xs",
              active
                ? "border-navy-700 bg-navy-50 text-navy-900"
                : done
                  ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                  : "border-navy-100 bg-white text-ink-500",
            )}
          >
            <div className="font-semibold">{s.label}</div>
            <div className="mt-1 text-[11px]">
              {active ? "진행 중" : done ? "완료" : "대기"}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
