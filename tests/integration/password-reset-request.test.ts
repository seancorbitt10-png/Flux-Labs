import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { PrismaClient } from "@prisma/client";
import {
  hashPasswordResetToken,
  passwordResetIdentifier,
  PASSWORD_RESET_REQUEST_MESSAGE,
} from "@/lib/auth/password-reset";
import { requestPasswordReset } from "@/lib/auth/password-reset-actions";
import { prisma as appPrisma } from "@/lib/db/prisma";
import { resetRateLimits } from "@/lib/security/rate-limit";

const db = new PrismaClient();

const API_KEY = "re_test_not_a_real_key_0123456789";
const FROM = "noreply@fluxlabs.tech";
const BASE_URL = "https://www.fluxlabs.tech";
const ENV_KEYS = [
  "RESEND_API_KEY",
  "RESET_EMAIL_FROM",
  "AUTH_URL",
  "NEXTAUTH_URL",
  "AUTH_SECRET",
] as const;

type LogEntry = Record<string, unknown> & { outcome: string };

function form(email: string): FormData {
  const fd = new FormData();
  fd.set("email", email);
  return fd;
}

function configure(overrides: Partial<Record<(typeof ENV_KEYS)[number], string>> = {}) {
  process.env.RESEND_API_KEY = API_KEY;
  process.env.RESET_EMAIL_FROM = FROM;
  process.env.AUTH_URL = BASE_URL;
  process.env.AUTH_SECRET = "test-secret-not-for-production";
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function captureLogs() {
  const raw: string[] = [];
  const entries: LogEntry[] = [];
  const sink = (...args: unknown[]) => {
    raw.push(args.map(String).join(" "));
    const payload = args[1];
    if (typeof payload === "string") {
      try {
        entries.push(JSON.parse(payload) as LogEntry);
      } catch {
        /* not a diagnostics line */
      }
    }
  };
  vi.spyOn(console, "info").mockImplementation(sink);
  vi.spyOn(console, "warn").mockImplementation(sink);
  vi.spyOn(console, "error").mockImplementation(sink);
  return { raw, entries };
}

function resendResponse(status: number, body: unknown) {
  return vi.fn(
    async () => new Response(JSON.stringify(body), { status }),
  );
}

async function createUser(suffix: string) {
  return db.user.create({
    data: {
      email: `req.${suffix}@fluxlabs.test`,
      name: "Request User",
      passwordHash: "not-used-in-these-tests",
    },
  });
}

async function tokensFor(email: string) {
  return db.verificationToken.findMany({
    where: { identifier: passwordResetIdentifier(email) },
  });
}

async function cleanup() {
  await db.verificationToken.deleteMany({
    where: { identifier: { startsWith: "password-reset:" } },
  });
  await db.user.deleteMany({ where: { email: { endsWith: "@fluxlabs.test" } } });
}

function expectNoSensitiveData(
  raw: string[],
  extra: { email?: string; token?: string } = {},
) {
  const joined = raw.join("\n");
  expect(joined).not.toContain(API_KEY);
  expect(joined).not.toMatch(/bearer/i);
  expect(joined).not.toMatch(/reset-password\?token=/);
  expect(joined).not.toContain("@fluxlabs.test");
  expect(joined).not.toContain("authorization");
  if (extra.email) expect(joined).not.toContain(extra.email);
  if (extra.token) expect(joined).not.toContain(extra.token);
}

describe("requestPasswordReset diagnostics and delivery outcomes", () => {
  beforeAll(async () => {
    await db.$connect();
  });

  beforeEach(async () => {
    resetRateLimits();
    for (const key of ENV_KEYS) delete process.env[key];
    await cleanup();
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    resetRateLimits();
    for (const key of ENV_KEYS) delete process.env[key];
    await cleanup();
  });

  describe("configuration failures (no token, no network, generic response)", () => {
    const cases: Array<{
      name: string;
      env: Partial<Record<(typeof ENV_KEYS)[number], string>>;
      outcome: string;
    }> = [
      {
        name: "missing RESEND_API_KEY",
        env: { RESEND_API_KEY: undefined as unknown as string },
        outcome: "config_missing_api_key",
      },
      {
        name: "missing RESET_EMAIL_FROM",
        env: { RESET_EMAIL_FROM: undefined as unknown as string },
        outcome: "config_missing_from",
      },
      {
        name: "malformed RESET_EMAIL_FROM",
        env: { RESET_EMAIL_FROM: "Flux Labs noreply@fluxlabs.tech" },
        outcome: "config_invalid_from",
      },
      {
        name: "AUTH_URL and NEXTAUTH_URL both unset",
        env: { AUTH_URL: undefined as unknown as string },
        outcome: "config_missing_base_url",
      },
      {
        name: "non-https AUTH_URL",
        env: { AUTH_URL: "http://fluxlabs.tech" },
        outcome: "config_base_url_not_https",
      },
      {
        name: "unparseable AUTH_URL",
        env: { AUTH_URL: '"https://fluxlabs.tech"' },
        outcome: "config_base_url_invalid",
      },
    ];

    for (const testCase of cases) {
      it(`${testCase.name} -> ${testCase.outcome}`, async () => {
        const user = await createUser(`cfg-${Date.now()}`);
        configure(testCase.env);
        const fetchMock = vi.fn();
        vi.stubGlobal("fetch", fetchMock);
        const logs = captureLogs();

        const result = await requestPasswordReset(null, form(user.email));

        expect(result).toEqual({ ok: true, message: PASSWORD_RESET_REQUEST_MESSAGE });
        expect(fetchMock).not.toHaveBeenCalled();
        expect(await tokensFor(user.email)).toHaveLength(0);
        expect(logs.entries).toHaveLength(1);
        expect(logs.entries[0]).toMatchObject({
          outcome: testCase.outcome,
          certainty: "not_sent",
          token: "not_created",
        });
        expectNoSensitiveData(logs.raw, { email: user.email });
      });
    }

    it("logs the config failure even when the account does not exist", async () => {
      configure({ RESEND_API_KEY: undefined as unknown as string });
      const logs = captureLogs();
      const result = await requestPasswordReset(null, form("nobody@fluxlabs.test"));
      expect(result.message).toBe(PASSWORD_RESET_REQUEST_MESSAGE);
      expect(logs.entries[0]).toMatchObject({ outcome: "config_missing_api_key" });
    });
  });

  it("returns the generic response for an unknown account without calling Resend", async () => {
    configure();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const logs = captureLogs();

    const result = await requestPasswordReset(null, form("ghost@fluxlabs.test"));

    expect(result).toEqual({ ok: true, message: PASSWORD_RESET_REQUEST_MESSAGE });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(logs.entries[0]).toMatchObject({
      outcome: "account_not_found",
      token: "not_created",
      baseHost: "www.fluxlabs.tech",
    });
    expectNoSensitiveData(logs.raw, { email: "ghost@fluxlabs.test" });
  });

  it("logs invalid input without creating a token", async () => {
    configure();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const logs = captureLogs();

    const result = await requestPasswordReset(null, form("not-an-email"));

    expect(result.message).toBe(PASSWORD_RESET_REQUEST_MESSAGE);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(logs.entries[0]).toMatchObject({ outcome: "invalid_email_input" });
  });

  describe("rate limiting", () => {
    it("silently limits repeated requests for one email and logs the scope", async () => {
      const user = await createUser(`rl-email-${Date.now()}`);
      configure();
      const fetchMock = resendResponse(200, { id: "49a3999c-0ce1-4ea6-ab68-afcd6dc2e794" });
      vi.stubGlobal("fetch", fetchMock);
      const logs = captureLogs();

      const results = [];
      for (let i = 0; i < 4; i += 1) {
        results.push(await requestPasswordReset(null, form(user.email)));
      }

      expect(new Set(results.map((r) => r.message))).toEqual(
        new Set([PASSWORD_RESET_REQUEST_MESSAGE]),
      );
      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(logs.entries.map((e) => e.outcome)).toEqual([
        "resend_accepted",
        "resend_accepted",
        "resend_accepted",
        "rate_limited",
      ]);
      expect(logs.entries[3]).toMatchObject({
        rateLimitScope: "email",
        certainty: "not_sent",
      });
    });

    it("limits by IP across different emails and records that the IP was unknown", async () => {
      configure();
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);
      const logs = captureLogs();

      for (let i = 0; i < 6; i += 1) {
        await requestPasswordReset(null, form(`ghost${i}@fluxlabs.test`));
      }

      expect(logs.entries).toHaveLength(6);
      expect(logs.entries[5]).toMatchObject({
        outcome: "rate_limited",
        rateLimitScope: "ip",
        ipKnown: false,
      });
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe("database failures", () => {
    it("account lookup failure -> generic response, safe log, no leaked query text", async () => {
      const user = await createUser(`dblookup-${Date.now()}`);
      configure();
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);
      const logs = captureLogs();
      vi.spyOn(appPrisma.user, "findUnique").mockRejectedValueOnce(
        Object.assign(
          new Error(`Invalid findUnique() where: { email: "${user.email}" }`),
          { code: "P1001" },
        ),
      );

      const result = await requestPasswordReset(null, form(user.email));

      expect(result.message).toBe(PASSWORD_RESET_REQUEST_MESSAGE);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(logs.entries[0]).toMatchObject({
        outcome: "lookup_failed",
        errorCode: "P1001",
        token: "not_created",
      });
      expectNoSensitiveData(logs.raw, { email: user.email });
    });

    it("token persistence failure -> generic response, no email sent", async () => {
      const user = await createUser(`dbtoken-${Date.now()}`);
      configure();
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);
      const logs = captureLogs();
      vi.spyOn(appPrisma.verificationToken, "create").mockRejectedValueOnce(
        Object.assign(new Error("connection lost"), { code: "P1017" }),
      );

      const result = await requestPasswordReset(null, form(user.email));

      expect(result.message).toBe(PASSWORD_RESET_REQUEST_MESSAGE);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(await tokensFor(user.email)).toHaveLength(0);
      expect(logs.entries[0]).toMatchObject({
        outcome: "token_persist_failed",
        errorCode: "P1017",
      });
    });

    it("cleanup failure after a definitive rejection is reported, not hidden", async () => {
      const user = await createUser(`dbcleanup-${Date.now()}`);
      configure();
      vi.stubGlobal("fetch", resendResponse(403, { name: "validation_error", message: "domain not verified" }));
      const logs = captureLogs();
      const realDeleteMany = appPrisma.verificationToken.deleteMany.bind(
        appPrisma.verificationToken,
      );
      vi.spyOn(appPrisma.verificationToken, "deleteMany")
        .mockImplementationOnce(realDeleteMany)
        .mockRejectedValueOnce(Object.assign(new Error("boom"), { code: "P2024" }));

      const result = await requestPasswordReset(null, form(user.email));

      expect(result.message).toBe(PASSWORD_RESET_REQUEST_MESSAGE);
      expect(logs.entries.map((e) => e.outcome)).toEqual([
        "token_cleanup_failed",
        "resend_rejected",
      ]);
      expect(logs.entries[1]).toMatchObject({ token: "cleanup_failed" });
    });
  });

  describe("Resend responses", () => {
    it("successful acceptance keeps the hashed token and logs the Resend message id", async () => {
      const user = await createUser(`ok-${Date.now()}`);
      configure();
      let plainToken = "";
      const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as { text: string };
        plainToken = decodeURIComponent(body.text.match(/token=([^&\s]+)/)?.[1] ?? "");
        return new Response(
          JSON.stringify({ id: "49a3999c-0ce1-4ea6-ab68-afcd6dc2e794" }),
          { status: 200 },
        );
      });
      vi.stubGlobal("fetch", fetchMock);
      const logs = captureLogs();

      const result = await requestPasswordReset(null, form(user.email));

      expect(result).toEqual({ ok: true, message: PASSWORD_RESET_REQUEST_MESSAGE });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
      expect(url).toBe("https://api.resend.com/emails");
      const sent = JSON.parse(String(init.body)) as { from: string; to: string[]; text: string };
      expect(sent.from).toBe(FROM);
      expect(sent.to).toEqual([user.email]);
      expect(sent.text).toContain(`${BASE_URL}/reset-password?token=`);

      const stored = await tokensFor(user.email);
      expect(stored).toHaveLength(1);
      expect(stored[0].token).toBe(hashPasswordResetToken(plainToken));
      expect(stored[0].token).not.toBe(plainToken);

      expect(logs.entries).toHaveLength(1);
      expect(logs.entries[0]).toMatchObject({
        outcome: "resend_accepted",
        certainty: "accepted",
        token: "retained",
        httpStatus: 200,
        resendMessageId: "49a3999c-0ce1-4ea6-ab68-afcd6dc2e794",
        baseHost: "www.fluxlabs.tech",
      });
      expect(logs.entries[0].emailRef).toMatch(/^[a-f0-9]{12}$/);
      expectNoSensitiveData(logs.raw, { email: user.email, token: plainToken });
    });

    it("domain-not-verified rejection logs a useful reason and deletes the unused token", async () => {
      const user = await createUser(`reject-${Date.now()}`);
      configure();
      vi.stubGlobal(
        "fetch",
        resendResponse(403, {
          statusCode: 403,
          name: "validation_error",
          message: "The fluxlabs.tech domain is not verified. Please, add and verify your domain.",
        }),
      );
      const logs = captureLogs();

      const result = await requestPasswordReset(null, form(user.email));

      expect(result).toEqual({ ok: true, message: PASSWORD_RESET_REQUEST_MESSAGE });
      expect(await tokensFor(user.email)).toHaveLength(0);
      expect(logs.entries).toHaveLength(1);
      expect(logs.entries[0]).toMatchObject({
        outcome: "resend_rejected",
        certainty: "rejected",
        token: "deleted",
        httpStatus: 403,
        resendErrorName: "validation_error",
        resendErrorMessage:
          "The fluxlabs.tech domain is not verified. Please, add and verify your domain.",
      });
      expectNoSensitiveData(logs.raw, { email: user.email });
    });

    it("invalid API key rejection (401) is classified and does not leak the key", async () => {
      const user = await createUser(`badkey-${Date.now()}`);
      configure();
      vi.stubGlobal(
        "fetch",
        resendResponse(401, { name: "restricted_api_key", message: "API key is invalid" }),
      );
      const logs = captureLogs();

      await requestPasswordReset(null, form(user.email));

      expect(logs.entries[0]).toMatchObject({
        outcome: "resend_rejected",
        httpStatus: 401,
        resendErrorName: "restricted_api_key",
        token: "deleted",
      });
      expectNoSensitiveData(logs.raw);
    });

    it("redacts the recipient if Resend echoes it in an error", async () => {
      const user = await createUser(`echo-${Date.now()}`);
      configure();
      vi.stubGlobal(
        "fetch",
        resendResponse(422, {
          name: "validation_error",
          message: `Invalid to field: ${user.email}`,
        }),
      );
      const logs = captureLogs();

      await requestPasswordReset(null, form(user.email));

      expect(logs.entries[0].resendErrorMessage).toContain("[email]");
      expectNoSensitiveData(logs.raw, { email: user.email });
    });

    it("a 5xx is ambiguous: the token is retained", async () => {
      const user = await createUser(`five-${Date.now()}`);
      configure();
      vi.stubGlobal(
        "fetch",
        resendResponse(503, { name: "internal_server_error", message: "temporarily unavailable" }),
      );
      const logs = captureLogs();

      const result = await requestPasswordReset(null, form(user.email));

      expect(result.message).toBe(PASSWORD_RESET_REQUEST_MESSAGE);
      expect(await tokensFor(user.email)).toHaveLength(1);
      expect(logs.entries[0]).toMatchObject({
        outcome: "resend_unavailable",
        certainty: "ambiguous",
        token: "retained",
        httpStatus: 503,
      });
    });

    it("a network exception is ambiguous: the token is retained and only a safe code is logged", async () => {
      const user = await createUser(`net-${Date.now()}`);
      configure();
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => {
          throw Object.assign(new TypeError(`fetch failed for ${user.email}`), {
            cause: { code: "ECONNRESET" },
          });
        }),
      );
      const logs = captureLogs();

      const result = await requestPasswordReset(null, form(user.email));

      expect(result.message).toBe(PASSWORD_RESET_REQUEST_MESSAGE);
      expect(await tokensFor(user.email)).toHaveLength(1);
      expect(logs.entries[0]).toMatchObject({
        outcome: "resend_network_error",
        certainty: "ambiguous",
        token: "retained",
        errorName: "TypeError",
        errorCode: "ECONNRESET",
      });
      expectNoSensitiveData(logs.raw, { email: user.email });
    });

    it("a timeout is ambiguous: the token is retained", async () => {
      const user = await createUser(`timeout-${Date.now()}`);
      configure();
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => {
          throw new DOMException("The operation timed out.", "TimeoutError");
        }),
      );
      const logs = captureLogs();

      const result = await requestPasswordReset(null, form(user.email));

      expect(result.message).toBe(PASSWORD_RESET_REQUEST_MESSAGE);
      expect(await tokensFor(user.email)).toHaveLength(1);
      expect(logs.entries[0]).toMatchObject({
        outcome: "resend_timeout",
        certainty: "ambiguous",
        token: "retained",
      });
    });
  });

  it("returns the identical public response for every outcome", async () => {
    const user = await createUser(`same-${Date.now()}`);
    const messages = new Set<string>();
    const runs: Array<() => Promise<void>> = [
      async () => configure({ RESEND_API_KEY: undefined as unknown as string }),
      async () => {
        configure();
        vi.stubGlobal("fetch", resendResponse(200, { id: "49a3999c-0ce1-4ea6-ab68-afcd6dc2e794" }));
      },
      async () => {
        configure();
        vi.stubGlobal("fetch", resendResponse(403, { name: "validation_error", message: "x" }));
      },
      async () => {
        configure();
        vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("down"); }));
      },
    ];
    captureLogs();
    for (const arrange of runs) {
      resetRateLimits();
      await arrange();
      const known = await requestPasswordReset(null, form(user.email));
      const unknown = await requestPasswordReset(null, form("ghost@fluxlabs.test"));
      messages.add(JSON.stringify(known));
      messages.add(JSON.stringify(unknown));
    }
    expect([...messages]).toEqual([
      JSON.stringify({ ok: true, message: PASSWORD_RESET_REQUEST_MESSAGE }),
    ]);
  });
});
