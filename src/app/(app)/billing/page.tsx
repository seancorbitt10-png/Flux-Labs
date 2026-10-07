import { PageHeader } from "@/components/ui/page-header";
import { prisma } from "@/lib/db/prisma";
import { requireUserId } from "@/lib/auth/session";
import { getActiveEntitlement } from "@/lib/entitlements/check";
import { getPlanDefinition } from "@/lib/entitlements/plans";
import { getCustomerPlanPriceUsd } from "@/lib/billing/config";
import { BillingControls } from "@/components/billing/billing-controls";

export const metadata = { title: "Billing" };

export default async function BillingPage() {
  const userId = await requireUserId();
  const [user, entitlement] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { stripeCustomerId: true },
    }),
    getActiveEntitlement(userId),
  ]);

  const activePlan = entitlement?.entitlement.plan ?? null;
  const plans = (["PLUS", "PRO"] as const).map((tier) => {
    const definition = getPlanDefinition(tier);
    return {
      tier,
      label: definition.label,
      priceUsd: getCustomerPlanPriceUsd(tier),
      summary:
        tier === "PLUS"
          ? "Core Flux experience"
          : "Higher academic usage and advanced tutoring",
      aiSessions: definition.limits.aiSessions,
      documentAnalyses: definition.limits.documentAnalyses,
      advancedTutoring: definition.limits.advancedTutoring,
    };
  });

  return (
    <div className="animate-fade-up max-w-2xl space-y-8">
      <PageHeader
        title="Billing"
        description="Manage your Flux Labs subscription. Billing is handled securely by Stripe."
      />

      <section className="space-y-3 border-t border-foreground/10 pt-6">
        <h2 className="text-sm font-medium">Current plan</h2>
        <p className="text-sm text-foreground/70">
          {entitlement ? entitlement.plan.label : "No active plan"}
          {entitlement?.entitlement.endsAt
            ? " · access through " +
              entitlement.entitlement.endsAt.toLocaleDateString()
            : ""}
        </p>
      </section>

      <section className="space-y-3 border-t border-foreground/10 pt-6">
        <h2 className="text-sm font-medium">
          {activePlan === "PLUS" || activePlan === "PRO"
            ? "Manage subscription"
            : "Choose a plan"}
        </h2>

        <BillingControls
          activePlan={activePlan}
          hasBillingAccount={Boolean(user?.stripeCustomerId)}
          plans={plans}
        />
      </section>

      <p className="text-xs text-foreground/45">
        Taxes, refunds, disputes, and payment-provider fees are handled
        separately from Flux&apos;s AI usage economics.
      </p>
    </div>
  );
}
