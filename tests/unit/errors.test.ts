import { describe, expect, it } from "vitest";
import { AppError, EntitlementError, toClientError } from "@/lib/errors";

describe("error sanitization", () => {
  it("passes through AppError client payloads", () => {
    const err = new EntitlementError();
    const client = toClientError(err);
    expect(client.status).toBe(402);
    expect(client.message).not.toMatch(/prisma|stack|secret/i);
  });

  it("hides unknown internal errors", () => {
    const client = toClientError(new Error("ECONNREFUSED postgres://secret"));
    expect(client.status).toBe(500);
    expect(client.message).toBe("Something went wrong. Please try again.");
    expect(client.message).not.toContain("postgres");
  });

  it("AppError includes stable codes", () => {
    const err = new AppError("x", "CUSTOM", 400, "Nice message");
    expect(err.toClient()).toEqual({ error: "CUSTOM", message: "Nice message" });
  });
});
