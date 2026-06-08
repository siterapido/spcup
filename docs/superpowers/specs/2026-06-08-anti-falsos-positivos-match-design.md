# Anti-falsos-positivos no match — Design

**Data:** 2026-06-08  
**Produto:** SPC UP — Unidade Popular  
**Status:** Aprovado (brainstorming 2026-06-08)  
**Relacionado:**
- [2026-06-08-remetente-destinatario-design.md](./2026-06-08-remetente-destinatario-design.md)
- [2026-05-26-consolidacao-extratos-design.md](./2026-05-26-consolidacao-extratos-design.md)
- [2026-05-26-cadastro-pf-pj-design.md](./2026-05-26-cadastro-pf-pj-design.md)

---

## 1. Resumo

Endurecer match **cadastro** (extrato → pessoa) e **consolidação** (PDF ↔ PDF) contra falsos positivos, em modo **balanceado**: automação só com evidência forte; resto fica `PENDENTE_REVISAO` para operador.

Unificar lógica de nome em um kernel (`match/cadastro-link.ts`). Parar criação automática de stubs PF/PJ no match. Tier de evidência governa auto-`CONFIRMADO` e auto-merge na consolidação.

**Não inclui:** IA Kimi no pipeline automático; wipe de domínio; escopo UF por tabela.

---

## 2. Decisões (brainstorming)

| # | Tema | Decisão |
|---|------|---------|
| 1 | Escopo FP | Unificado: vínculo cadastro **e** merge cross-PDF |
| 2 | Postura | **Balanceado (B):** auto só tier ALTA; MÉDIA/BAIXA pendente |
| 3 | Abordagem | **Kernel unificado (B):** `cadastro-link.ts` + gates; não refactor “assinatura de evento” |
| 4 | Stub PF/PJ | Match **não** chama `getOrCreate*`; sem vínculo se doc fora do cadastro |
| 5 | Nome | Uma gramática: `compararNomeCadastro` + unicidade + `aliases` |
| 6 | Hora | Opcional: se coluna mapeada e persistida, reforça/rebaixa par na consolidação |
| 7 | UI | Bolinha alinhada ao tier + comparação nome |
| 8 | Migração | Rematch incremental; stubs existentes desvinculados |

---

## 3. Dois matches, uma gramática

| Match | Pergunta | Chaves |
|-------|----------|--------|
| **Evento** | Mesma transação em 2 PDFs? | data [± janela PIX], valor, direção, nome; hora se ambos têm |
| **Pessoa** | Quem é no cadastro UF? | CPF/CNPJ estruturado em `origemExtracao`; nome valida |

Data/valor **não** identificam pessoa no cadastro. CPF/CNPJ **não** substituem data/valor no par cross-PDF.

---

## 4. Tiers de evidência

| Tier | Cadastro (extrato → pessoa) | Consolidação (PDF ↔ PDF) | Auto |
|------|----------------------------|--------------------------|------|
| **ALTA** | CPF/CNPJ no cadastro + `compararNomeCadastro` = `bate` | Mesmo doc estruturado nos 2 lados + data/valor/direção; se ambos têm hora, Δ ≤ 5 min | `CONFIRMADO` / merge sugerido auto-aprovável |
| **MÉDIA** | CPF/CNPJ no cadastro + nome `difere` | Doc só no completo + data/valor/direção + nome `bate` | `PENDENTE_REVISAO`; evento consolidação `PENDENTE` |
| **MÉDIA** | Nome único fuzzy no cadastro, sem doc | Par PIX↔completo: data/valor/direção + nome `bate`, sem doc | `PENDENTE_REVISAO` |
| **BAIXA** | Doc extraído, ausente no cadastro | Só data/valor/direção; nomes fracos ou ausentes | Sem `pessoa_*_id`; hipótese lateral |
| **REJEITADO** | Múltiplos CPF/CNPJ na linha | 2+ pares plausíveis mesmo valor/dia | `CONFLITO_*`; sem auto |

Score numérico (`confianca`, `confiancaGlobal`) permanece para ordenação e export; **tier** governa automação.

### 4.1 Mapeamento tier → evidências (`match_evidencia`)

| Tipo novo/existente | Tier típico |
|---------------------|-------------|
| `CPF_CADASTRO` + nome alinhado | ALTA |
| `CNPJ_CADASTRO` + nome alinhado | ALTA |
| `CPF_CADASTRO` + `NOME_DIVERGE_CADASTRO` | MÉDIA |
| `NOME_CADASTRO` (único fuzzy) | MÉDIA |
| `CPF_EXATO` / stub (legado) | BAIXA — rematch remove vínculo |
| `CONFLITO_DOCUMENTO` | REJEITADO |
| `CRUZAMENTO_PDF` + doc igual | ALTA |
| `CRUZAMENTO_PDF` + só nome | MÉDIA |

---

## 5. Kernel unificado — `packages/core/src/match/cadastro-link.ts`

### 5.1 API

