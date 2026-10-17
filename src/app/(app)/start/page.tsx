import { redirect } from "next/navigation";
import { requireUserId } from "@/lib/auth/session";
import { resolvePostAuthPath } from "@/lib/onboarding/session";

export const metadata = { title: "Starting" };

/**
 * Soft post-auth router: never-started setup → /onboarding; otherwise /home.
 * In-progress (“Set up later”) sessions do not block Home, Study, or other app routes.
 */
export default async function StartPage() {
  const userId = await requireUserId();
  const path = await resolvePostAuthPath({
    actorUserId: userId,
    userId,
  });
  redirect(path);
}
