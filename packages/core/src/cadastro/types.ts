import type { CadastroTipo } from "./constants";

export interface CadastroRow {
  linha: number;
  tipo: CadastroTipo;
  documento: string;
  nome: string;
}

export interface UpsertPessoaResult {
  action: "inserted" | "updated" | "unchanged" | "conflict";
  pessoaFisicaId?: string;
  pessoaJuridicaId?: string;
  conflitoId?: string;
}

export interface ImportCadastroResult {
  inseridos: number;
  atualizados: number;
  ignorados: number;
  conflitos: number;
  erros: Array<{ linha: number; motivo: string }>;
}

export interface ParseCadastroResult {
  ok: CadastroRow[];
  erros: Array<{ linha: number; motivo: string }>;
}

export interface CadastroColumnMap {
  documento: string;
  nome: string;
  tipo?: string;
}

export interface SpreadsheetHeadersResult {
  headers: string[];
  suggestedMap: Partial<CadastroColumnMap>;
}
