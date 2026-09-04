import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";

export const metadata = { title: "Tasks" };

export default function TasksPage() {
  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Tasks"
        description="Assignments, priorities, and effort estimates — eventually with AI-assisted prioritization."
      />
      <EmptyState
        title="Task workspace coming in Phase 3"
        body="This surface will connect assignments, due dates, class context, and study recommendations."
      />
    </div>
  );
}
