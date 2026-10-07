"use client";

import { useState } from "react";
import type { BillablePlanTier } from "@/lib/billing/config";

type BillingPlan = {
  tier: BillablePlanTier;
  label: string;
  priceUsd: string;
  summary: string;
  aiSessions: number | null;
  documentAnalyses: number | null;
  advancedTutoring: number | null;
};

type BillingControlsProps = {
  activePlan: "FREE_TRIAL" | "PLUS" | "PRO" | null;
  hasBillingAccount: boolean;
  plans: BillingPlan[];
};

export function BillingControls({
  activePlan,
  hasBillingAccount,
  plans,
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
        <div className="grid gap-4 sm:grid-cols-2">
          {plans.map((plan) => (
            <div
              key={plan.tier}
              className="rounded-lg border border-foreground/10 p-4"
            >
              <div className="space-y-1">
                <p className="text-sm font-semibold">{plan.label}</p>
                <p className="text-lg font-bold">
                  ${plan.priceUsd}/month
                </p>
                <p className="text-xs text-foreground/55">{plan.summary}</p>
              </div>
              <dl className="mt-4 space-y-1 text-xs text-foreground/60">
                <div className="flex justify-between gap-3">
                  <dt>AI sessions</dt>
                  <dd className="font-medium text-foreground">{plan.aiSessions ?? "Unlimited"}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt>Document analyses</dt>
                  <dd className="font-medium text-foreground">{plan.documentAnalyses ?? "Unlimited"}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt>Advanced tutoring</dt>
                  <dd className="font-medium text-foreground">{plan.advancedTutoring ?? "Unlimited"}</dd>
                </div>
              </dl>
              <button
                type="button"
                className="mt-4 rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={pending !== null}
                onClick={() => startCheckout(plan.tier)}
              >
                {pending === plan.tier ? "Opening checkout…" : "Choose " + plan.label}
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
