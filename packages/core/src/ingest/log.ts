export type IngestLogLevel = "info" | "error";

export type IngestFase =
  | "inicio"
  | "pdf_text"
  | "openrouter_text"
  | "openrouter_vision"
  | "filtro_doc"
  | "persist"
  | "match"
  | "concluido"
  | "storage";

export interface IngestLogFields {
  fase: IngestFase;
  arquivoId?: string;
  sessaoId?: string;
  filename?: string;
  duracaoMs?: number;
  codigoErro?: string;
  causa?: string;
}

export function ingestLog(level: IngestLogLevel, fields: IngestLogFields): void {
  const line = JSON.stringify({ event: "ingest", level, ...fields });
  if (level === "error") {
    console.error(line);
  } else {
    console.log(line);
  }
}
