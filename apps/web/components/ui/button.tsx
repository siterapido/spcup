import type { ButtonHTMLAttributes } from "react";

const variants = {
  default:
    "bg-up-black text-up-white hover:bg-up-black-hover focus-visible:ring-up-black",
  outline:
    "border border-border-input bg-surface-card text-up-black hover:bg-surface-page focus-visible:ring-up-black",
  ghost: "text-up-black hover:bg-surface-page focus-visible:ring-up-black",
  destructive:
    "bg-red-600 text-up-white hover:bg-red-700 focus-visible:ring-red-600",
} as const;

const base =
  "inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-medium transition-colors duration-150 ease-out-quart disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2";

export function buttonClassName(
  variant: keyof typeof variants = "default",
  className = "",
) {
  return `${base} ${variants[variant]} ${className}`.trim();
}

export function Button({
  className = "",
  variant = "default",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: keyof typeof variants;
}) {
  return <button className={buttonClassName(variant, className)} {...props} />;
}
