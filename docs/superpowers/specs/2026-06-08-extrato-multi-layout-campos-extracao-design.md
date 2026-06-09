# Extratos multi-layout — campos completos e match cross-PDF (Design)

**Data:** 2026-06-08  
**Cliente:** Unidade Popular (UP) — SPC UP  
**Status:** Aprovado (grill-me 2026-06-08)  
**Relacionado:**
- [2026-06-07-planilha-unificada-design.md](./2026-06-07-planilha-unificada-design.md)
- [2026-06-08-remetente-destinatario-design.md](./2026-06-08-remetente-destinatario-design.md)
- [2026-06-08-extrato-column-map-notebooklm-design.md](./2026-06-08-extrato-column-map-notebooklm-design.md)
- [2026-06-08-anti-falsos-positivos-match-design.md](./2026-06-08-anti-falsos-positivos-match-design.md)
- [2026-05-26-consolidacao-extratos-design.md](./2026-05-26-consolidacao-extratos-design.md)

---

## 1. Resumo

PDFs de extrato na mesma sessão têm **layouts diferentes** (ex.: Caixa PIX vs Caixa Total) e **campos em comum** (data, valor, direção). O sistema deve:

1. **Extrair todos os campos** de cada layout conforme o modelo do PDF.
2. **Persistir todos** em `movimentacao.campos_extracao` (JSON).
3. **Exibir todos** na planilha unificada — colunas = **união dos modelos** da sessão.
4. **Consolidar** linhas de PDFs distintos por correspondência **direta** (data, valor, direção) + **aproximação** entre campos equivalentes (ex.: `remetente_destinatario` no PIX ↔ contraparte inferida do `historico` no Total).

**Não inclui:** colapsar `historico` em `remetente_destinatario`; filtro/validação por mês; novos bancos além dos presets Caixa (extensível depois).

---

## 2. Problema observado (jun/2026)

Sessão com `Extrato Jan PIX (1).pdf` (34 linhas) + `EXTRATO TOTAL JANEIRO (1) (1).pdf` (36 linhas):

| Sintoma | Causa raiz |
|---------|------------|
| Todas as linhas com **1 origem** | Consolidação não forma par PIX↔Total |
| **36** em "Sem remetente/destinatário" | Total não tem coluna Rem/Dest; nome está no **Histórico** |
| **Doc./Extrato** sempre `—` | Pipeline NotebookLM não persiste `documento` do extrato → `nr_extrato_bancario` null |
| Match cadastro OK no PIX | `remetente_destinatario` mapeado só no extrato PIX |

O extrato Total Caixa tem colunas: **Data, Documento, Histórico, Valor, Saldo** — sem Remetente/Destinatário.

---

## 3. Premissa

> Cada PDF tem colunas **próprias** e algumas **compartilhadas**. O produto extrai **tudo**, mostra **tudo** na planilha, e faz match pelos campos com correspondência direta ou aproximada — **sem** forçar o mesmo índice físico nem fundir semanticamente campos distintos (ex.: Histórico ≠ Rem/Dest).

---

## 4. Decisões (grill-me)

| # | Tema | Decisão |
|---|------|---------|
| 1 | Premissa | Layouts diferentes por PDF; campos iguais + equivalentes |
| 2 | Ingestão | Extrair **todos** os campos do modelo; gravar em `campos_extracao` |
| 3 | Histórico vs Rem/Dest | **Campos separados**; não gravar Histórico em `remetente_destinatario` |
| 4 | Planilha | Colunas = **união dos modelos da sessão**; célula vazia onde o PDF não tem o campo |
| 5 | Persistência | **`campos_extracao` JSON** por movimentação |
| 6 | Modelo do PDF | Auto-detect por nome (`pix` / `total\|completo`) + **revisão leve** antes de processar |
| 7 | Match PIX↔Total | Chaves **duras** obrigatórias + nome **aproximado** entre campos equivalentes |
| 8 | Mês opcional | Só **rótulo** da sessão; não filtra nem valida |

### 4.1 Relação com spec Remetente/Destinatário

[2026-06-08-remetente-destinatario-design.md](./2026-06-08-remetente-destinatario-design.md) proíbe **derivar** `remetente_destinatario` de histórico/PIX **na ingestão**. Esta spec **mantém** essa regra.

O que muda: na **consolidação**, comparar `remetente_destinatario` (PIX) com contraparte parseada de `historico` (Total) **só para formar par** — sem copiar Histórico para a coluna Rem/Dest.

---

## 5. Modelos de extrato (v1)

