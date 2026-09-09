import { type InputHTMLAttributes } from "react";

type Props = InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  error?: string;
};

export function Input({ label, error, id, className = "", ...props }: Props) {
  const inputId = id ?? props.name;
  return (
    <label className="block space-y-1.5">
      <span className="text-sm font-medium text-foreground/75">{label}</span>
      <input
        id={inputId}
        className={[
          "w-full min-h-10 rounded-lg border border-foreground/12 bg-surface px-3 py-2 text-sm font-medium text-foreground outline-none transition",
          "placeholder:text-foreground/35",
          "focus:border-accent/50 focus:ring-2 focus:ring-accent/25",
          error ? "border-danger/70" : "",
          className,
        ].join(" ")}
        {...props}
      />
      {error ? <span className="text-xs font-medium text-danger">{error}</span> : null}
    </label>
  );
}
