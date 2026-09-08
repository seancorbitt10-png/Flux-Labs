import { redirect } from "next/navigation";
import { StudyWorkspace } from "@/components/study/study-workspace";
import { requireUserId } from "@/lib/auth/session";
import { getStudyBootstrap } from "@/lib/study/bootstrap";

export const metadata = { title: "Study" };

/**
 * Study Experience — authenticated academic workspace over AI orchestration.
 * Layout uses the app shell; this page does not invent a second context system.
 */
export default async function StudyPage() {
  let userId: string;
  try {
    userId = await requireUserId();
  } catch {
    redirect("/login?callbackUrl=/study");
  }

  const bootstrap = await getStudyBootstrap({
    actorUserId: userId,
    userId,
  });

  return <StudyWorkspace initialBootstrap={bootstrap} />;
}
