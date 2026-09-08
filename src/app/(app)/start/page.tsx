import { redirect } from "next/navigation";
import { requireUserId } from "@/lib/auth/session";
import { resolvePostAuthPath } from "@/lib/onboarding/session";

export const metadata = { title: "Starting" };

/**
 * Soft post-auth router: incomplete onboarding → /onboarding; otherwise /home.
 * Does not hard-block Study or other routes after dismiss/complete.
 */
export default async function StartPage() {
  const userId = await requireUserId();
  const path = await resolvePostAuthPath({
    actorUserId: userId,
    userId,
  });
  redirect(path);
}
