import { beforeEach, describe, expect, it } from "vitest";
import {
  getCustomerPlanPriceUsd,
  getMonthlyPriceCents,
  getPlanFromStripePriceId,
  isBillablePlanTier,
} from "@/lib/billing/config";
import { getPlanDefinition } from "@/lib/entitlements/plans";
import { maxEnvelopeCostMicros } from "@/lib/entitlements/cost-table";

const MINIMUM_VARIABLE_GROSS_MARGIN = 0.6;

// Conservative planning assumption used for the economic guard.
// 2.9% domestic card + 1.5% international card + 1% currency conversion
// + 0.7% Stripe Billing + $0.30 fixed card fee.
function conservativePaymentFeeMicros(priceCents: number): number {
  const revenueUsd = priceCents / 100;
  return Math.ceil((revenueUsd * 0.061 + 0.3) * 1_000_000);
}

function maxPlanAiCostMicros(
  tier: "PLUS" | "PRO",
): number {
  const plan = getPlanDefinition(tier);
  const standard = maxEnvelopeCostMicros("flux-standard");
  const advanced = maxEnvelopeCostMicros("flux-advanced");

  return (
    (plan.limits.aiSessions ?? 0) * standard +
    (plan.limits.documentAnalyses ?? 0) * standard +
    (plan.limits.advancedTutoring ?? 0) * advanced
  );
}

describe("billing economics configuration", () => {
  beforeEach(() => {
    delete process.env.STRIPE_PRICE_PLUS;
    delete process.env.STRIPE_PRICE_PRO;
  });

  it("locks the approved Plus and Pro customer prices", () => {
    expect(getMonthlyPriceCents("PLUS")).toBe(800);
    expect(getMonthlyPriceCents("PRO")).toBe(1200);
    expect(getCustomerPlanPriceUsd("PLUS")).toBe("8.00");
    expect(getCustomerPlanPriceUsd("PRO")).toBe("12.00");
  });

  it("does not treat trial as a paid billing tier", () => {
    expect(isBillablePlanTier("FREE_TRIAL")).toBe(false);
    expect(isBillablePlanTier("PLUS")).toBe(true);
    expect(isBillablePlanTier("PRO")).toBe(true);
  });

  it("maps only explicitly configured Stripe prices to paid plans", () => {
    process.env.STRIPE_PRICE_PLUS = "price_plus_test";
    process.env.STRIPE_PRICE_PRO = "price_pro_test";

    expect(getPlanFromStripePriceId("price_plus_test")).toBe("PLUS");
    expect(getPlanFromStripePriceId("price_pro_test")).toBe("PRO");
    expect(getPlanFromStripePriceId("price_unknown")).toBeNull();
  });

  it("keeps Plus above the 60% minimum variable gross-margin floor", () => {
    const revenue = getMonthlyPriceCents("PLUS") * 10_000;
    const variableCost =
      maxPlanAiCostMicros("PLUS") + conservativePaymentFeeMicros(800);
    const margin = 1 - variableCost / revenue;

    expect(margin).toBeGreaterThanOrEqual(MINIMUM_VARIABLE_GROSS_MARGIN);
  });

  it("keeps Pro above the 60% minimum variable gross-margin floor", () => {
    const revenue = getMonthlyPriceCents("PRO") * 10_000;
    const variableCost =
      maxPlanAiCostMicros("PRO") + conservativePaymentFeeMicros(1200);
    const margin = 1 - variableCost / revenue;

    expect(margin).toBeGreaterThanOrEqual(MINIMUM_VARIABLE_GROSS_MARGIN);
  });
});
