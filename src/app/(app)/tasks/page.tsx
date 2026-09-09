import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { TasksWorkspace } from "@/components/academic/tasks-workspace";
import { requireUserId } from "@/lib/auth/session";
import { getTasksWorkspaceBootstrap } from "@/lib/academic/workspace";

export const metadata = { title: "Tasks" };

export default async function TasksPage() {
  let userId: string;
  try {
    userId = await requireUserId();
  } catch {
    redirect("/login?callbackUrl=/tasks");
  }

  const bootstrap = await getTasksWorkspaceBootstrap({
    actorUserId: userId,
    userId,
  });

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Tasks"
        description="Assignments and deadlines — track what needs attention and what you have finished."
      />
      <TasksWorkspace initial={bootstrap} />
    </div>
  );
}
