import type { ReactNode } from "react";

export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-dashed border-foreground/15 bg-background/40 px-5 py-8">
      <h2 className="text-sm font-medium">{title}</h2>
      <p className="mt-2 max-w-xl text-sm leading-relaxed text-foreground/60">
        {body}
      </p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
