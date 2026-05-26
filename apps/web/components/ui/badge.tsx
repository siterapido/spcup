import type { HTMLAttributes } from "react";

const tones = {
  success: "bg-status-success-bg text-status-success-text",
  danger: "bg-status-danger-bg text-status-danger-text",
  neutral: "bg-surface-page text-muted",
  warn: "bg-status-warn-bg text-status-warn-text",
} as const;

export function Badge({
  tone = "neutral",
  className = "",
  ...props
}: HTMLAttributes<HTMLSpanElement> & { tone?: keyof typeof tones }) {
  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${tones[tone]} ${className}`}
      {...props}
    />
  );
}
