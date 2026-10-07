"use client";

import { useState } from "react";
import type { BillablePlanTier } from "@/lib/billing/config";

type BillingControlsProps = {
  activePlan: "FREE_TRIAL" | "PLUS" | "PRO" | null;
  hasBillingAccount: boolean;
};

export function BillingControls({
  activePlan,
  hasBillingAccount,
}: BillingControlsProps) {
  const [pending, setPending] = useState<BillablePlanTier | "portal" | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  async function startCheckout(plan: BillablePlanTier) {
    setPending(plan);
    setError(null);
    try {
      const response = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ plan }),
      });
      const data = (await response.json()) as {
        url?: string;
        message?: string;
      };
      if (!response.ok || !data.url) {
        throw new Error(data.message ?? "Unable to start checkout.");
      }
      window.location.assign(data.url);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Unable to start checkout.",
      );
      setPending(null);
    }
  }

  async function openPortal() {
    setPending("portal");
    setError(null);
    try {
      const response = await fetch("/api/billing/portal", { method: "POST" });
      const data = (await response.json()) as {
        url?: string;
        message?: string;
      };
      if (!response.ok || !data.url) {
        throw new Error(data.message ?? "Unable to open billing.");
      }
      window.location.assign(data.url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to open billing.");
      setPending(null);
    }
  }

  const paid = activePlan === "PLUS" || activePlan === "PRO";

  return (
    <div className="space-y-4">
      {paid ? (
        <button
          type="button"
          onClick={openPortal}
          disabled={pending !== null || !hasBillingAccount}
          className="rounded-md border border-foreground/15 px-4 py-2 text-sm font-medium hover:border-foreground/30 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending === "portal" ? "Opening billing…" : "Manage billing"}
        </button>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {([
            ["PLUS", "$8/month", "Core Flux experience"],
            ["PRO", "$12/month", "Higher academic usage and advanced tutoring"],
          ] as const).map(([plan, price, summary]) => (
            <div
              key={plan}
              className="rounded-lg border border-foreground/10 p-4"
            >
              <div className="space-y-1">
                <p className="text-sm font-semibold">
                  {plan === "PLUS" ? "Plus" : "Pro"}
                </p>
                <p className="text-lg font-bold">{price}</p>
                <p className="text-xs text-foreground/55">{summary}</p>
              </div>
              <button
                type="button"
                className="mt-4 rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={pending !== null}
                onClick={() => startCheckout(plan)}
              >
                {pending === plan
                  ? "Opening checkout…"
                  : "Choose " + (plan === "PLUS" ? "Plus" : "Pro")}
              </button>
            </div>
          ))}
        </div>
      )}

      {error ? (
        <p className="text-sm text-red-600" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
