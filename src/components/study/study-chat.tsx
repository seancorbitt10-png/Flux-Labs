"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import {
  sendStudyMessage,
  type StudyActionResult,
} from "@/lib/ai/actions";

export function StudyChat() {
  const [state, action, pending] = useActionState<
    StudyActionResult | null,
    FormData
  >(sendStudyMessage, null);

  return (
    <div className="space-y-4">
      <form action={action} className="space-y-3">
        <label className="block space-y-1.5">
          <span className="text-sm text-foreground/70">
            What are you working on?
          </span>
          <textarea
            name="message"
            rows={4}
            required
            maxLength={4000}
            placeholder="Ask for guidance — Flux will teach and guide rather than dump answers."
            className="w-full rounded-md border border-foreground/15 bg-background/80 px-3 py-2 text-sm outline-none focus:border-foreground/40 focus:ring-2 focus:ring-foreground/10"
          />
        </label>
        <Button type="submit" disabled={pending}>
          {pending ? "Thinking…" : "Ask Flux"}
        </Button>
      </form>

      {state?.ok === false ? (
        <p className="text-sm text-red-600" role="alert">
          {state.message}
        </p>
      ) : null}

      {state?.ok === true ? (
        <div className="space-y-3 rounded-lg border border-foreground/10 bg-background/60 p-4">
          <div className="flex flex-wrap gap-2 text-xs text-foreground/55">
            <span>Mode: {state.assistanceMode}</span>
            <span aria-hidden>·</span>
            <span>Task: {state.taskType}</span>
            {state.requiresStudentParticipation ? (
              <>
                <span aria-hidden>·</span>
                <span>Your participation required</span>
              </>
            ) : null}
          </div>
          <p className="whitespace-pre-wrap text-sm leading-relaxed">
            {state.reply}
          </p>
        </div>
      ) : null}
    </div>
  );
}
