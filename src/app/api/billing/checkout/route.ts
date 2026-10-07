import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUserId } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import {
  getConfiguredStripePriceId,
  getMonthlyPriceCents,
  isBillablePlanTier,
  type BillablePlanTier,
} from "@/lib/billing/config";
import { billingApplicationUrl, getStripe } from "@/lib/billing/stripe";
import {
  assertBillingRateLimit,
  assertBillingSameOrigin,
} from "@/lib/billing/request-security";
import { getActiveEntitlement } from "@/lib/entitlements/check";

const bodySchema = z
  .object({ plan: z.string().trim().toUpperCase() })
  .strict();

async function ensureStripeCustomer(args: {
  userId: string;
  email: string;
  existingStripeCustomerId: string | null;
}): Promise<string> {
  if (args.existingStripeCustomerId) return args.existingStripeCustomerId;

  const stripe = getStripe();
  const customer = await stripe.customers.create(
    {
      email: args.email,
      metadata: { userId: args.userId },
    },
    { idempotencyKey: "flux-customer-" + args.userId },
  );

  await prisma.user.update({
    where: { id: args.userId },
    data: { stripeCustomerId: customer.id },
  });

  return customer.id;
}

async function assertStripePriceMatchesPlan(
  stripe: ReturnType<typeof getStripe>,
  plan: BillablePlanTier,
): Promise<string> {
  const priceId = getConfiguredStripePriceId(plan);
  const price = await stripe.prices.retrieve(priceId);

  if (
    !price.active ||
    price.currency !== "usd" ||
    price.unit_amount !== getMonthlyPriceCents(plan) ||
    price.type !== "recurring" ||
    price.recurring?.interval !== "month" ||
    price.recurring?.interval_count !== 1
  ) {
    throw new Error(
      "Configured Stripe price for " +
        plan +
        " does not match Flux's approved monthly pricing.",
    );
  }

  return price.id;
}

export async function POST(request: Request) {
  try {
    const userId = await requireUserId();
    assertBillingRateLimit(userId);
    assertBillingSameOrigin(request);

    const body = bodySchema.safeParse(await request.json());
    if (!body.success || !isBillablePlanTier(body.data.plan)) {
      return NextResponse.json(
        { error: "VALIDATION_ERROR", message: "Invalid paid plan." },
        { status: 400 },
      );
    }

    const plan = body.data.plan;
    const [user, entitlement] = await Promise.all([
      prisma.user.findUnique({
        where: { id: userId },
        select: { email: true, stripeCustomerId: true },
      }),
      getActiveEntitlement(userId),
    ]);

    if (!user) {
      return NextResponse.json(
        { error: "ACCOUNT_NOT_FOUND", message: "Account not found." },
        { status: 404 },
      );
    }

    if (
      entitlement &&
      entitlement.entitlement.status === "ACTIVE" &&
      (entitlement.entitlement.plan === "PLUS" ||
        entitlement.entitlement.plan === "PRO")
    ) {
      return NextResponse.json(
        {
          error: "ACTIVE_SUBSCRIPTION",
          message:
            "You already have an active paid subscription. Use Manage billing to change or cancel it.",
        },
        { status: 409 },
      );
    }

    const stripe = getStripe();
    const priceId = await assertStripePriceMatchesPlan(stripe, plan);
    const customerId = await ensureStripeCustomer({
      userId,
      email: user.email,
      existingStripeCustomerId: user.stripeCustomerId,
    });

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      allow_promotion_codes: false,
      client_reference_id: userId,
      metadata: { userId, plan },
      subscription_data: { metadata: { userId, plan } },
      success_url:
        billingApplicationUrl() + "/billing?checkout=success",
      cancel_url:
        billingApplicationUrl() + "/billing?checkout=cancelled",
    });

    if (!session.url) {
      throw new Error("Stripe did not return a Checkout URL.");
    }

    return NextResponse.json({ url: session.url });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to start checkout.";
    return NextResponse.json(
      { error: "BILLING_UNAVAILABLE", message },
      { status: 503 },
    );
  }
}
