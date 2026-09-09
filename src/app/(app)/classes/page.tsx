import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { ClassesWorkspace } from "@/components/academic/classes-workspace";
import { requireUserId } from "@/lib/auth/session";
import { getClassesWorkspaceBootstrap } from "@/lib/academic/workspace";

export const metadata = { title: "Classes" };

export default async function ClassesPage() {
  let userId: string;
  try {
    userId = await requireUserId();
  } catch {
    redirect("/login?callbackUrl=/classes");
  }

  const bootstrap = await getClassesWorkspaceBootstrap({
    actorUserId: userId,
    userId,
  });

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Classes"
        description="The courses you are taking — organize tasks by class without losing uncategorized work."
      />
      <ClassesWorkspace initial={bootstrap} />
    </div>
  );
}
