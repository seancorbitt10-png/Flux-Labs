import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";

export const metadata = { title: "Classes" };

export default function ClassesPage() {
  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Classes"
        description="Each class becomes an AI-aware context boundary — assignments, materials, topics, and mastery."
      />
      <EmptyState
        title="No classes yet"
        body="Class management ships in Phase 3. The schema and navigation are ready for enrollments, assignments, and class-scoped AI context."
      />
    </div>
  );
}
