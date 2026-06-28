#!/usr/bin/env python3
"""NotebookLM (CLI `nlm`) — extração de PDFs para JSON da conciliação SPCA V2."""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any

from lib_paths import (
    carregar_meses,
    exportar_cadastro_csv,
    listar_pdfs,
    MODELO_BB_UNIFICADO,
    MODELO_CAIXA_1,
    normalizar_modelo_extrato,
    resolver_cadastro,
    resolver_mes,
)

NLM = os.environ.get("NLM_PATH", os.path.expanduser("~/.local/bin/nlm"))
TIMEOUT = int(os.environ.get("NLM_QUERY_TIMEOUT", "300"))

CACHE_NLM_ARQUIVOS = (
    "nlm_transacoes.json",
    "nlm_meta.json",
    "fontes.json",
    "nlm_pessoas.json",
    "cadastro_pessoas.csv",
)


def limpar_cache_nlm(cache_dir: Path) -> None:
    """Remove artefatos de extração anteriores — NLM sempre roda do zero."""
    if not cache_dir.is_dir():
        return
    for nome in CACHE_NLM_ARQUIVOS:
        alvo = cache_dir / nome
        if alvo.is_file():
            alvo.unlink()


def inferir_direcao(transacao: dict[str, Any]) -> str:
    raw = str(transacao.get("direcao") or transacao.get("natureza") or "").strip().lower()
    if raw in ("entrada", "credito", "crédito", "credit", "in"):
        return "entrada"
    if raw in ("saida", "saída", "debito", "débito", "debit", "out"):
        return "saida"

    tipo = str(transacao.get("tipo_pix") or transacao.get("tipo") or "").lower()
    if any(
        k in tipo
        for k in (
            "deb ",
            "deb.",
            "debito",
            "débito",
            "pag ",
            "pagamento",
            "pix enviado",
            "enviado",
            "envio",
            "saída",
            "saida",
            "ted env",
            "tev deb",
            "transferencia enviada",
            "transferência enviada",
        )
    ):
        return "saida"
    if "envi" in tipo and "pix" in tipo:
        return "saida"
    return "entrada"


def is_saida(transacao: dict[str, Any]) -> bool:
    return inferir_direcao(transacao) == "saida"


def is_nlm_pix_recebido(transacao: dict[str, Any]) -> bool:
    if is_saida(transacao):
        return False
    tipo = str(transacao.get("tipo_pix") or transacao.get("tipo") or "").lower()
    if "pix" in tipo:
        return "envi" not in tipo
    
    # Se "pix" está no nome do arquivo de origem, e não é saída, é pix recebido
    origem = str(transacao.get("origem_arquivo") or "").lower()
    if "pix" in origem:
        return True
        
    return False


def normalizar_payload_nlm(payload: dict[str, Any]) -> dict[str, Any]:
    transacoes = payload.get("transacoes", [])
    for tx in transacoes:
        tx["direcao"] = inferir_direcao(tx)
    payload["transacoes"] = transacoes
    return payload


def origem_contem_pdf(origem: str, pdfs: list[str] | set[str]) -> bool:
    alvo = str(origem or "").strip().lower()
    if not alvo:
        return False
    nomes = {p.strip().lower() for p in pdfs}
    if alvo in nomes:
        return True
    return any(nome in alvo for nome in nomes)


def _dias_entre_datas(a: Any, b: Any) -> int | None:
    from datetime import date

    def _parse(valor: Any) -> date | None:
        texto = str(valor or "").strip()
        if not texto:
            return None
        try:
            return date.fromisoformat(texto[:10])
        except ValueError:
            return None

    data_a, data_b = _parse(a), _parse(b)
    if not data_a or not data_b:
        return None
    return abs((data_a - data_b).days)


