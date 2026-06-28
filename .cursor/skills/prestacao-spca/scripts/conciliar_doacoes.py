#!/usr/bin/env python3
"""
Conciliação de doações SPCA (TSE) — extrato total + extrato PIX + cadastro pessoas.

Etapas:
  1. Limpeza e deduplicação da base de pessoas
  2. Filtragem CRED PIX no extrato total
  3. Pareamento total ↔ PIX (Documento DDHHMM + valor, tolerância ±3 min)
  4. Fuzzy matching nome PIX → cadastro (token_set_ratio ≥ 85%, gap ≥ 5)
  5. Exportação Excel (sucesso + pendências)
"""

from __future__ import annotations

import argparse
import re
import unicodedata
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

import pandas as pd
from thefuzz import fuzz

from tse_io import TSE_ENCODING

# ---------------------------------------------------------------------------
# Configuração de colunas esperadas (detecção fuzzy de cabeçalhos)
# ---------------------------------------------------------------------------

COLUMN_ALIASES: dict[str, list[str]] = {
    # extrato total
    "data_total": ["data", "dt movimento", "dt mov", "data movimento"],
    "valor_total": ["valor", "valor r", "vlr", "valor rs"],
    "documento_total": ["documento", "doc", "num documento", "numero documento"],
    "historico_total": ["historico", "hist", "descricao", "descrição"],
    # extrato pix
    "data_pix": ["data", "dt", "data transacao", "data transação"],
    "hora_pix": ["hora", "hr", "horario", "horário", "time"],
    "valor_pix": ["valor", "valor r", "vlr", "valor rs"],
    "nome_pix": [
        "nome",
        "remetente",
        "remetente/destinatario",
        "remetente destinatario",
        "nome remetente",
        "contraparte",
        "pagador",
        "nome pagador",
    ],
    "cpf_pix": [
        "cpf",
        "cpf cnpj",
        "cpf/cnpj",
        "documento",
        "doc",
        "cpf extrato",
        "cpf_extrato",
    ],
    # pessoas
    "nome_pessoa": ["nome", "nome completo", "razao social", "razão social"],
    "cpf_pessoa": ["cpf", "cpf cnpj", "documento", "doc"],
    "cnpj_pessoa": ["cnpj"],
    "tipo_pessoa": ["tipo", "tipo pessoa", "tipo de pessoa", "pf pj"],
    "status_pessoa": ["status", "situacao", "situação", "validacao", "validação"],
}

FUZZY_THRESHOLD = 85
FUZZY_GAP = 5
PAIR_TOLERANCE_MINUTES = 3
HISTORICO_ALVO = "CRED PIX"

# Históricos aceitos como doação PIX recebida (pós-normalize_historico)
HISTORICOS_CRED_PIX = frozenset(
    {
        "CRED PIX",
        "CRED PIX CHAVE",
        "PIX RECEBIDO DADOS CONTA",
        "PIX RECEBIDO",  # BB unificado (ex.: Santa Catarina — histórico 821)
    }
)

# Preposições ignoradas na comparação secundária (RF vs cadastro manual)
PREPOSICOES_NOME = frozenset({"DE", "DA", "DO", "DOS", "DAS", "E"})

# Limiares conservadores por método (evita falso positivo)
PARTIAL_TOKEN_SET_SOBRENOME_MIN = 92
TOKEN_SORT_SOBRENOME_MIN = 88


# ---------------------------------------------------------------------------
# Utilitários de normalização
# ---------------------------------------------------------------------------


def strip_accents(text: str) -> str:
    if not isinstance(text, str):
        return ""
    nfkd = unicodedata.normalize("NFKD", text)
    return "".join(c for c in nfkd if not unicodedata.combining(c))


def normalize_text(text: Any) -> str:
    """Maiúsculas, sem acentos, espaços colapsados."""
    if pd.isna(text) or text is None:
        return ""
    s = strip_accents(str(text).upper().strip())
    s = re.sub(r"\s+", " ", s)
    return s


def only_digits(text: Any) -> str:
    if pd.isna(text) or text is None:
        return ""
    return re.sub(r"\D", "", str(text))


def is_masked_cpf(text: Any) -> bool:
    """CPF mascarado XXX.XXX.XXX-XX."""
    if pd.isna(text) or text is None:
        return False
    return bool(re.match(r"^\d{3}\.\d{3}\.\d{3}-\d{2}$", str(text).strip()))


def is_masked_cnpj(text: Any) -> bool:
    return bool(re.match(r"^\d{2}\.\d{3}\.\d{3}/\d{4}-\d{2}$", str(text).strip())) if text else False


def parse_brazilian_value(val: Any) -> float | None:
    if pd.isna(val) or val is None or str(val).strip() == "":
        return None
    s = str(val).strip().replace("R$", "").replace(" ", "")
    if "," in s and "." in s:
        s = s.replace(".", "").replace(",", ".")
    elif "," in s:
        s = s.replace(",", ".")
    try:
        return round(float(s), 2)
    except ValueError:
        return None


def parse_brazilian_date(val: Any) -> datetime | None:
    if pd.isna(val) or val is None:
        return None
    if isinstance(val, datetime):
        return val.replace(hour=0, minute=0, second=0, microsecond=0)
    s = str(val).strip()
    for fmt in ("%d/%m/%Y", "%d-%m-%Y", "%Y-%m-%d", "%d/%m/%y"):
        try:
            return datetime.strptime(s[:10], fmt)
        except ValueError:
            continue
    return None


def parse_hora(val: Any) -> tuple[int, int] | None:
    if pd.isna(val) or val is None:
        return None
    s = str(val).strip()
    m = re.match(r"(\d{1,2}):(\d{2})(?::\d{2})?", s)
    if m:
        return int(m.group(1)), int(m.group(2))
    if re.match(r"^\d{4}$", s):
        return int(s[:2]), int(s[2:])
    if re.match(r"^\d{6}$", s):
        return int(s[:2]), int(s[2:4])
    return None


