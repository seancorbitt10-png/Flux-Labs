/**
 * Plan and entitlement configuration.
 *
 * Limits live here (not hard-coded in UI) so they can change without
 * rewriting application logic. Phase 9 will wire billing; Phase 1 stores
 * entitlement state and enforces checks server-side.
 */

import type { PlanTier, UsageCapability } from "@prisma/client";

export type CapabilityLimits = {
  aiSessions: number | null; // null = unlimited within budget
  documentAnalyses: number | null;
  advancedTutoring: number | null;
  /** Soft AI budget in USD micros (1e-6 USD). null = no soft cap. */
  aiBudgetMicros: number | null;
};

export type PlanDefinition = {
  tier: PlanTier;
  label: string;
  description: string;
  /** User-facing capabilities — never expose model names as the product abstraction */
  capabilities: string[];
  limits: CapabilityLimits;
  trialDays?: number;
};

/**
 * Experimental trial numbers — configurable, not permanently locked.
 * Target envelope: ~$1 avg AI cost / trial user, max ~$1.50–$2.00.
 */
export const PLAN_DEFINITIONS: Record<PlanTier, PlanDefinition> = {
  FREE_TRIAL: {
    tier: "FREE_TRIAL",
    label: "Trial",
    description: "7-day controlled trial of the full product experience.",
    capabilities: [
      "Guided AI tutoring",
      "Academic workspace",
      "Limited document analysis",
    ],
    limits: {
      aiSessions: 10,
      documentAnalyses: 3,
      advancedTutoring: 1,
      aiBudgetMicros: 2_000_000, // $2.00 soft ceiling
    },
    trialDays: 7,
  },
  PLUS: {
    tier: "PLUS",
    label: "Plus",
    description: "Expanded study assistance and planning.",
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
      // Billable AI must never use GENERAL as an unlimited escape hatch.
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