def complementar_nomes_total_com_pix(
    transacoes: list[dict[str, Any]],
    pdfs_total: list[str],
    pdfs_pix: list[str],
    *,
    tolerancia_dias: int = 3,
) -> int:
    complementados = 0
    linhas_pix = [
        {
            "data": tx.get("data"),
            "valor": tx.get("valor"),
            "nome": str(tx.get("remetente_destinatario") or "").strip(),
            "cpf_cnpj": str(tx.get("cpf_cnpj_extrato") or "").strip(),
            "numero_documento": str(tx.get("numero_documento") or "").strip(),
        }
        for tx in transacoes
        if origem_contem_pdf(str(tx.get("origem_arquivo") or ""), pdfs_pix)
        and str(tx.get("remetente_destinatario") or "").strip()
    ]

    for tx in transacoes:
        if not origem_contem_pdf(str(tx.get("origem_arquivo") or ""), pdfs_total):
            continue
        if not is_nlm_pix_recebido(tx):
            continue
        if str(tx.get("remetente_destinatario") or "").strip():
            continue
        doc_total = str(tx.get("numero_documento") or "").strip()
        if doc_total:
            por_doc = [pix for pix in linhas_pix if pix.get("numero_documento") == doc_total]
            if len(por_doc) == 1:
                tx["remetente_destinatario"] = por_doc[0]["nome"]
                if por_doc[0]["cpf_cnpj"]:
                    tx["cpf_cnpj_extrato"] = por_doc[0]["cpf_cnpj"]
                complementados += 1
                continue
        valor_total = float(tx.get("valor") or 0)
        candidatos = []
        for pix in linhas_pix:
            if round(float(pix.get("valor") or 0), 2) != round(valor_total, 2):
                continue
            dias = _dias_entre_datas(tx.get("data"), pix.get("data"))
            if dias is not None and dias <= tolerancia_dias:
                candidatos.append(pix)
        if len(candidatos) == 1:
            tx["remetente_destinatario"] = candidatos[0]["nome"]
            if candidatos[0]["cpf_cnpj"]:
                tx["cpf_cnpj_extrato"] = candidatos[0]["cpf_cnpj"]
            complementados += 1
            continue
        mesma_data = [p for p in candidatos if p.get("data") == tx.get("data")]
        if len(mesma_data) == 1:
            tx["remetente_destinatario"] = mesma_data[0]["nome"]
            if mesma_data[0]["cpf_cnpj"]:
                tx["cpf_cnpj_extrato"] = mesma_data[0]["cpf_cnpj"]
            complementados += 1
    return complementados


def run_nlm(args: list[str]) -> str:
    cmd = [NLM, *args]
    proc = subprocess.run(cmd, capture_output=True, text=True, check=False)
    saida = (proc.stdout or proc.stderr or "").strip()
    if proc.returncode != 0:
        raise RuntimeError(f"nlm falhou ({' '.join(cmd)}): {saida}")
    if saida.startswith("{"):
        dados = json.loads(saida)
        if dados.get("status") == "error":
            raise RuntimeError(dados.get("error") or saida)
    return proc.stdout.strip()


def listar_notebooks() -> list[dict]:
    return json.loads(run_nlm(["notebook", "list", "--json"]))


def obter_ou_criar_notebook(titulo: str) -> str:
    for nb in listar_notebooks():
        if str(nb.get("title", "")).strip().lower() == titulo.lower():
            return str(nb["id"])
    dados = json.loads(run_nlm(["notebook", "create", titulo, "--json"]))
    for chave in ("notebook_id", "id"):
        if dados.get(chave):
            return str(dados[chave])
    if dados.get("notebook", {}).get("id"):
        return str(dados["notebook"]["id"])
    raise RuntimeError(f"Resposta sem notebook id: {dados}")


def listar_fontes(notebook_id: str) -> list[dict]:
    return json.loads(run_nlm(["source", "list", notebook_id, "--json"]))


def fonte_existe(fontes: list[dict], nome_arquivo: str) -> bool:
    alvo = nome_arquivo.strip().lower()
    return any(str(f.get("title", "")).strip().lower() == alvo for f in fontes)


def _caminho_sem_espacos_para_nlm(caminho: Path) -> Path:
    """NLM CLI quebra paths com espaço no diretório — copia para staging em /tmp."""
    if " " not in str(caminho):
        return caminho
    staging = Path("/tmp/spca-nlm-upload")
    staging.mkdir(parents=True, exist_ok=True)
    destino = staging / caminho.name
    shutil.copy2(caminho, destino)
    return destino


