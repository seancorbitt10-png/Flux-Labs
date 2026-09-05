"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  bootstrapOnboardingAction,
  completeOnboardingAction,
  dismissOnboardingAction,
  submitOnboardingAnswerAction,
} from "@/lib/onboarding/actions";
import {
  SUBJECT_SUGGESTIONS,
  type ClientOnboardingQuestion,
} from "@/lib/onboarding/catalog";
import type { OnboardingBootstrap } from "@/lib/onboarding/session";

type Props = {
  initial: OnboardingBootstrap;
};

function isAnswerReady(
  question: ClientOnboardingQuestion,
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

export function OnboardingFlow({ initial }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [bootstrap, setBootstrap] = useState(initial);
  const [index, setIndex] = useState(initial.progress.firstUnansweredIndex);
  const [draft, setDraft] = useState<unknown>(() => {
    const q = initial.questions[initial.progress.firstUnansweredIndex];
    const existing = q ? initial.answers[q.questionId] : undefined;
    if (existing && !existing.skipped) return existing.answer;
    if (q?.answerType === "string_array") return [];
    if (q?.answerType === "boolean") return null;
    return "";
  });
  const [error, setError] = useState<string | null>(null);
  const [tagInput, setTagInput] = useState("");
  const [doneView, setDoneView] = useState<"completed" | "dismissed" | null>(
    initial.gate === "completed"
      ? "completed"
      : initial.gate === "dismissed"
        ? "dismissed"
        : null,
  );

  const questions = bootstrap.questions;
  const question = questions[index];
  const total = questions.length;
  const stepNumber = Math.min(index + 1, total);
  const progressPct = total === 0 ? 0 : Math.round((stepNumber / total) * 100);

  const answeredCount = useMemo(
    () => Object.keys(bootstrap.answers).length,
    [bootstrap.answers],
  );

  function loadDraftForIndex(
    nextIndex: number,
    answers: OnboardingBootstrap["answers"],
    qs: ClientOnboardingQuestion[],
  ) {
    const q = qs[nextIndex];
    const existing = q ? answers[q.questionId] : undefined;
    if (existing && !existing.skipped) {
      setDraft(existing.answer);
    } else if (q?.answerType === "string_array") {
      setDraft([]);
    } else if (q?.answerType === "boolean") {
      setDraft(null);
    } else {
      setDraft("");
    }
    setTagInput("");
  }

  function goTo(nextIndex: number, nextBootstrap = bootstrap) {
    const clamped = Math.max(0, Math.min(nextIndex, nextBootstrap.questions.length - 1));
    setIndex(clamped);
    loadDraftForIndex(clamped, nextBootstrap.answers, nextBootstrap.questions);
    setError(null);
  }

  async function refreshBootstrap() {
    const result = await bootstrapOnboardingAction({ ensureSession: true });
    if (!result.ok) {
      setError(result.message);
      return null;
    }
    setBootstrap(result.data);
    return result.data;
  }

  function submitCurrent(skipped: boolean) {
    if (!bootstrap.session || !question) return;
    setError(null);

    if (!skipped && !isAnswerReady(question, draft)) {
      setError("Please answer this question, or skip it.");
      return;
    }

    startTransition(async () => {
      const result = await submitOnboardingAnswerAction({
        sessionId: bootstrap.session!.id,
        questionId: question.questionId,
        skipped,
        ...(skipped ? {} : { answer: draft }),
      });

      if (!result.ok) {
        setError(result.message);
        return;
      }

      const refreshed = await refreshBootstrap();
      if (!refreshed) return;

      if (index >= refreshed.questions.length - 1) {
        // Last question saved — stay for finish actions.
        goTo(index, refreshed);
        return;
      }
      goTo(index + 1, refreshed);
    });
  }

  function finish() {
    if (!bootstrap.session) return;
    startTransition(async () => {
      const result = await completeOnboardingAction({
        sessionId: bootstrap.session!.id,
      });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setDoneView("completed");
      router.refresh();
    });
  }

  function dismiss() {
    if (!bootstrap.session) return;
    startTransition(async () => {
      const result = await dismissOnboardingAction({
        sessionId: bootstrap.session!.id,
      });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setDoneView("dismissed");
      router.refresh();
    });
  }

  function addTag(raw: string) {
    const value = raw.trim();
    if (!value || !question) return;
    const maxItems = question.maxItems ?? 12;
    const itemMax = question.itemMaxLength ?? 80;
    if (value.length > itemMax) {
      setError(`Each item must be under ${itemMax} characters.`);
      return;
    }
    const current = Array.isArray(draft) ? [...draft] : [];
    if (current.includes(value)) {
      setTagInput("");
      return;
    }
    if (current.length >= maxItems) {
      setError(`You can add up to ${maxItems} items.`);
      return;
    }
    setDraft([...current, value]);
    setTagInput("");
    setError(null);
  }

  function removeTag(value: string) {
    if (!Array.isArray(draft)) return;
    setDraft(draft.filter((item) => item !== value));
  }

  if (doneView === "completed") {
    return (
      <div className="mx-auto max-w-lg space-y-6 animate-fade-up">
        <h1 className="font-display text-3xl tracking-tight">You&apos;re set up</h1>
        <p className="text-sm leading-relaxed text-foreground/65">
          Flux will use the academic context you shared to give more relevant
          help. You can keep refining things later in Settings.
        </p>
        <Button type="button" onClick={() => router.push("/home")}>
          Continue to Home
        </Button>
      </div>
    );
  }

  if (doneView === "dismissed") {
    return (
      <div className="mx-auto max-w-lg space-y-6 animate-fade-up">
        <h1 className="font-display text-3xl tracking-tight">Setup skipped</h1>
        <p className="text-sm leading-relaxed text-foreground/65">
          You can use Flux with less personalization. Resume setup anytime —
          Study still works with degraded context.
        </p>
        <div className="flex flex-wrap gap-3">
          <Button type="button" onClick={() => router.push("/home")}>
            Go to Home
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={pending}
            onClick={() => {
              startTransition(async () => {
                const refreshed = await refreshBootstrap();
                if (!refreshed?.session) return;
                setDoneView(null);
                goTo(refreshed.progress.firstUnansweredIndex, refreshed);
              });
            }}
          >
            Resume setup
          </Button>
        </div>
      </div>
    );
  }

  if (!question || !bootstrap.session) {
    return (
      <div className="mx-auto max-w-lg space-y-4">
        <p className="text-sm text-foreground/65">Loading academic setup…</p>
        {error ? (
          <p className="text-sm text-red-600" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    );
  }

  const canContinue = isAnswerReady(question, draft);

  return (
    <div className="mx-auto max-w-lg space-y-6 animate-fade-up">
      <header className="space-y-3">
        <p className="text-xs font-medium uppercase tracking-[0.14em] text-foreground/45">
          Academic setup
        </p>
        <h1 className="font-display text-3xl tracking-tight sm:text-4xl">
          Flux Labs
        </h1>
        <p className="text-sm leading-relaxed text-foreground/65">
          A short academic setup so Flux can help more usefully. Skip anything
          you prefer not to share.
        </p>
      </header>

      <div
        className="space-y-2"
        aria-label={`Progress: step ${stepNumber} of ${total}`}
      >
        <div className="flex items-center justify-between text-xs text-foreground/55">
          <span>
            Step {stepNumber} of {total}
          </span>
          <span>
            {answeredCount} saved · {bootstrap.progress.remaining} remaining
          </span>
        </div>
        <div
          className="h-1.5 overflow-hidden rounded-full bg-foreground/10"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progressPct}
        >
          <div
            className="h-full rounded-full bg-foreground transition-[width] duration-300 ease-out"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </div>

      <section className="space-y-4 animate-fade-up-delay" aria-live="polite">
        <div className="space-y-1">
          <h2 className="text-lg font-medium leading-snug">{question.prompt}</h2>
          <p className="text-xs text-foreground/50">
            {question.essential ? "Essential for better help" : "Optional"}
            {question.skippable ? " · Skippable" : ""}
          </p>
        </div>

        {question.answerType === "enum" && question.options ? (
          <fieldset className="space-y-2" disabled={pending}>
            <legend className="sr-only">{question.prompt}</legend>
            {question.options.map((option) => {
              const selected = draft === option.value;
              return (
                <label
                  key={option.value}
                  className={[
                    "flex min-h-11 cursor-pointer items-center gap-3 rounded-md border px-3 py-2.5 text-sm transition",
                    selected
                      ? "border-foreground/40 bg-background"
                      : "border-foreground/15 bg-background/60 hover:border-foreground/30",
                  ].join(" ")}
                >
                  <input
                    type="radio"
                    className="size-4 accent-foreground"
                    name={question.questionId}
                    value={option.value}
                    checked={selected}
                    onChange={() => setDraft(option.value)}
                  />
                  <span>{option.label}</span>
                </label>
              );
            })}
          </fieldset>
        ) : null}

        {question.answerType === "boolean" ? (
          <fieldset className="grid grid-cols-2 gap-2" disabled={pending}>
            <legend className="sr-only">{question.prompt}</legend>
            {[
              { value: true, label: "Yes" },
              { value: false, label: "No" },
            ].map((option) => {
              const selected = draft === option.value;
              return (
                <button
                  key={String(option.value)}
                  type="button"
                  aria-pressed={selected}
                  className={[
                    "min-h-11 rounded-md border px-3 text-sm transition",
                    selected
                      ? "border-foreground/40 bg-background"
                      : "border-foreground/15 bg-background/60 hover:border-foreground/30",
                  ].join(" ")}
                  onClick={() => setDraft(option.value)}
                >
                  {option.label}
                </button>
              );
            })}
          </fieldset>
        ) : null}

        {question.answerType === "string" ? (
          <label className="block space-y-1.5">
            <span className="sr-only">{question.prompt}</span>
            <textarea
              rows={4}
              maxLength={question.maxLength ?? 300}
              disabled={pending}
              value={typeof draft === "string" ? draft : ""}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={question.placeholder}
              className="w-full rounded-md border border-foreground/15 bg-background/80 px-3 py-2 text-sm outline-none focus:border-foreground/40 focus:ring-2 focus:ring-foreground/10"
            />
          </label>
        ) : null}

        {question.answerType === "string_array" ? (
          <div className="space-y-3">
            {question.questionId === "academic.subjects" ? (
              <div className="flex flex-wrap gap-2">
                {SUBJECT_SUGGESTIONS.map((subject) => {
                  const selected =
                    Array.isArray(draft) && draft.includes(subject);
                  return (
                    <button
                      key={subject}
                      type="button"
                      disabled={pending}
                      aria-pressed={selected}
                      className={[
                        "min-h-10 rounded-md border px-3 text-sm transition",
                        selected
                          ? "border-foreground/40 bg-background"
                          : "border-foreground/15 bg-background/60",
                      ].join(" ")}
                      onClick={() => {
                        const current = Array.isArray(draft) ? [...draft] : [];
                        if (selected) {
                          setDraft(current.filter((s) => s !== subject));
                        } else if (current.length < (question.maxItems ?? 12)) {
                          setDraft([...current, subject]);
                        }
                      }}
                    >
                      {subject}
                    </button>
                  );
                })}
              </div>
            ) : null}

            <div className="flex gap-2">
              <input
                type="text"
                value={tagInput}
                disabled={pending}
                maxLength={question.itemMaxLength ?? 80}
                placeholder={question.placeholder ?? "Add an item"}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addTag(tagInput);
                  }
                }}
                className="min-h-11 flex-1 rounded-md border border-foreground/15 bg-background/80 px-3 text-sm outline-none focus:border-foreground/40 focus:ring-2 focus:ring-foreground/10"
                aria-label={question.placeholder ?? "Add an item"}
              />
              <Button
                type="button"
                variant="secondary"
                disabled={pending || tagInput.trim().length === 0}
                onClick={() => addTag(tagInput)}
              >
                Add
              </Button>
            </div>

            {Array.isArray(draft) && draft.length > 0 ? (
              <ul className="flex flex-wrap gap-2" aria-label="Selected items">
                {draft.map((item) => (
                  <li key={item}>
                    <button
                      type="button"
                      className="min-h-10 rounded-md border border-foreground/20 bg-background px-3 text-sm"
                      onClick={() => removeTag(item)}
                      aria-label={`Remove ${item}`}
                    >
                      {item} ×
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-foreground/50">No items added yet.</p>
            )}
          </div>
        ) : null}
      </section>

      {error ? (
        <p className="text-sm text-red-600" role="alert">
          {error}
        </p>
      ) : null}

      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
        <Button
          type="button"
          disabled={pending || index === 0}
          variant="ghost"
          className="min-h-11 sm:order-1"
          onClick={() => goTo(index - 1)}
        >
          Back
        </Button>
        <Button
          type="button"
          disabled={pending || !canContinue}
          className="min-h-11 sm:order-3 sm:ml-auto"
          onClick={() => submitCurrent(false)}
        >
          {pending ? "Saving…" : index >= total - 1 ? "Save" : "Next"}
        </Button>
        {question.skippable ? (
          <Button
            type="button"
            variant="secondary"
            disabled={pending}
            className="min-h-11 sm:order-2"
            onClick={() => submitCurrent(true)}
          >
            Skip
          </Button>
        ) : null}
      </div>

      <div className="flex flex-col gap-2 border-t border-foreground/10 pt-4 sm:flex-row sm:items-center sm:justify-between">
        <Button
          type="button"
          variant="ghost"
          disabled={pending}
          className="min-h-11 justify-start px-0 sm:px-4"
          onClick={dismiss}
        >
          Skip setup for now
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={pending}
          className="min-h-11"
          onClick={finish}
        >
          Finish setup
        </Button>
      </div>
    </div>
  );
}
