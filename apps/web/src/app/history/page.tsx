import { SessionListView } from "@/components/sessions/SessionListView";

export default function HistoryPage() {
  return (
    <SessionListView
      active="history"
      title="최근 검토 기록"
      emptyText="아직 생성된 검토 세션이 없습니다."
    />
  );
}
