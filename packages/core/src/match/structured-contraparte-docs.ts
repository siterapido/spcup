import { normalizeCnpj, normalizeCpf } from "../normalize";
import type { OrigemExtracaoV1 } from "../provenance/types";

export type StructuredContraparteDocs = {
  cpf: string | null;
  cnpj: string | null;
};

/** CPF/CNPJ só de campos estruturados da extração — nunca regex em descricao/histórico. */
export function structuredDocsFromExtratoItem(
  item: Record<string, unknown>,
): StructuredContraparteDocs {
  const cpfStr = item.cpf != null ? String(item.cpf).replace(/\D/g, "") : "";
  if (cpfStr.length === 11) {
    try {
      return { cpf: normalizeCpf(cpfStr), cnpj: null };
    } catch {
      // fall through
    }
  }

  const cnpjStr = item.cnpj != null ? String(item.cnpj).replace(/\D/g, "") : "";
  if (cnpjStr.length === 14) {
    try {
      return { cpf: null, cnpj: normalizeCnpj(cnpjStr) };
    } catch {
      // fall through
    }
  }

  const cpfCnpjRaw = String(item.cpf_cnpj ?? "").replace(/\D/g, "");
  if (cpfCnpjRaw.length === 11) {
    try {
      return { cpf: normalizeCpf(cpfCnpjRaw), cnpj: null };
    } catch {
      // fall through
    }
  }
  if (cpfCnpjRaw.length === 14) {
    try {
      return { cpf: null, cnpj: normalizeCnpj(cpfCnpjRaw) };
    } catch {
      // fall through
    }
  }

  return { cpf: null, cnpj: null };
}

export function structuredDocsFromOrigemExtracao(
  origem: OrigemExtracaoV1 | null | undefined,
): StructuredContraparteDocs {
  if (!origem) {
    return { cpf: null, cnpj: null };
  }
  return {
    cpf: origem.cpfContraparte ?? null,
    cnpj: origem.cnpjContraparte ?? null,
  };
}

export function hasStructuredContraparteDoc(
  origem: OrigemExtracaoV1 | null | undefined,
): boolean {
  const { cpf, cnpj } = structuredDocsFromOrigemExtracao(origem);
  return cpf != null || cnpj != null;
}
