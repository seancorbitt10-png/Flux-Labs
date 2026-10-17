import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isValidResetEmailFrom,
  publicHttpsBaseUrl,
  resolveResetEmailConfig,
} from "@/lib/auth/password-reset";
import {
  describeThrown,
  emailCorrelationRef,
  hostOf,
  logPasswordReset,
  sanitizeDiagnosticText,
  sanitizeErrorName,
} from "@/lib/auth/password-reset-diagnostics";
import {
  RESEND_EMAILS_URL,
  sendPasswordResetEmail,
} from "@/lib/auth/password-reset-email";

const GOOD_ENV = {
  RESEND_API_KEY: "re_test_not_a_real_key",
  RESET_EMAIL_FROM: "noreply@fluxlabs.tech",
  AUTH_URL: "https://fluxlabs.tech",
};

describe("resolveResetEmailConfig", () => {
  it("accepts the intended production configuration", () => {
    expect(resolveResetEmailConfig(GOOD_ENV)).toEqual({
      ok: true,
      apiKey: "re_test_not_a_real_key",
      from: "noreply@fluxlabs.tech",
      baseUrl: "https://fluxlabs.tech",
    });
  });

  it("reports each failure with a distinct safe category", () => {
    expect(resolveResetEmailConfig({ ...GOOD_ENV, RESEND_API_KEY: undefined })).toEqual({
      ok: false,
      reason: "config_missing_api_key",
    });
    expect(resolveResetEmailConfig({ ...GOOD_ENV, RESEND_API_KEY: "   " })).toEqual({
      ok: false,
      reason: "config_missing_api_key",
    });
    expect(resolveResetEmailConfig({ ...GOOD_ENV, RESET_EMAIL_FROM: undefined })).toEqual({
      ok: false,
      reason: "config_missing_from",
    });
    expect(
      resolveResetEmailConfig({ ...GOOD_ENV, RESET_EMAIL_FROM: "not an address" }),
    ).toEqual({ ok: false, reason: "config_invalid_from" });
    expect(resolveResetEmailConfig({ ...GOOD_ENV, AUTH_URL: undefined })).toEqual({
      ok: false,
      reason: "config_missing_base_url",
    });
    expect(
      resolveResetEmailConfig({ ...GOOD_ENV, AUTH_URL: "http://fluxlabs.tech" }),
    ).toEqual({ ok: false, reason: "config_base_url_not_https" });
    expect(resolveResetEmailConfig({ ...GOOD_ENV, AUTH_URL: "fluxlabs.tech" })).toEqual({
      ok: false,
      reason: "config_base_url_invalid",
    });
  });

  it("falls back to NEXTAUTH_URL only when AUTH_URL is unset", () => {
    expect(
      resolveResetEmailConfig({
        ...GOOD_ENV,
        AUTH_URL: undefined,
        NEXTAUTH_URL: "https://www.fluxlabs.tech",
      }),
    ).toMatchObject({ ok: true, baseUrl: "https://www.fluxlabs.tech" });
  });

  it("trims whitespace and trailing slashes from the base URL", () => {
    expect(publicHttpsBaseUrl({ AUTH_URL: "  https://www.fluxlabs.tech//\n" })).toBe(
      "https://www.fluxlabs.tech",
    );
  });

  it("rejects a base URL pasted with quotes or embedded credentials", () => {
    expect(publicHttpsBaseUrl({ AUTH_URL: '"https://fluxlabs.tech"' })).toBeNull();
    expect(publicHttpsBaseUrl({ AUTH_URL: "https://user:pw@fluxlabs.tech" })).toBeNull();
  });

  it("validates RESET_EMAIL_FROM against the formats Resend accepts", () => {
    expect(isValidResetEmailFrom("noreply@fluxlabs.tech")).toBe(true);
    expect(isValidResetEmailFrom("Flux Labs <noreply@fluxlabs.tech>")).toBe(true);
    expect(isValidResetEmailFrom("Flux Labs noreply@fluxlabs.tech")).toBe(false);
    expect(isValidResetEmailFrom("<noreply@fluxlabs>")).toBe(false);
    expect(isValidResetEmailFrom("fluxlabs.tech")).toBe(false);
  });
});

