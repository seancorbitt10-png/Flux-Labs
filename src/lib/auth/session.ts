import { auth } from "@/lib/auth";
import { UnauthorizedError, ForbiddenError } from "@/lib/errors";

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

/** Defense-in-depth ownership check against IDOR */
export function assertResourceOwner(
  resourceUserId: string,
  requesterId: string,
): void {
  if (resourceUserId !== requesterId) {
    throw new ForbiddenError();
  }
}
