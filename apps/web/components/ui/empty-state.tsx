export function EmptyState({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  return (
    <div className="rounded-md border border-dashed border-border-default px-4 py-8 text-center">
      <p className="text-sm font-medium text-up-black">{title}</p>
      {description ? <p className="mt-1 text-sm text-muted">{description}</p> : null}
    </div>
  );
}
