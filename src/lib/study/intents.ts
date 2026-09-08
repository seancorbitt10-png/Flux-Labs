import { ValidationError } from "@/lib/errors";

/**
 * Raw student body max — leaves headroom for intent/focus framing so the
 * composed userMessage stays within orchestration's 4000-char cap.
 */
export const MAX_STUDY_MESSAGE = 3700;

/**
 * Study learning intents — server-mapped cues that align with assistance policy.
 * Clients choose an intent label; they cannot set assistanceMode/taskType.
 */
export const STUDY_INTENTS = [
  "ask",
  "hint",
  "check_work",
  "explain",
  "steps",
  "attempt",
] as const;

export type StudyIntent = (typeof STUDY_INTENTS)[number];

export const STUDY_INTENT_LABELS: Record<StudyIntent, string> = {
  ask: "Ask",
  hint: "Hint",
  check_work: "Check my work",
  explain: "Explain",
  steps: "Break into steps",
  attempt: "Submit attempt",
};

/**
 * Map intent → message framing that existing policy signals recognize.
 * Returns the full userMessage sent to orchestration.
 */
export function composeStudyUserMessage(args: {
  intent: StudyIntent;
  message: string;
  focusLabel?: string | null;
}): string {
  const body = args.message.trim();
  if (!body) {
    throw new ValidationError("Enter a message");
  }

  const focus =
    args.focusLabel && args.focusLabel.trim()
      ? `[Working on: ${args.focusLabel.trim()}]\n`
      : "";

  switch (args.intent) {
    case "ask":
      return `${focus}${body}`;
    case "hint":
      return `${focus}I need a hint: ${body}`;
    case "check_work":
      return `${focus}Please check my work: ${body}`;
    case "explain":
      return `${focus}Explain this concept: ${body}`;
    case "steps":
      return `${focus}Help me break this into steps: ${body}`;
    case "attempt":
      return `${focus}Here is my attempt. Please give feedback and ask me to keep working: ${body}`;
    default:
      throw new ValidationError("Unknown study intent.");
  }
}

export function parseStudyIntent(raw: unknown): StudyIntent {
  if (typeof raw !== "string" || !(STUDY_INTENTS as readonly string[]).includes(raw)) {
    throw new ValidationError("Invalid study intent.");
  }
  return raw as StudyIntent;
}
