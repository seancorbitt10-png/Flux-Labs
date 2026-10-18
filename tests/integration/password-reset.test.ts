import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import {
  hashPasswordResetToken,
  passwordResetIdentifier,
  PASSWORD_RESET_REQUEST_MESSAGE,
} from "@/lib/auth/password-reset";
import {
  requestPasswordReset,
  resetPassword,
} from "@/lib/auth/password-reset-actions";
import { isPublicPath } from "@/lib/auth/public-paths";
import { resetRateLimits } from "@/lib/security/rate-limit";

const prisma = new PrismaClient();

const ENV_KEYS = [
  "RESEND_API_KEY",
  "RESET_EMAIL_FROM",
  "AUTH_URL",
  "NEXTAUTH_URL",
  "VERCEL_ENV",
  "VERCEL_PROJECT_PRODUCTION_URL",
] as const;

function form(data: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(data)) {
    fd.set(key, value);
  }
  return fd;
}

async function cleanup() {
  const where = { email: { endsWith: "@fluxlabs.test" } };
  await prisma.verificationToken.deleteMany({
    where: { identifier: { startsWith: "password-reset:" } },
  });
  await prisma.user.deleteMany({ where });
}

async function createUser(suffix: string, password = "original-password-1") {
  return prisma.user.create({
    data: {
      email: `reset.${suffix}@fluxlabs.test`,
      name: "Reset User",
      passwordHash: await bcrypt.hash(password, 12),
    },
  });
}

