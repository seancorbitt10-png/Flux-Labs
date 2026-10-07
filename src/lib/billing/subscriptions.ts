import type { Prisma, PlanTier } from "@prisma/client";
import type Stripe from "stripe";
import {
  getPlanFromStripePriceId,
  type BillablePlanTier,
} from "@/lib/billing/config";

function unixToDate(value: number | null | undefined): Date | null {
  return typeof value === "number" && Number.isFinite(value)
    ? new Date(value * 1000)
    : null;
}

function subscriptionPriceId(
  subscription: Stripe.Subscription,
): string | null {
  return subscription.items.data[0]?.price?.id ?? null;
}

function entitlementStatusForSubscription(
  status: Stripe.Subscription.Status,
): "ACTIVE" | "SUSPENDED" | "CANCELLED" | "EXPIRED" {
  switch (status) {
    case "active":
    case "trialing":
      return "ACTIVE";
    case "canceled":
      return "CANCELLED";
    case "incomplete_expired":
      return "EXPIRED";
    case "incomplete":
    case "past_due":
    case "unpaid":
    case "paused":
    default:
      return "SUSPENDED";
  }
}

function subscriptionMetadata(subscription: Stripe.Subscription) {
  return {
    stripeSubscriptionStatus: subscription.status,
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
  };
}

export async function syncStripeSubscription(
  tx: Prisma.TransactionClient,
  subscription: Stripe.Subscription,
): Promise<void> {
  const userId = subscription.metadata?.userId?.trim();
  if (!userId) {
    throw new Error(
      "Stripe subscription " +
        subscription.id +
        " is missing required Flux userId metadata.",
    );
  }

  const plan = getPlanFromStripePriceId(subscriptionPriceId(subscription));
  if (!plan) return;

  const status = entitlementStatusForSubscription(subscription.status);
  const startsAt = unixToDate(subscription.start_date) ?? new Date();
  const endsAt = unixToDate(subscription.current_period_end);
  const metadata = subscriptionMetadata(subscription);

  const existingBySubscription = await tx.entitlement.findUnique({
    where: { externalSubscriptionId: subscription.id },
  });

  if (existingBySubscription) {
    await tx.entitlement.update({
      where: { id: existingBySubscription.id },
      data: {
        plan: plan satisfies PlanTier,
        status,
        startsAt,
        endsAt,
        metadata,
      },
    });
    return;
  }

  const active = await tx.entitlement.findFirst({
    where: { userId, status: "ACTIVE" },
    orderBy: { createdAt: "desc" },
  });

  if (active) {
    if (active.plan === "FREE_TRIAL" && status !== "ACTIVE") {
      // Do not consume or replace a live app trial merely because a Stripe
      // Checkout session created an incomplete/failed subscription.
      return;
    }

    if (active.plan === "FREE_TRIAL") {
      await tx.entitlement.update({
        where: { id: active.id },
        data: {
          plan,
          status,
          startsAt,
          endsAt,
          externalSubscriptionId: subscription.id,
          metadata,
        },
      });

      await tx.trial.updateMany({
        where: { userId, convertedAt: null },
        data: { convertedAt: new Date() },
      });
      return;
    }

    // One active entitlement per user is a deliberate invariant.
    throw new Error(
      "User " +
        userId +
        " already has an active paid entitlement while subscription " +
        subscription.id +
        " was received.",
    );
  }

  const existingLatest = await tx.entitlement.findFirst({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });

  if (existingLatest) {
    await tx.entitlement.update({
      where: { id: existingLatest.id },
      data: {
        plan,
        status,
        startsAt,
        endsAt,
        externalSubscriptionId: subscription.id,
        metadata,
      },
    });
    return;
  }

  await tx.entitlement.create({
    data: {
      userId,
      plan,
      status,
      startsAt,
      endsAt,
      externalSubscriptionId: subscription.id,
      metadata,
    },
  });
}

export async function bindStripeCustomerToUser(
  tx: Prisma.TransactionClient,
  userId: string,
  stripeCustomerId: string,
): Promise<void> {
  await tx.user.update({
    where: { id: userId },
    data: { stripeCustomerId },
  });
}
