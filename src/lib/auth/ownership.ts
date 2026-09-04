import { ForbiddenError } from "@/lib/errors";

/** Defense-in-depth ownership check against IDOR. Safe to import from domain/tests. */
export function assertResourceOwner(
  resourceUserId: string,
  requesterId: string,
): void {
  if (resourceUserId !== requesterId) {
    throw new ForbiddenError();
  }
}
