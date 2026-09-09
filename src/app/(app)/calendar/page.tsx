import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { CalendarWorkspace } from "@/components/academic/calendar-workspace";
import { requireUserId } from "@/lib/auth/session";
import { getCalendarWorkspaceBootstrap } from "@/lib/academic/workspace";

export const metadata = { title: "Calendar" };

export default async function CalendarPage() {
  let userId: string;
  try {
    userId = await requireUserId();
  } catch {
    redirect("/login?callbackUrl=/calendar");
  }

  const bootstrap = await getCalendarWorkspaceBootstrap({
    actorUserId: userId,
    userId,
  });

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Calendar"
        description="Your academic week — deadlines and class periods from Classes and Tasks, not a separate calendar."
      />
      <CalendarWorkspace initial={bootstrap} />
    </div>
  );
}
