export type IngestErrorCodigo =
  | "OPENROUTER_NAO_CONFIGURADO"
  | "OPENROUTER_FALHA"
  | "PDF_INVALIDO"
  | "PDF_MUITAS_PAGINAS"
  | "PDF_SEM_TEXTO_E_VISAO_FALHOU"
  | "STORAGE_FALHA"
  | "INGESTAO_DESCONHECIDA";

export interface IngestErrorDetail {
  codigo: IngestErrorCodigo;
  mensagem: string;
  causaTecnica: string;
}

const MENSAGENS: Record<IngestErrorCodigo, string> = {
  OPENROUTER_NAO_CONFIGURADO:
    "Extração de PDF não está configurada no servidor. Contate o administrador.",
  OPENROUTER_FALHA:
    "Não foi possível ler o extrato com IA. Tente novamente em alguns minutos.",
  PDF_INVALIDO: "Arquivo PDF inválido ou corrompido.",
  PDF_MUITAS_PAGINAS: "Extrato com muitas páginas. Divida o arquivo.",
  PDF_SEM_TEXTO_E_VISAO_FALHOU:
    "Não foi possível extrair dados deste PDF (scan ou formato não suportado).",
  STORAGE_FALHA: "Falha ao salvar o arquivo. Tente novamente.",
  INGESTAO_DESCONHECIDA: "Erro inesperado no processamento.",
};

export class IngestError extends Error {
  readonly detail: IngestErrorDetail;

  constructor(detail: IngestErrorDetail) {
    super(detail.mensagem);
    this.name = "IngestError";
    this.detail = detail;
  }
}

export function classifyIngestError(error: unknown): IngestErrorDetail {
  if (error instanceof IngestError) {
    return error.detail;
  }

  const causaTecnica = error instanceof Error ? error.message : String(error);
  const msg = causaTecnica.toLowerCase();

  let codigo: IngestErrorCodigo = "INGESTAO_DESCONHECIDA";
  if (causaTecnica.includes("OPENROUTER_API_KEY")) {
    codigo = "OPENROUTER_NAO_CONFIGURADO";
  } else if (
    /openrouter http 401/i.test(causaTecnica) &&
    (msg.includes("user not found") || msg.includes("missing authentication"))
  ) {
    codigo = "OPENROUTER_NAO_CONFIGURADO";
  } else if (/mais de \d+ páginas/i.test(causaTecnica)) {
    codigo = "PDF_MUITAS_PAGINAS";
  } else if (/openrouter http/i.test(causaTecnica) || msg.includes("abort")) {
    codigo = "OPENROUTER_FALHA";
  } else if (/invalid pdf/i.test(causaTecnica) || msg.includes("pdfdocument")) {
    codigo = "PDF_INVALIDO";
  } else if (msg.includes("falha no storage") || msg.includes("blob")) {
    codigo = "STORAGE_FALHA";
  } else if (
    msg.includes("sem texto") ||
    msg.includes("texto insuficiente") ||
    msg.includes("visão") ||
    msg.includes("vision") ||
    msg.includes("não foi possível extrair")
  ) {
    codigo = "PDF_SEM_TEXTO_E_VISAO_FALHOU";
  } else if (msg.includes("colunas obrigatórias")) {
    codigo = "INGESTAO_DESCONHECIDA";
  }

  return { codigo, mensagem: MENSAGENS[codigo], causaTecnica };
}

export function toIngestError(error: unknown): IngestError {
  if (error instanceof IngestError) return error;
  return new IngestError(classifyIngestError(error));
}
