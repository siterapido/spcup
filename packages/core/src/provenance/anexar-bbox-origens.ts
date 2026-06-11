import { eq } from "drizzle-orm";

import type { Db, Movimentacao } from "@spc-up/db";
import { movimentacao } from "@spc-up/db";

import {
  campoExtracao,
  type CamposExtracao,
  type MovimentacaoCamposLike,
} from "../ingest/campos-extracao";
import {
  detectExtratoModeloFromFilename,
  type ExtratoModeloId,
} from "../ingest/extrato-modelo";
import { extractPdfTextLayer } from "../pdf-locate/extract-pdf-text-layer";
import { localizarLinhaPdf } from "../pdf-locate/localizar-linha-pdf";
import type { LocalizarLinhaPdfInput, PdfPaginaTexto } from "../pdf-locate/types";
import type { OrigemAncoragem, OrigemExtracaoV1 } from "./types";
import { clampBbox } from "./validate";

export type AnexarBboxOrigensOptions = {
  nomeArquivo: string;
  modeloId?: ExtratoModeloId;
  /** Re-tenta movimentações com ancoragem nao_localizado */
  force?: boolean;
};

export type AnexarBboxOrigensResult = {
  total: number;
  ancoradas: number;
  falhas: number;
  ignoradas: number;
};

export function precisaAncorarBbox(
  origem: OrigemExtracaoV1 | null | undefined,
  options?: { force?: boolean },
): boolean {
  if (!origem) {
    return false;
  }
  if (origem.ancoragem === "nao_localizado" && !options?.force) {
    return false;
  }
  if (
    (origem.ancoragem === "modelo" || origem.ancoragem === "text_layer") &&
    origem.bbox &&
    clampBbox(origem.bbox)
  ) {
    return false;
  }
  if (!origem.ancoragem && origem.bbox && clampBbox(origem.bbox)) {
    return false;
  }
  return true;
}

function relaxarDataNaLinha(modeloId: ExtratoModeloId): boolean {
  return modeloId === "caixa_pix";
}

function camposLike(mov: Movimentacao): MovimentacaoCamposLike {
  return {
    camposExtracao: mov.camposExtracao as CamposExtracao | null,
    remetenteDestinatario: mov.remetenteDestinatario,
    nrExtratoBancario: mov.nrExtratoBancario,
  };
}

function buildDescricaoBusca(mov: Movimentacao): string {
  const fields = camposLike(mov);
  const remetente = campoExtracao(fields, "remetente_destinatario");
  const historico = campoExtracao(fields, "historico");
  const parts = [remetente, historico, mov.descricaoRaw].filter(
    (s) => s != null && s.trim() !== "",
  );
  return parts.join(" ").trim() || mov.descricaoRaw;
}

function buildLocalizarInput(
  mov: Movimentacao,
  paginas: PdfPaginaTexto[],
  relaxarData: boolean,
): LocalizarLinhaPdfInput {
  const origem = mov.origemExtracao as OrigemExtracaoV1;
  const fields = camposLike(mov);
  const dataRaw = campoExtracao(fields, "data") ?? String(mov.dataMovimento);
  const dataMovimento = dataRaw.slice(0, 10);

  return {
    paginas,
    dataMovimento,
    valor: campoExtracao(fields, "valor") ?? mov.valor,
    descricaoRaw: buildDescricaoBusca(mov),
    remetenteDestinatario: campoExtracao(fields, "remetente_destinatario"),
    documento: campoExtracao(fields, "documento"),
    hora: campoExtracao(fields, "hora") ?? origem.horaContraparte,
    relaxarDataNaLinha: relaxarData,
  };
}

function tentarLocalizar(
  mov: Movimentacao,
  paginas: PdfPaginaTexto[],
  relaxarData: boolean,
) {
  return localizarLinhaPdf(buildLocalizarInput(mov, paginas, relaxarData));
}

function paginasDeclaradas(movs: Movimentacao[]): number[] {
  return [
    ...new Set(
      movs
        .map((m) => (m.origemExtracao as OrigemExtracaoV1 | null)?.pagina)
        .filter((p): p is number => typeof p === "number" && p >= 1),
    ),
  ];
}

async function persistirOrigem(
  db: Db,
  movId: string,
  origem: OrigemExtracaoV1,
): Promise<void> {
  await db
    .update(movimentacao)
    .set({ origemExtracao: origem })
    .where(eq(movimentacao.id, movId));
}

/** Ancora bbox no text layer para movimentações do arquivo sem bbox válido. */
export async function anexarBboxOrigensPorArquivo(
  db: Db,
  arquivoIngestaoId: string,
  pdfBuffer: Buffer,
  options: AnexarBboxOrigensOptions,
): Promise<AnexarBboxOrigensResult> {
  const modeloId =
    options.modeloId ?? detectExtratoModeloFromFilename(options.nomeArquivo);
  const relaxarData = relaxarDataNaLinha(modeloId);

  const rows = await db
    .select()
    .from(movimentacao)
    .where(eq(movimentacao.arquivoIngestaoId, arquivoIngestaoId));

  const pendentes = rows.filter((m) =>
    precisaAncorarBbox(m.origemExtracao as OrigemExtracaoV1 | null, {
      force: options.force,
    }),
  );

  if (pendentes.length === 0) {
    return {
      total: rows.length,
      ancoradas: 0,
      falhas: 0,
      ignoradas: rows.length,
    };
  }

  const paginasAlvo = paginasDeclaradas(pendentes);
  let { paginas } = await extractPdfTextLayer(pdfBuffer, paginasAlvo);

  let ancoradas = 0;
  let falhas = 0;
  const aindaPendentes: Movimentacao[] = [];

  for (const mov of pendentes) {
    const origem = mov.origemExtracao as OrigemExtracaoV1;
    let result = tentarLocalizar(mov, paginas, relaxarData);

    if (!result.encontrado) {
      aindaPendentes.push(mov);
      continue;
    }

    await persistirOrigem(db, mov.id, {
      ...origem,
      pagina: result.pagina,
      bbox: result.bbox,
      ancoragem: "text_layer" satisfies OrigemAncoragem,
    });
    ancoradas += 1;
  }

  if (aindaPendentes.length > 0) {
    const { paginas: todasPaginas, pageCount } =
      await extractPdfTextLayer(pdfBuffer);
    const faltaPagina = aindaPendentes.some((mov) => {
      const p = (mov.origemExtracao as OrigemExtracaoV1).pagina;
      return p > pageCount || !paginasAlvo.includes(p);
    });
    if (todasPaginas.length > paginas.length || faltaPagina) {
      paginas = todasPaginas;
    }

    for (const mov of aindaPendentes) {
      const origem = mov.origemExtracao as OrigemExtracaoV1;
      const result = tentarLocalizar(mov, paginas, relaxarData);

      if (result.encontrado) {
        await persistirOrigem(db, mov.id, {
          ...origem,
          pagina: result.pagina,
          bbox: result.bbox,
          ancoragem: "text_layer",
        });
        ancoradas += 1;
      } else {
        await persistirOrigem(db, mov.id, {
          ...origem,
          bbox: undefined,
          ancoragem: "nao_localizado",
        });
        falhas += 1;
      }
    }
  }

  return {
    total: rows.length,
    ancoradas,
    falhas,
    ignoradas: rows.length - pendentes.length,
  };
}
