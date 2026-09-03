export function PageHeader({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <header className="mb-8 max-w-2xl">
      <h1 className="font-display text-3xl tracking-tight sm:text-4xl">
        {title}
      </h1>
      <p className="mt-2 text-sm leading-relaxed text-foreground/65 sm:text-base">
        {description}
      </p>
    </header>
  );
}
