/** Single-screen upload wizard (no multi-step UI). */
export const WIZARD_STEPS = [{ id: 1, label: "Upload" }] as const;

export const END_TO_END_FLOW_STEPS = [
  { id: 1, label: "Upload" },
  { id: 2, label: "Planilha" },
  { id: 3, label: "Export" },
] as const;
