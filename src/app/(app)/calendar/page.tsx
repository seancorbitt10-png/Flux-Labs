import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";

export const metadata = { title: "Calendar" };

export default function CalendarPage() {
  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Calendar"
        description="Deadlines, assessments, and study sessions in one academic timeline Flux can reason over."
      />
      <EmptyState
        title="Calendar arrives in Phase 3"
        body="External calendar integrations remain modular and optional — Flux will never assume unauthorized access."
      />
    </div>
  );
}
