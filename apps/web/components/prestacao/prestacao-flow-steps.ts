export const WIZARD_STEPS = [
  { id: 1, label: "UF" },
  { id: 2, label: "Tipo" },
  { id: 3, label: "Prestador" },
  { id: 4, label: "Exercício" },
  { id: 5, label: "Anexos" },
] as const;

export const END_TO_END_FLOW_STEPS = [
  ...WIZARD_STEPS,
  { id: 6, label: "Kanban" },
  { id: 7, label: "Export" },
] as const;
