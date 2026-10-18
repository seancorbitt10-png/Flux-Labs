const EXACT_PUBLIC_PATHS: ReadonlySet<string> = new Set([
  "/",
  "/login",
  "/register",
  "/forgot-password",
  "/reset-password",
  "/api/health",
]);

/** Paths reachable without a session. Trailing slashes are ignored. */
export function isPublicPath(pathname: string): boolean {
  const normalized =
    pathname.length > 1 ? pathname.replace(/\/+$/, "") || "/" : pathname;
  return (
    EXACT_PUBLIC_PATHS.has(normalized) ||
    normalized === "/api/auth" ||
    normalized.startsWith("/api/auth/")
  );
}
