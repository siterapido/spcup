CREATE TABLE "consolidacao_evento" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sessao_prestacao_id" uuid NOT NULL,
	"status" varchar(20) DEFAULT 'PENDENTE' NOT NULL,
	"data_movimento" date NOT NULL,
	"valor" numeric(15, 2) NOT NULL,
	"direcao" varchar(10) NOT NULL,
	"confianca" real NOT NULL,
	"pessoa_fisica_id" uuid,
	"pessoa_juridica_id" uuid,
	"movimentacao_canonica_id" uuid,
	"justificativa" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "consolidacao_hipotese" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"evento_id" uuid NOT NULL,
	"tipo" varchar(40) NOT NULL,
	"confianca" real NOT NULL,
	"payload" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "consolidacao_linha" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"evento_id" uuid NOT NULL,
	"movimentacao_id" uuid NOT NULL,
	"arquivo_ingestao_id" uuid,
	"papel" varchar(20) NOT NULL
);
--> statement-breakpoint
ALTER TABLE "movimentacao" ADD COLUMN "movimentacao_canonica_id" uuid;--> statement-breakpoint
ALTER TABLE "sessao_prestacao" ADD COLUMN "consolidar_extratos" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "consolidacao_evento" ADD CONSTRAINT "consolidacao_evento_sessao_prestacao_id_sessao_prestacao_id_fk" FOREIGN KEY ("sessao_prestacao_id") REFERENCES "public"."sessao_prestacao"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consolidacao_evento" ADD CONSTRAINT "consolidacao_evento_pessoa_fisica_id_pessoa_fisica_id_fk" FOREIGN KEY ("pessoa_fisica_id") REFERENCES "public"."pessoa_fisica"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consolidacao_evento" ADD CONSTRAINT "consolidacao_evento_pessoa_juridica_id_pessoa_juridica_id_fk" FOREIGN KEY ("pessoa_juridica_id") REFERENCES "public"."pessoa_juridica"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consolidacao_evento" ADD CONSTRAINT "consolidacao_evento_movimentacao_canonica_id_movimentacao_id_fk" FOREIGN KEY ("movimentacao_canonica_id") REFERENCES "public"."movimentacao"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consolidacao_hipotese" ADD CONSTRAINT "consolidacao_hipotese_evento_id_consolidacao_evento_id_fk" FOREIGN KEY ("evento_id") REFERENCES "public"."consolidacao_evento"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consolidacao_linha" ADD CONSTRAINT "consolidacao_linha_evento_id_consolidacao_evento_id_fk" FOREIGN KEY ("evento_id") REFERENCES "public"."consolidacao_evento"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consolidacao_linha" ADD CONSTRAINT "consolidacao_linha_movimentacao_id_movimentacao_id_fk" FOREIGN KEY ("movimentacao_id") REFERENCES "public"."movimentacao"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consolidacao_linha" ADD CONSTRAINT "consolidacao_linha_arquivo_ingestao_id_arquivo_ingestao_id_fk" FOREIGN KEY ("arquivo_ingestao_id") REFERENCES "public"."arquivo_ingestao"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_consolidacao_evento_sessao_status" ON "consolidacao_evento" USING btree ("sessao_prestacao_id","status");--> statement-breakpoint
ALTER TABLE "movimentacao" ADD CONSTRAINT "movimentacao_movimentacao_canonica_id_movimentacao_id_fk" FOREIGN KEY ("movimentacao_canonica_id") REFERENCES "public"."movimentacao"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_movimentacao_canonica" ON "movimentacao" USING btree ("movimentacao_canonica_id");