import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { prisma } from "@/lib/db/prisma";
import {
  bindStripeCustomerToUser,
  syncStripeSubscription,
} from "@/lib/billing/subscriptions";
import { getStripe, getStripeWebhookSecret } from "@/lib/billing/stripe";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json(
      { error: "WEBHOOK_SIGNATURE_MISSING" },
      { status: 400 },
    );
  }

  let event: Stripe.Event;
  try {
    const rawBody = await request.text();
    event = getStripe().webhooks.constructEvent(
      rawBody,
      signature,
      getStripeWebhookSecret(),
    );
  } catch {
    return NextResponse.json(
      { error: "WEBHOOK_SIGNATURE_INVALID" },
      { status: 400 },
    );
  }

  try {
    await prisma.$transaction(async (tx) => {
      const seen = await tx.billingWebhookEvent.findUnique({
        where: { id: event.id },
      });
      if (seen) return;

      await tx.billingWebhookEvent.create({
        data: { id: event.id, type: event.type },
      });

      switch (event.type) {
        case "checkout.session.completed": {
          const session = event.data.object as Stripe.Checkout.Session;
          const userId = session.metadata?.userId?.trim();
          const customerId =
            typeof session.customer === "string"
              ? session.customer
              : null;

          if (userId && customerId) {
            await bindStripeCustomerToUser(tx, userId, customerId);
          }
          break;
        }

        case "customer.subscription.created":
        case "customer.subscription.updated":
        case "customer.subscription.paused":
        case "customer.subscription.resumed":
          await syncStripeSubscription(
            tx,
            event.data.object as Stripe.Subscription,
          );
          break;

        case "customer.subscription.deleted": {
          const subscription = event.data.object as Stripe.Subscription;
          const entitlement = await tx.entitlement.findUnique({
            where: { externalSubscriptionId: subscription.id },
          });

          if (entitlement) {
            await tx.entitlement.update({
              where: { id: entitlement.id },
              data: {
                status: "CANCELLED",
                endsAt:
                  typeof subscription.current_period_end === "number"
                    ? new Date(subscription.current_period_end * 1000)
                    : new Date(),
                metadata: {
                  stripeSubscriptionStatus: "canceled",
                  cancelAtPeriodEnd: false,
                },
              },
            });
          }
          break;
        }

        default:
          break;
      }
    });

    return NextResponse.json({ received: true });
  } catch {
    return NextResponse.json(
      { error: "WEBHOOK_PROCESSING_FAILED" },
      { status: 500 },
    );
  }
}
