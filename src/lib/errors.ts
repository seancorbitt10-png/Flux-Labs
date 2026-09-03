/**
 * Application error types. Never expose raw provider/DB errors to clients.
 */

export class AppError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status: number = 400,
    public readonly userMessage?: string,
  ) {
    super(message);
    this.name = "AppError";
  }

  toClient() {
    return {
      error: this.code,
      message: this.userMessage ?? this.message,
    };
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "Authentication required") {
    super(message, "UNAUTHORIZED", 401, "Please sign in to continue.");
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "Forbidden") {
    super(message, "FORBIDDEN", 403, "You do not have access to this resource.");
  }
}

export class EntitlementError extends AppError {
  constructor(
    message = "Entitlement limit reached",
    userMessage = "You have reached your usage limit for this feature.",
  ) {
    super(message, "ENTITLEMENT_LIMIT", 402, userMessage);
  }
}

export class ValidationError extends AppError {
  constructor(message: string) {
    super(message, "VALIDATION_ERROR", 400, message);
  }
}

export class RateLimitError extends AppError {
  constructor(message = "Too many requests") {
    super(message, "RATE_LIMITED", 429, "Please wait a moment and try again.");
  }
}

export function toClientError(error: unknown): {
  error: string;
  message: string;
  status: number;
} {
  if (error instanceof AppError) {
    return { ...error.toClient(), status: error.status };
  }

  console.error("[unhandled]", error instanceof Error ? error.message : "unknown");

  return {
    error: "INTERNAL_ERROR",
    message: "Something went wrong. Please try again.",
    status: 500,
  };
}