def subir_arquivo(notebook_id: str, caminho: Path) -> None:
    fontes = listar_fontes(notebook_id)
    if fonte_existe(fontes, caminho.name):
        return
    upload = _caminho_sem_espacos_para_nlm(caminho.resolve())
    run_nlm(["source", "add", notebook_id, "--file", str(upload), "--wait"])


def _parse_json_flex(texto: str) -> dict:
    """NLM às vezes retorna JSON malformado — aplica reparos comuns."""
    variantes = [texto]
    sem_trailing = re.sub(r",\s*([}\]])", r"\1", texto)
    if sem_trailing != texto:
        variantes.append(sem_trailing)
    entre_objs = re.sub(r"\}\s*\{", r"},{", sem_trailing)
    if entre_objs not in variantes:
        variantes.append(entre_objs)
    sem_trailing2 = re.sub(r",\s*([}\]])", r"\1", entre_objs)
    if sem_trailing2 not in variantes:
        variantes.append(sem_trailing2)

    ultimo: json.JSONDecodeError | None = None
    for candidato in variantes:
        try:
            return json.loads(candidato)
        except json.JSONDecodeError as exc:
            ultimo = exc
    if ultimo is not None:
        raise ultimo
    raise json.JSONDecodeError("JSON vazio", texto, 0)


def extrair_json_resposta(resposta: dict | str) -> dict:
    if isinstance(resposta, str):
        texto = resposta.strip()
    else:
        texto = str(resposta.get("answer") or resposta.get("response") or resposta).strip()

    texto = re.sub(r"^```(?:json)?\s*", "", texto)
    texto = re.sub(r"\s*```$", "", texto)
    inicio = texto.find("{")
    fim = texto.rfind("}")
    if inicio == -1 or fim == -1:
        raise RuntimeError(f"Resposta sem JSON: {texto[:500]}")
    return _parse_json_flex(texto[inicio : fim + 1])


def consultar_notebook(notebook_id: str, prompt: str, *, max_tentativas: int = 3) -> dict:
    ultimo_erro: Exception | None = None
    for tentativa in range(1, max_tentativas + 1):
        try:
            out = run_nlm(
                [
                    "query",
                    "notebook",
                    notebook_id,
                    prompt,
                    "--json",
                    "--timeout",
                    str(TIMEOUT),
                ]
            )
            return extrair_json_resposta(json.loads(out))
        except (RuntimeError, json.JSONDecodeError) as exc:
            ultimo_erro = exc
            if tentativa < max_tentativas:
                continue
    raise ultimo_erro or RuntimeError("NLM falhou sem detalhe")


def _prompt_pdf_bb_unificado(nome_pdf: str) -> str:
    return f"""Você extrai transações de extrato bancário Banco do Brasil (formato unificado) para prestação de contas SPCA.

Analise APENAS o PDF "{nome_pdf}" deste notebook. Ignore completamente os outros PDFs.

Este extrato combina em cada lançamento PIX:
- Dt. movimento (data do balancete na conta) — campo "data"
- Linha de detalhe abaixo: MM/DD HH:MM + CPF/CNPJ (11 ou 14 dígitos) + nome — use data_pix, hora, cpf_cnpj_extrato e remetente_destinatario
- Histórico "Pix - Recebido" (código 821)
- Documento longo (E2E) — NÃO use como numero_documento
- numero_documento = DDHHMM da linha de detalhe (dia 2 dígitos + hora 2 + minuto 2). Ex.: detalhe "01/01 05:42" → "010542"

Inclua TODAS as movimentações com valor:
- entradas PIX recebido, TED/TEV recebido
- saídas: PIX enviado, tarifas, débitos

Ignore saldo anterior/final.

Use cadastro_pessoas.csv como referência de nomes quando útil.

Para cada transação retorne:
- data (YYYY-MM-DD — Dt. movimento / balancete)
- data_pix (YYYY-MM-DD — data na linha de detalhe do PIX, quando diferente)
- valor (número decimal positivo)
- tipo (ex: Pix - Recebido, Pix Enviado, Tarifa)
- direcao: "entrada" ou "saida"
- hora (HH:MM:SS da linha de detalhe — obrigatório em PIX recebido)
- remetente_destinatario (nome na linha de detalhe — obrigatório em PIX recebido)
- cpf_cnpj_extrato (CPF ou CNPJ da linha de detalhe, só dígitos — obrigatório em PIX recebido)
- numero_documento (DDHHMM da linha de detalhe, NÃO o E2E longo)
- origem_arquivo: sempre exatamente "{nome_pdf}"

IMPORTANTE: responda SOMENTE com o objeto JSON abaixo. Sem texto explicativo, sem markdown, sem comentários.

Retorne APENAS JSON válido:
{{
  "transacoes": [
    {{
      "data": "2025-01-02",
      "data_pix": "2025-01-01",
      "valor": 20.0,
      "tipo": "Pix - Recebido",
      "direcao": "entrada",
      "hora": "05:42:00",
      "remetente_destinatario": "JACSON SILV",
      "cpf_cnpj_extrato": "00001381188095",
      "numero_documento": "010542",
      "origem_arquivo": "{nome_pdf}"
    }}
  ]
}}
"""


