import { type InputHTMLAttributes } from "react";

type Props = InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  error?: string;
};

export function Input({ label, error, id, className = "", ...props }: Props) {
  const inputId = id ?? props.name;
  return (
    <label className="block space-y-1.5">
      <span className="text-sm text-foreground/70">{label}</span>
      <input
        id={inputId}
        className={[
          "w-full rounded-md border border-foreground/15 bg-background/80 px-3 py-2 text-sm outline-none transition",
          "focus:border-foreground/40 focus:ring-2 focus:ring-foreground/10",
          error ? "border-red-500/60" : "",
          className,
        ].join(" ")}
        {...props}
      />
      {error ? <span className="text-xs text-red-600">{error}</span> : null}
    </label>
  );
}
