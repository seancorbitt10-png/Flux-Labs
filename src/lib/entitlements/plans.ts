/**
 * Plan and entitlement configuration.
 *
 * Limits live here (not hard-coded in UI) so they can change without
 * rewriting application logic. Billing prices also live here as the
 * product-level source of truth; Stripe Price IDs remain environment secrets.
 */

import type { PlanTier, UsageCapability } from "@prisma/client";

export type CapabilityLimits = {
  aiSessions: number | null;
  documentAnalyses: number | null;
  advancedTutoring: number | null;
  /** Soft AI budget in USD micros (1e-6 USD). null = no soft cap. */
  aiBudgetMicros: number | null;
};

export type PlanDefinition = {
  tier: PlanTier;
  label: string;
  description: string;
  /** Monthly customer price in USD cents. null for non-paid tiers. */
  monthlyPriceCents: number | null;
  capabilities: string[];
  limits: CapabilityLimits;
  trialDays?: number;
};

/**
 * Approved billing economics:
 * - Plus: $8/month
 * - Pro: $12/month
 *
 * Existing capability allowances remain unchanged.
 */
export const PLAN_DEFINITIONS: Record<PlanTier, PlanDefinition> = {
  FREE_TRIAL: {
    tier: "FREE_TRIAL",
    label: "Trial",
    description: "7-day controlled trial of the full product experience.",
    monthlyPriceCents: null,
    capabilities: [
      "Guided AI tutoring",
      "Academic workspace",
      "Limited document analysis",
    ],
    limits: {
      aiSessions: 10,
      documentAnalyses: 3,
      advancedTutoring: 1,
      aiBudgetMicros: 2_000_000,
    },
    trialDays: 7,
  },
  PLUS: {
    tier: "PLUS",
    label: "Plus",
    description: "Expanded study assistance and planning.",
    monthlyPriceCents: 800,
    capabilities: [
      "Guided AI tutoring",
      "Study planning",
      "Document-grounded help",
      "Progress insights",
    ],
    limits: {
      aiSessions: 100,
      documentAnalyses: 25,
      advancedTutoring: 20,
      aiBudgetMicros: 5_000_000,
    },
  },
  PRO: {
    tier: "PRO",
    label: "Pro",
    description: "Full academic operating system capabilities.",
    monthlyPriceCents: 1200,
    capabilities: [
      "Everything in Plus",
      "Advanced tutoring workflows",
      "Higher usage allowances",
      "Priority features as they ship",
    ],
    limits: {
      aiSessions: 300,
      documentAnalyses: 100,
      advancedTutoring: 80,
      aiBudgetMicros: 15_000_000,
    },
  },
};

export function getPlanDefinition(tier: PlanTier): PlanDefinition {
  return PLAN_DEFINITIONS[tier];
}

export function capabilityToLimitKey(
  capability: UsageCapability,
): keyof Omit<CapabilityLimits, "aiBudgetMicros"> | null {
  switch (capability) {
    case "AI_SESSION":
      return "aiSessions";
    case "DOCUMENT_ANALYSIS":
      return "documentAnalyses";
    case "ADVANCED_TUTORING":
      return "advancedTutoring";
    case "GENERAL":
      return "aiSessions";
    default:
      return "aiSessions";
  }
}

export function trialCounterField(
  capability: UsageCapability,
): "aiSessionsUsed" | "documentAnalysesUsed" | "advancedTutoringUsed" {
  switch (capability) {
    case "DOCUMENT_ANALYSIS":
      return "documentAnalysesUsed";
    case "ADVANCED_TUTORING":
      return "advancedTutoringUsed";
    case "AI_SESSION":
    case "GENERAL":
    default:
      return "aiSessionsUsed";
  }
}