### 5.1 Caixa — Extrato PIX

Colunas físicas (E2E jan/2025):

| Índice | Campo físico | Chave canônica |
|--------|--------------|----------------|
| 0 | Data | `data` |
| 1 | Hora | `hora` |
| 2 | Tipo de PIX | `tipo_pix` |
| 3 | Situação | `situacao` |
| 4 | Remetente/Destinatário | `remetente_destinatario` |
| 5 | Valor | `valor` |

Preset existente: `EXTRATO_COLUMN_MAP_CAIXA_PIX_JAN` em `extrato-column-map-fixtures.ts`.

`inferirDirecaoDoValor: true`.

### 5.2 Caixa — Extrato Total

Colunas físicas (E2E jan/2025):

| Índice | Campo físico | Chave canônica |
|--------|--------------|----------------|
| 0 | Data | `data` |
| 1 | Documento (do extrato) | `documento` |
| 2 | Histórico | `historico` |
| 3 | Valor | `valor` |
| 4 | Saldo | `saldo` |

Preset novo: `EXTRATO_COLUMN_MAP_CAIXA_TOTAL_JAN`.

`inferirDirecaoDoValor: true` (sem coluna direção dedicada).

### 5.3 Tipo de modelo por arquivo

```ts
type ExtratoModeloId =
  | "caixa_pix"
  | "caixa_total"
  | "outro"; // wizard manual de colunas
```

Persistir em `arquivo_ingestao.metadados.extratoModeloId` junto com `extratoColumnMap`.

---

## 6. Seleção de modelo (upload)

### 6.1 Auto-detect (heurística)

Reutilizar/estender `classifyArquivoPapel`:

| Padrão no `nomeArquivo` | Modelo sugerido |
|-------------------------|-----------------|
| `/pix/i` | `caixa_pix` |
| `/total\|completo/i` | `caixa_total` |
| nenhum | `outro` (âmbar) |

### 6.2 Revisão leve (antes de Processar)

Após upload, lista de arquivos com:

- Badge do modelo detectado (dropdown editável).
- Verde: match confiante no nome.
- Âmbar: ambíguo ou `outro` — operador deve escolher.
- Botão **Processar** desabilitado até cada PDF ter modelo válido (`caixa_pix`, `caixa_total`, ou `outro` com mapa manual completo).

Opções no dropdown:

- Caixa — Extrato PIX
- Caixa — Extrato Total
- Outro (mapear colunas manualmente)

Ao escolher preset, aplicar mapa fixture correspondente (operador pode ajustar no painel existente).

### 6.3 Mês opcional

Campo opcional na sessão: `mesReferencia?: string` (`YYYY-MM`).

- Exibir no título/subtítulo da prestação (ex.: "Janeiro/2025").
- **Não** filtra planilha, **não** valida datas, **não** bloqueia ingestão ou merge.

---

## 7. Modelo de dados

### 7.1 Migration

```sql
ALTER TABLE movimentacao
  ADD COLUMN campos_extracao jsonb NOT NULL DEFAULT '{}';
```

Índice GIN opcional (fase 2) se filtros por campo JSON forem necessários.

### 7.2 Formato `campos_extracao`

Chaves = nomes canônicos de `EXTRATO_COLUMN_MAP_CAMPOS_PADRAO` + custom fields do mapa.

```ts
type CamposExtracao = Partial<Record<string, string | null>>;
```

Exemplos:

```json
// PIX
{
  "data": "2025-01-05",
  "hora": "14:32",
  "tipo_pix": "Recebido",
  "situacao": "Efetivado",
  "remetente_destinatario": "MARIA SILVA",
  "valor": "150.00"
}

// Total
{
  "data": "2025-01-05",
  "documento": "123456",
  "historico": "PIX RECEBIDO - MARIA SILVA",
  "valor": "150.00",
  "saldo": "12500.00"
}
```

### 7.3 Espelhamento em colunas legadas

Manter compatibilidade com export, match cadastro e UI atual:

| Chave em `campos_extracao` | Coluna legada |
|----------------------------|---------------|
| `remetente_destinatario` | `movimentacao.remetente_destinatario` (normalizado) |
| `documento` | `movimentacao.nr_extrato_bancario` |
| `historico` | **não** espelhar em `descricao_raw` como substituto de Rem/Dest |

`descricao_raw` continua sendo a descrição/histórico bruto da linha para auditoria (Total: valor de `historico`; PIX: pode ser `tipo_pix` + contexto ou campo `historico` se mapeado).

### 7.4 União de colunas da sessão

