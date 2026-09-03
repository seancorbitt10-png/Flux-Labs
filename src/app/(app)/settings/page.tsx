import { PageHeader } from "@/components/ui/page-header";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db/prisma";
import { getActiveEntitlement } from "@/lib/entitlements/check";
import { logoutAction } from "@/lib/auth/actions";
import { Button } from "@/components/ui/button";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const session = await auth();
  const userId = session!.user!.id;
  const [user, profile, entitlement] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId } }),
    prisma.studentProfile.findUnique({ where: { userId } }),
    getActiveEntitlement(userId),
  ]);

  return (
    <div className="animate-fade-up max-w-xl space-y-8">
      <PageHeader
        title="Settings"
        description="Account, preferences, privacy, and subscription controls. Keep V1 minimal — customization comes later."
      />

      <section className="space-y-3 border-t border-foreground/10 pt-6">
        <h2 className="text-sm font-medium">Account</h2>
        <dl className="space-y-2 text-sm text-foreground/70">
          <div className="flex justify-between gap-4">
            <dt>Name</dt>
            <dd className="text-foreground">{user?.name ?? "—"}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt>Email</dt>
            <dd className="text-foreground">{user?.email}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt>Display name</dt>
            <dd className="text-foreground">{profile?.displayName ?? "—"}</dd>
          </div>
        </dl>
      </section>

      <section className="space-y-3 border-t border-foreground/10 pt-6">
        <h2 className="text-sm font-medium">Subscription</h2>
        <p className="text-sm text-foreground/70">
          {entitlement
            ? `${entitlement.plan.label} · status ${entitlement.entitlement.status.toLowerCase()}`
            : "No active plan"}
        </p>
        <p className="text-xs text-foreground/50">
          Billing integration arrives in Phase 9. Limits are enforced
          server-side today.
        </p>
      </section>

      <section className="space-y-3 border-t border-foreground/10 pt-6">
        <h2 className="text-sm font-medium">Session</h2>
        <form action={logoutAction}>
          <Button type="submit" variant="secondary">
            Sign out
          </Button>
        </form>
      </section>
    </div>
  );
}
