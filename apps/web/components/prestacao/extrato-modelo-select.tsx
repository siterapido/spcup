import { ExtratoModeloId, EXTRATO_MODELO_LABELS } from "@spc-up/core/browser";
import { Badge } from "@/components/ui/badge";

interface ExtratoModeloSelectProps {
  value: ExtratoModeloId;
  onChange: (value: ExtratoModeloId) => void;
  disabled?: boolean;
}

export function ExtratoModeloSelect({ value, onChange, disabled }: ExtratoModeloSelectProps) {
  const badgeTone = value === "outro" ? "warn" : "success";
  const badgeLabel = value === "outro" ? "Manual" : "Detectado";

  return (
    <div className="flex items-center gap-3">
      <div className="flex-1">
        <select
          className="w-full rounded-md border border-border-default px-3 py-2 text-sm bg-white disabled:bg-slate-50 disabled:text-muted"
          value={value || "outro"}
          onChange={(e) => onChange(e.target.value as ExtratoModeloId)}
          disabled={disabled}
        >
          <option value="caixa_pix">{EXTRATO_MODELO_LABELS.caixa_pix}</option>
          <option value="caixa_total">{EXTRATO_MODELO_LABELS.caixa_total}</option>
          <option value="outro">{EXTRATO_MODELO_LABELS.outro}</option>
        </select>
      </div>
      <Badge tone={badgeTone} className="shrink-0">
        {badgeLabel}
      </Badge>
    </div>
  );
}