```ts
export type CadastroLinkTier = "ALTA" | "MEDIA" | "BAIXA" | "REJEITADO";

export type CadastroLinkResult = {
  tier: CadastroLinkTier;
  pessoaFisicaId: string | null;
  pessoaJuridicaId: string | null;
  comparacaoNome: "bate" | "difere" | "indefinido";
  motivo: string;
  evidencias: Array<{ tipo: string; peso: number; detalhe: string }>;
};

export function compararNomeComPessoa(
  nomeExtraido: string,
  pessoa: { nome: string; aliases?: string[] | null },
): NomeCadastroComparacao;

export async function findPessoasByNomeFuzzy(
  db: Db,
  rawNome: string,
): Promise<Array<{ kind: "PF" | "PJ"; id: string; nome: string }>>;

export async function resolveCadastroLink(
  db: Db,
  input: {
    cpf: string | null;
    cnpj: string | null;
    remetenteDestinatario: string | null;
  },
): Promise<CadastroLinkResult>;
```

### 5.2 Regras `resolveCadastroLink`

1. `cpf` e `cnpj` preenchidos, ou múltiplos valores → **REJEITADO**
2. `cpf` ou `cnpj` único:
   - Existe em `pessoa_fisica` / `pessoa_juridica` → comparar `remetenteDestinatario` com nome (+ aliases)
   - `bate` → **ALTA**; `difere` → **MÉDIA**; vazio → **MÉDIA** (doc manda, nome ausente)
   - Não existe no cadastro → **BAIXA**, sem IDs
3. Sem doc, `remetenteDestinatario` preenchido:
   - `findPessoasByNomeFuzzy` → 1 match → **MÉDIA**; 0 → **BAIXA**; 2+ → **REJEITADO** (homônimo)
4. Sem doc e sem nome → **BAIXA**

### 5.3 Consumidores (substituir duplicatas)

| Módulo | Mudança |
|--------|---------|
| `match/rules.ts` | `applyDeterministicMatch` delega a `resolveCadastroLink`; remove `getOrCreate*` e `findUniquePessoaByNome` local |
| `consolidacao/candidates.ts` | `scorePair` / `scoreSingle` usam kernel para pessoa; par exige nome `bate` ou doc igual |
| `planilha/mutations.ts` | `rematchConsolidacaoEventoPorNome` usa kernel |

---

## 6. `applyDeterministicMatch` (determinístico)

### 6.1 Status

```ts
function resolveStatus(tier: CadastroLinkTier, score: number, limiar: number): string {
  if (tier === "ALTA" && score >= limiar) return CONFIRMADO;
  return PENDENTE_REVISAO;
}
```

Default `confiancaLimiteAlta` = 0.85 mantido.

### 6.2 Pesos (ajuste mínimo)

| Evidência | Peso sugerido |
|-----------|---------------|
| CPF/CNPJ cadastro + nome bate | 0.45 (existente) |
| CPF/CNPJ cadastro + nome diverge | 0.40 + flag `NOME_DIVERGE_CADASTRO` |
| NOME_CADASTRO único fuzzy | 0.38 |
| Sem vínculo | 0 |

---

## 7. Consolidação endurecida

### 7.1 Par candidato (arquivos diferentes)

Obrigatório:

- Mesma `direcao`, `valor` exato
- `isDateWindowMatch` (PIX↔completo: 0–3 dias; demais: mesma data)

E pelo menos um:

- Mesmo `cpfExtraido` ou `cnpjExtraido` (de `origemExtracao`), ou
- `compararNomeCadastro(remetenteA, remetenteB) === "bate"`

**Removido como evento principal:** par só por data/valor/direção com nomes divergentes (antigo score 0.55) → `consolidacao_hipotese` tipo `PAR_PDF_ALTERNATIVO`.

### 7.2 Hora (opcional v1)

- Ingest: se mapa inclui `hora`, persistir em `origemExtracao.horaContraparte` (string `HH:MM`) ou coluna `movimentacao.hora_movimento` (time nullable) — **uma** das duas; spec de implementação escolhe menor diff.
- Consolidação: se ambos os lados têm hora:
  - |Δ| ≤ 5 min → reforço tier (ALTA se já tem doc ou nome bate)
  - |Δ| > 60 min → não formar par principal; hipótese

Se um lado sem hora: ignorar hora (não penalizar).

### 7.3 Auto-merge

- `buildConsolidacaoCandidates`: evento com par tier ALTA pode seguir fluxo auto atual (`consolidacao/auto.ts` se aplicável)
- Par tier MÉDIA: sempre `consolidacao_evento.status = PENDENTE`
- `approveConsolidacaoEvento`: operador obrigatório para MÉDIA

### 7.4 Score composto (referência)

| Sinal | Confiança | Tier |
|-------|-----------|------|
| CPF/CNPJ igual nos 2 + cadastro | ≥ 0.95 | ALTA |
| Doc só completo + data/valor + nome bate | ≥ 0.90 | ALTA ou MÉDIA* |
| Só data/valor + nome bate único cadastro | 0.80 | MÉDIA |
| Só data/valor, nomes divergem | — | hipótese, não evento |

