import { ValidationError } from "@/lib/errors";
import { rejectClientAuthorityFields } from "./attribute-registry";
import { setStudentAttribute, type SetAttributeResult } from "./attributes";

/**
 * Settings/onboarding client entrypoint for attributes.
 * Accepts only { key, value }. Rejects provenance/confidence/source/metadata authority.
 */
export async function applyClientAttributeUpdate(args: {
  actorUserId: string;
  userId: string;
  payload: Record<string, unknown>;
  writer: "onboarding" | "settings";
}): Promise<SetAttributeResult> {
  rejectClientAuthorityFields(args.payload);

  if (typeof args.payload.key !== "string") {
    throw new ValidationError("Attribute key is required.");
  }
  if (!("value" in args.payload)) {
    throw new ValidationError("Attribute value is required.");
  }

  // Disallow extra unknown fields beyond key/value
  const allowed = new Set(["key", "value"]);
  for (const k of Object.keys(args.payload)) {
    if (!allowed.has(k)) {
      throw new ValidationError("Unexpected attribute fields are not allowed.");
    }
  }

  return setStudentAttribute({
    actorUserId: args.actorUserId,
    userId: args.userId,
    key: args.payload.key,
    value: args.payload.value,
    writer: args.writer,
  });
}