def _prompt_pdf(nome_pdf: str, *, extrato_total: bool) -> str:
    doc_regra = (
        "numero_documento (número/documento bancário DDHHMM quando visível; obrigatório no extrato total)"
        if extrato_total
        else (
            "numero_documento (ID da transação, nº documento, identificador ou E2E quando visível)"
        )
    )
    nome_regra = (
        "remetente_destinatario: OBRIGATÓRIO em entradas PIX quando o nome da contraparte "
        "aparecer no lançamento"
        if extrato_total
        else "remetente_destinatario (contraparte: quem enviou em entradas PIX recebido, ou null)"
    )
    cpf_regra = (
        "cpf_cnpj_extrato (CPF ou CNPJ da contraparte quando visível, só dígitos; opcional)"
        if extrato_total
        else "cpf_cnpj_extrato (CPF ou CNPJ da contraparte, só dígitos — OBRIGATÓRIO em PIX recebido; null se não visível)"
    )
    cpf_exemplo = "" if extrato_total else '\n      "cpf_cnpj_extrato": "12345678900",'
    return f"""Você extrai transações de extratos bancários brasileiros para prestação de contas SPCA.

Analise APENAS o PDF "{nome_pdf}" deste notebook. Ignore completamente os outros PDFs.

Inclua TODAS as movimentações com valor desse arquivo:
- entradas: PIX recebido, TED/transferência recebida, crédito (CRED PIX, CRED TEV etc.)
- saídas: PIX enviado, débitos, tarifas, transferências enviadas

Ignore saldo inicial/final e rendimentos automáticos sem contraparte.

Use cadastro_pessoas.csv como referência de nomes quando útil.

Para cada transação retorne:
- data (YYYY-MM-DD ou null)
- valor (número decimal, sempre positivo)
- tipo (ex: PIX Recebido, CRED PIX, DEB PIX, CRED TEV, Tarifa)
- direcao: "entrada" ou "saida"
- hora (HH:MM:SS da transação quando visível — obrigatório no extrato PIX)
- {nome_regra}
- {cpf_regra}
- {doc_regra}
- origem_arquivo: sempre exatamente "{nome_pdf}"

Retorne APENAS JSON válido, sem markdown:
{{{{
  "transacoes": [
    {{{{
      "data": "2025-01-01",
      "valor": 100.0,
      "tipo": "CRED PIX",
      "direcao": "entrada",
      "hora": "07:57:39",
      "remetente_destinatario": "NOME DA PESSOA",{cpf_exemplo}
      "numero_documento": "010757",
      "origem_arquivo": "{nome_pdf}"
    }}}}
  ]
}}}}
"""


