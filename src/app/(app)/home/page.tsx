import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { requireUserId } from "@/lib/auth/session";
import { auth } from "@/lib/auth";
import { getActiveEntitlement } from "@/lib/entitlements/check";
import { prisma } from "@/lib/db/prisma";

export const metadata = { title: "Home" };

export default async function HomePage() {
  const userId = await requireUserId();
  const session = await auth();
  const [profile, entitlement] = await Promise.all([
    prisma.studentProfile.findUnique({ where: { userId } }),
    getActiveEntitlement(userId),
  ]);

  const firstName =
    profile?.displayName?.split(" ")[0] ??
    session?.user?.name?.split(" ")[0] ??
    "there";

  return (
    <div className="animate-fade-up">
      <PageHeader
        title={`Welcome, ${firstName}`}
        description="Your academic command center. Priorities, recommendations, and study entry points will grow here as Flux learns your context."
      />

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
