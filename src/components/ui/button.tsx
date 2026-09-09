import { type ButtonHTMLAttributes } from "react";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost";
};

export function Button({
  variant = "primary",
  className = "",
  ...props
}: Props) {
  const base =
    "inline-flex min-h-10 items-center justify-center rounded-lg px-4 py-2 text-sm font-semibold tracking-tight transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas disabled:cursor-not-allowed disabled:opacity-50";
  const variants = {
    primary:
      "bg-accent text-accent-foreground hover:bg-accent/90",
    secondary:
      "border border-foreground/15 bg-surface text-foreground hover:bg-surface-elevated hover:border-foreground/25",
    ghost:
      "text-foreground/75 hover:bg-foreground/5 hover:text-foreground",
  };

  return (
    <button
      className={`${base} ${variants[variant]} ${className}`}
      {...props}
    />
  );
}
