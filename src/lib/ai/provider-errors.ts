/**
 * Normalized AI provider errors.
 * Student-facing messages stay generic — never leak credentials or vendor payloads.
 */

import { AppError } from "@/lib/errors";

const GENERIC_UNAVAILABLE =
  "AI is temporarily unavailable. Please try again in a moment.";

export class AIProviderError extends AppError {
  constructor(
    code: string,
    message: string,
    status = 502,
    userMessage = GENERIC_UNAVAILABLE,
  ) {
    super(message, code, status, userMessage);
    this.name = "AIProviderError";
  }
}

export class AIProviderConfigError extends AIProviderError {
  constructor(message: string) {
    super(
      "AI_PROVIDER_CONFIG",
      message,
      503,
      "AI is not configured. Please try again later.",
    );
    this.name = "AIProviderConfigError";
  }
}

export class AIProviderTimeoutError extends AIProviderError {
  constructor(message = "AI provider request timed out.") {
    super("AI_PROVIDER_TIMEOUT", message, 504, GENERIC_UNAVAILABLE);
    this.name = "AIProviderTimeoutError";
  }
}

export class AIProviderUpstreamError extends AIProviderError {
  constructor(message = "AI provider upstream failure.") {
    super("AI_PROVIDER_UPSTREAM", message, 502, GENERIC_UNAVAILABLE);
    this.name = "AIProviderUpstreamError";
  }
}

export class AIProviderRateLimitError extends AIProviderError {
  constructor(message = "AI provider rate limited the request.") {
    super(
      "AI_PROVIDER_RATE_LIMIT",
      message,
      429,
      "AI is busy right now. Please wait a moment and try again.",
    );
    this.name = "AIProviderRateLimitError";
  }
}

export class AIProviderInvalidResponseError extends AIProviderError {
  constructor(message = "AI provider returned an invalid response.") {
    super("AI_PROVIDER_INVALID_RESPONSE", message, 502, GENERIC_UNAVAILABLE);
    this.name = "AIProviderInvalidResponseError";
  }
}

export class AIProviderLimitError extends AIProviderError {
  constructor(message: string) {
    super(
      "AI_PROVIDER_LIMIT",
      message,
      400,
      "Your request is too large. Please shorten it and try again.",
    );
    this.name = "AIProviderLimitError";
  }
}