```ts
function colunasPlanilhaSessao(modelos: ExtratoModeloId[]): string[] {
  // Ordem estável: data, valor, direcao, documento, remetente_destinatario,
  // historico, hora, tipo_pix, situacao, saldo, cred_dev, cpf_cnpj, ...
}
```

API `GET .../planilha` retorna:

```ts
type PlanilhaPayload = {
  colunas: string[];           // união dos modelos
  linhas: PlanilhaLinha[];
  // ...
};

type PlanilhaLinha = {
  // campos existentes +
  camposExtracao: CamposExtracao; // merge das origens após consolidação
};
```

Após merge PIX↔Total, `camposExtracao` da linha fundida = merge não-destrutivo dos JSONs das duas movimentações (chaves de ambos os lados presentes).

---

## 8. Ingestão (NotebookLM)

### 8.1 Schema JSON da resposta

Estender objeto de transação no prompt:

```json
{
  "data": "YYYY-MM-DD",
  "valor": 1250.50,
  "direcao": "CREDITO" | "DEBITO",
  "descricao": "…",
  "documento": "número documento/lançamento do extrato ou null",
  "historico": "texto coluna Histórico ou null",
  "hora": "HH:MM ou null",
  "tipo_pix": "… ou null",
  "situacao": "… ou null",
  "remetente_destinatario": "coluna Rem/Dest ou null",
  "documento_candidato": "CPF/CNPJ cadastro ou null",
  "nome_candidato": "… ou null"
}
```

Hint por modelo via `buildExtratoColumnPromptHint` + bloco adicional no preset:

- **Caixa Total:** `documento` = coluna Documento do extrato (não CPF); `historico` = coluna Histórico integral.
- **Caixa PIX:** `remetente_destinatario` só da coluna mapeada; não inferir da descrição.

### 8.2 `persistNotebookLmTransactions`

Para cada transação:

1. Montar `camposExtracao` com todos os campos extraídos do modelo.
2. Gravar `movimentacao.campos_extracao`.
3. Espelhar `remetente_destinatario` → `remetente_destinatario` (se ≥3 chars).
4. Espelhar `documento` → `nr_extrato_bancario`.
5. Persistir `origem_extracao` com `cpfContraparte` / `cnpjContraparte` quando `documento_candidato` for CPF/CNPJ da **contraparte** (distinto de `documento` do extrato).

### 8.3 Validação de sessão (ajuste)

`EXTRATO_SESSION_REQUIRED_CAMPOS` permanece união entre PDFs:

- `remetente_destinatario` — coberto pelo PIX.
- `historico` — coberto pelo Total.
- `documento` — coberto pelo Total.

Cada PDF valida só `data`, `valor`, direção (`validateExtratoColumnMapPerPdf`).

---

## 9. Consolidação cross-PDF

### 9.1 Correspondências

| Tipo | Campos | Regra |
|------|--------|-------|
| **Direto** | `data`, `valor`, `direcao` | Obrigatório para candidato a par |
| **Janela data PIX↔Total** | `data` | 0–3 dias (Total ≥ PIX); já em `isDateWindowMatch` |
| **Aproximado** | `remetente_destinatario` (PIX) ↔ contraparte(`historico`) (Total) | `compararNomeCadastro` = `bate` |

### 9.2 `contraparteDoHistorico(historico: string): string | null`

Parser determinístico Caixa (v1), ex.:

- `PIX RECEBIDO - {NOME}`
- `PIX ENVIADO - {NOME}`
- `TED … - {NOME}`

Retorna nome normalizado ou `null` se não identificar. Usado **apenas** em `pairEligible` / `scorePair` — **não** persiste em `remetente_destinatario`.

### 9.3 `pairEligible` (ajuste)

Além das regras atuais (CPF/CNPJ estruturado, nomes em `remetenteDestinatario`):

- Se papel PIX + COMPLETO: considerar `nomesBatem(remetentePix, contraparteDoHistorico(historicoTotal))`.

Leitura:

```ts
function campo(m: MovimentacaoCandidate, key: string): string | null {
  return m.camposExtracao?.[key] ?? fallbackLegado(m, key);
}
```

### 9.4 Resultado do merge

| Situação | `origens` | Status típico |
|----------|-----------|---------------|
| Par forte (duras + nome `bate`) | 2 | `pronta` se cadastro ALTA |
| Só duras, nome fraco | 1 + hipótese `PAR_PDF_FRACO` | merge pendente / revisão |
| Sem par | 1 | linha isolada |

