export function printJson(data: unknown): void {
  console.log(JSON.stringify(data, null, 2));
}

export function kanbanUrl(sessaoId: string): string {
  const base = process.env.AUTH_URL?.replace(/\/$/, "");
  const kanbanPath = `/prestacao/${sessaoId}/kanban`;
  return base ? `${base}${kanbanPath}` : kanbanPath;
}