describe("password reset flow", () => {
  beforeAll(async () => {
    await prisma.$connect();
  });

  beforeEach(async () => {
    resetRateLimits();
    await cleanup();
    for (const key of ENV_KEYS) {
      delete process.env[key];
    }
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    resetRateLimits();
    for (const key of ENV_KEYS) {
      delete process.env[key];
    }
    await cleanup();
  });

  it("returns a generic success when email config is missing and does not store a token", async () => {
    const user = await createUser(`noconfig-${Date.now()}`);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await requestPasswordReset(null, form({ email: user.email }));

    expect(result.ok).toBe(true);
    expect(result.message).toBe(PASSWORD_RESET_REQUEST_MESSAGE);
    expect(fetchMock).not.toHaveBeenCalled();
    const tokens = await prisma.verificationToken.findMany({
      where: { identifier: passwordResetIdentifier(user.email) },
    });
    expect(tokens).toHaveLength(0);
  });

  it("returns the same generic message for unknown emails and does not call Resend", async () => {
    process.env.RESEND_API_KEY = "re_test_not_real";
    process.env.RESET_EMAIL_FROM = "Flux Labs <no-reply@example.com>";
    process.env.AUTH_URL = "https://app.example.com";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const known = await createUser(`known-${Date.now()}`);
    const unknownEmail = `missing.${Date.now()}@fluxlabs.test`;

    const missing = await requestPasswordReset(
      null,
      form({ email: unknownEmail }),
    );
    expect(fetchMock).not.toHaveBeenCalled();

    fetchMock.mockResolvedValue({ ok: true });
    const present = await requestPasswordReset(
      null,
      form({ email: known.email }),
    );

    expect(missing.message).toBe(present.message);
    expect(missing.message).toBe(PASSWORD_RESET_REQUEST_MESSAGE);
    expect(missing.message).not.toMatch(/no account|not found|doesn't exist/i);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not send email when AUTH_URL is not https and deletes the token", async () => {
    const user = await createUser(`http-${Date.now()}`);
    process.env.RESEND_API_KEY = "re_test_not_real";
    process.env.RESET_EMAIL_FROM = "Flux Labs <no-reply@example.com>";
    process.env.AUTH_URL = "http://localhost:3000";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await requestPasswordReset(null, form({ email: user.email }));
    expect(result.message).toBe(PASSWORD_RESET_REQUEST_MESSAGE);
    expect(fetchMock).not.toHaveBeenCalled();
    const tokens = await prisma.verificationToken.findMany({
      where: { identifier: passwordResetIdentifier(user.email) },
    });
    expect(tokens).toHaveLength(0);
  });

  it("stores a hashed token, emails via Resend env, and settles a valid reset once", async () => {
    const original = "original-password-1";
    const user = await createUser(`ok-${Date.now()}`, original);
    process.env.RESEND_API_KEY = "re_test_not_real";
    process.env.RESET_EMAIL_FROM = "Flux Labs <no-reply@example.com>";
    process.env.AUTH_URL = "https://app.example.com";

    let plainToken = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body ?? "{}")) as {
          text?: string;
        };
        const match = body.text?.match(/token=([^&\s]+)/);
        plainToken = decodeURIComponent(match?.[1] ?? "");
        const auth = String(
          (init?.headers as Record<string, string>)?.Authorization ?? "",
        );
        expect(auth).toBe("Bearer re_test_not_real");
        expect(JSON.stringify(init)).not.toMatch(/sk-live|OPENAI/i);
        return { ok: true } as Response;
      }),
    );

    const requested = await requestPasswordReset(
      null,
      form({ email: user.email }),
    );
    expect(requested.message).toBe(PASSWORD_RESET_REQUEST_MESSAGE);
    expect(plainToken.length).toBeGreaterThan(10);

    const stored = await prisma.verificationToken.findFirstOrThrow({
      where: { identifier: passwordResetIdentifier(user.email) },
    });
    expect(stored.token).toBe(hashPasswordResetToken(plainToken));
    expect(stored.token).not.toBe(plainToken);
    expect(stored.expires.getTime()).toBeGreaterThan(Date.now());

    const nextPassword = "replacement-password-9";
    const first = await resetPassword(
      null,
      form({
        email: user.email,
        token: plainToken,
        password: nextPassword,
        confirmPassword: nextPassword,
      }),
    );
    expect(first.ok).toBe(true);

    const updated = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
    });
    expect(await bcrypt.compare(original, updated.passwordHash ?? "")).toBe(
      false,
    );
    expect(await bcrypt.compare(nextPassword, updated.passwordHash ?? "")).toBe(
      true,
    );

    const leftover = await prisma.verificationToken.findMany({
      where: { identifier: passwordResetIdentifier(user.email) },
    });
    expect(leftover).toHaveLength(0);

    const second = await resetPassword(
      null,
      form({
        email: user.email,
        token: plainToken,
        password: "another-password-9",
        confirmPassword: "another-password-9",
      }),
    );
    expect(second.ok).toBe(false);
    expect(second.message).toMatch(/invalid or expired/i);
  });

  it("rejects an invalid token", async () => {
    const user = await createUser(`invalid-${Date.now()}`);
    const storedToken = `real-token-${user.id}`;
    await prisma.verificationToken.create({
      data: {
        identifier: passwordResetIdentifier(user.email),
        token: hashPasswordResetToken(storedToken),
        expires: new Date(Date.now() + 30 * 60_000),
      },
    });

    const result = await resetPassword(
      null,
      form({
        email: user.email,
        token: "wrong-token",
        password: "new-password-1",
        confirmPassword: "new-password-1",
      }),
    );
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/invalid or expired/i);
  });

  it("rejects an expired token", async () => {
    const user = await createUser(`expired-${Date.now()}`);
    const token = `expired-plain-token-${user.id}`;
    await prisma.verificationToken.create({
      data: {
        identifier: passwordResetIdentifier(user.email),
        token: hashPasswordResetToken(token),
        expires: new Date(Date.now() - 1000),
      },
    });

    const result = await resetPassword(
      null,
      form({
        email: user.email,
        token,
        password: "new-password-1",
        confirmPassword: "new-password-1",
      }),
    );
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/invalid or expired/i);
  });

  it("allows only one concurrent reset to succeed for the same token", async () => {
    const original = "original-password-1";
    const user = await createUser(`race-${Date.now()}`, original);
    const token = `concurrent-token-${user.id}`;
    await prisma.verificationToken.create({
      data: {
        identifier: passwordResetIdentifier(user.email),
        token: hashPasswordResetToken(token),
        expires: new Date(Date.now() + 30 * 60_000),
      },
    });

    const passwords = [
      "concurrent-password-a",
      "concurrent-password-b",
      "concurrent-password-c",
    ];
    const results = await Promise.all(
      passwords.map((password) =>
        resetPassword(
          null,
          form({
            email: user.email,
            token,
            password,
            confirmPassword: password,
          }),
        ),
      ),
    );

    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toHaveLength(2);
    for (const failed of results.filter((result) => !result.ok)) {
      expect(failed.message).toMatch(/invalid or expired/i);
    }

    const updated = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
    });
    const matches = await Promise.all(
      passwords.map((password) =>
        bcrypt.compare(password, updated.passwordHash ?? ""),
      ),
    );
    expect(matches.filter(Boolean)).toHaveLength(1);
    expect(await bcrypt.compare(original, updated.passwordHash ?? "")).toBe(
      false,
    );

    const leftover = await prisma.verificationToken.findMany({
      where: { identifier: passwordResetIdentifier(user.email) },
    });
    expect(leftover).toHaveLength(0);
  });

  describe("emailed link round trip", () => {
    function captureEmail() {
      const sent: { text: string; html: string } = { text: "", html: "" };
      vi.stubGlobal(
        "fetch",
        vi.fn(async (_url: string, init?: RequestInit) => {
          const body = JSON.parse(String(init?.body ?? "{}")) as {
            text?: string;
            html?: string;
          };
          sent.text = body.text ?? "";
          sent.html = body.html ?? "";
          return { ok: true } as Response;
        }),
      );
      return sent;
    }

    function configureEmail(env: Record<string, string> = {}) {
      process.env.RESEND_API_KEY = "re_test_not_real";
      process.env.RESET_EMAIL_FROM = "Flux Labs <no-reply@example.com>";
      process.env.AUTH_URL = "https://www.example.com";
      for (const [key, value] of Object.entries(env)) {
        process.env[key] = value;
      }
    }

    function parseLink(text: string) {
      const raw = text.match(/https:\/\/[^\s"<]+/)?.[0] ?? "";
      const url = new URL(raw);
      return {
        url,
        token: url.searchParams.get("token") ?? "",
        email: url.searchParams.get("email") ?? "",
      };
    }

    it("links to the public /reset-password page on the configured origin", async () => {
      const user = await createUser(`link-${Date.now()}`);
      configureEmail();
      const sent = captureEmail();

      await requestPasswordReset(null, form({ email: user.email }));

      const link = parseLink(sent.text);
      expect(link.url.origin).toBe("https://www.example.com");
      expect(link.url.pathname).toBe("/reset-password");
      expect(link.url.pathname).not.toMatch(/login/);
      expect(link.email).toBe(user.email);
      expect(link.token.length).toBeGreaterThan(20);
      expect(isPublicPath(link.url.pathname)).toBe(true);
    });

    it("uses the production domain instead of a stale per-deployment AUTH_URL", async () => {
      const user = await createUser(`stale-${Date.now()}`);
      configureEmail({
        AUTH_URL: "https://flux-labs-p5zoqtxaj-jarvis-d61f.vercel.app",
        VERCEL_ENV: "production",
        VERCEL_PROJECT_PRODUCTION_URL: "www.example.com",
      });
      const sent = captureEmail();

      await requestPasswordReset(null, form({ email: user.email }));

      expect(parseLink(sent.text).url.origin).toBe("https://www.example.com");
      expect(sent.text).not.toContain("vercel.app");
    });

    it("completes request -> reset -> sign-in credentials, then rejects reuse of the consumed token", async () => {
      const original = "original-password-1";
      const user = await createUser(`trip-${Date.now()}`, original);
      configureEmail();
      const sent = captureEmail();

      await requestPasswordReset(null, form({ email: user.email }));
      const { token, email } = parseLink(sent.text);

      const nextPassword = "round-trip-password-9";
      const ok = await resetPassword(
        null,
        form({
          email,
          token,
          password: nextPassword,
          confirmPassword: nextPassword,
        }),
      );
      expect(ok.ok).toBe(true);
      const updated = await prisma.user.findUniqueOrThrow({
        where: { id: user.id },
      });
      expect(await bcrypt.compare(nextPassword, updated.passwordHash ?? "")).toBe(
        true,
      );

      const reuse = await resetPassword(
        null,
        form({
          email,
          token,
          password: "attacker-password-9",
          confirmPassword: "attacker-password-9",
        }),
      );
      expect(reuse.ok).toBe(false);
      expect(reuse.message).toMatch(/invalid or expired/i);
      const after = await prisma.user.findUniqueOrThrow({
        where: { id: user.id },
      });
      expect(after.passwordHash).toBe(updated.passwordHash);
    });
  });

  describe("input validation before the token is touched", () => {
    async function seedToken(suffix: string) {
      const user = await createUser(`${suffix}-${Date.now()}`);
      const token = `validation-token-${user.id}`;
      await prisma.verificationToken.create({
        data: {
          identifier: passwordResetIdentifier(user.email),
          token: hashPasswordResetToken(token),
          expires: new Date(Date.now() + 30 * 60_000),
        },
      });
      return { user, token };
    }

    it("rejects mismatched confirmation without consuming the token or changing the password", async () => {
      const { user, token } = await seedToken("mismatch");
      const before = await prisma.user.findUniqueOrThrow({
        where: { id: user.id },
      });
      const result = await resetPassword(
        null,
        form({
          email: user.email,
          token,
          password: "new-password-one-1",
          confirmPassword: "new-password-two-2",
        }),
      );
      expect(result.ok).toBe(false);
      expect(result.message).toMatch(/do not match/i);
      const after = await prisma.user.findUniqueOrThrow({
        where: { id: user.id },
      });
      expect(after.passwordHash).toBe(before.passwordHash);
      expect(
        await prisma.verificationToken.count({
          where: { identifier: passwordResetIdentifier(user.email) },
        }),
      ).toBe(1);
    });

    it("rejects a missing confirmation, short password, and missing token", async () => {
      const { user, token } = await seedToken("shape");
      const missingConfirm = await resetPassword(
        null,
        form({ email: user.email, token, password: "new-password-1" }),
      );
      expect(missingConfirm.ok).toBe(false);

      const short = await resetPassword(
        null,
        form({
          email: user.email,
          token,
          password: "short",
          confirmPassword: "short",
        }),
      );
      expect(short.ok).toBe(false);
      expect(short.message).toMatch(/8 and 72/);

      const noToken = await resetPassword(
        null,
        form({
          email: user.email,
          token: "",
          password: "new-password-1",
          confirmPassword: "new-password-1",
        }),
      );
      expect(noToken.ok).toBe(false);
      expect(noToken.message).toMatch(/invalid or incomplete/i);
      expect(
        await prisma.verificationToken.count({
          where: { identifier: passwordResetIdentifier(user.email) },
        }),
      ).toBe(1);
    });
  });
});
