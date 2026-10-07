import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import { billingApplicationUrl, getStripe } from "@/lib/billing/stripe";
import {
  assertBillingRateLimit,
  assertBillingSameOrigin,
} from "@/lib/billing/request-security";

export async function POST(request: Request) {
  try {
    const userId = await requireUserId();
    assertBillingRateLimit(userId);
    assertBillingSameOrigin(request);

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { stripeCustomerId: true },
    });

    if (!user?.stripeCustomerId) {
      return NextResponse.json(
        {
          error: "BILLING_NOT_CONNECTED",
          message: "No billing account is connected yet.",
        },
        { status: 404 },
      );
    }

    const session = await getStripe().billingPortal.sessions.create({
      customer: user.stripeCustomerId,
      return_url: billingApplicationUrl() + "/billing",
    });

    return NextResponse.json({ url: session.url });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to open billing.";
    return NextResponse.json(
      { error: "BILLING_UNAVAILABLE", message },
      { status: 503 },
    );
  }
}
