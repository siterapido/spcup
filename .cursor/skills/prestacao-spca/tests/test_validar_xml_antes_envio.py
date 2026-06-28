from pathlib import Path

import pytest
from validar_xml_antes_envio import validar

FIX = Path(__file__).parent / "fixtures"


def test_xml_valido_passa():
    erros = validar(FIX / "xml_valido.xml")
    assert erros == [], f"Esperava 0 erros, achou: {erros}"


def test_xml_sem_cnpj_falha():
    erros = validar(FIX / "xml_sem_cnpj.xml")
    assert any("nrCnpjPrestador" in e for e in erros), f"Faltou erro de CNPJ: {erros}"


def test_xml_com_namespace_errado_falha(tmp_path):
    p = tmp_path / "errado.xml"
    p.write_bytes(b'<?xml version="1.0" encoding="ISO-8859-1"?>\n<raiz>foo</raiz>')
    erros = validar(p)
    assert any("namespace" in e.lower() for e in erros), f"Faltou erro de namespace: {erros}"


def test_xml_com_origem_sem_cpf_falha(tmp_path):
    p = tmp_path / "semcpf.xml"
    p.write_bytes(b'''<?xml version="1.0" encoding="ISO-8859-1"?>
<spcaImportacaoArquivo xmlns="http://www.tse.jus.br/2012/XMLSchema/origemRecurso.xsd">
<CABECALHO><nrCnpjPrestador>47939572000102</nrCnpjPrestador><anoExercicio>2025</anoExercicio></CABECALHO>
<CORPO><origens>
<totalOrigem>1</totalOrigem>
<origem>
<data>2025-01-15</data>
<cpf></cpf>
<nome>JOAO</nome>
<vrOrigem>50</vrOrigem>
</origem>
</origens></CORPO>
</spcaImportacaoArquivo>''')
    erros = validar(p)
    assert any("cpf" in e.lower() or "cnpj" in e.lower() for e in erros), f"Faltou erro de cpf/cnpj: {erros}"


def test_xml_com_cpf_invalido_falha(tmp_path):
    p = tmp_path / "cpfcurto.xml"
    p.write_bytes(b'''<?xml version="1.0" encoding="ISO-8859-1"?>
<spcaImportacaoArquivo xmlns="http://www.tse.jus.br/2012/XMLSchema/origemRecurso.xsd">
<CABECALHO><nrCnpjPrestador>47939572000102</nrCnpjPrestador><anoExercicio>2025</anoExercicio></CABECALHO>
<CORPO><origens>
<totalOrigem>1</totalOrigem>
<origem>
<data>2025-01-15</data>
<cpf>123</cpf>
<nome>JOAO</nome>
<agenciaDestino>0141</agenciaDestino>
<contaCorrente>000123</contaCorrente>
<vrOrigem>50</vrOrigem>
</origem>
</origens></CORPO>
</spcaImportacaoArquivo>''')
    erros = validar(p)
    assert any("cpf" in e.lower() and "inv" in e.lower() for e in erros), f"Faltou erro de cpf inválido: {erros}"


def test_xml_com_agencia_vazia_falha(tmp_path):
    p = tmp_path / "semag.xml"
    p.write_bytes(b'''<?xml version="1.0" encoding="ISO-8859-1"?>
<spcaImportacaoArquivo xmlns="http://www.tse.jus.br/2012/XMLSchema/origemRecurso.xsd">
<CABECALHO><nrCnpjPrestador>47939572000102</nrCnpjPrestador><anoExercicio>2025</anoExercicio></CABECALHO>
<CORPO><origens>
<totalOrigem>1</totalOrigem>
<origem>
<data>2025-01-15</data>
<cpf>12345678901</cpf>
<nome>JOAO</nome>
<agenciaDestino></agenciaDestino>
<contaCorrente>000123</contaCorrente>
<vrOrigem>50</vrOrigem>
</origem>
</origens></CORPO>
</spcaImportacaoArquivo>''')
    erros = validar(p)
    assert any("agencia" in e.lower() for e in erros), f"Faltou erro de agência: {erros}"


def test_xml_com_encoding_errado_falha(tmp_path):
    p = tmp_path / "utf8.xml"
    p.write_bytes('<?xml version="1.0" encoding="UTF-8"?>\n<spcaImportacaoArquivo xmlns="http://www.tse.jus.br/2012/XMLSchema/origemRecurso.xsd"><CABECALHO><nrCnpjPrestador>47939572000102</nrCnpjPrestador></CABECALHO><CORPO><origens><totalOrigem>0</totalOrigem></origens></CORPO></spcaImportacaoArquivo>'.encode("utf-8"))
    erros = validar(p)
    assert any("encoding" in e.lower() or "iso-8859" in e.lower() for e in erros), f"Faltou erro de encoding: {erros}"


# === Testes do schema ANINHADO (TSE real) ===