Linha fundida na planilha: colunas da união preenchidas; Rem/Dest do PIX; `historico` e `documento` do Total nas colunas respectivas.

### 9.5 Anti-falsos-positivos

Alinhar a [2026-06-08-anti-falsos-positivos-match-design.md](./2026-06-08-anti-falsos-positivos-match-design.md):

- Par com doc estruturado igual nos dois lados → tier ALTA.
- Par só por nome Histórico ↔ Rem/Dest → tier MÉDIA; auto-merge só se política atual permitir; caso contrário `PENDENTE`.

---

## 10. Planilha (UI)

### 10.1 Colunas dinâmicas

Renderizar cabeçalhos a partir de `payload.colunas` (união da sessão).

Ordem sugerida:

`Data` · `Doc./Extrato` (`documento`) · `Valor` · `Direção` · `Histórico` · `Remetente/Destinatário` · `Hora` · `Tipo PIX` · `Situação` · `Saldo` · `PF/PJ` · `Confiança` · `Origens` · `Status` · `Ações`

Célula vazia (`—`) quando a chave não existe na linha (ou na origem correspondente antes do merge).

### 10.2 Painel Origens

Por origem, listar **todos** os `campos_extracao` da movimentação fonte (layout nativo do PDF).

### 10.3 Filtros

- "Sem remetente/destinatário" — só linhas onde `campos_extracao.remetente_destinatario` ausente **e** nenhuma origem PIX com Rem/Dest no merge.
- Manter filtros existentes (`sem pessoa`, `baixa confiança`, etc.).

---

## 11. Fluxo do operador (atualizado)

```
/prestacao/nova
  → UF, exercício, mês (opcional, rótulo), PDFs
  → por PDF: modelo auto-detectado (editável)
  → Processar
  → NotebookLM extrai todos os campos → campos_extracao
  → consolidateSession (≥2 PDFs)
  → /prestacao/:id/planilha (colunas união, origens 2 quando par OK)
```

---

## 12. Fora de escopo (v1)

- Novos bancos além presets Caixa PIX / Caixa Total.
- Mês como filtro ou validação de data.
- Copiar `historico` → `remetente_destinatario` na ingestão.
- IA no par (Kimi) — regras locais + parser Histórico.
- Reprocessamento em lote de sessões antigas (script opcional fase 2).

---

## 13. Plano de implementação (ordem)

1. Migration `campos_extracao` + tipos TS.
2. Fixture `EXTRATO_COLUMN_MAP_CAIXA_TOTAL_JAN`.
3. NotebookLM: schema, prompt, `persistNotebookLmTransactions` com todos os campos.
4. `contraparteDoHistorico` + ajuste `candidates.ts` lendo `campos_extracao`.
5. API planilha: `colunas` + `camposExtracao` por linha; merge no evento consolidado.
6. UI: modelo auto-detect + dropdown; tabela com colunas dinâmicas.
7. Testes: fixture Bahia PIX+Total; regressão `list.test.ts` / `candidates.test.ts`.

---

## 14. Critérios de aceite

Sessão teste: `Extrato Jan PIX (1).pdf` + `EXTRATO TOTAL JANEIRO (1) (1).pdf` + cadastro BA.

| Critério | Esperado |
|----------|----------|
| Colunas planilha | Inclui `historico`, `documento`, `remetente_destinatario`, `hora`, `tipo_pix`, `saldo` |
| Linhas PIX | `remetente_destinatario` preenchido; `documento` pode vazio |
| Linhas Total | `historico` + `documento` preenchidos; `remetente_destinatario` vazio |
| Pares PIX↔Total | Maioria com **2 origens** após consolidação |
| Doc./Extrato | Preenchido nas linhas Total (e fundidas) |
| Rem/Dest | Preenchido nas linhas PIX (e fundidas via origem PIX) |
| Histórico | Visível na coluna própria; **não** duplicado em Rem/Dest |
| Mês sessão | Aparece no rótulo; não altera dados |

---

## 15. Referências de código

| Área | Arquivo |
|------|---------|
| Classificação PIX/Total | `packages/core/src/consolidacao/classify-arquivo.ts` |
| Pares consolidação | `packages/core/src/consolidacao/candidates.ts` |
| Persist NotebookLM | `packages/core/src/prestacao/process-sessao-notebooklm.ts` |
| Planilha | `packages/core/src/planilha/list.ts`, `map-consolidacao-linha.ts` |
| UI tabela | `apps/web/components/prestacao/planilha-table.tsx` |
| Preset PIX | `packages/core/src/ingest/extrato-column-map-fixtures.ts` |
