import { relations } from "drizzle-orm";
import {
  boolean,
  date,
  index,
  integer,
  numeric,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

export const diretorioEstadual = pgTable("diretorio_estadual", {
  id: uuid("id").primaryKey().defaultRandom(),
  uf: varchar("uf", { length: 2 }).notNull().unique(),
  cnpjPrestador: varchar("cnpj_prestador", { length: 14 }).notNull(),
  nome: varchar("nome", { length: 255 }).notNull(),
  ativo: boolean("ativo").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const pessoaFisica = pgTable("pessoa_fisica", {
  id: uuid("id").primaryKey().defaultRandom(),
  cpf: varchar("cpf", { length: 11 }).notNull().unique(),
  nome: varchar("nome", { length: 255 }).notNull(),
  tituloEleitor: varchar("titulo_eleitor", { length: 12 }),
  aliases: text("aliases").array(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const pessoaJuridica = pgTable("pessoa_juridica", {
  id: uuid("id").primaryKey().defaultRandom(),
  cnpj: varchar("cnpj", { length: 14 }).notNull().unique(),
  razaoSocial: varchar("razao_social", { length: 255 }).notNull(),
  aliases: text("aliases").array(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const contaBancaria = pgTable("conta_bancaria", {
  id: uuid("id").primaryKey().defaultRandom(),
  diretorioEstadualId: uuid("diretorio_estadual_id")
    .notNull()
    .references(() => diretorioEstadual.id),
  agencia: varchar("agencia", { length: 10 }).notNull(),
  conta: varchar("conta", { length: 20 }).notNull(),
  dv: varchar("dv", { length: 2 }),
  ativo: boolean("ativo").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const arquivoIngestao = pgTable("arquivo_ingestao", {
  id: uuid("id").primaryKey().defaultRandom(),
  diretorioEstadualId: uuid("diretorio_estadual_id")
    .notNull()
    .references(() => diretorioEstadual.id),
  uf: varchar("uf", { length: 2 }).notNull(),
  exercicio: integer("exercicio").notNull(),
  nomeArquivo: varchar("nome_arquivo", { length: 512 }).notNull(),
  hashArquivo: varchar("hash_arquivo", { length: 64 }).notNull(),
  caminhoStorage: varchar("caminho_storage", { length: 1024 }).notNull(),
  status: varchar("status", { length: 20 }).notNull().default("PENDENTE"),
  erroMensagem: text("erro_mensagem"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const movimentacao = pgTable(
  "movimentacao",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    uf: varchar("uf", { length: 2 }).notNull(),
    exercicio: integer("exercicio").notNull(),
    direcao: varchar("direcao", { length: 10 }).notNull(),
    valor: numeric("valor", { precision: 15, scale: 2 }).notNull(),
    dataMovimento: date("data_movimento").notNull(),
    descricaoRaw: text("descricao_raw").notNull(),
    nrExtratoBancario: varchar("nr_extrato_bancario", { length: 64 }),
    contaBancariaId: uuid("conta_bancaria_id").references(() => contaBancaria.id),
    pessoaFisicaId: uuid("pessoa_fisica_id").references(() => pessoaFisica.id),
    pessoaJuridicaId: uuid("pessoa_juridica_id").references(() => pessoaJuridica.id),
    arquivoIngestaoId: uuid("arquivo_ingestao_id").references(() => arquivoIngestao.id),
    status: varchar("status", { length: 20 }).notNull().default("RASCUNHO"),
    confiancaGlobal: real("confianca_global").notNull().default(0),
    bloqueioExport: boolean("bloqueio_export").notNull().default(false),
    hashMovimento: varchar("hash_movimento", { length: 64 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("uq_mov_uf_exercicio_hash").on(
      table.uf,
      table.exercicio,
      table.hashMovimento,
    ),
    index("ix_movimentacao_exercicio").on(table.exercicio),
    index("ix_movimentacao_uf").on(table.uf),
  ],
);

export const doacaoFinanceiraLink = pgTable("doacao_financeira_link", {
  id: uuid("id").primaryKey().defaultRandom(),
  movimentacaoOrigemId: uuid("movimentacao_origem_id")
    .notNull()
    .unique()
    .references(() => movimentacao.id),
  sincronizado: boolean("sincronizado").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const matchEvidencia = pgTable(
  "match_evidencia",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    movimentacaoId: uuid("movimentacao_id")
      .notNull()
      .references(() => movimentacao.id),
    tipo: varchar("tipo", { length: 64 }).notNull(),
    peso: real("peso").notNull(),
    detalhe: text("detalhe"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("ix_match_evidencia_movimentacao_id").on(table.movimentacaoId)],
);

export const movimentacaoSpca = pgTable("movimentacao_spca", {
  id: uuid("id").primaryKey().defaultRandom(),
  movimentacaoId: uuid("movimentacao_id")
    .notNull()
    .unique()
    .references(() => movimentacao.id),
  modulos: text("modulos").array(),
  fonteRecurso: varchar("fonte_recurso", { length: 4 }),
  naturezaRecurso: varchar("natureza_recurso", { length: 1 }),
  tipoOrigemRecurso: varchar("tipo_origem_recurso", { length: 2 }),
  classificacaoReceita: varchar("classificacao_receita", { length: 3 }),
  especieRecurso: varchar("especie_recurso", { length: 10 }),
  cdDescricaoGasto: varchar("cd_descricao_gasto", { length: 10 }),
  tipoDocumento: varchar("tipo_documento", { length: 10 }),
  nrDocumento: varchar("nr_documento", { length: 64 }),
  dataEmissaoContratacao: date("data_emissao_contratacao"),
  detalheSituacao: integer("detalhe_situacao"),
  descricaoResumida: varchar("descricao_resumida", { length: 512 }),
  nrReciboDoacao: varchar("nr_recibo_doacao", { length: 64 }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const usuario = pgTable(
  "usuario",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: varchar("email", { length: 255 }).notNull().unique(),
    passwordHash: varchar("password_hash", { length: 255 }).notNull(),
    ativo: boolean("ativo").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("ix_usuario_email").on(table.email)],
);

export const diretorioEstadualRelations = relations(diretorioEstadual, ({ many }) => ({
  contasBancarias: many(contaBancaria),
  arquivosIngestao: many(arquivoIngestao),
}));

export const contaBancariaRelations = relations(contaBancaria, ({ one, many }) => ({
  diretorioEstadual: one(diretorioEstadual, {
    fields: [contaBancaria.diretorioEstadualId],
    references: [diretorioEstadual.id],
  }),
  movimentacoes: many(movimentacao),
}));

export const pessoaFisicaRelations = relations(pessoaFisica, ({ many }) => ({
  movimentacoes: many(movimentacao),
}));

export const pessoaJuridicaRelations = relations(pessoaJuridica, ({ many }) => ({
  movimentacoes: many(movimentacao),
}));

export const arquivoIngestaoRelations = relations(arquivoIngestao, ({ one, many }) => ({
  diretorioEstadual: one(diretorioEstadual, {
    fields: [arquivoIngestao.diretorioEstadualId],
    references: [diretorioEstadual.id],
  }),
  movimentacoes: many(movimentacao),
}));

export const movimentacaoRelations = relations(movimentacao, ({ one, many }) => ({
  contaBancaria: one(contaBancaria, {
    fields: [movimentacao.contaBancariaId],
    references: [contaBancaria.id],
  }),
  pessoaFisica: one(pessoaFisica, {
    fields: [movimentacao.pessoaFisicaId],
    references: [pessoaFisica.id],
  }),
  pessoaJuridica: one(pessoaJuridica, {
    fields: [movimentacao.pessoaJuridicaId],
    references: [pessoaJuridica.id],
  }),
  arquivoIngestao: one(arquivoIngestao, {
    fields: [movimentacao.arquivoIngestaoId],
    references: [arquivoIngestao.id],
  }),
  spca: one(movimentacaoSpca, {
    fields: [movimentacao.id],
    references: [movimentacaoSpca.movimentacaoId],
  }),
  evidencias: many(matchEvidencia),
  doacaoLink: one(doacaoFinanceiraLink, {
    fields: [movimentacao.id],
    references: [doacaoFinanceiraLink.movimentacaoOrigemId],
  }),
}));

export const doacaoFinanceiraLinkRelations = relations(doacaoFinanceiraLink, ({ one }) => ({
  movimentacaoOrigem: one(movimentacao, {
    fields: [doacaoFinanceiraLink.movimentacaoOrigemId],
    references: [movimentacao.id],
  }),
}));

export const matchEvidenciaRelations = relations(matchEvidencia, ({ one }) => ({
  movimentacao: one(movimentacao, {
    fields: [matchEvidencia.movimentacaoId],
    references: [movimentacao.id],
  }),
}));

export const movimentacaoSpcaRelations = relations(movimentacaoSpca, ({ one }) => ({
  movimentacao: one(movimentacao, {
    fields: [movimentacaoSpca.movimentacaoId],
    references: [movimentacao.id],
  }),
}));

export type DiretorioEstadual = typeof diretorioEstadual.$inferSelect;
export type NewDiretorioEstadual = typeof diretorioEstadual.$inferInsert;
export type PessoaFisica = typeof pessoaFisica.$inferSelect;
export type NewPessoaFisica = typeof pessoaFisica.$inferInsert;
export type PessoaJuridica = typeof pessoaJuridica.$inferSelect;
export type NewPessoaJuridica = typeof pessoaJuridica.$inferInsert;
export type ContaBancaria = typeof contaBancaria.$inferSelect;
export type NewContaBancaria = typeof contaBancaria.$inferInsert;
export type ArquivoIngestao = typeof arquivoIngestao.$inferSelect;
export type NewArquivoIngestao = typeof arquivoIngestao.$inferInsert;
export type Movimentacao = typeof movimentacao.$inferSelect;
export type NewMovimentacao = typeof movimentacao.$inferInsert;
export type DoacaoFinanceiraLink = typeof doacaoFinanceiraLink.$inferSelect;
export type NewDoacaoFinanceiraLink = typeof doacaoFinanceiraLink.$inferInsert;
export type MatchEvidencia = typeof matchEvidencia.$inferSelect;
export type NewMatchEvidencia = typeof matchEvidencia.$inferInsert;
export type MovimentacaoSpca = typeof movimentacaoSpca.$inferSelect;
export type NewMovimentacaoSpca = typeof movimentacaoSpca.$inferInsert;
export type Usuario = typeof usuario.$inferSelect;
export type NewUsuario = typeof usuario.$inferInsert;
