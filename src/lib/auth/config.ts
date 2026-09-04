import type { NextAuthConfig } from "next-auth";

/**
 * Edge-compatible auth config (no Prisma / Node crypto).
 * Full providers + adapter are merged in `src/lib/auth/index.ts`.
 *
 * Access control is enforced in middleware.ts (single source of truth).
 * Keep callbacks here limited to JWT/session shaping.
 */
export const authConfig = {
  pages: {
    signIn: "/login",
  },
  providers: [],
  callbacks: {
    async jwt({ token, user }) {
      if (user?.id) {
        token.sub = user.id;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user && token.sub) {
        session.user.id = token.sub;
      }
      return session;
    },
  },
  // Prefer AUTH_URL in production. trustHost is required for local/proxy
  // setups; document reverse-proxy host configuration in ENVIRONMENT.md.
  trustHost: true,
} satisfies NextAuthConfig;
