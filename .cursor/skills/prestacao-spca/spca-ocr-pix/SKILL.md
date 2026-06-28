---
name: spca-ocr-pix
description: OCR complementar ao NLM para extratos PIX escaneados da Caixa (Bahia). Diagnóstico de PDFs mergeados incompletos, extração de transações faltantes, remontagem de PDFs.
---

# OCR para Extratos PIX Escaneados (Caixa)

PDFs da Caixa Econômica Federal (Bahia) são imagens escaneadas — 0 chars de texto
via pymupdf. O NotebookLM é a ferramenta primária, mas o OCR com pytesseract serve
como validação de cobertura e extração complementar.

## Setup

```bash
brew install tesseract
.venv/bin/pip install pytesseract pdf2image Pillow
```

## Extração de transações PIX

```python
from pdf2image import convert_from_path
import pytesseract, re

images = convert_from_path('Bahia/fontes/2025-novembro-pix.pdf', dpi=300)
for img in images:
    text = pytesseract.image_to_string(img, lang='eng')
    for m in re.finditer(
        r'(\d{2}/\d{2}/\d{4})\s+(\d{2}:\d{2}:\d{2})\s+'
        r'(RECEBIDO|ENVIADO)\s+EFETIVADO\s+(.+?)\s+R\$\s*([\d.,]+)',
        text, re.IGNORECASE
    ):
        print(m.group(1), m.group(2), m.group(4), m.group(5))
```

Formato do extrato PIX Caixa: `DD/MM/YYYY HH:MM:SS RECEBIDO EFETIVADO NOME R$ X.XXX,XX`.
Use `lang='eng'` (números e nomes OK; acentos viram ASCII, fuzzy resolve depois).

## PDFs mergeados vs páginas individuais

As páginas individuais em `Prestação de contas - {Estado}/Extrato total PIX/{Mês}/`
(`pagina 1.pdf`, `pagina 2.pdf`) podem conter transações que o PDF mergeado em
`fontes/2025-{mes}-pix.pdf` não incluiu.

**Sintoma:** muitos "PIX sem par" concentrados nos dias 01-03 de cada mês.

**Diagnóstico:** comparar dias cobertos via OCR nas individuais vs mergeado.

**Correção — remontar PDF mergeado:**

```bash
.venv/bin/python -c "
import fitz, os
mes_dir = 'Bahia/Prestação de contas -  Bahia/Extrato total PIX/Novembro'
pdfs = sorted([f for f in os.listdir(mes_dir) if f.endswith('.pdf')])
merged = fitz.open()
for pdf_file in pdfs:
    doc = fitz.open(f'{mes_dir}/{pdf_file}')
    merged.insert_pdf(doc)
    doc.close()
merged.save('Bahia/fontes/2025-novembro-pix.pdf')
merged.close()
print(f'{len(pdfs)} páginas mergeadas')
"
```

Fazer para **todos os meses**. Após recriar, limpar cache e rodar
`processar_todos --forcar`.

## Planilhado: estrutura esperada

O fallback do planilhado em `lib_paths.py` espera `Planilhado/{Mês}/*.xlsx`
(subpasta por mês), NÃO arquivos soltos em `Planilhado/`.

## Caso real: Bahia 2025

- 141 "PIX sem par" em 9 meses — extrato PIX não cobria dias 01-03
- Causa: pagina2.pdf (dias 01-04, 20 RECEBIDOs em novembro) fora do mergeado
- Correção: remontar 12 PDFs PIX com páginas individuais
- Ganho: +111 transações PIX recuperadas (abril +9, julho +12, maio +41,
  março +29, novembro +20)

## Scripts no projeto

- `scripts/ocr_extrair_pix.py` — extrai transações das páginas individuais via OCR
- `scripts/ocr_mesclar_pix.py` — mescla OCR + planilhado existente, gera xlsx completo