def _prompt_pessoas(nome_pdf: str) -> str:
    return f"""Extraia o cadastro de pessoas do PDF "{nome_pdf}".

Analise APENAS esse arquivo. Para cada linha/pessoa retorne:
- nome (texto completo)
- documento (CPF ou CNPJ com máscara quando visível)
- tipo ("Pessoa Física" ou "Pessoa Jurídica")
- status (ex: Validado, Validar)

Retorne APENAS JSON válido, sem markdown:
{{
  "pessoas": [
    {{
      "nome": "Fulano de Tal",
      "documento": "123.456.789-00",
      "tipo": "Pessoa Física",
      "status": "Validado"
    }}
  ]
}}
"""


def extrair_por_pdf(notebook_id: str, pdf: Path, *, extrato_total: bool, bb_unificado: bool = False) -> list[dict]:
    if bb_unificado:
        prompt = _prompt_pdf_bb_unificado(pdf.name)
    else:
        prompt = _prompt_pdf(pdf.name, extrato_total=extrato_total)
    payload = consultar_notebook(notebook_id, prompt)
    payload = normalizar_payload_nlm(payload)
    transacoes = payload.get("transacoes", [])
    for tx in transacoes:
        tx["origem_arquivo"] = pdf.name
    return transacoes


def extrair_pessoas_pdf(notebook_id: str, pdf: Path) -> list[dict]:
    payload = consultar_notebook(notebook_id, _prompt_pessoas(pdf.name))
    pessoas = payload.get("pessoas", [])
    for p in pessoas:
        p["origem_arquivo"] = pdf.name
    return pessoas


def notebook_titulo(
    cfg_mes: dict[str, str],
    ano: int,
    estado_uf: str,
    escopo: str | None = None,
) -> str:
    """Um notebook por estado + ano + mês (+ escopo municipal)."""
    mes_nome = cfg_mes["nome"]
    uf = estado_uf.strip().upper()
    template = cfg_mes.get("notebook")
    if template:
        titulo = (
            template.replace("{ano}", str(ano))
            .replace("{uf}", uf)
            .replace("{estado_uf}", uf)
            .replace("{mes}", mes_nome)
        )
    else:
        titulo = f"SPCA-V2-{uf}-{ano}-{mes_nome}"
    if escopo:
        sufixo = escopo.replace("_", "-").upper()
        return f"{titulo}-{sufixo}"
    return titulo


