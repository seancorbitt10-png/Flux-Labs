import { auth } from "@/lib/auth";
import { UnauthorizedError } from "@/lib/errors";

export { assertResourceOwner } from "@/lib/auth/ownership";

export async function requireSession() {
  const session = await auth();
  if (!session?.user?.id) {
    throw new UnauthorizedError();
  }
  return session;
}

export async function requireUserId(): Promise<string> {
  const session = await requireSession();
  return session.user.id;
}
