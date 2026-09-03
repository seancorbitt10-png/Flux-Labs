import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";

export const metadata = { title: "Progress" };

export default function ProgressPage() {
  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Progress"
        description="Actionable academic trajectory — mastery, weak areas, and Flux recommendations. Not vanity analytics."
      />
      <EmptyState
        title="Evidence will accumulate here"
        body="Topic mastery and recommendations land in Phase 6 after onboarding and study evidence exist."
      />
    </div>
  );
}
