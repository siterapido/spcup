ALTER TABLE "movimentacao" ADD COLUMN "origem_extracao" jsonb;
--> statement-breakpoint
ALTER TABLE "movimentacao" ADD COLUMN "origem_enriquecimento" jsonb;
--> statement-breakpoint
ALTER TABLE "consolidacao_evento" ADD COLUMN "origem_atributos" jsonb;
