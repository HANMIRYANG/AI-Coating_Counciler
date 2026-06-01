import {
  ARCHIVE_STATUSES,
  SessionListView,
} from "@/components/sessions/SessionListView";

export default function ArchivePage() {
  return (
    <SessionListView
      active="inbox"
      title="업체 발송 답변 보관함"
      emptyText="완료된(발송 가능) 답변이 아직 없습니다."
      statusFilter={ARCHIVE_STATUSES}
    />
  );
}
