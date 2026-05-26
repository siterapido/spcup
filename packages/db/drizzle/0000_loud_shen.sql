CREATE TABLE "arquivo_ingestao" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"diretorio_estadual_id" uuid NOT NULL,
	"uf" varchar(2) NOT NULL,
	"exercicio" integer NOT NULL,
	"nome_arquivo" varchar(512) NOT NULL,
	"hash_arquivo" varchar(64) NOT NULL,
	"caminho_storage" varchar(1024) NOT NULL,
	"status" varchar(20) DEFAULT 'PENDENTE' NOT NULL,
	"erro_mensagem" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conta_bancaria" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"diretorio_estadual_id" uuid NOT NULL,
	"agencia" varchar(10) NOT NULL,
	"conta" varchar(20) NOT NULL,
	"dv" varchar(2),
	"ativo" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "diretorio_estadual" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"uf" varchar(2) NOT NULL,
	"cnpj_prestador" varchar(14) NOT NULL,
	"nome" varchar(255) NOT NULL,
	"ativo" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "diretorio_estadual_uf_unique" UNIQUE("uf")
);
--> statement-breakpoint
CREATE TABLE "doacao_financeira_link" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"movimentacao_origem_id" uuid NOT NULL,
	"sincronizado" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "doacao_financeira_link_movimentacao_origem_id_unique" UNIQUE("movimentacao_origem_id")
);
--> statement-breakpoint
CREATE TABLE "match_evidencia" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"movimentacao_id" uuid NOT NULL,
	"tipo" varchar(64) NOT NULL,
	"peso" real NOT NULL,
	"detalhe" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "movimentacao" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"uf" varchar(2) NOT NULL,
	"exercicio" integer NOT NULL,
	"direcao" varchar(10) NOT NULL,
	"valor" numeric(15, 2) NOT NULL,
	"data_movimento" date NOT NULL,
	"descricao_raw" text NOT NULL,
	"nr_extrato_bancario" varchar(64),
	"conta_bancaria_id" uuid,
	"pessoa_fisica_id" uuid,
	"pessoa_juridica_id" uuid,
	"arquivo_ingestao_id" uuid,
	"status" varchar(20) DEFAULT 'RASCUNHO' NOT NULL,
	"confianca_global" real DEFAULT 0 NOT NULL,
	"bloqueio_export" boolean DEFAULT false NOT NULL,
	"hash_movimento" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_mov_uf_exercicio_hash" UNIQUE("uf","exercicio","hash_movimento")
);
--> statement-breakpoint
CREATE TABLE "movimentacao_spca" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"movimentacao_id" uuid NOT NULL,
	"modulos" text[],
	"fonte_recurso" varchar(4),
	"natureza_recurso" varchar(1),
	"tipo_origem_recurso" varchar(2),
	"classificacao_receita" varchar(3),
	"especie_recurso" varchar(10),
	"cd_descricao_gasto" varchar(10),
	"tipo_documento" varchar(10),
	"nr_documento" varchar(64),
	"data_emissao_contratacao" date,
	"detalhe_situacao" integer,
	"descricao_resumida" varchar(512),
	"nr_recibo_doacao" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "movimentacao_spca_movimentacao_id_unique" UNIQUE("movimentacao_id")
);
--> statement-breakpoint
CREATE TABLE "pessoa_fisica" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cpf" varchar(11) NOT NULL,
	"nome" varchar(255) NOT NULL,
	"titulo_eleitor" varchar(12),
	"aliases" text[],
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pessoa_fisica_cpf_unique" UNIQUE("cpf")
);
--> statement-breakpoint
CREATE TABLE "pessoa_juridica" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cnpj" varchar(14) NOT NULL,
	"razao_social" varchar(255) NOT NULL,
	"aliases" text[],
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pessoa_juridica_cnpj_unique" UNIQUE("cnpj")
);
--> statement-breakpoint
CREATE TABLE "usuario" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(255) NOT NULL,
	"password_hash" varchar(255) NOT NULL,
	"ativo" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "usuario_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "arquivo_ingestao" ADD CONSTRAINT "arquivo_ingestao_diretorio_estadual_id_diretorio_estadual_id_fk" FOREIGN KEY ("diretorio_estadual_id") REFERENCES "public"."diretorio_estadual"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conta_bancaria" ADD CONSTRAINT "conta_bancaria_diretorio_estadual_id_diretorio_estadual_id_fk" FOREIGN KEY ("diretorio_estadual_id") REFERENCES "public"."diretorio_estadual"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doacao_financeira_link" ADD CONSTRAINT "doacao_financeira_link_movimentacao_origem_id_movimentacao_id_fk" FOREIGN KEY ("movimentacao_origem_id") REFERENCES "public"."movimentacao"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_evidencia" ADD CONSTRAINT "match_evidencia_movimentacao_id_movimentacao_id_fk" FOREIGN KEY ("movimentacao_id") REFERENCES "public"."movimentacao"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movimentacao" ADD CONSTRAINT "movimentacao_conta_bancaria_id_conta_bancaria_id_fk" FOREIGN KEY ("conta_bancaria_id") REFERENCES "public"."conta_bancaria"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movimentacao" ADD CONSTRAINT "movimentacao_pessoa_fisica_id_pessoa_fisica_id_fk" FOREIGN KEY ("pessoa_fisica_id") REFERENCES "public"."pessoa_fisica"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movimentacao" ADD CONSTRAINT "movimentacao_pessoa_juridica_id_pessoa_juridica_id_fk" FOREIGN KEY ("pessoa_juridica_id") REFERENCES "public"."pessoa_juridica"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movimentacao" ADD CONSTRAINT "movimentacao_arquivo_ingestao_id_arquivo_ingestao_id_fk" FOREIGN KEY ("arquivo_ingestao_id") REFERENCES "public"."arquivo_ingestao"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movimentacao_spca" ADD CONSTRAINT "movimentacao_spca_movimentacao_id_movimentacao_id_fk" FOREIGN KEY ("movimentacao_id") REFERENCES "public"."movimentacao"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_match_evidencia_movimentacao_id" ON "match_evidencia" USING btree ("movimentacao_id");--> statement-breakpoint
CREATE INDEX "ix_movimentacao_exercicio" ON "movimentacao" USING btree ("exercicio");--> statement-breakpoint
CREATE INDEX "ix_movimentacao_uf" ON "movimentacao" USING btree ("uf");--> statement-breakpoint
CREATE INDEX "ix_usuario_email" ON "usuario" USING btree ("email");