describe("diagnostic redaction", () => {
  it("redacts emails, URLs, Resend keys, and opaque tokens", () => {
    const text = sanitizeDiagnosticText(
      "Invalid to student@school.edu see https://fluxlabs.tech/reset-password?token=abc key re_AbCdEf123456 token Zm9vYmFyYmF6cXV4cXV1eHF1dXg",
    );
    expect(text).toBeDefined();
    expect(text).not.toMatch(/student@school\.edu/);
    expect(text).not.toMatch(/https?:\/\//);
    expect(text).not.toMatch(/re_AbCdEf123456/);
    expect(text).not.toMatch(/Zm9vYmFy/);
    expect(text).toContain("[email]");
    expect(text).toContain("[url]");
  });

  it("keeps useful provider wording and bounds length", () => {
    expect(
      sanitizeDiagnosticText("The fluxlabs.tech domain is not verified."),
    ).toBe("The fluxlabs.tech domain is not verified.");
    expect(sanitizeDiagnosticText("x ".repeat(400))!.length).toBeLessThanOrEqual(200);
    expect(sanitizeDiagnosticText(undefined)).toBeUndefined();
    expect(sanitizeDiagnosticText("   ")).toBeUndefined();
  });

  it("only accepts identifier-shaped Resend error names", () => {
    expect(sanitizeErrorName("validation_error")).toBe("validation_error");
    expect(sanitizeErrorName("has spaces and a@b.co")).toBeUndefined();
    expect(sanitizeErrorName(42)).toBeUndefined();
  });

  it("describes thrown values without exposing their message", () => {
    const prismaLike = Object.assign(
      new Error('Invalid `findUnique()` where: { email: "victim@x.edu" }'),
      { code: "P1001" },
    );
    const described = describeThrown(prismaLike);
    expect(described).toEqual({ errorName: "Error", errorCode: "P1001" });
    expect(JSON.stringify(described)).not.toContain("victim@x.edu");

    const fetchFailed = Object.assign(new TypeError("fetch failed"), {
      cause: { code: "ENOTFOUND" },
    });
    expect(describeThrown(fetchFailed)).toEqual({
      errorName: "TypeError",
      errorCode: "ENOTFOUND",
    });
  });

  it("exposes only the hostname of a base URL", () => {
    expect(hostOf("https://www.fluxlabs.tech/reset-password?token=secret")).toBe(
      "www.fluxlabs.tech",
    );
    expect(hostOf("not a url")).toBeUndefined();
  });
});

describe("emailCorrelationRef", () => {
  it("is keyed, stable, case-insensitive, and not the email", () => {
    const a = emailCorrelationRef("Student@School.edu", "secret-one");
    expect(a).toMatch(/^[a-f0-9]{12}$/);
    expect(emailCorrelationRef("student@school.edu", "secret-one")).toBe(a);
    expect(emailCorrelationRef("student@school.edu", "secret-two")).not.toBe(a);
    expect(a).not.toContain("student");
  });

  it("emits nothing when there is no secret to key it with", () => {
    expect(emailCorrelationRef("student@school.edu", undefined)).toBeNull();
    expect(emailCorrelationRef("student@school.edu", "  ")).toBeNull();
  });
});

describe("logPasswordReset", () => {
  afterEach(() => vi.restoreAllMocks());

  it("routes by severity and emits a single JSON line", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    logPasswordReset({ outcome: "resend_accepted", requestId: "r1" });
    logPasswordReset({ outcome: "resend_rejected", requestId: "r2" });
    logPasswordReset({ outcome: "config_missing_api_key", requestId: "r3" });

    expect(info).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse(String(info.mock.calls[0][1]));
    expect(parsed).toMatchObject({
      event: "password_reset_request",
      outcome: "resend_accepted",
      requestId: "r1",
    });
  });

  it("re-sanitizes provider text even if a caller forgets to", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    logPasswordReset({
      outcome: "resend_rejected",
      requestId: "r1",
      resendErrorName: "bad name with spaces",
      resendErrorMessage: "rejected for student@school.edu at https://x.test/p",
      baseHost: "https://evil.test/path?token=abc",
    });
    const line = String(warn.mock.calls[0][1]);
    expect(line).not.toContain("student@school.edu");
    expect(line).not.toContain("https://");
    expect(line).not.toContain("token=abc");
    expect(line).not.toContain("bad name");
  });

  it("never throws, even when console fails", () => {
    vi.spyOn(console, "info").mockImplementation(() => {
      throw new Error("console unavailable");
    });
    expect(() =>
      logPasswordReset({ outcome: "resend_accepted", requestId: "r1" }),
    ).not.toThrow();
  });
});

