import type { PlanTier } from "@prisma/client";
import { getPlanDefinition } from "@/lib/entitlements/plans";

export type BillablePlanTier = "PLUS" | "PRO";

const STRIPE_PRICE_ENV_BY_PLAN: Record<BillablePlanTier, string> = {
  PLUS: "STRIPE_PRICE_PLUS",
  PRO: "STRIPE_PRICE_PRO",
};

export const BILLABLE_PLAN_TIERS = ["PLUS", "PRO"] as const;

export function isBillablePlanTier(value: unknown): value is BillablePlanTier {
  return (
    typeof value === "string" &&
    (BILLABLE_PLAN_TIERS as readonly string[]).includes(value)
  );
}

export function getMonthlyPriceCents(plan: BillablePlanTier): number {
  const price = getPlanDefinition(plan).monthlyPriceCents;
  if (price == null || price < 1) {
    throw new Error("Paid plan has no valid monthly price: " + plan);
  }
  return price;
}

export function getStripePriceEnvKey(plan: BillablePlanTier): string {
  return STRIPE_PRICE_ENV_BY_PLAN[plan];
}

export function getConfiguredStripePriceId(plan: BillablePlanTier): string {
  const envKey = getStripePriceEnvKey(plan);
  const value = process.env[envKey]?.trim();
  if (!value) {
    throw new Error("Missing " + envKey + ". Billing is not configured.");
  }
  return value;
}

export function getPlanFromStripePriceId(
  priceId: string | null | undefined,
): BillablePlanTier | null {
  if (!priceId) return null;

  for (const plan of BILLABLE_PLAN_TIERS) {
    const configured = process.env[getStripePriceEnvKey(plan)]?.trim();
    if (configured && configured === priceId) return plan;
  }

  return null;
}

export function getCustomerPlanPriceUsd(plan: BillablePlanTier): string {
  return (getMonthlyPriceCents(plan) / 100).toFixed(2);
}

export function allConfiguredPlanTiers(): readonly PlanTier[] {
  return [...BILLABLE_PLAN_TIERS];
}
