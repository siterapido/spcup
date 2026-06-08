# Planilha — coluna Nome e match PF/PJ (Design)

**Data:** 2026-06-08  
**Cliente:** Unidade Popular (UP) — SPC UP  
**Status:** Aprovado (grill-me 2026-06-08)  
**Relacionado:**
- [2026-06-07-planilha-unificada-design.md](./2026-06-07-planilha-unificada-design.md)
- [2026-05-26-consolidacao-extratos-design.md](./2026-05-26-consolidacao-extratos-design.md)

---

## 1. Resumo

Adicionar coluna **Nome** na planilha unificada (`/prestacao/[id]/planilha`). O nome da contraparte (extraído do extrato ou corrigido pelo operador) passa a ser a **fonte primária** para match por nome no cadastro UF, sem substituir match por CPF/CNPJ nas origens.

---

## 2. Decisões de produto (grill-me)

| # | Tema | Decisão |
|---|------|---------|
| 1 | Modo do campo | **Híbrido (C):** pré-preenchido na extração; editável se vazio ou errado |
| 2 | Persistência | **Coluna `nome_contraparte` nullable** em `movimentacao` e `consolidacao_evento` + migration Drizzle |
| 3 | Derivação (quando null) | **Regra D:** se origem PIX tem nome e completo tem documento → nome do PIX; senão `nomeFromDescricao` do completo; fallback melhor origem |
| 4 | Salvar Nome editado | **Re-match só se PF/PJ vazio (B):** CPF/CNPJ nas origens tem prioridade; senão `findUniquePessoaByNome(nomeEffective)` |
| 5 | Ingest | **Gravar na ingest + refatorar match (C):** `applyDeterministicMatch` e consolidação usam `nome_contraparte ?? derivado` |
| 6 | UX edição | **Input inline (A):** salva no blur ou Enter |
| 7 | Linha consolidada | **Grava só no evento (A):** `consolidacao_evento.nome_contraparte`; filhas intactas até Confirmar merge |
| 8 | Filtro toolbar | **"Sem nome" (A)** com contador |
| 9 | Export | **Nome não é gate (A):** linha pronta exige PF/PJ + confiança + status; nome vazio OK se PF/PJ preenchido |

---

## 3. Modelo de dados

```sql
ALTER TABLE movimentacao ADD COLUMN nome_contraparte varchar(255);
ALTER TABLE consolidacao_evento ADD COLUMN nome_contraparte varchar(255);
```

| Campo | Semântica |
|-------|-----------|
| `NULL` | Usar nome derivado em tempo de leitura (`deriveNomeContraparte`) |
| não-`NULL` | Override do operador ou valor materializado na ingest |

**Nome efetivo (leitura):**

```typescript
nomeEffective = row.nome_contraparte ?? deriveNomeContraparte(origens)
```

---

## 4. Derivação — regra D

Entrada: lista de origens com `descricaoRaw` e `papel` (`PIX` | `COMPLETO` | `OUTRO`).

1. `nomePix` = `extractNomeContraparte(pix.descricaoRaw)` se papel PIX
2. `nomeCompleto` = idem para COMPLETO
3. `completoTemDoc` = CPF ou CNPJ em `completo.descricaoRaw`
4. Se `nomePix.length >= 3` e `completoTemDoc` → retornar `nomePix`
5. Senão se `nomeCompleto.length >= 3` → retornar `nomeCompleto`
6. Senão maior `extractNomeContraparte` não vazio entre origens (comprimento ≥ 3)

`extractNomeContraparte(descricaoRaw)` reutiliza `cleanNomeSugestao` + `normalizeName` (remove prefixos bancários, documentos, etc.).

---

## 5. Planilha — UX

### 5.1 Coluna Nome

| Aspecto | Decisão |
|---------|---------|
| Posição | Entre **Descrição Original** e **PF/PJ** |
| Editável | Sim — input inline |
| Salvar | Blur ou Enter → `PATCH .../planilha/linhas/:id` com `{ nomeContraparte }` |
| Vazio | Exibir `—`; placeholder ausente quando editando |
| Export | Não bloqueia |

### 5.2 Filtro

- Chip **Sem nome (N)** na toolbar
- Linha entra no filtro quando `nomeEffective` vazio ou só prefixo bancário (< 3 chars após extract)

### 5.3 Resumo API

```typescript
type PlanilhaLinha = {
  // ...campos existentes
  nome: string;              // nomeEffective para exibição
  nomeContraparte: string | null;  // valor persistido (null = só derivado)
  nomeDerivado: boolean;     // true quando nome vem só da derivação
};

type PlanilhaResumo = {
  // ...campos existentes
  semNome: number;
};
```

---

## 6. Match PF/PJ

Ordem inalterada em relação ao design da planilha (§7.2):

1. CPF/CNPJ na descrição das origens (`descricaoRaw`)
2. Nome único no cadastro UF via **`nomeEffective`** (não `descricaoRaw` inteira)
3. Par PIX↔completo (consolidação)
4. IA para ambíguos

**Ao PATCH `nomeContraparte`:**

1. Persistir override
2. Se `pessoaFisicaId` e `pessoaJuridicaId` ambos vazios → reexecutar match determinístico na linha
3. Se PF/PJ já vinculado → não sobrescrever

---

## 7. Ingest e consolidação

| Momento | Ação |
|---------|------|
| `persistTransactions` | `nome_contraparte = extractNomeContraparte(descricaoRaw)` quando ≥ 3 chars; senão `null` |
| `persistConsolidacaoDrafts` | `nome_contraparte = deriveNomeContraparte(linhas do draft)` |
| `applyDeterministicMatch` | Match por nome usa `mov.nomeContraparte ?? extractNomeContraparte(mov.descricaoRaw)` |
| `approveConsolidacaoEvento` | Copiar `evento.nomeContraparte` → movimentação canônica |

**Backfill:** sessões já ingeridas exibem nome derivado na leitura (`nome_contraparte` null). Re-processar sessão opcional fora de escopo.

---

## 8. API

Estender `PATCH /api/prestacao/sessoes/:id/planilha/linhas/:linhaId`:

```typescript
{
  fonte: "consolidacao" | "movimentacao",
  nomeContraparte?: string | null,  // null = limpar override, voltar à derivação
  // ...pessoa existente
}
```

---

## 9. Testes de aceite

| # | Cenário | Esperado |
|---|---------|----------|
| 1 | PIX `GABRIEL…` + completo com CPF | Nome = Gabriel; match PF cadastro |
| 2 | PIX `CRED PIX` só | Nome vazio; filtro Sem nome; operador edita → match se único no cadastro |
| 3 | PF/PJ manual sem nome | Export liberado (nome vazio) |
| 4 | Editar nome com PF/PJ já setado | Nome salvo; PF/PJ não muda |
| 5 | Editar nome sem PF/PJ | Re-match preenche PF/PJ se único |
| 6 | Confirmar merge | `nome_contraparte` do evento na movimentação canônica |
| 7 | Refresh planilha | Nome editado persiste |

---

## 10. Fora de escopo

- Fuzzy match de nomes
- Edição em lote de Nome
- Obrigatoriedade de nome para export
- Migration de dados históricos além de derivação na leitura
