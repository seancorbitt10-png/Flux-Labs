/**
 * Safe operational logging for AI paths.
 *
 * Allowed: provider id, outcome category, model key, latency, accounting
 * outcome, non-secret operation identifiers.
 *
 * Forbidden: API keys, Authorization headers, confirm secrets, raw student
 * prompts, raw provider payloads that may contain student content.
 */

export type AIOpsLogEvent = {
  event:
    | "provider_selected"
    | "provider_complete"
    | "provider_error"
    | "reservation_outcome"
    | "smoke_test";
  provider?: string;
  modelKey?: string;
  outcome?: string;
  executionCertainty?: string;
  latencyMs?: number;
  operationId?: string;
  /** Free-form non-sensitive detail (never pass prompts, keys, or replies). */
  detail?: string;
};

const SENSITIVE_KEY = /(api[_-]?key|authorization|bearer|confirm|password|secret)/i;

function assertSafeDetail(detail: string | undefined): void {
  if (!detail) return;
  if (SENSITIVE_KEY.test(detail)) {
    throw new Error("AI ops log refused potentially sensitive detail.");
  }
}

/** Emit a structured ops log line. Never throws for logging failures. */
export function logAIOps(event: AIOpsLogEvent): void {
  try {
    assertSafeDetail(event.detail);
    assertSafeDetail(event.operationId);
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
    console.info("[flux-ai-ops]", { event: event.event, outcome: "log_suppressed" });
  }
}
