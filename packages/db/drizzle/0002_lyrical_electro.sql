CREATE TABLE "diretorio_municipal" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"uf" varchar(2) NOT NULL,
	"codigo_ibge" varchar(7),
	"nome_municipio" varchar(255) NOT NULL,
	"cnpj_prestador" varchar(14) NOT NULL,
	"ativo" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "diretorio_municipal_cnpj_prestador_unique" UNIQUE("cnpj_prestador")
);
--> statement-breakpoint
CREATE TABLE "sessao_prestacao" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"uf" varchar(2) NOT NULL,
	"tipo_prestador" varchar(10) NOT NULL,
	"diretorio_estadual_id" uuid,
	"diretorio_municipal_id" uuid,
	"exercicio" integer NOT NULL,
	"status" varchar(20) DEFAULT 'ABERTA' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "uq_mov_uf_exercicio_hash";--> statement-breakpoint
ALTER TABLE "arquivo_ingestao" ADD COLUMN "sessao_prestacao_id" uuid;--> statement-breakpoint
ALTER TABLE "movimentacao" ADD COLUMN "sessao_prestacao_id" uuid;--> statement-breakpoint
ALTER TABLE "movimentacao" ADD COLUMN "cnpj_prestador" varchar(14);--> statement-breakpoint
ALTER TABLE "movimentacao" ADD COLUMN "tipo_prestador" varchar(10);--> statement-breakpoint
ALTER TABLE "movimentacao" ADD COLUMN "diretorio_municipal_id" uuid;--> statement-breakpoint
UPDATE "movimentacao" AS m SET "cnpj_prestador" = d."cnpj_prestador" FROM "diretorio_estadual" AS d WHERE m."uf" = d."uf";--> statement-breakpoint
UPDATE "movimentacao" SET "tipo_prestador" = 'ESTADUAL' WHERE "tipo_prestador" IS NULL;--> statement-breakpoint
ALTER TABLE "movimentacao" ALTER COLUMN "cnpj_prestador" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "movimentacao" ALTER COLUMN "tipo_prestador" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "sessao_prestacao" ADD CONSTRAINT "sessao_prestacao_diretorio_estadual_id_diretorio_estadual_id_fk" FOREIGN KEY ("diretorio_estadual_id") REFERENCES "public"."diretorio_estadual"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessao_prestacao" ADD CONSTRAINT "sessao_prestacao_diretorio_municipal_id_diretorio_municipal_id_fk" FOREIGN KEY ("diretorio_municipal_id") REFERENCES "public"."diretorio_municipal"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_diretorio_municipal_uf_ativo" ON "diretorio_municipal" USING btree ("uf","ativo");--> statement-breakpoint
ALTER TABLE "arquivo_ingestao" ADD CONSTRAINT "arquivo_ingestao_sessao_prestacao_id_sessao_prestacao_id_fk" FOREIGN KEY ("sessao_prestacao_id") REFERENCES "public"."sessao_prestacao"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movimentacao" ADD CONSTRAINT "movimentacao_sessao_prestacao_id_sessao_prestacao_id_fk" FOREIGN KEY ("sessao_prestacao_id") REFERENCES "public"."sessao_prestacao"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movimentacao" ADD CONSTRAINT "movimentacao_diretorio_municipal_id_diretorio_municipal_id_fk" FOREIGN KEY ("diretorio_municipal_id") REFERENCES "public"."diretorio_municipal"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_mov_prestador_exercicio_hash" ON "movimentacao" USING btree ("cnpj_prestador","exercicio","hash_movimento");--> statement-breakpoint
CREATE INDEX "ix_movimentacao_sessao" ON "movimentacao" USING btree ("sessao_prestacao_id");