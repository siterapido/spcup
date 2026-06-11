ALTER TABLE "sessao_prestacao" ADD COLUMN "arquivo_base_ingestao_id" uuid;
ALTER TABLE "sessao_prestacao" ADD CONSTRAINT "sessao_prestacao_arquivo_base_ingestao_id_arquivo_ingestao_id_fk" FOREIGN KEY ("arquivo_base_ingestao_id") REFERENCES "public"."arquivo_ingestao"("id") ON DELETE no action ON UPDATE no action;
CREATE INDEX IF NOT EXISTS "ix_sessao_prestacao_arquivo_base" ON "sessao_prestacao" USING btree ("arquivo_base_ingestao_id");