def normalize_historico(val: Any) -> str:
    s = normalize_text(val)
    s = re.sub(r"[^A-Z0-9 ]", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def is_cred_pix_recebido(historico_norm: str) -> bool:
    """True se o histórico normalizado representa doação PIX recebida."""
    return historico_norm in HISTORICOS_CRED_PIX


def cpf_norm_compare(digits: str) -> str:
    """Chave comparável para CPF (ignora zeros à esquerda)."""
    d = only_digits(digits)
    return d.lstrip("0") or "0"


def documento_extrato_bb_chaves(raw: Any) -> tuple[str, str]:
    """
    Interpreta número da linha de detalhe BB (11 ou 14 dígitos).
    Retorna (cpf_digits, cnpj_digits) — um deles vazio.
    """
    d = only_digits(raw)
    if not d:
        return "", ""
    if len(d) == 11:
        return d, ""
    if len(d) == 14:
        if d.startswith("000"):
            return d[-11:], ""
        return "", d
    if len(d) > 11:
        return d[-11:], d if len(d) >= 14 else ""
    return d.zfill(11), ""


# ---------------------------------------------------------------------------
# Matching de nomes (variações RF vs cadastro)
# ---------------------------------------------------------------------------


def tokenize_name(nome_norm: str) -> list[str]:
    return [t for t in nome_norm.split() if t]


def strip_preposition_tokens(nome_norm: str) -> str:
    return " ".join(t for t in tokenize_name(nome_norm) if t not in PREPOSICOES_NOME)


def token_casa_com_abreviacao(a: str, b: str) -> bool:
    """Token igual ou abreviação de 1 letra = inicial do outro."""
    if a == b:
        return True
    if len(a) == 1 and len(b) > 1:
        return b[0] == a
    if len(b) == 1 and len(a) > 1:
        return a[0] == b
    return False


def sobrenome_coincide(a_tokens: list[str], b_tokens: list[str]) -> bool:
    if not a_tokens or not b_tokens:
        return False
    return token_casa_com_abreviacao(a_tokens[-1], b_tokens[-1])


def tokens_restantes_cadastro_casam(pix_tokens: list[str], cad_tokens: list[str]) -> bool:
    """
    Cada token do cadastro após o 1º nome casa com um token distinto do PIX.
    Token de 1 letra (cadastro ou PIX) = inicial do nome completo no outro lado.
  PIX pode ter tokens extras (nome completo da RF).
    """
    pix_rest = [t for t in pix_tokens[1:] if t not in PREPOSICOES_NOME]
    cad_rest = [t for t in cad_tokens[1:] if t not in PREPOSICOES_NOME]
    if not cad_rest:
        return True
    if not pix_rest:
        return False
    disponiveis = list(pix_rest)
    for ct in cad_rest:
        match_idx = None
        for i, pt in enumerate(disponiveis):
            if token_casa_com_abreviacao(ct, pt):
                match_idx = i
                break
        if match_idx is None:
            return False
        disponiveis.pop(match_idx)
    return True


def primeiro_nome_igual(a_tokens: list[str], b_tokens: list[str]) -> bool:
    """1º token igual — só tolera acento e caixa (via normalize_text)."""
    if not a_tokens or not b_tokens:
        return False
    return normalize_text(a_tokens[0]) == normalize_text(b_tokens[0])


def avaliar_match_nome(pix_norm: str, cad_norm: str) -> tuple[float, str, bool, float]:
    """
    Avalia similaridade nome PIX (RF) vs cadastro.

    Retorna (score_efetivo, metodo, aceito, score_token_set).
    score_token_set é usado para desempate/ambiguidade (estável vs versão anterior).
    """
    if not pix_norm or not cad_norm:
        return 0.0, "vazio", False, 0.0

    pix_t = tokenize_name(pix_norm)
    cad_t = tokenize_name(cad_norm)
    pix_sp = strip_preposition_tokens(pix_norm)
    cad_sp = strip_preposition_tokens(cad_norm)

    ts = float(fuzz.token_set_ratio(pix_norm, cad_norm))
    ts_sp = float(fuzz.token_set_ratio(pix_sp, cad_sp)) if pix_sp and cad_sp else 0.0
    pts = float(fuzz.partial_token_set_ratio(pix_norm, cad_norm))
    tsort = float(fuzz.token_sort_ratio(pix_norm, cad_norm))

    sur = sobrenome_coincide(pix_t, cad_t)
    prim = primeiro_nome_igual(pix_t, cad_t)
    abrev = tokens_restantes_cadastro_casam(pix_t, cad_t)

    # 1º nome obrigatório em todos os caminhos (só variação de acento/caixa)
    if not prim:
        return max(ts, ts_sp, pts, tsort), "primeiro_nome_diferente", False, ts

    # Alta confiança fuzzy — não exige alinhamento token-a-token
    if ts >= FUZZY_THRESHOLD:
        return ts, "token_set", True, ts
    if ts_sp >= FUZZY_THRESHOLD:
        return ts_sp, "token_set_sem_prep", True, ts

    # Abaixo de 85%: exige alinhamento com abreviações do cadastro
    if not abrev:
        return max(ts, ts_sp, pts, tsort), "tokens_restantes_incompativeis", False, ts

    if ts >= 75 and sur:
        if pts >= PARTIAL_TOKEN_SET_SOBRENOME_MIN:
            return pts, "partial_token_set+sobrenome", True, ts
        if tsort >= TOKEN_SORT_SOBRENOME_MIN:
            return tsort, "token_sort+sobrenome", True, ts
    if ts >= 70 and sur:
        return ts, "token_abrev_cadastro", True, ts

    return max(ts, ts_sp, pts, tsort), "abaixo_limite", False, ts


def _cpfs_mesma_pessoa(a: str, b: str) -> bool:
    """True se CPFs parecem typo/duplicata da mesma pessoa (não homônimos distintos)."""
    if not a or not b:
        return True
    if a == b:
        return True
    # Um CPF contido no outro ou diferença de 1 dígito (cadastro sem máscara)
    if a in b or b in a:
        return True
    if len(a) == len(b) == 11:
        diffs = sum(x != y for x, y in zip(a, b))
        return diffs <= 1
    return False


def _grupo_e_duplicata_cadastro(group: pd.DataFrame) -> bool:
    """
    Só consolida mesmo nome_norm quando indica duplicata de cadastro,
    nunca homônimos ou PF/PJ distintos com documentos diferentes.
    """
    if len(group) <= 1:
        return False

    statuses = {str(s).upper() for s in group["status"] if s}
    cpfs = [str(c) for c in group["cpf_digits"] if c]
    cnpjs = [str(c) for c in group["cnpj_digits"] if c]

    if "VALIDAR" in statuses and "VALIDADO" in statuses:
        return True

    # Qualquer combinação de documentos distintos (CPF ou CNPJ) => não consolidar
    docs = set(cpfs) | set(cnpjs)
    if len(docs) > 1:
        return False
    return True


def consolidar_por_nome_identico(df: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame]:
    """
    Mescla linhas com mesmo nome_norm somente quando duplicata de cadastro
    (ex.: Vitoria Validar + Validado). Homônimos com CPFs distintos permanecem.
    """
    if df.empty or "nome_norm" not in df.columns:
        return df, pd.DataFrame()

    extra_dupes: list[pd.Series] = []
    kept_rows: list[pd.Series] = []

    for _, group in df.groupby("nome_norm", dropna=False):
        if len(group) == 1 or not _grupo_e_duplicata_cadastro(group):
            for _, row in group.iterrows():
                kept_rows.append(row)
            continue

        scored = group.copy()
        scored["_dedup_score"] = scored.apply(
            lambda r: dedup_score(
                pd.Series(
                    {
                        "_status_norm": r.get("status", ""),
                        "_cpf_raw": r.get("cpf", ""),
                        "_cnpj_raw": r.get("cnpj", ""),
                        "_nome_norm": r.get("nome_norm", ""),
                    }
                )
            ),
            axis=1,
        )
        scored = scored.sort_values("_dedup_score", ascending=False)
        kept_rows.append(scored.iloc[0])
        for idx in scored.index[1:]:
            row = scored.loc[idx].copy()
            row["categoria"] = "Duplicata descartada"
            row["motivo"] = "Mesmo nome_norm — priorizada linha Validado + documento mascarado"
            extra_dupes.append(row)

    limpo = pd.DataFrame(kept_rows).reset_index(drop=True)
    dupes = pd.DataFrame(extra_dupes) if extra_dupes else pd.DataFrame()
    return limpo, dupes


def detect_column(df: pd.DataFrame, aliases: list[str], used: set[str]) -> str | None:
    """Detecta coluna por similaridade fuzzy nos cabeçalhos."""
    headers = {normalize_text(c): c for c in df.columns}
    best_col, best_score = None, 0
    for alias in aliases:
        alias_norm = normalize_text(alias)
        for hdr_norm, hdr_orig in headers.items():
            if hdr_orig in used:
                continue
            score = fuzz.ratio(alias_norm, hdr_norm)
            if score > best_score and score >= 70:
                best_score = score
                best_col = hdr_orig
    return best_col


def map_columns(df: pd.DataFrame, field_keys: list[str], used: set[str]) -> dict[str, str]:
    mapping: dict[str, str] = {}
    for key in field_keys:
        aliases = COLUMN_ALIASES.get(key, [])
        col = detect_column(df, aliases, used)
        if col:
            mapping[key] = col
            used.add(col)
    return mapping


def read_input(path: Path) -> pd.DataFrame:
    suffix = path.suffix.lower()
    if suffix in (".xlsx", ".xls"):
        return pd.read_excel(path, dtype=str)
    if suffix == ".csv":
        for sep in (";", ","):
            try:
                df = pd.read_csv(path, sep=sep, dtype=str, encoding="utf-8")
                if len(df.columns) > 1:
                    return df
            except Exception:
                continue
        return pd.read_csv(path, dtype=str, encoding=TSE_ENCODING)
    raise ValueError(f"Formato não suportado: {suffix}. Use CSV ou XLSX.")


# ---------------------------------------------------------------------------
# ETAPA 1 — Pré-processamento da base de pessoas
# ---------------------------------------------------------------------------


def dedup_score(row: pd.Series) -> tuple[int, int, int]:
    """Maior = melhor. Prioriza Validado + CPF/CNPJ mascarado."""
    status = normalize_text(row.get("_status_norm", ""))
    cpf = row.get("_cpf_raw", "")
    cnpj = row.get("_cnpj_raw", "")
    score_validado = 2 if "VALIDADO" in status else (1 if "VALIDAR" in status else 0)
    score_mask = 0
    if is_masked_cpf(cpf):
        score_mask += 2
    elif len(only_digits(cpf)) == 11:
        score_mask += 1
    if is_masked_cnpj(cnpj):
        score_mask += 2
    elif len(only_digits(cnpj)) == 14:
        score_mask += 1
    completeness = sum(1 for v in [row.get("_nome_norm"), cpf, cnpj] if v)
    return (score_validado, score_mask, completeness)


def limpar_pessoas(df: pd.DataFrame, maps: dict[str, str]) -> tuple[pd.DataFrame, pd.DataFrame]:
    """
    Deduplica por dígitos do documento (CPF/CNPJ) ou nome normalizado.
    Retorna (base_limpa, dupes_descartadas).
    """
    nome_col = maps["nome_pessoa"]
    cpf_col = maps.get("cpf_pessoa")
    cnpj_col = maps.get("cnpj_pessoa")
    status_col = maps.get("status_pessoa")
    tipo_col = maps.get("tipo_pessoa")

    work = df.copy()
    work["_nome_norm"] = work[nome_col].map(normalize_text)
    work["_cpf_raw"] = work[cpf_col] if cpf_col else ""
    work["_cnpj_raw"] = work[cnpj_col] if cnpj_col else ""
    if not cnpj_col and cpf_col:
        # Coluna única CPF/CNPJ
        work["_cpf_digits"] = work[cpf_col].map(only_digits)
        work["_cnpj_digits"] = work["_cpf_digits"].map(lambda d: d if len(d) == 14 else "")
        work["_cpf_digits"] = work["_cpf_digits"].map(lambda d: d if len(d) == 11 else d[:11] if len(d) == 11 else (d if len(d) <= 11 else ""))
        mask_cnpj = work["_cpf_digits"].str.len() == 14
        work.loc[mask_cnpj, "_cnpj_digits"] = work.loc[mask_cnpj, "_cpf_digits"]
        work.loc[mask_cnpj, "_cpf_digits"] = ""
    else:
        work["_cpf_digits"] = work["_cpf_raw"].map(only_digits).str[:11]
        work["_cnpj_digits"] = work["_cnpj_raw"].map(only_digits).str[:14]

    work["_status_norm"] = work[status_col].map(normalize_text) if status_col else ""
    work["_tipo"] = work[tipo_col] if tipo_col else ""
    work["_grupo"] = work.apply(
        lambda r: r["_cpf_digits"] or r["_cnpj_digits"] or r["_nome_norm"],
        axis=1,
    )

    dupes_rows: list[pd.Series] = []
    kept_indices: list[int] = []

    for _, group in work.groupby("_grupo", dropna=False):
        if len(group) == 1:
            kept_indices.append(group.index[0])
            continue
        scored = group.copy()
        scored["_dedup_score"] = scored.apply(dedup_score, axis=1)
        scored = scored.sort_values("_dedup_score", ascending=False)
        winner = scored.iloc[0]
        kept_indices.append(winner.name)
        for idx in scored.index[1:]:
            row = scored.loc[idx].copy()
            row["categoria"] = "Duplicata descartada"
            row["motivo"] = "Priorizada linha Validado + documento mascarado"
            dupes_rows.append(row)

    limpa = work.loc[kept_indices].copy()
    dupes_df = pd.DataFrame(dupes_rows) if dupes_rows else pd.DataFrame()

    out = pd.DataFrame(
        {
            "nome_norm": limpa["_nome_norm"],
            "nome_original": limpa[nome_col],
            "cpf": limpa["_cpf_raw"],
            "cnpj": limpa["_cnpj_raw"],
            "cpf_digits": limpa["_cpf_digits"],
            "cnpj_digits": limpa["_cnpj_digits"],
            "tipo_pessoa": limpa["_tipo"],
            "status": limpa["_status_norm"],
        }
    )
    out, dupes_nome = consolidar_por_nome_identico(out)
    if not dupes_nome.empty:
        dupes_df = pd.concat([dupes_df, dupes_nome], ignore_index=True, sort=False)
    return out.reset_index(drop=True), dupes_df


# ---------------------------------------------------------------------------
# Filtro mês civil (data de crédito no extrato total)
# ---------------------------------------------------------------------------


def filtrar_extrato_mes_civil(
    df: pd.DataFrame,
    data_col: str,
    mes_civil: int,
    ano: int,
) -> tuple[pd.DataFrame, dict[str, int]]:
    """
    Mantém só linhas cuja Data (extrato total) cai no mês civil da prestação.
    PIX não é filtrado aqui — permanece inteiro para pareamento (DDHHMM+valor).
    Linhas fora do mês (vazamento de fronteira do PDF) não geram artefato extra se
    constarem no PDF do mês efetivo.
    """
    linhas_pdf = len(df)
    if linhas_pdf == 0:
        return df, {"linhas_pdf": 0, "linhas_mes": 0, "linhas_vazamento": 0}

    parsed = df[data_col].map(parse_brazilian_date)
    mask = parsed.map(
        lambda d: d is not None and d.year == ano and d.month == mes_civil
    )
    filtrado = df.loc[mask].reset_index(drop=True)
    linhas_mes = len(filtrado)
    return filtrado, {
        "linhas_pdf": linhas_pdf,
        "linhas_mes": linhas_mes,
        "linhas_vazamento": linhas_pdf - linhas_mes,
    }


# ---------------------------------------------------------------------------
# ETAPA 2 — Filtragem extrato total
# ---------------------------------------------------------------------------


def filtrar_extrato_total(df: pd.DataFrame, maps: dict[str, str]) -> tuple[pd.DataFrame, pd.DataFrame]:
    hist_col = maps["historico_total"]
    work = df.copy()
    work["_historico_norm"] = work[hist_col].map(normalize_historico)
    work["_data"] = work[maps["data_total"]].map(parse_brazilian_date)
    work["_valor"] = work[maps["valor_total"]].map(parse_brazilian_value)
    work["_documento"] = work[maps["documento_total"]].astype(str).str.strip()

    pix = work[work["_historico_norm"].map(is_cred_pix_recebido)].copy()
    excecoes = work[~work["_historico_norm"].map(is_cred_pix_recebido)].copy()
    return pix.reset_index(drop=True), excecoes.reset_index(drop=True)


# ---------------------------------------------------------------------------
# ETAPA 3 — Pareamento total ↔ PIX
# ---------------------------------------------------------------------------


def normalize_documento(documento: Any) -> str:
    """Normaliza Documento do extrato total para comparação DDHHMM (6 dígitos)."""
    doc = only_digits(documento)
    if not doc:
        return ""
    return doc[-6:].zfill(6) if len(doc) >= 6 else doc.zfill(6)


def build_ddhhmm(data: datetime | None, hora: Any) -> str | None:
    """
    Chave DDHHMM a partir da Data e Hora do extrato PIX.
    Dia (2) + hora (2) + minuto (2) — mesma regra do campo Documento no extrato total.
    """
    if data is None:
        return None
    hm = parse_hora(hora)
    if hm is None:
        return None
    return f"{data.day:02d}{hm[0]:02d}{hm[1]:02d}"


def build_pix_datetime(data: datetime | None, hora: Any) -> datetime | None:
    if data is None:
        return None
    hm = parse_hora(hora)
    if hm is None:
        return None
    return data.replace(hour=hm[0], minute=hm[1], second=0, microsecond=0)


def parear_total_pix(
    total_pix: pd.DataFrame,
    df_pix: pd.DataFrame,
    maps_total: dict[str, str],
    maps_pix: dict[str, str],
) -> tuple[pd.DataFrame, pd.DataFrame]:
    """
    Left join extrato total (CRED PIX) → extrato PIX pela chave DDHHMM + valor.

    Documento no total = DD + HH + MM da transação no extrato PIX.
    Fallback: datetime ±3 min quando DDHHMM não casa (variação de dia no PDF).
    Nunca pareia se ambíguo.
    """
    pix_work = df_pix.copy()
    pix_work["_data"] = pix_work[maps_pix["data_pix"]].map(parse_brazilian_date)
    pix_work["_valor"] = pix_work[maps_pix["valor_pix"]].map(parse_brazilian_value)
    pix_work["_nome_pix"] = pix_work[maps_pix["nome_pix"]].astype(str)
    cpf_col = maps_pix.get("cpf_pix")
    if cpf_col and cpf_col in pix_work.columns:
        pix_work["_doc_extrato"] = pix_work[cpf_col].astype(str).str.strip()
    else:
        pix_work["_doc_extrato"] = ""
    pix_work["_ddhhmm"] = pix_work.apply(
        lambda r: build_ddhhmm(r["_data"], r[maps_pix["hora_pix"]]),
        axis=1,
    )
    pix_work["_datetime"] = pix_work.apply(
        lambda r: build_pix_datetime(r["_data"], r[maps_pix["hora_pix"]]),
        axis=1,
    )
    pix_work["_pix_idx"] = pix_work.index
    pix_usados: set[int] = set()

    total_work = total_pix.copy()
    total_work["_documento_norm"] = total_work["_documento"].map(normalize_documento)
    total_work["_total_idx"] = total_work.index

    resultados: list[dict[str, Any]] = []
    sem_par: list[dict[str, Any]] = []

    for _, row in total_work.iterrows():
        valor = row["_valor"]
        doc_norm = row["_documento_norm"]
        if valor is None or not doc_norm:
            sem_par.append(
                {**row.to_dict(), "categoria": "PIX sem par", "motivo": "Documento ou valor inválido"}
            )
            continue

        disponiveis = pix_work[~pix_work["_pix_idx"].isin(pix_usados)]
        candidatos = disponiveis[
            (disponiveis["_ddhhmm"] == doc_norm) & (disponiveis["_valor"] == valor)
        ]
        metodo = "DDHHMM+valor"

        if len(candidatos) == 0:
            # Fallback: HHMM extraído do documento + valor + proximidade temporal
            hhmm = doc_norm[-4:]
            try:
                h_ref, m_ref = int(hhmm[:2]), int(hhmm[2:4])
            except ValueError:
                h_ref, m_ref = -1, -1
            if 0 <= h_ref <= 23 and 0 <= m_ref <= 59:
                tol = timedelta(minutes=PAIR_TOLERANCE_MINUTES)
                por_valor = disponiveis[disponiveis["_valor"] == valor].copy()
                proximos: list[tuple[timedelta, int]] = []
                for idx, pix_row in por_valor.iterrows():
                    dt_pix = pix_row["_datetime"]
                    if dt_pix is None:
                        continue
                    if f"{dt_pix.hour:02d}{dt_pix.minute:02d}" != hhmm:
                        continue
                    data_total = row["_data"]
                    if data_total is None:
                        continue
                    if dt_pix.date() != data_total.date():
                        delta_dias = abs((dt_pix.date() - data_total.date()).days)
                        if delta_dias > 1:
                            continue
                    ref_dt = data_total.replace(hour=h_ref, minute=m_ref, second=0, microsecond=0)
                    delta = abs(dt_pix - ref_dt)
                    if delta <= tol:
                        proximos.append((delta, int(pix_row["_pix_idx"])))
                if len(proximos) == 1:
                    candidatos = pix_work[pix_work["_pix_idx"] == proximos[0][1]]
                    metodo = "HHMM+valor±3min"

        if len(candidatos) == 0:
            sem_par.append(
                {
                    **row.to_dict(),
                    "categoria": "PIX sem par",
                    "motivo": f"Nenhum PIX com DDHHMM={doc_norm} e mesmo valor",
                }
            )
            continue
        if len(candidatos) > 1:
            sem_par.append(
                {
                    **row.to_dict(),
                    "categoria": "PIX sem par",
                    "motivo": f"Par ambíguo ({len(candidatos)} PIX com DDHHMM={doc_norm})",
                }
            )
            continue

        pix_row = candidatos.iloc[0]
        pix_usados.add(int(pix_row["_pix_idx"]))
        resultados.append(
            {
                "data": row["_data"],
                "valor": valor,
                "documento": row["_documento"],
                "historico": row.get(maps_total["historico_total"], HISTORICO_ALVO),
                "nome_pix_original": pix_row["_nome_pix"],
                "nome_pix_norm": normalize_text(pix_row["_nome_pix"]),
                "doc_extrato": pix_row.get("_doc_extrato", ""),
                "par_pix_metodo": metodo,
                "_total_idx": row["_total_idx"],
            }
        )

    pareados = pd.DataFrame(resultados)
    sem_par_df = pd.DataFrame(sem_par)
    return pareados, sem_par_df


# ---------------------------------------------------------------------------
# ETAPA 4 — Fuzzy matching nome → cadastro
# ---------------------------------------------------------------------------


def match_pessoa_por_documento(
    doc_raw: str,
    pessoas: pd.DataFrame,
) -> tuple[str | None, str | None, str | None, str | None, float | None, str, str] | None:
    """
    Match exato por CPF/CNPJ do extrato (linha de detalhe BB).
    Retorna mesmo formato de fuzzy_match_pessoa, ou None se sem documento.
    """
    cpf_d, cnpj_d = documento_extrato_bb_chaves(doc_raw)
    if not cpf_d and not cnpj_d:
        return None

    if cnpj_d:
        matches = pessoas[pessoas["cnpj_digits"] == cnpj_d]
        if len(matches) == 1:
            row = matches.iloc[0]
            return (
                row["nome_original"],
                row["cpf"] if row["cpf_digits"] else "",
                row["cnpj"] if row["cnpj_digits"] else "",
                row.get("tipo_pessoa", ""),
                100.0,
                "",
                "cnpj_extrato",
            )
        if len(matches) > 1:
            return (
                None,
                None,
                None,
                None,
                100.0,
                "CPF Ausente - Revisão Manual (CNPJ ambíguo no cadastro)",
                "cnpj_extrato",
            )

    if cpf_d:
        alvo = cpf_norm_compare(cpf_d)
        matches = pessoas[pessoas["cpf_digits"].map(cpf_norm_compare) == alvo]
        if len(matches) == 1:
            row = matches.iloc[0]
            return (
                row["nome_original"],
                row["cpf"] if row["cpf_digits"] else "",
                row["cnpj"] if row["cnpj_digits"] else "",
                row.get("tipo_pessoa", ""),
                100.0,
                "",
                "cpf_extrato",
            )
        if len(matches) > 1:
            return (
                None,
                None,
                None,
                None,
                100.0,
                "CPF Ausente - Revisão Manual (CPF ambíguo no cadastro)",
                "cpf_extrato",
            )

    return (
        None,
        None,
        None,
        None,
        None,
        "CPF Ausente - Revisão Manual (documento fora do cadastro)",
        "cpf_extrato" if cpf_d else "cnpj_extrato",
    )


def fuzzy_match_pessoa(
    nome_norm: str,
    pessoas: pd.DataFrame,
) -> tuple[str | None, str | None, str | None, str | None, float | None, str, str]:
    """
    Retorna (nome_cadastro, cpf, cnpj, tipo, score, flag, metodo_match).
    flag vazia = sucesso; senão motivo de pendência.
    """
    if not nome_norm:
        return None, None, None, None, None, "CPF Ausente - Revisão Manual", ""

    candidatos: list[tuple[float, str, bool, float, pd.Series]] = []
    for _, row in pessoas.iterrows():
        cand = row["nome_norm"]
        if not cand:
            continue
        score, metodo, aceito, ts_gap = avaliar_match_nome(nome_norm, cand)
        candidatos.append((score, metodo, aceito, ts_gap, row))

    if not candidatos:
        return None, None, None, None, None, "CPF Ausente - Revisão Manual", ""

    aceitos = [(s, m, tg, r) for s, m, ok, tg, r in candidatos if ok]
    melhor_bruto = max(candidatos, key=lambda x: x[0])

    if not aceitos:
        return (
            None,
            None,
            None,
            None,
            melhor_bruto[0],
            "CPF Ausente - Revisão Manual",
            melhor_bruto[1],
        )

    # Desempate pelo token_set (evita ambiguidade artificial de regras de resgate)
    aceitos.sort(key=lambda x: (x[2], x[0]), reverse=True)
    best_score, best_metodo, best_ts, best_row = aceitos[0]
    second_ts = aceitos[1][2] if len(aceitos) > 1 else 0.0

    if best_ts - second_ts < FUZZY_GAP:
        return (
            None,
            None,
            None,
            None,
            best_score,
            "CPF Ausente - Revisão Manual (ambiguidade fuzzy)",
            best_metodo,
        )

    cpf_out = best_row["cpf"] if best_row["cpf_digits"] else ""
    cnpj_out = best_row["cnpj"] if best_row["cnpj_digits"] else ""
    return (
        best_row["nome_original"],
        cpf_out,
        cnpj_out,
        best_row.get("tipo_pessoa", ""),
        float(best_score),
        "",
        best_metodo,
    )


def cruzar_pessoas(pareados: pd.DataFrame, pessoas: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame]:
    sucesso_rows: list[dict[str, Any]] = []
    pendencia_rows: list[dict[str, Any]] = []

    for _, row in pareados.iterrows():
        doc_extrato = str(row.get("doc_extrato") or "").strip()
        cpf_fmt = ""
        if doc_extrato:
            cpf_d, cnpj_d = documento_extrato_bb_chaves(doc_extrato)
            raw = cpf_d or cnpj_d or doc_extrato
            if len(raw) == 11:
                cpf_fmt = f"{raw[:3]}.{raw[3:6]}.{raw[6:9]}-{raw[9:]}"
            elif len(raw) == 14:
                cpf_fmt = f"{raw[:2]}.{raw[2:5]}.{raw[5:8]}/{raw[8:12]}-{raw[12:]}"
            else:
                cpf_fmt = doc_extrato
        doc_result = match_pessoa_por_documento(doc_extrato, pessoas) if doc_extrato else None
        if doc_result and not doc_result[5]:
            # Match por documento OK. Validar compatibilidade do nome PIX vs cadastro.
            nome_cad, cpf, cnpj, tipo, score, flag, metodo = doc_result
            cad_norm = normalize_text(nome_cad) if nome_cad else ""
            pix_t = tokenize_name(row.get("nome_pix_norm", ""))
            cad_t = tokenize_name(cad_norm)
            if pix_t and cad_t and not primeiro_nome_igual(pix_t, cad_t):
                # CPF existe no cadastro mas nome PIX é de outra pessoa
                nome_cad, cpf, cnpj, tipo, score, flag, metodo = (
                    None, None, None, None, 0.0,
                    "CPF Ausente - Revisão Manual (nome PIX incompatível com titular do CPF no cadastro)",
                    "cpf_extrato_nome_divergente",
                )
        elif doc_result and doc_result[5] and "fora do cadastro" in doc_result[5]:
            fuzzy = fuzzy_match_pessoa(row["nome_pix_norm"], pessoas)
            if fuzzy[5]:
                nome_cad, cpf, cnpj, tipo, score, flag, metodo = doc_result
            else:
                nome_cad, cpf, cnpj, tipo, score, flag, metodo = fuzzy
        else:
            nome_cad, cpf, cnpj, tipo, score, flag, metodo = fuzzy_match_pessoa(
                row["nome_pix_norm"], pessoas
            )
        base = {
            "Data": row["data"].strftime("%d/%m/%Y") if row["data"] else "",
            "Valor": row["valor"],
            "Documento": row["documento"],
            "Histórico": row["historico"],
            "Nome_PIX_original": row["nome_pix_original"],
            "CPF_extrato": cpf_fmt,
            "Par_PIX_metodo": row["par_pix_metodo"],
            "Score_fuzzy": score,
            "Metodo_fuzzy": metodo,
        }
        if flag:
            pendencia_rows.append(
                {
                    **base,
                    "Nome do Doador (PIX)": row["nome_pix_original"],
                    "categoria": "CPF Ausente - Revisão Manual",
                    "motivo": flag,
                }
            )
        else:
            doc_valido = cpf if cpf else cnpj
            sucesso_rows.append(
                {
                    "Data": base["Data"],
                    "Valor": base["Valor"],
                    "Documento": base["Documento"],
                    "Histórico": base["Histórico"],
                    "Nome do Doador": nome_cad,
                    "CPF Válido": cpf or "",
                    "CNPJ": cnpj or "",
                    "Tipo de Pessoa": tipo or "",
                    "Nome_PIX_original": base["Nome_PIX_original"],
                    "Score_fuzzy": score,
                    "Metodo_fuzzy": metodo,
                    "Par_PIX_metodo": base["Par_PIX_metodo"],
                }
            )

    return pd.DataFrame(sucesso_rows), pd.DataFrame(pendencia_rows)


# ---------------------------------------------------------------------------
# ETAPA 5 — Exportação
# ---------------------------------------------------------------------------


def montar_pendencias(
    excecoes: pd.DataFrame,
    sem_par: pd.DataFrame,
    fuzzy_pend: pd.DataFrame,
    dupes: pd.DataFrame,
    maps_total: dict[str, str],
) -> pd.DataFrame:
    partes: list[pd.DataFrame] = []

    if not excecoes.empty:
        e = excecoes.copy()
        e["categoria"] = "Não PIX"
        e["motivo"] = e.get("_historico_norm", e.get(maps_total.get("historico_total", ""), ""))
        partes.append(e)

    if not sem_par.empty:
        s = sem_par.copy()
        if "categoria" not in s.columns:
            s["categoria"] = "PIX sem par"
        partes.append(s)

    if not fuzzy_pend.empty:
        partes.append(fuzzy_pend)

    if not dupes.empty:
        d = dupes.copy()
        if "categoria" not in d.columns:
            d["categoria"] = "Duplicata descartada"
        partes.append(d)

    if not partes:
        return pd.DataFrame(columns=["categoria", "motivo"])

    out = pd.concat(partes, ignore_index=True, sort=False)
    # Colunas legíveis
    keep = [c for c in out.columns if not c.startswith("_")]
    return out[keep]


def exportar(
    sucesso: pd.DataFrame,
    pendencias: pd.DataFrame,
    output_dir: Path,
    *,
    mes_slug: str | None = None,
) -> tuple[Path, Path]:
    output_dir.mkdir(parents=True, exist_ok=True)

    def _dest(nome: str) -> Path:
        if mes_slug:
            from lib_paths import arquivo_mes

            return output_dir / arquivo_mes(mes_slug, nome)
        return output_dir / nome

    path_ok = _dest("Consolidado_SPCA_Sucesso.xlsx")
    path_pend = _dest("Pendencias_e_Inconsistencias.xlsx")

    cols_sucesso = [
        "Data",
        "Valor",
        "Documento",
        "Histórico",
        "Nome do Doador",
        "CPF Válido",
        "CNPJ",
        "Tipo de Pessoa",
        "Nome_PIX_original",
        "Score_fuzzy",
        "Metodo_fuzzy",
        "Par_PIX_metodo",
    ]
    sucesso_out = sucesso.reindex(columns=[c for c in cols_sucesso if c in sucesso.columns])
    sucesso_out.to_excel(path_ok, index=False, sheet_name="Sucesso")

    pendencias.to_excel(path_pend, index=False, sheet_name="Pendencias")
    return path_ok, path_pend


# ---------------------------------------------------------------------------
# Pipeline principal
# ---------------------------------------------------------------------------


def conciliar_dataframes(
    df_total: pd.DataFrame,
    df_pix: pd.DataFrame,
    df_pessoas: pd.DataFrame,
    output_dir: Path,
    *,
    mes_civil: int | None = None,
    ano: int | None = None,
    meta: dict[str, Any] | None = None,
    cache_dir: Path | None = None,
    excel_mensal: bool = False,
) -> dict[str, Any]:
    used: set[str] = set()
    maps_total = map_columns(
        df_total,
        ["data_total", "valor_total", "documento_total", "historico_total"],
        used,
    )
    used_pix: set[str] = set()
    maps_pix = map_columns(
        df_pix,
        ["data_pix", "hora_pix", "valor_pix", "nome_pix", "cpf_pix"],
        used_pix,
    )
    used_pessoas: set[str] = set()
    maps_pessoas = map_columns(
        df_pessoas,
        ["nome_pessoa", "cpf_pessoa", "cnpj_pessoa", "tipo_pessoa", "status_pessoa"],
        used_pessoas,
    )

    required_total = {"data_total", "valor_total", "documento_total", "historico_total"}
    required_pix = {"data_pix", "hora_pix", "valor_pix", "nome_pix"}
    required_pessoas = {"nome_pessoa"}

    missing = (
        required_total - set(maps_total)
        | required_pix - set(maps_pix)
        | required_pessoas - set(maps_pessoas)
    )
    if missing:
        raise ValueError(f"Colunas não detectadas: {missing}")

    filtro_mes: dict[str, int] = {}
    if mes_civil is not None and ano is not None:
        df_total, filtro_mes = filtrar_extrato_mes_civil(
            df_total,
            maps_total["data_total"],
            mes_civil,
            ano,
        )

    pessoas_limpa, dupes = limpar_pessoas(df_pessoas, maps_pessoas)
    total_pix, excecoes = filtrar_extrato_total(df_total, maps_total)
    pareados, sem_par = parear_total_pix(total_pix, df_pix, maps_total, maps_pix)
    sucesso, fuzzy_pend = cruzar_pessoas(pareados, pessoas_limpa)
    pendencias = montar_pendencias(excecoes, sem_par, fuzzy_pend, dupes, maps_total)
    mes_slug = (meta or {}).get("mes_slug")
    path_ok, path_pend = exportar(sucesso, pendencias, output_dir, mes_slug=mes_slug)

    path_export = ""
    if excel_mensal:
        from lib_export_mensal import exportar_planilha_mensal

        path_export = str(
            exportar_planilha_mensal(
                output_dir,
                pendencias=pendencias,
                excecoes=excecoes,
                stats={
                    "cred_pix": len(total_pix),
                    "sucesso": len(sucesso),
                    "pendencias": len(pendencias),
                    "excecoes": len(excecoes),
                    "sem_par": len(sem_par),
                    **filtro_mes,
                },
                meta=meta or {},
                maps_total=maps_total,
                cache_dir=cache_dir,
                mes_slug=mes_slug,
            )
        )

    return {
        "sucesso": len(sucesso),
        "pendencias": len(pendencias),
        "cred_pix": len(total_pix),
        "excecoes": len(excecoes),
        "sem_par": len(sem_par),
        "path_sucesso": str(path_ok),
        "path_pendencias": str(path_pend),
        "path_exportacao_mensal": path_export,
        "maps_total": maps_total,
        "maps_pix": maps_pix,
        "maps_pessoas": maps_pessoas,
        **filtro_mes,
    }


def conciliar(
    path_total: Path,
    path_pix: Path,
    path_pessoas: Path,
    output_dir: Path,
    *,
    mes_civil: int | None = None,
    ano: int | None = None,
    meta: dict[str, Any] | None = None,
    cache_dir: Path | None = None,
    excel_mensal: bool = False,
) -> dict[str, Any]:
    df_total = read_input(path_total)
    df_pix = read_input(path_pix)
    df_pessoas = read_input(path_pessoas)
    return conciliar_dataframes(
        df_total,
        df_pix,
        df_pessoas,
        output_dir,
        mes_civil=mes_civil,
        ano=ano,
        meta=meta,
        cache_dir=cache_dir,
        excel_mensal=excel_mensal,
    )


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Concilia doações SPCA: extrato total + PIX + cadastro pessoas"
    )
    parser.add_argument("--total", required=True, type=Path, help="CSV/XLSX extrato total")
    parser.add_argument("--pix", required=True, type=Path, help="CSV/XLSX extrato PIX")
    parser.add_argument("--pessoas", required=True, type=Path, help="CSV/XLSX cadastro pessoas")
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("./output"),
        help="Pasta de saída (padrão: ./output)",
    )
    args = parser.parse_args()

    for p, label in [(args.total, "total"), (args.pix, "pix"), (args.pessoas, "pessoas")]:
        if not p.exists():
            raise SystemExit(f"Arquivo {label} não encontrado: {p}")

    stats = conciliar(args.total, args.pix, args.pessoas, args.output)
    print("Conciliação concluída.")
    print(f"  CRED PIX processados: {stats['cred_pix']}")
    print(f"  Sucesso:              {stats['sucesso']} → {stats['path_sucesso']}")
    print(f"  Pendências:           {stats['pendencias']} → {stats['path_pendencias']}")
    print(f"  Exceções (não PIX):   {stats['excecoes']}")
    print(f"  Sem par PIX:          {stats['sem_par']}")


if __name__ == "__main__":
    main()
