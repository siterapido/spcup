"""Valida XML origemRecurso antes de enviar ao TSE.

Suporta DOIS schemas com auto-detecção:

1. FLAT (legado/testes):
   <origem>
     <data>...</data>
     <cpf>...</cpf>  (ou <cnpj>)
     <nome>...</nome>
     <agenciaDestino>...</agenciaDestino>
     <contaCorrente>...</contaCorrente>
     <vrOrigem>...</vrOrigem>
   </origem>

2. ANINHADO (real, produção TSE):
   <origem>
     <dtEntrada>...</dtEntrada>
     <vrOrigem>...</vrOrigem>
     <origemRecurso>
       <pessoaFisica>          (ou <pessoaJuridica>)
         <tipo>PF</tipo>
         <nrCpf>...</nrCpf>    (ou <nrCnpj>)
         <nmPessoa>...</nmPessoa>
       </pessoaFisica>
     </origemRecurso>
     <especieRecurso>
       <transferenciaEletronicaPIX>
         <contaBancariaDestino>
           <bancoDestino>
             <agenciaDestino>...</agenciaDestino>
             <contaCorrente>...</contaCorrente>
           </bancoDestino>
         </contaBancariaDestino>
       </transferenciaEletronicaPIX>
     </especieRecurso>
   </origem>

Auto-detecção: presença de <origemRecurso>, <pessoaFisica>, <pessoaJuridica>,
<contaBancariaDestino> ou <especieRecurso> dentro de <origem> indica schema aninhado.
Senão, schema flat.

Checagens comuns (qualquer schema):
- Encoding ISO-8859-1 declarado no header
- Parse OK (ElementTree)
- Namespace correto (http://www.tse.jus.br/2012/XMLSchema/origemRecurso.xsd)
- <nrCnpjPrestador> presente e 14 dígitos
- Cada <origem> tem <agenciaDestino> e <contaCorrente> preenchidos
- Cada <origem> tem CPF (11 dígitos) ou CNPJ (14 dígitos) preenchido
- Cada <origem> tem <vrOrigem> preenchido

Uso:
    .venv/bin/python scripts/validar_xml_antes_envio.py <arquivo.xml>

Exit code:
    0 = OK
    1 = erros encontrados
    2 = uso incorreto
"""
import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

NS = "{http://www.tse.jus.br/2012/XMLSchema/origemRecurso.xsd}"
EXPECTED_NS = "http://www.tse.jus.br/2012/XMLSchema/origemRecurso.xsd"

# Marcadores do schema aninhado (TSE real)
ANINHADO_MARKERS = (
    "origemRecurso",
    "pessoaFisica",
    "pessoaJuridica",
    "contaBancariaDestino",
    "especieRecurso",
    "transferenciaEletronicaPIX",
)


def _detectar_schema(origem) -> str:
    """Retorna 'aninhado' se a origem tem marcadores do schema real, senão 'flat'."""
    # Procura marcadores em qualquer nível dentro da origem
    for marker in ANINHADO_MARKERS:
        if origem.find(f".//{NS}{marker}") is not None:
            return "aninhado"
    return "flat"


def _validar_cabecalho(root) -> tuple[list[str], bool]:
    """Valida CABECALHO. Retorna (erros, deve_parar)."""
    erros: list[str] = []
    cab = root.find(f"{NS}CABECALHO")
    if cab is None:
        return (["CABECALHO ausente"], True)
    cnpj = cab.findtext(f"{NS}nrCnpjPrestador") or ""
    if not cnpj:
        erros.append("nrCnpjPrestador ausente")
    elif not re.fullmatch(r"\d{14}", cnpj):
        erros.append(f"nrCnpjPrestador inválido (não-14 dígitos): {cnpj!r}")
    return (erros, False)


def _validar_origem_flat(o, i: int) -> list[str]:
    """Valida uma origem no schema FLAT (legado)."""
    erros: list[str] = []
    ag = (o.findtext(f"{NS}agenciaDestino") or "").strip()
    cc = (o.findtext(f"{NS}contaCorrente") or "").strip()
    cpf = (o.findtext(f"{NS}cpf") or "").strip()
    cnpj_o = (o.findtext(f"{NS}cnpj") or "").strip()
    vr = (o.findtext(f"{NS}vrOrigem") or "").strip()

    if not ag:
        erros.append(f"origem #{i}: agenciaDestino vazia")
    if not cc:
        erros.append(f"origem #{i}: contaCorrente vazia")
    if not cpf and not cnpj_o:
        erros.append(f"origem #{i}: cpf e cnpj vazios")
    elif cpf and not re.fullmatch(r"\d{11}", cpf):
        erros.append(f"origem #{i}: cpf inválido (não-11 dígitos): {cpf!r}")
    if not vr:
        erros.append(f"origem #{i}: vrOrigem vazio")
    return erros


