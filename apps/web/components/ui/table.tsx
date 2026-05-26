import type { HTMLAttributes, TableHTMLAttributes } from "react";

export function Table({ className = "", ...props }: TableHTMLAttributes<HTMLTableElement>) {
  return (
    <table className={`w-full border-collapse text-sm ${className}`} {...props} />
  );
}

export function Th({ className = "", ...props }: HTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      className={`border-b border-slate-200 px-3 py-2 text-left font-medium text-slate-600 ${className}`}
      {...props}
    />
  );
}

export function Td({ className = "", ...props }: HTMLAttributes<HTMLTableCellElement>) {
  return <td className={`border-b border-slate-100 px-3 py-2 ${className}`} {...props} />;
}
