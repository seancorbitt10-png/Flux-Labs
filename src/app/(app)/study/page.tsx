import { redirect } from "next/navigation";
import { StudyWorkspace } from "@/components/study/study-workspace";
import { getClass } from "@/lib/academic/classes";
import { getTask } from "@/lib/academic/tasks";
import { requireUserId } from "@/lib/auth/session";
import { getStudyBootstrap } from "@/lib/study/bootstrap";

export const metadata = { title: "Study" };

type StudyPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function firstParam(
  value: string | string[] | undefined,
): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value[0];
  return undefined;
}

/**
 * Study Experience — authenticated academic workspace over AI orchestration.
 * Optional ?classId=&taskId= deep-links are ownership-checked before hydrate.
 * Layout uses the app shell; this page does not invent a second context system.
 */
export default async function StudyPage({ searchParams }: StudyPageProps) {
  let userId: string;
  try {
    userId = await requireUserId();
  } catch {
    redirect("/login?callbackUrl=/study");
  }

  const params = searchParams ? await searchParams : {};
  const requestedClassId = firstParam(params?.classId)?.trim() || "";
  const requestedTaskId = firstParam(params?.taskId)?.trim() || "";

  let initialClassId = "";
  let initialTaskId = "";

  // Validate deep-link focus against authoritative owned records.
  // Invalid/foreign IDs are ignored (empty focus) rather than failing the page.
  if (requestedClassId) {
    try {
      const owned = await getClass({
        actorUserId: userId,
        userId,
        classId: requestedClassId,
      });
      initialClassId = owned.id;
    } catch {
      initialClassId = "";
    }
  }

  if (requestedTaskId) {
    try {
      const owned = await getTask({
        actorUserId: userId,
        userId,
        taskId: requestedTaskId,
      });
      // If both were requested, require consistency when the task has a class.
      if (
        initialClassId &&
        owned.classId &&
        owned.classId !== initialClassId
      ) {
        initialTaskId = "";
      } else {
        initialTaskId = owned.id;
        if (!initialClassId && owned.classId) {
          initialClassId = owned.classId;
        }
      }
    } catch {
      initialTaskId = "";
    }
  }

  const bootstrap = await getStudyBootstrap({
    actorUserId: userId,
    userId,
  });

  return (
    <StudyWorkspace
      initialBootstrap={bootstrap}
      initialClassId={initialClassId}
      initialTaskId={initialTaskId}
    />
  );
}
