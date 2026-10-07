import { beforeEach, describe, expect, it } from "vitest";
import {
  getCustomerPlanPriceUsd,
  getMonthlyPriceCents,
  getPlanFromStripePriceId,
  isBillablePlanTier,
} from "@/lib/billing/config";

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
});
