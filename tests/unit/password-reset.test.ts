import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  hashPasswordResetToken,
  passwordResetIdentifier,
  PASSWORD_RESET_TTL_MS,
  publicHttpsBaseUrl,
  resetEmailConfigured,
  buildPasswordResetUrl,
  resetBaseUrlSource,
} from "@/lib/auth/password-reset";
import { isPublicPath } from "@/lib/auth/public-paths";
import {
  validateNewPassword,
  validatePasswordResetSubmission,
} from "@/lib/auth/password-reset-validation";

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
  it("treats forgot/reset/login pages as public, including trailing slashes", () => {
    for (const p of [
      "/",
      "/login",
      "/register",
      "/forgot-password",
      "/reset-password",
      "/reset-password/",
      "/api/auth/session",
      "/api/health",
    ]) {
      expect(isPublicPath(p), p).toBe(true);
    }
  });

  it("keeps app routes and unrelated APIs protected", () => {
    for (const p of [
      "/home",
      "/start",
      "/reset-password/extra",
      "/reset-passwords",
      "/api/authx",
      "/api/ai/chat",
    ]) {
      expect(isPublicPath(p), p).toBe(false);
    }
  });

  it("middleware uses the shared public-path list and drops the query on the login redirect", () => {
    const src = readFileSync(
      path.join(process.cwd(), "src/middleware.ts"),
      "utf8",
    );
    expect(src).toContain('from "@/lib/auth/public-paths"');
    expect(src).toMatch(/url\.search = ""/);
    expect(src.indexOf('url.search = ""')).toBeLessThan(
      src.indexOf('searchParams.set("callbackUrl"'),
    );
  });
});

describe("reset link base URL and URL building", () => {
  const stale = "https://flux-labs-p5zoqtxaj-jarvis-d61f.vercel.app";

  it("builds /reset-password links with encoded token and email", () => {
    const url = new URL(
      buildPasswordResetUrl("https://www.fluxlabs.tech/", "a+b/c=", "u+x@e.com"),
    );
    expect(url.origin).toBe("https://www.fluxlabs.tech");
    expect(url.pathname).toBe("/reset-password");
    expect(url.searchParams.get("token")).toBe("a+b/c=");
    expect(url.searchParams.get("email")).toBe("u+x@e.com");
  });

  it("prefers AUTH_URL, then NEXTAUTH_URL", () => {
    expect(resetBaseUrlSource({ AUTH_URL: "https://a.example.com" })).toBe(
      "auth_url",
    );
    expect(resetBaseUrlSource({ NEXTAUTH_URL: "https://a.example.com" })).toBe(
      "nextauth_url",
    );
  });

  it("replaces a stale *.vercel.app AUTH_URL with the production domain only in production", () => {
    const prod = {
      AUTH_URL: stale,
      VERCEL_ENV: "production",
      VERCEL_PROJECT_PRODUCTION_URL: "www.fluxlabs.tech",
    };
    expect(publicHttpsBaseUrl(prod)).toBe("https://www.fluxlabs.tech");
    expect(resetBaseUrlSource(prod)).toBe("vercel_production_url");
    expect(publicHttpsBaseUrl({ ...prod, VERCEL_ENV: "preview" })).toBe(stale);
    expect(
      publicHttpsBaseUrl({ AUTH_URL: stale, VERCEL_ENV: "production" }),
    ).toBe(stale);
  });

  it("keeps an explicit custom-domain AUTH_URL even on Vercel production", () => {
    expect(
      publicHttpsBaseUrl({
        AUTH_URL: "https://www.fluxlabs.tech",
        VERCEL_ENV: "production",
        VERCEL_PROJECT_PRODUCTION_URL: "fluxlabs.tech",
      }),
    ).toBe("https://www.fluxlabs.tech");
  });

  it("falls back to the production domain when AUTH_URL is missing or unusable", () => {
    const base = {
      VERCEL_ENV: "production",
      VERCEL_PROJECT_PRODUCTION_URL: "www.fluxlabs.tech",
    };
    expect(publicHttpsBaseUrl(base)).toBe("https://www.fluxlabs.tech");
    expect(publicHttpsBaseUrl({ ...base, AUTH_URL: "http://localhost:3000" })).toBe(
      "https://www.fluxlabs.tech",
    );
  });
});

describe("new password validation", () => {
  it("requires matching passwords of 8-72 characters", () => {
    expect(validateNewPassword("long-enough-1", "long-enough-1")).toBeNull();
    expect(validateNewPassword("short", "short")).toMatch(/8 and 72/);
    expect(validateNewPassword("x".repeat(73), "x".repeat(73))).toMatch(/8 and 72/);
    expect(validateNewPassword("long-enough-1", "long-enough-2")).toMatch(
      /do not match/i,
    );
  });

  it("flags incomplete links before looking at passwords", () => {
    const ok = {
      email: "a@b.co",
      token: "t",
      password: "long-enough-1",
      confirmPassword: "long-enough-1",
    };
    expect(validatePasswordResetSubmission(ok)).toBeNull();
    expect(validatePasswordResetSubmission({ ...ok, token: "" })).toMatch(
      /invalid or incomplete/i,
    );
    expect(validatePasswordResetSubmission({ ...ok, email: "nope" })).toMatch(
      /invalid or incomplete/i,
    );
  });
});

describe("reset page and form wiring", () => {
  const read = (rel: string) =>
    readFileSync(path.join(process.cwd(), rel), "utf8");

  it("reset page is outside any auth guard and shows a missing-token state", () => {
    const page = read("src/app/(auth)/reset-password/page.tsx");
    expect(page).not.toMatch(/auth\(|redirect\(|getServerSession/);
    expect(page).toContain("isPlausibleEmail");
    expect(page).toContain("/forgot-password");
    expect(page).toMatch(/robots/);
  });

  it("form posts a confirmation and only redirects after a successful reset", () => {
    const form = read("src/components/auth/password-reset-forms.tsx");
    expect(form).toContain('name="confirmPassword"');
    expect(form).toContain("/login?reset=success");
    expect(form).toMatch(/if \(!succeeded\) return;/);
  });

  it("sign-in page announces a completed reset", () => {
    expect(read("src/app/(auth)/login/page.tsx")).toContain('reset === "success"');
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
