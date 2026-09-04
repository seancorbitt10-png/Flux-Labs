import { PageHeader } from "@/components/ui/page-header";
import { StudyChat } from "@/components/study/study-chat";

export const metadata = { title: "Study" };

export default function StudyPage() {
  return (
    <div className="animate-fade-up max-w-2xl">
      <PageHeader
        title="Study"
        description="Guided learning with a learning-first assistance policy. Flux routes your request, checks entitlements, and asks you to participate."
      />
      <StudyChat />
    </div>
  );
}
