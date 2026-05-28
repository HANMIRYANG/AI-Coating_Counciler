"use client";

import type { FinalAnswer } from "@/lib/council/schemas";

export type EvidencePanelProps = {
  claims: FinalAnswer["evidenceBackedClaims"];
  assumptions: FinalAnswer["assumptions"];
  missing: FinalAnswer["missingEvidence"];
};

export function EvidencePanel({
  claims,
  assumptions,
  missing,
}: EvidencePanelProps) {
  return (
    <>
      <EvidenceGroup title="근거 있는 주장" items={claims} />
      <EvidenceGroup title="추정 / 가정" items={assumptions} />
      <EvidenceGroup title="누락 근거" items={missing} />
    </>
  );
}

function EvidenceGroup({
  title,
  items,
}: {
  title: string;
  items: readonly string[] | undefined;
}) {
  const list = items ?? [];
  return (
    <div className="detail-group">
      <b>{title}</b>
      {list.length ? (
        <ul>
          {list.map((item, idx) => (
            <li key={idx}>{item}</li>
          ))}
        </ul>
      ) : (
        <span>없음</span>
      )}
    </div>
  );
}
