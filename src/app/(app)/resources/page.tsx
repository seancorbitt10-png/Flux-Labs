import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";

export const metadata = { title: "Resources" };

export default function ResourcesPage() {
  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Resources"
        description="Secure document storage, extraction, and retrieval for course materials — Phase 5."
      />
      <EmptyState
        title="Document intelligence not yet enabled"
        body="Uploads will be validated, isolated per user, and never treated as trusted system instructions."
      />
    </div>
  );
}
