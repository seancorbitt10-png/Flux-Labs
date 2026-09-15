/**
 * Safe operational logging for AI paths.
 *
 * Allowed: known provider ids, known outcome categories, model key, latency,
 * accounting outcome, non-secret operation identifiers, execution certainty.
 *
 * Forbidden: API keys, Authorization headers, confirm secrets, raw student
 * prompts, raw provider payloads that may contain student content.
 *
 * Controlled fields use narrow unions matching real application values —
 * not a generic "sanitize everything" layer that could hide bugs.
 */

import type { ProviderExecutionCertainty } from "./provider-errors";

/** Known provider identifiers that may appear in ops logs. */
export type AIOpsProviderId = "openai" | "stub";

/**
 * Finite operational outcomes used by factory / smoke / accounting paths.
 * Keep this list aligned with real call sites — do not invent free-form tags.
 */
export type AIOpsOutcome =
  | "success"
  | "provider_error"
  | "production_active"
  | "failed_consumed"
  | "failed_released"
  | "log_suppressed"
  | "dispatch_start"
  | "smoke_pass"
  | "smoke_fail"
  | "gate_not_ready";

export type AIOpsLogEvent = {
  event:
    | "provider_selected"
    | "provider_complete"
    | "provider_error"
    | "reservation_outcome"
    | "smoke_test";
  provider?: AIOpsProviderId;
  modelKey?: string;
  outcome?: AIOpsOutcome;
  executionCertainty?: ProviderExecutionCertainty;
  latencyMs?: number;
  operationId?: string;
  /** Free-form non-sensitive detail (never pass prompts, keys, or replies). */
  detail?: string;
};

const SENSITIVE_KEY =
  /(api[_-]?key|authorization|bearer|confirm|password|secret)/i;

const KNOWN_PROVIDERS: ReadonlySet<string> = new Set(["openai", "stub"]);
const KNOWN_OUTCOMES: ReadonlySet<string> = new Set([
  "success",
  "provider_error",
  "production_active",
  "failed_consumed",
  "failed_released",
  "log_suppressed",
  "dispatch_start",
  "smoke_pass",
  "smoke_fail",
  "gate_not_ready",
]);
const KNOWN_CERTAINTIES: ReadonlySet<string> = new Set([
  "not_dispatched",
  "ambiguous",
  "dispatched",
]);

function assertSafeDetail(detail: string | undefined): void {
  if (!detail) return;
  if (SENSITIVE_KEY.test(detail)) {
    throw new Error("AI ops log refused potentially sensitive detail.");
  }
}

function assertControlledFields(event: AIOpsLogEvent): void {
  if (event.provider !== undefined && !KNOWN_PROVIDERS.has(event.provider)) {
    throw new Error("AI ops log refused unknown provider identifier.");
  }
  if (event.outcome !== undefined && !KNOWN_OUTCOMES.has(event.outcome)) {
    throw new Error("AI ops log refused unknown operational outcome.");
  }
  if (
    event.executionCertainty !== undefined &&
    !KNOWN_CERTAINTIES.has(event.executionCertainty)
  ) {
    throw new Error("AI ops log refused unknown executionCertainty.");
  }
}

/** Emit a structured ops log line. Never throws for logging failures. */
export function logAIOps(event: AIOpsLogEvent): void {
  try {
    assertSafeDetail(event.detail);
    assertSafeDetail(event.operationId);
    assertControlledFields(event);
    // Avoid logging student content by construction — callers must not pass it.
    console.info("[flux-ai-ops]", {
      event: event.event,
      provider: event.provider,
      modelKey: event.modelKey,
      outcome: event.outcome,
      executionCertainty: event.executionCertainty,
      latencyMs: event.latencyMs,
      operationId: event.operationId,
      detail: event.detail,
    });
  } catch {
    console.info("[flux-ai-ops]", {
      event: event.event,
      outcome: "log_suppressed",
    });
  }
}
