import { OnboardingFlow } from "@/components/onboarding/onboarding-flow";
import { requireUserId } from "@/lib/auth/session";
import { getOnboardingBootstrap } from "@/lib/onboarding/session";

export const metadata = { title: "Academic setup" };

export default async function OnboardingPage() {
  const userId = await requireUserId();

  // Completed or dismissed: do not auto-mint a new session (resume is explicit).
  const status = await getOnboardingBootstrap({
    actorUserId: userId,
    userId,
    ensureSession: false,
  });

  const initial =
    status.gate === "completed" || status.gate === "dismissed"
      ? status
      : await getOnboardingBootstrap({
          actorUserId: userId,
          userId,
          ensureSession: true,
        });

  return <OnboardingFlow initial={initial} />;
}
