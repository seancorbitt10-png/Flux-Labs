export function EmptyState({
  title,
  body,
}: {
  title: string;
  body: string;
}) {
  return (
    <div className="rounded-lg border border-dashed border-foreground/15 bg-background/40 px-5 py-8">
      <h2 className="text-sm font-medium">{title}</h2>
      <p className="mt-2 max-w-xl text-sm leading-relaxed text-foreground/60">
        {body}
      </p>
    </div>
  );
}
