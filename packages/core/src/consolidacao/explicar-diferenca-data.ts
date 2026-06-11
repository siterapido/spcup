/** Feriados nacionais fixos (mês/dia). Móveis (Carnaval etc.) não entram. */
const FERIADOS_FIXOS_BR: ReadonlyArray<{ mes: number; dia: number; nome: string }> = [
  { mes: 1, dia: 1, nome: "Ano Novo" },
  { mes: 4, dia: 21, nome: "Tiradentes" },
  { mes: 5, dia: 1, nome: "Dia do Trabalho" },
  { mes: 9, dia: 7, nome: "Independência" },
  { mes: 10, dia: 12, nome: "Nossa Senhora Aparecida" },
  { mes: 11, dia: 2, nome: "Finados" },
  { mes: 11, dia: 15, nome: "Proclamação da República" },
  { mes: 11, dia: 20, nome: "Consciência Negra" },
  { mes: 12, dia: 25, nome: "Natal" },
];

const DIAS_SEMANA = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"] as const;

export type DiferencaDataPixCompleto = {
  dataPix: string;
  dataCompleto: string;
  diffDias: number;
  mesmoDia: boolean;
  /** Texto curto para UI */
  motivo: string | null;
  status: "ok" | "info" | "warn";
};

function parseIsoDate(iso: string): Date | null {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const d = new Date(`${m[1]}-${m[2]}-${m[3]}T12:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function diffDiasCalendario(pix: Date, completo: Date): number {
  const ms = completo.getTime() - pix.getTime();
  return Math.round(ms / (1000 * 60 * 60 * 24));
}

function feriadoFixoNaData(d: Date): string | null {
  const mes = d.getMonth() + 1;
  const dia = d.getDate();
  return FERIADOS_FIXOS_BR.find((f) => f.mes === mes && f.dia === dia)?.nome ?? null;
}

function diaSemanaLabel(d: Date): string {
  return DIAS_SEMANA[d.getDay()] ?? "?";
}

function motivoFimDeSemana(pix: Date, completo: Date, diff: number): string | null {
  const dowPix = pix.getDay();
  if (diff === 0) return null;

  if (dowPix === 6 && diff === 2) {
    return "PIX no sábado; extrato completo na segunda (+2 dias)";
  }
  if (dowPix === 0 && diff === 1) {
    return "PIX no domingo; extrato completo na segunda (+1 dia)";
  }
  if (dowPix === 5 && diff === 3 && completo.getDay() === 1) {
    return "PIX na sexta; extrato completo na segunda (+3 dias, fim de semana)";
  }
  if (dowPix === 6 && diff === 1 && completo.getDay() === 0) {
    return "PIX no sábado; extrato completo no domingo (+1 dia)";
  }
  if ((dowPix === 6 || dowPix === 0) && diff >= 1 && diff <= 3) {
    return `PIX no ${diaSemanaLabel(pix)}; diferença de ${diff} dia(s) até o completo (fim de semana)`;
  }
  return null;
}

function motivoFeriado(pix: Date, completo: Date, diff: number): string | null {
  const feriadoPix = feriadoFixoNaData(pix);
  if (feriadoPix && diff >= 1 && diff <= 3) {
    return `PIX em feriado (${feriadoPix}); completo ${diff} dia(s) depois`;
  }
  for (let i = 1; i <= diff; i++) {
    const entre = new Date(pix);
    entre.setDate(entre.getDate() + i);
    const feriado = feriadoFixoNaData(entre);
    if (feriado) {
      return `Entre PIX e completo cai ${feriado} (+${diff} dia(s) no extrato total)`;
    }
  }
  const feriadoComp = feriadoFixoNaData(completo);
  if (feriadoComp && diff >= 1 && diff <= 3) {
    return `Completo em feriado (${feriadoComp}); PIX ${diff} dia(s) antes`;
  }
  return null;
}

/**
 * Explica diferença de data entre movimentação PIX e extrato completo
 * (janela de consolidação: completo 0–3 dias após PIX).
 */
export function explicarDiferencaDataPixCompleto(
  dataPix: string,
  dataCompleto: string,
): DiferencaDataPixCompleto {
  const pix = parseIsoDate(dataPix);
  const completo = parseIsoDate(dataCompleto);

  if (!pix || !completo) {
    return {
      dataPix,
      dataCompleto,
      diffDias: 0,
      mesmoDia: false,
      motivo: "datas inválidas para comparar",
      status: "warn",
    };
  }

  const diff = diffDiasCalendario(pix, completo);
  const mesmoDia = diff === 0;

  if (mesmoDia) {
    return { dataPix, dataCompleto, diffDias: 0, mesmoDia: true, motivo: null, status: "ok" };
  }

  if (diff < 0) {
    return {
      dataPix,
      dataCompleto,
      diffDias: diff,
      mesmoDia: false,
      motivo: "data do completo é anterior ao PIX",
      status: "warn",
    };
  }

  if (diff > 3) {
    return {
      dataPix,
      dataCompleto,
      diffDias: diff,
      mesmoDia: false,
      motivo: `diferença de ${diff} dias (fora da janela de 3 dias da consolidação)`,
      status: "warn",
    };
  }

  const fimDeSemana = motivoFimDeSemana(pix, completo, diff);
  if (fimDeSemana) {
    return {
      dataPix,
      dataCompleto,
      diffDias: diff,
      mesmoDia: false,
      motivo: fimDeSemana,
      status: "info",
    };
  }

  const feriado = motivoFeriado(pix, completo, diff);
  if (feriado) {
    return {
      dataPix,
      dataCompleto,
      diffDias: diff,
      mesmoDia: false,
      motivo: feriado,
      status: "info",
    };
  }

  return {
    dataPix,
    dataCompleto,
    diffDias: diff,
    mesmoDia: false,
    motivo: `diferença de ${diff} dia(s): pode ser compensação bancária (dia útil ou feriado móvel)`,
    status: "info",
  };
}