def _validar_origem_aninhada(o, i: int) -> list[str]:
    """Valida uma origem no schema ANINHADO (TSE real)."""
    erros: list[str] = []
    # vrOrigem direto na origem
    vr = (o.findtext(f"{NS}vrOrigem") or "").strip()
    if not vr:
        erros.append(f"origem #{i}: vrOrigem vazio")

    # Pessoa (física ou jurídica) dentro de origemRecurso
    pf = o.find(f".//{NS}pessoaFisica")
    pj = o.find(f".//{NS}pessoaJuridica")
    if pf is None and pj is None:
        erros.append(
            f"origem #{i}: pessoaFisica/pessoaJuridica ausente (schema aninhado)"
        )
    elif pf is not None and pj is not None:
        erros.append(
            f"origem #{i}: origem tem pessoaFisica E pessoaJuridica (apenas uma é permitida)"
        )
    elif pf is not None:
        cpf = (pf.findtext(f"{NS}nrCpf") or "").strip()
        if not cpf:
            erros.append(f"origem #{i}: pessoaFisica.nrCpf vazio")
        elif not re.fullmatch(r"\d{11}", cpf):
            erros.append(
                f"origem #{i}: pessoaFisica.nrCpf inválido (não-11 dígitos): {cpf!r}"
            )
    elif pj is not None:
        cnpj_o = (pj.findtext(f"{NS}nrCnpj") or "").strip()
        if not cnpj_o:
            erros.append(f"origem #{i}: pessoaJuridica.nrCnpj vazio")
        elif not re.fullmatch(r"\d{14}", cnpj_o):
            erros.append(
                f"origem #{i}: pessoaJuridica.nrCnpj inválido (não-14 dígitos): {cnpj_o!r}"
            )

    # Agência e conta dentro de bancoDestino
    banco = o.find(f".//{NS}bancoDestino")
    if banco is None:
        erros.append(
            f"origem #{i}: bancoDestino ausente (schema aninhado - caminho especieRecurso/.../bancoDestino)"
        )
    else:
        ag = (banco.findtext(f"{NS}agenciaDestino") or "").strip()
        cc = (banco.findtext(f"{NS}contaCorrente") or "").strip()
        if not ag:
            erros.append(
                f"origem #{i}: bancoDestino.agenciaDestino vazia"
            )
        if not cc:
            erros.append(
                f"origem #{i}: bancoDestino.contaCorrente vazia"
            )
    return erros


def validar(path: Path) -> list[str]:
    """Retorna lista de erros. Lista vazia = OK."""
    erros: list[str] = []
    raw = path.read_bytes()

    # 1. Encoding
    head = raw[:120].decode("iso-8859-1", errors="replace")
    if "ISO-8859-1" not in head:
        erros.append("Encoding deve ser ISO-8859-1 (TSE rejeita UTF-8 em alguns parsers)")

    # 2. Parse + namespace
    try:
        root = ET.fromstring(raw)
    except ET.ParseError as e:
        erros.append(f"ParseError: {e}")
        return erros  # sem sentido continuar
    if root.tag != f"{NS}spcaImportacaoArquivo":
        erros.append(f"Namespace errado: esperado {EXPECTED_NS}, achou {root.tag}")

    # 3. CABECALHO + CNPJ do prestador
    cab_erros, parar = _validar_cabecalho(root)
    erros.extend(cab_erros)
    if parar:
        return erros

    # 4. Cada <origem>
    origens = root.findall(f".//{NS}origem")
    for i, o in enumerate(origens, 1):
        schema = _detectar_schema(o)
        if schema == "aninhado":
            erros.extend(_validar_origem_aninhada(o, i))
        else:
            erros.extend(_validar_origem_flat(o, i))

    return erros


def main():
    if len(sys.argv) < 2:
        print("Uso: validar_xml_antes_envio.py <arquivo.xml>", file=sys.stderr)
        sys.exit(2)
    path = Path(sys.argv[1])
    if not path.exists():
        print(f"❌ Arquivo não encontrado: {path}", file=sys.stderr)
        sys.exit(1)
    erros = validar(path)
    if erros:
        print(f"❌ {len(erros)} erro(s) em {path.name}:", file=sys.stderr)
        for e in erros:
            print(f"  - {e}", file=sys.stderr)
        sys.exit(1)
    print(f"✅ XML válido: {path}")


if __name__ == "__main__":
    main()
