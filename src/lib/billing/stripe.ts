import Stripe from "stripe";

let stripeClient: Stripe | null = null;

export function getStripe(): Stripe {
  const secretKey = process.env.STRIPE_SECRET_KEY?.trim();
  if (!secretKey) {
    throw new Error("Stripe is not configured. Set STRIPE_SECRET_KEY.");
  }

  if (!stripeClient) {
    stripeClient = new Stripe(secretKey);
  }

  return stripeClient;
}

export function getStripeWebhookSecret(): string {
  const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  if (!secret) {
    throw new Error(
      "Stripe webhook verification is not configured. Set STRIPE_WEBHOOK_SECRET.",
    );
  }
  return secret;
}

export function billingApplicationUrl(): string {
  const url = process.env.AUTH_URL?.trim();
  if (!url) {
    throw new Error("AUTH_URL is required for billing redirects.");
  }
  return url.replace(/\/$/, "");
}
