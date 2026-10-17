import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  hashPasswordResetToken,
  passwordResetIdentifier,
  PASSWORD_RESET_TTL_MS,
  publicHttpsBaseUrl,
  resetEmailConfigured,
} from "@/lib/auth/password-reset";

describe("password reset helpers", () => {
  it("hashes tokens with sha256 hex (never stores plaintext)", () => {
    const token = "plain-reset-token";
    const digest = hashPasswordResetToken(token);
    expect(digest).toMatch(/^[a-f0-9]{64}$/);
    expect(digest).not.toContain(token);
    expect(hashPasswordResetToken(token)).toBe(digest);
    expect(hashPasswordResetToken("other")).not.toBe(digest);
  });

  it("scopes identifiers to the normalized email", () => {
    expect(passwordResetIdentifier("  User@Example.COM ")).toBe(
      "password-reset:user@example.com",
    );
  });

  it("uses a 30-minute expiry window", () => {
    expect(PASSWORD_RESET_TTL_MS).toBe(30 * 60_000);
  });

  it("requires RESEND_API_KEY and RESET_EMAIL_FROM before sending mail", () => {
    expect(
      resetEmailConfigured({
        RESEND_API_KEY: "re_test",
        RESET_EMAIL_FROM: "Flux Labs <no-reply@example.com>",
      }),
    ).toBe(true);
    expect(resetEmailConfigured({ RESEND_API_KEY: "re_test" })).toBe(false);
    expect(
      resetEmailConfigured({
        RESET_EMAIL_FROM: "Flux Labs <no-reply@example.com>",
      }),
    ).toBe(false);
  });

  it("only builds reset links from an https AUTH_URL", () => {
    expect(publicHttpsBaseUrl({ AUTH_URL: "https://app.example.com/" })).toBe(
      "https://app.example.com",
    );
    expect(publicHttpsBaseUrl({ AUTH_URL: "http://localhost:3000" })).toBeNull();
    expect(publicHttpsBaseUrl({})).toBeNull();
  });
});

describe("password-reset public routes", () => {
  it("allows unauthenticated access to forgot/reset pages", () => {
    const src = readFileSync(
      path.join(process.cwd(), "src/middleware.ts"),
      "utf8",
    );
    expect(src).toContain('pathname === "/forgot-password"');
    expect(src).toContain('pathname === "/reset-password"');
    expect(src).toContain('pathname === "/login"');
  });
});

describe("sign-in Forgot password link placement", () => {
  it("puts Forgot password? on the same line as No account? Create one", () => {
    const src = readFileSync(
      path.join(process.cwd(), "src/app/(auth)/login/page.tsx"),
      "utf8",
    );
    const footer = src.match(
      /<p className="text-sm font-medium text-muted">([\s\S]*?Create one[\s\S]*?Forgot password\?[\s\S]*?)<\/p>/,
    );
    expect(footer).not.toBeNull();
    const block = footer![1];
    expect(block).toContain("No account?");
    expect(block).toContain("Create one");
    expect(block).toContain("Forgot password?");
    expect(block).toContain('href="/register"');
    expect(block).toContain('href="/forgot-password"');
    expect(src).not.toMatch(
      /Forgot password\?[\s\S]*?<\/p>\s*<p[\s\S]*No account\?/,
    );
  });
});
