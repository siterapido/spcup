export type BboxNorm = { x: number; y: number; w: number; h: number };

/** Como a âncora espacial no PDF foi obtida (undefined = legado / não tentou). */
export type OrigemAncoragem = "modelo" | "text_layer" | "nao_localizado";

export type CampoExtrato =
  | "data"
  | "valor"
  | "direcao"
  | "cpf"
  | "cnpj"
  | "nome"
  | "descricao";

export type OrigemExtracaoDualMeta = {
  modo: "dual";
  consenso: boolean;
  score: number;
  modelo_primario: string;
  modelo_secundario: string;
  modelo_origem_linha: "consenso" | "primario" | "secundario" | "revisor";
  motivo?: string;
};

export type OrigemExtracaoV1 = {
  versao: 1;
  arquivoIngestaoId: string;
  nomeArquivo: string;
  pagina: number;
  indiceLinha: number;
  bbox?: BboxNorm;
  /** CPF da contraparte (coluna cpf/cpf_cnpj da extração), não derivado de descricaoRaw. */
  cpfContraparte?: string | null;
  /** CNPJ da contraparte (coluna cnpj/cpf_cnpj da extração), não derivado de descricaoRaw. */
  cnpjContraparte?: string | null;
  /** Hora do lançamento (HH:MM) quando coluna mapeada. */
  horaContraparte?: string | null;
  campos?: Partial<
    Record<CampoExtrato, { pagina: number; indiceLinha: number; bbox?: BboxNorm }>
  >;
  dual?: OrigemExtracaoDualMeta;
  ancoragem?: OrigemAncoragem;
};

export type OrigemRef =
  | {
      tipo: "PDF";
      movimentacaoId: string;
      arquivoIngestaoId: string;
      nomeArquivo: string;
      pagina: number;
      indiceLinha: number;
      bbox?: BboxNorm;
      campo: CampoExtrato | "linha_inteira";
    }
  | {
      tipo: "CADASTRO_UF";
      pessoaFisicaId?: string;
      pessoaJuridicaId?: string;
      matchTipo: "CPF_CADASTRO" | "CNPJ_CADASTRO" | "NOME_CADASTRO";
      documento?: string;
    }
  | {
      tipo: "CRUZAMENTO_PDF";
      movimentacaoIds: string[];
      regra: string;
      detalhe?: string;
    }
  | { tipo: "IA_CRUZAMENTO"; confianca: number; detalhe?: string }
  | { tipo: "INDISPONIVEL"; motivo: string };

export type OrigemAtributosEvento = {
  versao: 1;
  dataMovimento: OrigemRef[];
  valor: OrigemRef[];
  direcao: OrigemRef[];
  pessoa: OrigemRef[];
  confianca: OrigemRef[];
};

export type OrigemEnriquecimentoV1 = {
  versao: 1;
  refs: OrigemRef[];
};
