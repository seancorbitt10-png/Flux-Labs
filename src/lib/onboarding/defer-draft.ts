import type { ClientOnboardingQuestion } from "./catalog";

export function isOnboardingDraftReady(
  question: Pick<ClientOnboardingQuestion, "answerType">,
  value: unknown,
): boolean {
  switch (question.answerType) {
    case "enum":
      return typeof value === "string" && value.length > 0;
    case "string":
      return typeof value === "string" && value.trim().length > 0;
    case "string_array":
      return Array.isArray(value) && value.length > 0;
    case "boolean":
      return typeof value === "boolean";
    default:
      return false;
  }
}

/**
 * Valid in-progress edits to persist when the student chooses “Set up later”.
 * Includes a pending string_array chip that has not been added yet.
 * Returns null when there is nothing valid to save (empty / incomplete).
 */
export function persistableDeferDraft(
  question: Pick<
    ClientOnboardingQuestion,
    "answerType" | "maxItems" | "itemMaxLength"
  >,
  draft: unknown,
  tagInput = "",
): unknown | null {
  if (question.answerType === "string_array") {
    const items = Array.isArray(draft)
      ? draft.filter((item): item is string => typeof item === "string")
      : [];
    const extra = tagInput.trim();
    const itemMax = question.itemMaxLength ?? 80;
    const maxItems = question.maxItems ?? 12;
    if (
      extra &&
      extra.length <= itemMax &&
      !items.includes(extra) &&
      items.length < maxItems
    ) {
      items.push(extra);
    }
    return items.length > 0 ? items : null;
  }
  return isOnboardingDraftReady(question, draft) ? draft : null;
}
