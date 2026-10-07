import { billingApplicationUrl } from "@/lib/billing/stripe";
import { assertRateLimit } from "@/lib/security/rate-limit";

export function assertBillingSameOrigin(request: Request): void {
  const expectedOrigin = new URL(billingApplicationUrl()).origin;
  const origin = request.headers.get("origin");

  if (origin !== expectedOrigin) {
    throw new Error("Billing request origin is not authorized.");
  }
}

export function assertBillingRateLimit(userId: string): void {
  assertRateLimit("billing:" + userId, {
    limit: 10,
    windowMs: 60_000,
  });
}
