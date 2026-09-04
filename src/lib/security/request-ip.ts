import { headers } from "next/headers";

/**
 * Best-effort client IP for abuse controls.
 * Prefer reverse-proxy headers; never trust for authz — only rate limiting.
 */
export async function getRequestIp(): Promise<string> {
  const h = await headers();
  const forwarded = h.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return h.get("x-real-ip")?.trim() || "unknown";
}
