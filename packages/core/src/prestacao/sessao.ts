import {
  diretorioEstadual,
  diretorioMunicipal,
  sessaoPrestacao,
  SESSAO_STATUS,
  TIPO_PRESTADOR,
  type Db,
  type DiretorioEstadual,
  type DiretorioMunicipal,
  type SessaoPrestacao,
} from "@spc-up/db";
import { and, eq } from "drizzle-orm";

export type TipoPrestadorSessao =
  (typeof TIPO_PRESTADOR)[keyof typeof TIPO_PRESTADOR];

export interface CreateSessaoInput {
  uf: string;
  tipoPrestador: TipoPrestadorSessao;
  diretorioMunicipalId?: string;
  exercicio: number;
}

export interface PrestadorResolvido {
  cnpjPrestador: string;
  tipoPrestador: TipoPrestadorSessao;
  diretorioEstadualId?: string;
  diretorioMunicipalId?: string;
}

export function resolveCnpjPrestador(input: {
  tipoPrestador: TipoPrestadorSessao;
  diretorioEstadual?: Pick<DiretorioEstadual, "cnpjPrestador"> | null;
  diretorioMunicipal?: Pick<DiretorioMunicipal, "cnpjPrestador"> | null;
}): string {
  if (input.tipoPrestador === TIPO_PRESTADOR.MUNICIPAL) {
    if (!input.diretorioMunicipal) {
      throw new Error("Diretório municipal obrigatório para prestação municipal");
    }
    return input.diretorioMunicipal.cnpjPrestador;
  }
  if (!input.diretorioEstadual) {
    throw new Error("Diretório estadual obrigatório para prestação estadual");
  }
  return input.diretorioEstadual.cnpjPrestador;
}

export async function createSessao(
  db: Db,
  input: CreateSessaoInput,
): Promise<SessaoPrestacao> {
  const uf = input.uf.toUpperCase();

  if (input.tipoPrestador === TIPO_PRESTADOR.MUNICIPAL) {
    if (!input.diretorioMunicipalId) {
      throw new Error("diretorioMunicipalId é obrigatório para prestação municipal");
    }
    const municipal = await db.query.diretorioMunicipal.findFirst({
      where: and(
        eq(diretorioMunicipal.id, input.diretorioMunicipalId),
        eq(diretorioMunicipal.uf, uf),
        eq(diretorioMunicipal.ativo, true),
      ),
    });
    if (!municipal) {
      throw new Error(`Diretório municipal não encontrado para UF=${uf}`);
    }

    const estadual = await db.query.diretorioEstadual.findFirst({
      where: eq(diretorioEstadual.uf, uf),
    });
    if (!estadual) {
      throw new Error(`Diretório estadual não cadastrado para UF=${uf}`);
    }

    const [sessao] = await db
      .insert(sessaoPrestacao)
      .values({
        uf,
        tipoPrestador: TIPO_PRESTADOR.MUNICIPAL,
        diretorioEstadualId: estadual.id,
        diretorioMunicipalId: municipal.id,
        exercicio: input.exercicio,
        status: SESSAO_STATUS.ABERTA,
      })
      .returning();
    if (!sessao) {
      throw new Error("Falha ao criar sessão de prestação");
    }
    return sessao;
  }

  const estadual = await db.query.diretorioEstadual.findFirst({
    where: eq(diretorioEstadual.uf, uf),
  });
  if (!estadual) {
    throw new Error(`Diretório estadual não cadastrado para UF=${uf}`);
  }

  const [sessao] = await db
    .insert(sessaoPrestacao)
    .values({
      uf,
      tipoPrestador: TIPO_PRESTADOR.ESTADUAL,
      diretorioEstadualId: estadual.id,
      exercicio: input.exercicio,
      status: SESSAO_STATUS.ABERTA,
    })
    .returning();
  if (!sessao) {
    throw new Error("Falha ao criar sessão de prestação");
  }
  return sessao;
}

export async function getSessao(
  db: Db,
  sessaoId: string,
): Promise<
  | (SessaoPrestacao & {
      diretorioEstadual: DiretorioEstadual | null;
      diretorioMunicipal: DiretorioMunicipal | null;
    })
  | undefined
> {
  return db.query.sessaoPrestacao.findFirst({
    where: eq(sessaoPrestacao.id, sessaoId),
    with: {
      diretorioEstadual: true,
      diretorioMunicipal: true,
    },
  });
}

export function prestadorFromSessao(
  sessao: SessaoPrestacao & {
    diretorioEstadual: DiretorioEstadual | null;
    diretorioMunicipal: DiretorioMunicipal | null;
  },
): PrestadorResolvido & { sessaoPrestacaoId: string } {
  const cnpjPrestador = resolveCnpjPrestador({
    tipoPrestador: sessao.tipoPrestador as TipoPrestadorSessao,
    diretorioEstadual: sessao.diretorioEstadual,
    diretorioMunicipal: sessao.diretorioMunicipal,
  });

  return {
    sessaoPrestacaoId: sessao.id,
    cnpjPrestador,
    tipoPrestador: sessao.tipoPrestador as TipoPrestadorSessao,
    diretorioEstadualId: sessao.diretorioEstadualId ?? undefined,
    diretorioMunicipalId: sessao.diretorioMunicipalId ?? undefined,
  };
}