def extrair_mes_nlm(
    paths: dict[str, Any],
    *,
    pular_nlm: bool = False,
) -> dict[str, Any]:
    """
    Extrai PDFs via NotebookLM e grava JSON em {output_dir}/.cache/.

    Por padrão limpa cache e reexecuta queries NLM (sem reuso de JSON anterior).
    `pular_nlm=True` só para debug local — não usar em produção.
    """
    cache_dir = Path(paths["cache_dir"])
    cache_dir.mkdir(parents=True, exist_ok=True)
    out_nlm = cache_dir / "nlm_transacoes.json"
    meta_path = cache_dir / "nlm_meta.json"

    if pular_nlm and out_nlm.is_file():
        return json.loads(meta_path.read_text(encoding="utf-8")) if meta_path.is_file() else {}

    limpar_cache_nlm(cache_dir)

    pdfs_total = [Path(p) for p in paths["pdfs_total"]]
    pdfs_pix = [Path(p) for p in paths["pdfs_pix"]]
    pdfs = pdfs_total + pdfs_pix
    pdf_pessoas = Path(paths["pdf_pessoas"]) if paths.get("pdf_pessoas") else None

    if not pdfs and not pdf_pessoas:
        raise FileNotFoundError("Nenhum PDF encontrado para extração NLM.")

    cfg = paths["mes_cfg"]
    titulo = notebook_titulo(
        cfg, int(paths["ano"]), str(paths["estado_uf"]), paths.get("escopo")
    )
    notebook_id = obter_ou_criar_notebook(titulo)

    cadastro_csv = cache_dir / "cadastro_pessoas.csv"
    try:
        cadastro_path = resolver_cadastro(paths["raiz"], paths["estado_uf"], paths["base_prestacao"])
        exportar_cadastro_csv(cadastro_path, cadastro_csv)
        subir_arquivo(notebook_id, cadastro_csv)
    except FileNotFoundError:
        if pdf_pessoas and pdf_pessoas.is_file():
            subir_arquivo(notebook_id, pdf_pessoas)

    for pdf in pdfs:
        subir_arquivo(notebook_id, pdf)

    lista: list[dict] = []
    por_pdf: dict[str, int] = {}
    bb_unificado = normalizar_modelo_extrato(paths.get("modelo_extrato")) == MODELO_BB_UNIFICADO
    pdfs_unicos = list(dict.fromkeys(pdfs_total + pdfs_pix))

    if bb_unificado:
        for pdf in pdfs_unicos:
            txs = extrair_por_pdf(notebook_id, pdf, extrato_total=True, bb_unificado=True)
            lista.extend(txs)
            por_pdf[pdf.name] = len(txs)
    else:
        for pdf in pdfs_total:
            txs = extrair_por_pdf(notebook_id, pdf, extrato_total=True)
            lista.extend(txs)
            por_pdf[pdf.name] = len(txs)
        for pdf in pdfs_pix:
            txs = extrair_por_pdf(notebook_id, pdf, extrato_total=False)
            lista.extend(txs)
            por_pdf[pdf.name] = len(txs)

    payload = normalizar_payload_nlm({"transacoes": lista})
    lista = payload.get("transacoes", [])
    if not bb_unificado:
        complementar_nomes_total_com_pix(
            lista,
            [p.name for p in pdfs_total],
            [p.name for p in pdfs_pix],
        )
    out_nlm.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    pessoas_nlm: list[dict] = []
    if pdf_pessoas and pdf_pessoas.is_file() and not paths.get("path_pessoas"):
        if not fonte_existe(listar_fontes(notebook_id), pdf_pessoas.name):
            subir_arquivo(notebook_id, pdf_pessoas)
        pessoas_nlm = extrair_pessoas_pdf(notebook_id, pdf_pessoas)
        (cache_dir / "nlm_pessoas.json").write_text(
            json.dumps({"pessoas": pessoas_nlm}, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )

    entradas = sum(1 for tx in lista if tx.get("direcao") == "entrada")
    saidas = sum(1 for tx in lista if tx.get("direcao") == "saida")
    meta = {
        "mes": paths["mes_slug"],
        "notebook": titulo,
        "notebook_id": notebook_id,
        "modelo_extrato": normalizar_modelo_extrato(paths.get("modelo_extrato")) or MODELO_CAIXA_1,
        "pdfs": [p.name for p in pdfs],
        "transacoes": len(lista),
        "entradas": entradas,
        "saidas": saidas,
        "por_pdf": por_pdf,
        "pessoas_nlm": len(pessoas_nlm),
        "arquivo": str(out_nlm.relative_to(paths["raiz"])),
    }
    meta_path.write_text(json.dumps(meta, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return meta


def main() -> int:
    from lib_paths import carregar_prestacao, descobrir_base_prestacao, nome_estado, raiz_projeto
    from lib_paths import resolver_fontes_mes

    parser = __import__("argparse").ArgumentParser(description="Extrai PDFs do mês via NotebookLM")
    parser.add_argument("mes", help="Slug do mês (ex: janeiro)")
    parser.add_argument("--raiz", type=Path, help="Raiz do projeto")
    parser.add_argument("--estado", help="UF ou nome")
    parser.add_argument("--ano", type=int, help="Ano da prestação")
    args = parser.parse_args()

    raiz = raiz_projeto(args.raiz)
    prestacao = carregar_prestacao(raiz)
    if not prestacao and not (args.estado and args.ano):
        print(
            json.dumps({"erro": "Configure prestacao.json ou informe --estado e --ano"}),
            file=sys.stderr,
        )
        return 1

    uf = prestacao["estado_uf"] if prestacao else __import__("lib_paths").normalizar_uf(args.estado)
    ano = int(prestacao["ano"]) if prestacao else args.ano
    paths = resolver_fontes_mes(raiz, uf, args.mes, ano)
    meta = extrair_mes_nlm(paths, pular_nlm=False)
    print(json.dumps(meta, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:  # noqa: BLE001
        print(json.dumps({"erro": str(exc)}, ensure_ascii=False), file=sys.stderr)
        raise SystemExit(1) from exc
