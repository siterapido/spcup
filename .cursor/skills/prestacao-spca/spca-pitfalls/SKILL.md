---
name: spca-pitfalls
description: Armadilhas e correções do pipeline SPCA descobertas em sessão. Complementa prestacao-spca.
---

# SPCA Pitfalls (complemento de prestacao-spca)

Armadilhas encontradas e corrigidas que ainda não estão na skill principal.

## `_prestacao_row` — escopo `""` vs `NULL`

**Sintoma:** scripts anuais (`gerar_revisao_anual.py`, `exportar_lista_anual.py`,
`exportar_fora_cadastro.py`) retornam `"Prestação não encontrada no banco"` mesmo
com a prestação existindo no DB.

**Causa:** `_prestacao_row()` em `scripts/revisao_db/anuais.py` e `lista_anual.py` do
**projeto** usa `WHERE escopo IS ?` que não funciona com bind parameter `None`.
Agravado por: `prestacao.py` sem `--escopo` omite a chave do JSON → `None`,
mas DB armazena `''`. `str(x).strip() if x else None` converte `""` → `None`.

**Correção:** query normaliza — se `escopo_s` for `None` ou `""`, busca
`WHERE (escopo IS NULL OR escopo = '')`; senão `WHERE escopo = ?`.

**Arquivos:** `scripts/revisao_db/anuais.py:37`, `scripts/revisao_db/lista_anual.py:70`.
Corrigir no **projeto**, não no perfil Hermes (a `lib_revisao_anual.py` do perfil delega).

## Paths de script

Scripts estão em `~/.hermes/profiles/spca/skills/prestacao-spca/scripts/`, não em
`.cursor/skills/` (ausente no projeto SPCA UP V2). Use path absoluto.

## NLM PIX: `tipo` sem "pix" → `extrato_pix vazio` [RESOLVIDO AUTOMATICAMENTE]

**Sintoma:** `processar_mes` falha com `ValueError: extrato_pix vazio — forneça
Planilhado/*.xlsx ou PDF PIX para NLM.` mesmo com PDF PIX presente e NLM tendo
extraído transações.

**Causa:** `is_nlm_pix_recebido()` em `lib_nlm.py:86` exigia que o campo `tipo`
contenha a palavra "pix" (case-insensitive). Se o NLM rotular transações do
extrato PIX como `"RECEBIDO"` (sem "pix"), TODAS são filtradas → `extrato_pix`
fica vazio → `montar_fontes_json()` levanta erro.

**Solução automática (implementada em jun/2026):**
A função `is_nlm_pix_recebido` foi aprimorada. Agora, se `"pix"` estiver no nome do arquivo de origem (`origem_arquivo`), e a transação for de entrada (`is_saida=False`), ela é classificada como **PIX Recebido** mesmo sem conter a palavra "pix" no histórico/tipo.

**Diagnóstico manual (caso queira verificar o cache de meses legados):**
Verificar os `tipo` das transações do PDF PIX no cache:

```bash
.venv/bin/python -c "
import json
from collections import Counter
with open('Bahia/2025/mensal/.cache/maio/nlm_transacoes.json') as f:
    data = json.load(f)
txs = data.get('transacoes', data)
tipos = Counter(t.get('tipo') for t in txs if 'pix' in str(t.get('origem_arquivo','')).lower())
for t, c in tipos.most_common(): print(f'  {t}: {c}')
"
```

Se só aparecer `RECEBIDO` (sem PIX) e estiver rodando código legado sem a melhoria → é esse o bug.

**Correção manual legada:** adicionar `"tipo": "CRED PIX"` nas transações do PIX recebido:

```bash
.venv/bin/python -c "
import json, shutil
cache = 'Bahia/2025/mensal/.cache/MAIO/nlm_transacoes.json'
shutil.copy2(cache, cache + '.bak')
with open(cache) as f: data = json.load(f)
txs = data.get('transacoes', data)
for t in txs:
    o = str(t.get('origem_arquivo',''))
    if 'pix' in o.lower() and t.get('direcao') == 'entrada':
        if 'pix' not in str(t.get('tipo','')).lower():
            t['tipo'] = 'CRED PIX'
with open(cache, 'w') as f:
    json.dump(data, f, indent=2, ensure_ascii=False)
"
```

Depois reprocessar com `--pular-nlm` (cache já corrigido).

**Caso real:** Bahia maio/2025 — 50 transações PIX com `tipo: "RECEBIDO"`;
todas filtradas. Após correção: 47 prontas, 76 bloqueadas.

## Pipeline "revise o ano inteiro"

Gatilho: `revise o ano inteiro` / `revisão anual completa`:
1. `gerar_revisao_anual.py` → consolida SQLite
2. `exportar_lista_anual.py` → `lista-anual.xlsx` (8 abas)
3. `exportar_fora_cadastro.py` → `pessoas_fora_cadastro.xlsx`

## Cadastro caixa_1: atualizar a partir de Google Sheets do diretório

Quando o diretório envia planilha com CPFs ausentes (Google Sheets, formato
`nome | meses | CPF`), o fluxo é:

1. **Download:** converter link `https://docs.google.com/spreadsheets/d/ID/edit`
   para `https://docs.google.com/spreadsheets/d/ID/export?format=xlsx` e baixar com curl
2. **Extrair CPFs:** ler colunas `nome`, `CPF` da aba "Lista de CPF ausente";
   normalizar CPF (só dígitos); pular linhas sem CPF ou CPF inválido (< 11 dígitos)
3. **Dedup:** remover CPFs já existentes no cadastro atual (`pessoas bahia.xlsx`)
4. **Adicionar:** append no xlsx com `Status=Validado`, `Tipo de Pessoa=Pessoa Física`
5. **Backup:** sempre copiar `pessoas bahia.xlsx` antes de modificar
6. **Reconciliar:** `processar_todos --forcar --pular-nlm` para reaplicar conciliação
   com novo cadastro (NLM inalterado)
7. **Atualizar anual:** `gerar_revisao_anual.py` + `exportar_lista_anual.py` +
   `exportar_fora_cadastro.py`

**Caso real:** Bahia 2025 — 62 CPFs novos de 70 entradas na planilha do diretório;
cadastro foi de 259 → 321 linhas; prontas subiram de 381 → 509 (+34%).