describe("sendPasswordResetEmail", () => {
  afterEach(() => vi.unstubAllGlobals());

  const args = {
    apiKey: "re_test_not_a_real_key",
    from: "noreply@fluxlabs.tech",
    to: "student@school.edu",
    resetUrl: "https://fluxlabs.tech/reset-password?token=t&email=student%40school.edu",
  };

  function respond(status: number, body: unknown) {
    return vi.fn(
      async () =>
        new Response(typeof body === "string" ? body : JSON.stringify(body), {
          status,
        }),
    );
  }

  it("posts to Resend with bearer auth, a timeout signal, and returns the message id", async () => {
    const fetchMock = respond(200, { id: "49a3999c-0ce1-4ea6-ab68-afcd6dc2e794" });
    vi.stubGlobal("fetch", fetchMock);

    const result = await sendPasswordResetEmail(args);

    expect(result).toEqual({
      kind: "accepted",
      httpStatus: 200,
      messageId: "49a3999c-0ce1-4ea6-ab68-afcd6dc2e794",
    });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(RESEND_EMAILS_URL);
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "Bearer re_test_not_a_real_key",
    );
    expect(init.signal).toBeInstanceOf(AbortSignal);
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({ from: "noreply@fluxlabs.tech", to: ["student@school.edu"] });
  });

  it("classifies a 4xx as a definitive rejection and extracts a useful reason", async () => {
    vi.stubGlobal(
      "fetch",
      respond(403, {
        statusCode: 403,
        name: "validation_error",
        message: "The fluxlabs.tech domain is not verified. Please, add and verify your domain.",
      }),
    );
    const result = await sendPasswordResetEmail(args);
    expect(result).toEqual({
      kind: "rejected",
      httpStatus: 403,
      errorName: "validation_error",
      errorMessage:
        "The fluxlabs.tech domain is not verified. Please, add and verify your domain.",
    });
  });

  it("redacts the recipient if Resend echoes it back", async () => {
    vi.stubGlobal(
      "fetch",
      respond(422, {
        name: "validation_error",
        message: "Invalid `to` field: student@school.edu",
      }),
    );
    const result = await sendPasswordResetEmail(args);
    expect(JSON.stringify(result)).not.toContain("student@school.edu");
  });

  it("classifies 401 invalid key as rejected without leaking the key", async () => {
    vi.stubGlobal(
      "fetch",
      respond(401, { name: "restricted_api_key", message: "API key is invalid" }),
    );
    const result = await sendPasswordResetEmail(args);
    expect(result).toMatchObject({
      kind: "rejected",
      httpStatus: 401,
      errorName: "restricted_api_key",
    });
    expect(JSON.stringify(result)).not.toContain("re_test_not_a_real_key");
  });

  it("reports the status even when the error body is not JSON", async () => {
    vi.stubGlobal("fetch", respond(400, "<html>Bad Request</html>"));
    expect(await sendPasswordResetEmail(args)).toEqual({
      kind: "rejected",
      httpStatus: 400,
    });
  });

  it("treats a 5xx as ambiguous, not as a definitive rejection", async () => {
    vi.stubGlobal("fetch", respond(503, { name: "internal_server_error", message: "try later" }));
    expect(await sendPasswordResetEmail(args)).toMatchObject({
      kind: "unavailable",
      httpStatus: 503,
    });
  });

  it("treats a timeout as ambiguous", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new DOMException("The operation timed out.", "TimeoutError");
      }),
    );
    expect(await sendPasswordResetEmail(args)).toEqual({ kind: "timeout" });
  });

  it("treats a network failure as ambiguous and reports only a safe code", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw Object.assign(new TypeError("fetch failed for student@school.edu"), {
          cause: { code: "ECONNRESET" },
        });
      }),
    );
    const result = await sendPasswordResetEmail(args);
    expect(result).toEqual({
      kind: "network_error",
      errorName: "TypeError",
      errorCode: "ECONNRESET",
    });
    expect(JSON.stringify(result)).not.toContain("student@school.edu");
  });
});
