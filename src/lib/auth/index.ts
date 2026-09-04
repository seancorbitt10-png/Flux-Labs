import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { PrismaAdapter } from "@auth/prisma-adapter";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db/prisma";
import { loginSchema } from "@/lib/validation/auth";
import { authConfig } from "./config";
import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
    } & DefaultSession["user"];
  }
}

/**
 * Precomputed bcrypt hash used when no user exists so compare timing
 * does not leak account existence.
 */
const DUMMY_PASSWORD_HASH =
  "$2b$12$J8/Fu5UpSP2lKotav6MTwuE6CvSuPln16tQOOtnpfAu4DZluZgGQi";

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  adapter: PrismaAdapter(prisma),
  session: { strategy: "jwt" },
  providers: [
    Credentials({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const parsed = loginSchema.safeParse(credentials);
        if (!parsed.success) return null;

        const user = await prisma.user.findUnique({
          where: { email: parsed.data.email },
        });

        const hash = user?.passwordHash ?? DUMMY_PASSWORD_HASH;
        const valid = await bcrypt.compare(parsed.data.password, hash);

        if (!user?.passwordHash || !valid) return null;

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          image: user.image,
        };
      },
    }),
  ],
});
