import {
  describeThrown,
  sanitizeDiagnosticText,
  sanitizeErrorName,
} from "./password-reset-diagnostics";

export const RESEND_EMAILS_URL = "https://api.resend.com/emails";
export const RESEND_TIMEOUT_MS = 10_000;

/**
 * Result of one Resend send attempt.
 *
 * `rejected` (HTTP 4xx) is definitive: Resend declined the request, so no
 * email was queued and the unused reset token may be deleted.
 *
 * `unavailable` (HTTP 5xx), `timeout`, and `network_error` are ambiguous:
 * Resend may still have accepted and queued the email, so the reset token
 * must be retained (it is hashed, expires in 30 minutes, and is single-use).
 */
export type ResendSendResult =
  | { kind: "accepted"; httpStatus: number; messageId?: string }
  | {
      kind: "rejected";
      httpStatus: number;
      errorName?: string;
      errorMessage?: string;
    }
  | {
      kind: "unavailable";
      httpStatus: number;
      errorName?: string;
      errorMessage?: string;
    }
  | { kind: "timeout" }
  | { kind: "network_error"; errorName: string; errorCode?: string };

const MAX_BODY_CHARS = 4_000;

async function readErrorBody(
  response: Response,
): Promise<{ errorName?: string; errorMessage?: string }> {
  try {
    const text = (await response.text()).slice(0, MAX_BODY_CHARS);
    const parsed: unknown = JSON.parse(text);
    if (parsed && typeof parsed === "object") {
      const body = parsed as Record<string, unknown>;
      return {
        errorName: sanitizeErrorName(body.name),
        errorMessage: sanitizeDiagnosticText(body.message),
      };
    }
  } catch {
    // Non-JSON or unreadable body: status code alone is still reported.
  }
  return {};
}

async function readMessageId(response: Response): Promise<string | undefined> {
  try {
    const parsed: unknown = JSON.parse(
      (await response.text()).slice(0, MAX_BODY_CHARS),
    );
    const id = (parsed as { id?: unknown } | null)?.id;
    return typeof id === "string" ? id : undefined;
  } catch {
    return undefined;
  }
}

function isTimeout(error: unknown): boolean {
  const name = (error as { name?: unknown } | null)?.name;
  return name === "TimeoutError" || name === "AbortError";
}

export async function sendPasswordResetEmail(args: {
  apiKey: string;
  from: string;
  to: string;
  resetUrl: string;
  timeoutMs?: number;
}): Promise<ResendSendResult> {
  try {
    const response = await fetch(RESEND_EMAILS_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${args.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: args.from,
        to: [args.to],
        subject: "Reset your Flux Labs password",
        text:
          `We received a request to reset your Flux Labs password. This link expires in 30 minutes and can only be used once: ${args.resetUrl}\n\n` +
          `If you did not request this, you can ignore this email.`,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(args.timeoutMs ?? RESEND_TIMEOUT_MS),
    });

    if (response.ok) {
      return {
        kind: "accepted",
        httpStatus: response.status,
        messageId: await readMessageId(response),
      };
    }

    const detail = await readErrorBody(response);
    return {
      kind: response.status >= 500 ? "unavailable" : "rejected",
      httpStatus: response.status,
      ...detail,
    };
  } catch (error) {
    if (isTimeout(error)) return { kind: "timeout" };
    return { kind: "network_error", ...describeThrown(error) };
  }
}
