"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import type { OrchestrationProposalSummary } from "@/lib/ai/types";
import {
  confirmStudyProposalAction,
  loadStudyBootstrapAction,
  rejectStudyProposalAction,
  sendStudyTurnAction,
} from "@/lib/study/actions";
import {
  MAX_STUDY_MESSAGE,
  STUDY_INTENT_LABELS,
  STUDY_INTENTS,
  type StudyIntent,
} from "@/lib/study/intents";
import type { StudyBootstrap, StudyFocusOption } from "@/lib/study/bootstrap";

type ChatTurn = {
  id: string;
  role: "user" | "assistant";
  content: string;
  meta?: {
    assistanceMode?: string;
    taskType?: string;
    requiresStudentParticipation?: boolean;
    intent?: StudyIntent;
  };
};

type PendingProposal = OrchestrationProposalSummary & {
  statusLocal?: "pending" | "confirmed" | "rejected" | "error";
  error?: string;
};

function newId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function StudyWorkspace({
  initialBootstrap,
}: {
  initialBootstrap: StudyBootstrap;
}) {
  const formId = useId();
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const [pending, startTransition] = useTransition();
  const [bootstrap, setBootstrap] = useState(initialBootstrap);
  const [intent, setIntent] = useState<StudyIntent>("ask");
  const [message, setMessage] = useState("");
  const [focusLabel, setFocusLabel] = useState("");
  const [focusConceptId, setFocusConceptId] = useState<string>("");
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [proposals, setProposals] = useState<PendingProposal[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [turns, pending]);

  function selectedFocusOption(): StudyFocusOption | null {
    if (!focusConceptId) return null;
    return (
      bootstrap.focusOptions.find((o) => o.conceptId === focusConceptId) ?? null
    );
  }

  function submitTurn() {
    const trimmed = message.trim();
    if (!trimmed || pending) return;
    setError(null);
    setStatusMessage(null);

    const focusOption = selectedFocusOption();
    const effectiveFocusLabel =
      focusLabel.trim() || focusOption?.name || null;

    const priorTurns = turns.slice(-8).map((t) => ({
      role: t.role,
      content: t.content,
    }));

    const optimisticUser: ChatTurn = {
      id: newId(),
      role: "user",
      content: trimmed,
      meta: { intent },
    };
    setTurns((prev) => [...prev, optimisticUser]);
    setMessage("");

    startTransition(async () => {
      const result = await sendStudyTurnAction({
        message: trimmed,
        intent,
        focusLabel: effectiveFocusLabel,
        ...(focusOption ? { conceptIds: [focusOption.conceptId] } : {}),
        priorTurns,
      });

      if (!result.ok) {
        // Drop optimistic turn so failed sends do not poison priorTurns.
        setTurns((prev) => prev.filter((t) => t.id !== optimisticUser.id));
        setMessage(trimmed);
        setError(result.message);
        setStatusMessage(null);
        return;
      }

      setTurns((prev) => [
        ...prev,
        {
          id: newId(),
          role: "assistant",
          content: result.reply,
          meta: {
            assistanceMode: result.assistanceMode,
            taskType: result.taskType,
            requiresStudentParticipation: result.requiresStudentParticipation,
          },
        },
      ]);

      if (result.proposals.length > 0) {
        setProposals((prev) => [
          ...prev,
          ...result.proposals.map((p) => ({
            ...p,
            statusLocal: "pending" as const,
          })),
        ]);
      }

      if (result.requiresStudentParticipation) {
        setStatusMessage(
          "Flux expects your participation — try a step, ask for a hint, or submit an attempt.",
        );
      }
    });
  }

  function onConfirmProposal(proposalId: string) {
    startTransition(async () => {
      const result = await confirmStudyProposalAction({ proposalId });
      setProposals((prev) =>
        prev.map((p) =>
          p.id === proposalId
            ? {
                ...p,
                statusLocal: result.ok ? "confirmed" : "error",
                error: result.ok ? undefined : result.message,
              }
            : p,
        ),
      );
    });
  }

  function onRejectProposal(proposalId: string) {
    startTransition(async () => {
      const result = await rejectStudyProposalAction({ proposalId });
      setProposals((prev) =>
        prev.map((p) =>
          p.id === proposalId
            ? {
                ...p,
                statusLocal: result.ok ? "rejected" : "error",
                error: result.ok ? undefined : result.message,
              }
            : p,
        ),
      );
    });
  }

  function refreshBootstrap() {
    startTransition(async () => {
      const result = await loadStudyBootstrapAction();
      if (result.ok) setBootstrap(result.data);
    });
  }

  const canSend = message.trim().length > 0 && !pending;

  return (
    <div className="flex min-h-[70vh] flex-col gap-4 lg:min-h-[calc(100vh-8rem)]">
      <header className="space-y-1 border-b border-foreground/10 pb-4">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.12em] text-foreground/45">
              Study
            </p>
            <h1 className="text-xl font-bold tracking-tight sm:text-2xl">
              Academic workspace
            </h1>
          </div>
          {bootstrap.entitlement ? (
            <p className="text-xs text-foreground/50">
              Plan: {bootstrap.entitlement.plan.replaceAll("_", " ")}
            </p>
          ) : null}
        </div>
        <p className="max-w-2xl text-sm text-foreground/65">
          {bootstrap.guidance.note}
        </p>
      </header>

      <div className="grid flex-1 gap-4 lg:grid-cols-[minmax(0,1fr)_16rem]">
        <section
          className="flex min-h-0 flex-col rounded-lg border border-foreground/12 bg-background/70"
          aria-label="Study conversation"
        >
          <div className="border-b border-foreground/10 px-3 py-2 sm:px-4">
            <label className="block space-y-1" htmlFor={`${formId}-focus-select`}>
              <span className="text-xs text-foreground/55">Focus</span>
              <div className="flex flex-col gap-2 sm:flex-row">
                <select
                  id={`${formId}-focus-select`}
                  className="min-h-10 w-full rounded-md border border-foreground/15 bg-background px-2 text-sm outline-none focus:border-foreground/40 focus:ring-2 focus:ring-foreground/10 sm:max-w-xs"
                  value={focusConceptId}
                  onChange={(e) => {
                    setFocusConceptId(e.target.value);
                    const opt = bootstrap.focusOptions.find(
                      (o) => o.conceptId === e.target.value,
                    );
                    if (opt) setFocusLabel(opt.name);
                  }}
                >
                  <option value="">No linked concept</option>
                  {bootstrap.focusOptions.map((opt) => (
                    <option key={opt.conceptId} value={opt.conceptId}>
                      {opt.name} ({opt.mastery})
                    </option>
                  ))}
                </select>
                <input
                  id={`${formId}-focus-label`}
                  type="text"
                  maxLength={120}
                  placeholder="What are you working on?"
                  value={focusLabel}
                  onChange={(e) => setFocusLabel(e.target.value)}
                  className="min-h-10 w-full flex-1 rounded-md border border-foreground/15 bg-background px-3 text-sm outline-none focus:border-foreground/40 focus:ring-2 focus:ring-foreground/10"
                  aria-label="Focus label"
                />
              </div>
              <p className="text-xs text-foreground/45">
                Concept links are server-validated IDs only — no guessing from free text.
              </p>
            </label>
          </div>

          <div
            className="flex-1 space-y-3 overflow-y-auto px-3 py-3 sm:px-4"
            aria-live="polite"
          >
            {turns.length === 0 ? (
              <div className="rounded-md border border-dashed border-foreground/15 px-3 py-6 text-sm text-foreground/60">
                <p className="font-medium text-foreground/80">Start a study turn</p>
                <p className="mt-1">
                  Ask a question, request a hint, check an attempt, or ask Flux to
                  break a problem into steps. Flux will guide — not finish the work for you.
                </p>
              </div>
            ) : null}

            {turns.map((turn) => (
              <article
                key={turn.id}
                className={[
                  "rounded-md border px-3 py-2.5 text-sm leading-relaxed",
                  turn.role === "user"
                    ? "border-foreground/15 bg-foreground/[0.03]"
                    : "border-foreground/10 bg-background",
                ].join(" ")}
              >
                <p className="text-xs font-medium uppercase tracking-wide text-foreground/45">
                  {turn.role === "user" ? "You" : "Flux"}
                  {turn.meta?.intent
                    ? ` · ${STUDY_INTENT_LABELS[turn.meta.intent]}`
                    : null}
                </p>
                <p className="mt-1 whitespace-pre-wrap">{turn.content}</p>
                {turn.role === "assistant" && turn.meta ? (
                  <p className="mt-2 flex flex-wrap gap-x-2 gap-y-1 text-xs text-foreground/50">
                    {turn.meta.assistanceMode ? (
                      <span>Mode: {turn.meta.assistanceMode}</span>
                    ) : null}
                    {turn.meta.taskType ? (
                      <span>Task: {turn.meta.taskType}</span>
                    ) : null}
                    {turn.meta.requiresStudentParticipation ? (
                      <span>Participation requested</span>
                    ) : null}
                  </p>
                ) : null}
              </article>
            ))}

            {pending ? (
              <p className="text-sm text-foreground/55" role="status" aria-live="assertive">
                Flux is preparing guidance…
              </p>
            ) : null}
            <div ref={bottomRef} />
          </div>

          <div className="border-t border-foreground/10 px-3 py-3 sm:px-4">
            <fieldset className="mb-2" disabled={pending}>
              <legend className="sr-only">Study intent</legend>
              <div className="flex flex-wrap gap-1.5">
                {STUDY_INTENTS.map((value) => {
                  const selected = intent === value;
                  return (
                    <button
                      key={value}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => setIntent(value)}
                      className={[
                        "min-h-9 rounded-md border px-2.5 text-xs transition sm:text-sm",
                        selected
                          ? "border-foreground/40 bg-foreground text-background"
                          : "border-foreground/15 bg-background/60 text-foreground/80 hover:border-foreground/30",
                      ].join(" ")}
                    >
                      {STUDY_INTENT_LABELS[value]}
                    </button>
                  );
                })}
              </div>
            </fieldset>

            <label className="block space-y-1.5" htmlFor={`${formId}-message`}>
              <span className="sr-only">Study message</span>
              <textarea
                id={`${formId}-message`}
                rows={3}
                maxLength={MAX_STUDY_MESSAGE}
                value={message}
                disabled={pending}
                onChange={(e) => setMessage(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    submitTurn();
                  }
                }}
                placeholder={
                  intent === "attempt"
                    ? "Paste your attempt for feedback…"
                    : intent === "check_work"
                      ? "Share your reasoning to check…"
                      : "Ask for guidance — Flux will teach and guide."
                }
                className="w-full rounded-md border border-foreground/15 bg-background px-3 py-2 text-sm outline-none focus:border-foreground/40 focus:ring-2 focus:ring-foreground/10 disabled:opacity-60"
              />
            </label>

            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Button
                type="button"
                disabled={!canSend}
                onClick={submitTurn}
                aria-busy={pending}
              >
                {pending ? "Sending…" : "Send"}
              </Button>
              <p className="text-xs text-foreground/45">
                ⌘/Ctrl+Enter to send · {message.length}/{MAX_STUDY_MESSAGE}
              </p>
            </div>

            {error ? (
              <p className="mt-2 text-sm text-danger" role="alert">
                {error}
              </p>
            ) : null}
            {statusMessage ? (
              <p className="mt-2 text-sm text-foreground/65" role="status">
                {statusMessage}
              </p>
            ) : null}
          </div>
        </section>

        <aside className="space-y-3 lg:sticky lg:top-4 lg:self-start">
          <div className="rounded-lg border border-foreground/12 bg-background/70 p-3">
            <h2 className="text-sm font-medium">Session notes</h2>
            <ul className="mt-2 space-y-1.5 text-xs leading-relaxed text-foreground/60">
              <li>Learning-first policy is server-controlled.</li>
              <li>Conversation stays in this browser session (not a durable chat DB).</li>
              <li>Student Model changes only via confirmed AI proposals.</li>
            </ul>
            <Button
              type="button"
              variant="ghost"
              className="mt-2 min-h-9 px-2 text-xs"
              onClick={refreshBootstrap}
              disabled={pending}
            >
              Refresh focus options
            </Button>
          </div>

          <div className="rounded-lg border border-foreground/12 bg-background/70 p-3">
            <h2 className="text-sm font-medium">Pending proposals</h2>
            {proposals.length === 0 ? (
              <p className="mt-2 text-xs text-foreground/55">
                No AI proposals yet. When Flux suggests a Student Model change, it
                appears here for confirmation.
              </p>
            ) : (
              <ul className="mt-2 space-y-2">
                {proposals.map((p) => (
                  <li
                    key={p.id}
                    className="rounded-md border border-foreground/10 px-2 py-2 text-xs"
                  >
                    <p className="font-medium">{p.type}</p>
                    {p.rationale ? (
                      <p className="mt-1 text-foreground/60">{p.rationale}</p>
                    ) : null}
                    <p className="mt-1 text-foreground/45">
                      Status: {p.statusLocal ?? p.status}
                    </p>
                    {p.error ? (
                      <p className="mt-1 text-danger" role="alert">
                        {p.error}
                      </p>
                    ) : null}
                    {(p.statusLocal ?? "pending") === "pending" ? (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        <Button
                          type="button"
                          className="min-h-9 px-2 text-xs"
                          disabled={pending}
                          onClick={() => onConfirmProposal(p.id)}
                        >
                          Confirm
                        </Button>
                        <Button
                          type="button"
                          variant="secondary"
                          className="min-h-9 px-2 text-xs"
                          disabled={pending}
                          onClick={() => onRejectProposal(p.id)}
                        >
                          Reject
                        </Button>
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