def test_xml_aninhado_valido_passa():
    erros = validar(FIX / "xml_aninhado_valido.xml")
    assert erros == [], f"Esperava 0 erros, achou: {erros}"


def test_xml_aninhado_sem_cpf_falha(tmp_path):
    # PessoaFisica com nrCpf vazio
    p = tmp_path / "aninhado_sem_cpf.xml"
    p.write_bytes(b'''<?xml version="1.0" encoding="ISO-8859-1"?>
<spcaImportacaoArquivo xmlns="http://www.tse.jus.br/2012/XMLSchema/origemRecurso.xsd">
<CABECALHO><nrCnpjPrestador>47939572000102</nrCnpjPrestador><anoExercicio>2025</anoExercicio></CABECALHO>
<CORPO><origens>
<totalOrigem>1</totalOrigem>
<origem>
<dtEntrada>2025-01-15</dtEntrada>
<vrOrigem>50.00</vrOrigem>
<origemRecurso>
<pessoaFisica><tipo>PF</tipo><nrCpf></nrCpf><nmPessoa>JOAO</nmPessoa></pessoaFisica>
</origemRecurso>
<especieRecurso>
<transferenciaEletronicaPIX>
<contaBancariaDestino>
<bancoDestino><agenciaDestino>0141</agenciaDestino><contaCorrente>000123</contaCorrente></bancoDestino>
</contaBancariaDestino>
</transferenciaEletronicaPIX>
</especieRecurso>
</origem>
</origens></CORPO>
</spcaImportacaoArquivo>''')
    erros = validar(p)
    assert any("cpf" in e.lower() or "pessoafisica" in e.lower() for e in erros), f"Faltou erro de CPF: {erros}"


def test_xml_aninhado_pessoa_juridica_sem_cnpj_falha(tmp_path):
    # PJ aninhada com cnpj vazio
    p = tmp_path / "pj_sem_cnpj.xml"
    p.write_bytes(b'''<?xml version="1.0" encoding="ISO-8859-1"?>
<spcaImportacaoArquivo xmlns="http://www.tse.jus.br/2012/XMLSchema/origemRecurso.xsd">
<CABECALHO><nrCnpjPrestador>47939572000102</nrCnpjPrestador><anoExercicio>2025</anoExercicio></CABECALHO>
<CORPO><origens>
<totalOrigem>1</totalOrigem>
<origem>
<dtEntrada>2025-01-15</dtEntrada>
<vrOrigem>1000.00</vrOrigem>
<origemRecurso>
<pessoaJuridica><tipo>PJ</tipo><nrCnpj></nrCnpj><nmPessoa>EMPRESA X</nmPessoa></pessoaJuridica>
</origemRecurso>
<especieRecurso>
<transferenciaEletronicaPIX>
<contaBancariaDestino>
<bancoDestino><agenciaDestino>0141</agenciaDestino><contaCorrente>000123</contaCorrente></bancoDestino>
</contaBancariaDestino>
</transferenciaEletronicaPIX>
</especieRecurso>
</origem>
</origens></CORPO>
</spcaImportacaoArquivo>''')
    erros = validar(p)
    assert any("cnpj" in e.lower() or "pessoajuridica" in e.lower() for e in erros), f"Faltou erro de CNPJ PJ: {erros}"


def test_xml_schema_indeterminado_avisa(tmp_path):
    # XML que tem marcadores aninhados mas incompletos — sem pessoaFisica, sem pessoaJuridica,
    # sem bancoDestino. O validador vai detectar "aninhado" pelos marcadores
    # (especieRecurso) e gerar erros explicando os campos faltantes.
    p = tmp_path / "indeterminado.xml"
    p.write_bytes(b'''<?xml version="1.0" encoding="ISO-8859-1"?>
<spcaImportacaoArquivo xmlns="http://www.tse.jus.br/2012/XMLSchema/origemRecurso.xsd">
<CABECALHO><nrCnpjPrestador>47939572000102</nrCnpjPrestador><anoExercicio>2025</anoExercicio></CABECALHO>
<CORPO><origens>
<totalOrigem>1</totalOrigem>
<origem>
<dtEntrada>2025-01-15</dtEntrada>
<vrOrigem>50.00</vrOrigem>
<especieRecurso>
<transferenciaEletronicaPIX>
<contaBancariaDestino>
<bancoDestino>
<agenciaDestino>0141</agenciaDestino>
<contaCorrente>000123</contaCorrente>
</bancoDestino>
</contaBancariaDestino>
</transferenciaEletronicaPIX>
</especieRecurso>
</origem>
</origens></CORPO>
</spcaImportacaoArquivo>''')
    erros = validar(p)
    # Tem marcador aninhado (especieRecurso) mas falta pessoaFisica/pessoaJuridica
    assert any("pessoafisica" in e.lower() or "pessoajuridica" in e.lower() or "aninhado" in e.lower() for e in erros), f"Faltou aviso de schema aninhado incompleto: {erros}"
