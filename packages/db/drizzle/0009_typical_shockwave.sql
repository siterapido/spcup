CREATE TABLE "ingestao_linha_pendente" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"arquivo_ingestao_id" uuid NOT NULL,
	"pagina" integer NOT NULL,
	"payload" jsonb NOT NULL,
	"score" real NOT NULL,
	"motivo" varchar(64) NOT NULL,
	"snapshot" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ingestao_pagina" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"arquivo_ingestao_id" uuid NOT NULL,
	"pagina" integer NOT NULL,
	"status" varchar(24) NOT NULL,
	"modo" varchar(12) NOT NULL,
	"aceitas" integer DEFAULT 0 NOT NULL,
	"incertas" integer DEFAULT 0 NOT NULL,
	"motivo" text,
	"texto_amostra" text,
	"processado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "uq_mov_prestador_exercicio_hash";--> statement-breakpoint
ALTER TABLE "consolidacao_evento" ADD COLUMN "origem_atributos" jsonb;--> statement-breakpoint
ALTER TABLE "consolidacao_evento" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "movimentacao" ADD COLUMN "cred_dev" varchar(128);--> statement-breakpoint
ALTER TABLE "movimentacao" ADD COLUMN "origem_extracao" jsonb;--> statement-breakpoint
ALTER TABLE "movimentacao" ADD COLUMN "origem_enriquecimento" jsonb;--> statement-breakpoint
ALTER TABLE "movimentacao" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sessao_prestacao" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ingestao_linha_pendente" ADD CONSTRAINT "ingestao_linha_pendente_arquivo_ingestao_id_arquivo_ingestao_id_fk" FOREIGN KEY ("arquivo_ingestao_id") REFERENCES "public"."arquivo_ingestao"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingestao_pagina" ADD CONSTRAINT "ingestao_pagina_arquivo_ingestao_id_arquivo_ingestao_id_fk" FOREIGN KEY ("arquivo_ingestao_id") REFERENCES "public"."arquivo_ingestao"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_ingestao_linha_pendente_arquivo_pagina" ON "ingestao_linha_pendente" USING btree ("arquivo_ingestao_id","pagina");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_ingestao_pagina_arquivo_pagina" ON "ingestao_pagina" USING btree ("arquivo_ingestao_id","pagina");--> statement-breakpoint
CREATE INDEX "ix_ingestao_pagina_arquivo" ON "ingestao_pagina" USING btree ("arquivo_ingestao_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_mov_prestador_exercicio_hash" ON "movimentacao" USING btree ("cnpj_prestador","exercicio","hash_movimento") WHERE deleted_at IS NULL;