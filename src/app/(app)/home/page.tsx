import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { requireUserId } from "@/lib/auth/session";
import { auth } from "@/lib/auth";
import { getActiveEntitlement } from "@/lib/entitlements/check";
import { resolveOnboardingGate } from "@/lib/onboarding/session";
import { prisma } from "@/lib/db/prisma";

export const metadata = { title: "Home" };

export default async function HomePage() {
  const userId = await requireUserId();
  const session = await auth();
  const [profile, entitlement, onboarding] = await Promise.all([
    prisma.studentProfile.findUnique({ where: { userId } }),
    getActiveEntitlement(userId),
    resolveOnboardingGate({ actorUserId: userId, userId }),
  ]);

  const firstName =
    profile?.displayName?.split(" ")[0] ??
    session?.user?.name?.split(" ")[0] ??
    "there";

  const showSetupPrompt =
    onboarding.gate === "needed" || onboarding.gate === "in_progress";

  return (
    <div className="animate-fade-up">
      <PageHeader
        title={`Welcome, ${firstName}`}
        description="Your academic command center. Priorities, recommendations, and study entry points will grow here as Flux learns your context."
      />

      {showSetupPrompt ? (
        <div className="mb-6 rounded-lg border border-foreground/15 bg-background/70 p-4">
          <p className="text-sm font-medium">Finish academic setup</p>
          <p className="mt-1 text-sm text-foreground/65">
            A short setup helps Flux personalize study help. You can skip anytime.
          </p>
          <Link
            href="/onboarding"
            className="mt-3 inline-flex min-h-11 items-center text-sm font-medium underline-offset-4 hover:underline"
          >
            Continue setup
          </Link>
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <EmptyState
          title="Today's priorities"
          body="Classes, tasks, and calendar arrive in Phase 3. For now, open Study to try guided AI assistance."
        />
        <EmptyState
          title="Your plan"
          body={
            entitlement
              ? `${entitlement.plan.label} · ${
                  entitlement.trial
                    ? `${entitlement.trial.aiSessionsUsed}/${entitlement.plan.limits.aiSessions ?? "∞"} AI sessions used`
                    : "Active"
                }`
              : "No active entitlement found."
          }
        />
      </div>
    </div>
  );
}
