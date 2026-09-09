export function PageHeader({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <header className="mb-8 max-w-2xl">
      <h1 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
        {title}
      </h1>
      <p className="mt-2 text-sm font-medium leading-relaxed text-muted sm:text-base">
        {description}
      </p>
    </header>
  );
}
