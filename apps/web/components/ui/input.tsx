import type { InputHTMLAttributes } from "react";

const base =
  "w-full rounded-md border border-border-input bg-surface-card px-3 py-2 text-sm text-up-black shadow-sm transition-colors duration-150 ease-out-quart placeholder:text-muted/70 focus:border-up-black focus:outline-none focus:ring-1 focus:ring-up-black disabled:cursor-not-allowed disabled:opacity-50";

export function Input({ className = "", ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`${base} ${className}`} {...props} />;
}
