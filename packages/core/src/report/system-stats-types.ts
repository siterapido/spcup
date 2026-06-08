export interface ConfiancaFaixas {
  abaixo60: number;
  entre60e85: number;
  acima85: number;
}

export interface SystemStatsScope {
  movimentacoesPorStatus: Record<string, number>;
  movimentacoesBloqueadas: number;
  confiancaFaixas: ConfiancaFaixas;
  arquivosPorStatus: Record<string, number>;
  exportavel: boolean;
}

export interface SystemStatsGlobal {
  movimentacoesPorStatus: Record<string, number>;
  movimentacoesBloqueadas: number;
  confiancaFaixas: ConfiancaFaixas;
  arquivosPorStatus: Record<string, number>;
  conflitosPendentes: number;
  pessoasPf: number;
  pessoasPj: number;
  pessoasStub: number;
  sessoesAbertas: number;
  diretoriosPlaceholder: number;
}

export interface SystemStats {
  global: SystemStatsGlobal;
  scoped: SystemStatsScope;
  uf: string;
  exercicio: number;
}
