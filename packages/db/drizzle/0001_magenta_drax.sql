CREATE TABLE "cadastro_conflito" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tipo" varchar(2) NOT NULL,
	"documento" varchar(14) NOT NULL,
	"nome_existente" varchar(255) NOT NULL,
	"nome_proposto" varchar(255) NOT NULL,
	"origem" varchar(10) NOT NULL,
	"status" varchar(20) DEFAULT 'PENDENTE' NOT NULL,
	"resolucao" varchar(20),
	"uf_contexto" varchar(2) NOT NULL,
	"exercicio_contexto" integer NOT NULL,
	"pessoa_fisica_id" uuid,
	"pessoa_juridica_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "movimentacao" DROP CONSTRAINT "uq_mov_uf_exercicio_hash";--> statement-breakpoint
ALTER TABLE "cadastro_conflito" ADD CONSTRAINT "cadastro_conflito_pessoa_fisica_id_pessoa_fisica_id_fk" FOREIGN KEY ("pessoa_fisica_id") REFERENCES "public"."pessoa_fisica"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cadastro_conflito" ADD CONSTRAINT "cadastro_conflito_pessoa_juridica_id_pessoa_juridica_id_fk" FOREIGN KEY ("pessoa_juridica_id") REFERENCES "public"."pessoa_juridica"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_cadastro_conflito_status" ON "cadastro_conflito" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_mov_uf_exercicio_hash" ON "movimentacao" USING btree ("uf","exercicio","hash_movimento");