\* ALTA se nome também `bate` cadastro do doc; senão MÉDIA.

---

## 8. UI e operação

### 8.1 Planilha — bolinha remetente

| Estado | Cor | Condição |
|--------|-----|----------|
| Verde | `emerald` | `pessoa` vinculada + tier ALTA + `compararNomeCadastro` = `bate` |
| Âmbar | `amber` | Vinculada MÉDIA, ou ALTA com nome `difere`, ou fuzzy pendente |
| Ausente | — | Sem pessoa ou tier BAIXA |

Tooltip: `extraído / cadastro / tier`.

### 8.2 Resumo planilha (novos contadores opcionais)

- `docSemCadastro` — CPF/CNPJ extraído, pessoa não vinculada
- `nomeDiverge` — vinculado, comparação `difere`

Reuso de `semPessoa`, `mergePendente`, `baixaConfianca`.

### 8.3 Consolidação UI

Badge **“Revisar merge”** em eventos tier MÉDIA. Hipóteses fracas no painel lateral (já previsto no design consolidação).

---

## 9. Migração e rematch

### 9.1 Pós-deploy (one-shot script ou comando)

```
Para cada movimentacao com pessoa vinculada onde pessoa.nome é stub (DESCONHECIDO/DESCONHECIDA):
  - pessoaFisicaId / pessoaJuridicaId := null
  - status := PENDENTE_REVISAO
  - applyDeterministicMatch(id)
```

### 9.2 Rematch existente

`rematchPendingMovimentacoes` já roda após import cadastro; passa a usar kernel novo.

### 9.3 Dados históricos

- Eventos `consolidacao_evento` já `APROVADO`: não reabrir automaticamente
- Novas sessões e reprocessamento manual usam regras novas

---

## 10. Fora de escopo

- `applyAiMatchToMovimentacao` no pipeline pós-ingest automático
- Fuzzy além de `compararNomeCadastro` + `aliases`
- Filtro cadastro por UF na tabela `pessoa_*`
- Consolidação OFX ↔ PDF
- Wipe de domínio

---

## 11. Testes e critérios de aceite

### 11.1 Fixtures

- `Documentos para teste /Extrato Jan PIX (1).pdf`
- `EXTRATO TOTAL JANEIRO (1) (1).pdf`
- `pessoas bahia (1).xlsx`
- Testes unitários em `rules.test.ts`, `candidates.test.ts`, novo `cadastro-link.test.ts`

### 11.2 Cenários obrigatórios

| # | Cenário | Esperado |
|---|---------|----------|
| 1 | CPF estruturado, fora cadastro | Sem vínculo; `PENDENTE`; contador docSemCadastro |
| 2 | CPF cadastro, nome abreviado (`D` vs `DIAS`) | Vincula; tier ALTA ou MÉDIA conforme `bate` |
| 3 | CPF cadastro, nome claramente diferente | Vincula MÉDIA; âmbar; não `CONFIRMADO` |
| 4 | Homônimo (2 PF mesmo nome fuzzy) | REJEITADO / sem vínculo |
| 5 | Mesmo valor/dia, nomes divergentes, 2 PDFs | Hipótese, não evento único |
| 6 | PIX↔completo, CPF só completo, nomes batem | Par tier ALTA ou MÉDIA; pessoa do CPF |
| 7 | Stub legado pós-migração | Desvinculado |

### 11.3 Métrica piloto

Amostra manual ≥ 30 linhas revisadas: **FP < 5%**. Queda de auto-`CONFIRMADO` ~15–25% aceitável.

### 11.4 Comandos verificação

```bash
cd packages/core && npm test
pnpm --filter web exec tsc --noEmit
pnpm exec tsx scripts/test-remetente-match-e2e.ts  # opcional
```

---

## 12. Arquivos previstos (implementação)

| Arquivo | Ação |
|---------|------|
| `packages/core/src/match/cadastro-link.ts` | Criar |
| `packages/core/src/match/cadastro-link.test.ts` | Criar |
| `packages/core/src/match/rules.ts` | Refatorar |
| `packages/core/src/consolidacao/candidates.ts` | Endurecer par + tier |
| `packages/core/src/planilha/mutations.ts` | Usar kernel |
| `packages/core/src/planilha/status.ts` | Contadores opcionais |
| `apps/web/components/prestacao/planilha-remetente-destinatario-cell.tsx` | Tier na bolinha |
| `packages/core/src/provenance/types.ts` | `horaContraparte?` se coluna hora |
| `packages/core/src/index.ts` | Exportar API pública |
| `scripts/rematch-desvincular-stubs.ts` | Migração one-shot |

---

## 13. Próximo passo

Invocar skill **writing-plans** → `docs/superpowers/plans/2026-06-08-anti-falsos-positivos-match.md`
