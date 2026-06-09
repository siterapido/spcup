import dotenv from "dotenv";
dotenv.config();

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const prompt = `Você concilia transações bancárias de prestação de contas partidária no Brasil.
Analise apenas o extrato bancário nomeado "9227bb20-892d-40f8-8eaf-22a54060739c_Extrato Jan PIX (1).pdf" neste notebook. Use os arquivos de cadastro (PF/PJ) e documentos de regras formais do SPCA/TSE contidos neste notebook para cruzamento e classificação.
Extraia todas as transações (lançamentos) de débito e crédito presentes apenas neste extrato. Não inclua transações de outros extratos bancários presentes no notebook.

Sua prioridade máxima é cruzar e identificar cada transação com os candidatos/pessoas cadastrados no arquivo "cadastro_pessoas_db.csv".
Regras de match e preenchimento de candidato:
1. Consulte ativamente o arquivo "cadastro_pessoas_db.csv" que contém as colunas (tipo, documento, nome) para buscar os candidatos do banco de dados (por aproximação de nome, aliases, trechos de nome ou correspondência de CPF/CNPJ).
2. Se houver correspondência (match) de nome ou documento com uma linha de "cadastro_pessoas_db.csv", retorne obrigatoriamente:
   - "documento_candidato": O documento exato da linha correspondente no "cadastro_pessoas_db.csv" (apenas números: 11 dígitos para CPF, 14 para CNPJ).
   - "nome_candidato": O nome exato da linha correspondente no "cadastro_pessoas_db.csv".
3. Se não houver nenhuma correspondência no arquivo "cadastro_pessoas_db.csv", procure também em outros arquivos de cadastro locais presentes no notebook.
4. Caso a transação NÃO corresponda a nenhuma pessoa em "cadastro_pessoas_db.csv" ou outros cadastros do notebook:
   - Se o extrato/descrição contiver um CPF ou CNPJ explícito, retorne esse documento em "documento_candidato" e o nome do favorecido/pagador (extraído da descrição) em "nome_candidato".
   - Se NÃO houver CPF/CNPJ explícito na descrição e nenhum match foi feito, retorne "documento_candidato" como null e "nome_candidato" como o nome do favorecido/pagador extraído da descrição (ou null caso não seja identificável).

Determine também a Fonte de Recurso, a Natureza de Recurso e o Tipo Origem do Recurso para a transação, utilizando os documentos de regras do SPCA e a tabela de códigos abaixo para maior precisão jurídica.

Tabela de Códigos SPCA para Referência:

1. Fonte de Recurso (fonte_recurso):
- FP: Fundo Partidário
- OR: Outros Recursos
- RC: Recurso de Campanha
- FEFC: Fundo Especial de Financiamento de Campanha

2. Natureza de Recurso (natureza_recurso):
- 0: Financeiro
- 1: Estimável em dinheiro

3. Tipo Origem do Recurso (tipo_origem_recurso):
- CE: Candidato/Comitê - Recursos Próprios
- CF: Candidato - Doação de Outros Candidatos / Comitês
- PF: Pessoa Física
- PJ: Pessoa Jurídica
- PP: Partido Político
- CA: Comercialização
- NI: Não Identificado

Preencha remetente_destinatario somente a partir da coluna mapeada como remetente_destinatario (quando informada no layout de colunas); não extraia esse valor da descrição.

Regras adicionais para campos de extração:
- documento: o número do lançamento ou documento do extrato (distinct de documento_candidato).
- historico: o conteúdo integral da coluna de histórico do extrato.
- hora: hora do lançamento (se disponível).
- tipo_pix: tipo do PIX (ex: 'Enviado', 'Recebido').
- situacao: a situação do lançamento (ex: 'Efetivado').
- saldo: o valor do saldo após o lançamento.
- pagina: o número da página no PDF (de 1 a N) onde esta transação aparece.
- indice_linha: o índice sequencial da transação naquela página específica, começando em 1 para cada nova página.

Extraia também os metadados de saldos do extrato bancário.
Retorne APENAS um objeto JSON válido (sem explicações ou marcações markdown como \`\`\`json). O objeto deve ter o seguinte formato exato:
{
  "saldo_inicial": 1000.00,
  "saldo_final": 1500.00,
  "total_debitos": 500.00,
  "total_creditos": 1000.00,
  "transacoes": [
    {
      "data": "YYYY-MM-DD",
      "valor": 1250.50,
      "direcao": "CREDITO" | "DEBITO",
      "descricao": "Descrição original da transação",
      "pagina": 1,
      "indice_linha": 1,
      "documento_candidato": "CPF ou CNPJ do candidato correspondente (somente números, ou null)",
      "nome_candidato": "Nome ou Razão Social do candidato correspondente (ou null)",
      "remetente_destinatario": "Nome da coluna Remetente/Destinatário (ou null)",
      "fonte_recurso": "Código da fonte de recurso (ex: 'FP', 'OR', 'RC', 'FEFC' ou null)",
      "natureza_recurso": "Código da natureza de recurso (ex: '0', '1' ou null)",
      "tipo_origem_recurso": "Código do tipo de origem do recurso (ex: 'CE', 'CF', 'PF', 'PJ', 'PP', 'CA', 'NI' ou null)",
      "documento": "Número do documento / lançamento do extrato (ou null)",
      "historico": "Conteúdo integral da coluna de histórico (ou null)",
      "hora": "Hora da transação (ex: 'HH:MM', ou null)",
      "tipo_pix": "Tipo de PIX (ou null)",
      "situacao": "Situação do lançamento (ou null)",
      "saldo": "Valor do saldo após o lançamento (ou null)"
    }
  ]
}

---
Layout de colunas informado pelo operador (índice 0 = esquerda). Aplique em todas as páginas deste extrato:
coluna 0 = data (rótulo "Data") [faixa horizontal 0%-16% da página]
coluna 1 = hora [faixa horizontal 16%-25% da página]
coluna 2 = historico [faixa horizontal 26%-38% da página]
coluna 3 = situacao [faixa horizontal 38%-50% da página]
coluna 4 = valor [faixa horizontal 81%-100% da página]
coluna 4 = remetente_destinatario [faixa horizontal 50%-81% da página]
Direção ENTRADA/SAIDA: inferir pelo sinal ou natureza da coluna valor.
--- --json`;

async function main() {
  console.log("Executing exact nlm query...");
  try {
    const { stdout, stderr } = await execFileAsync("nlm", ["query", "notebook", "326dffba-1f82-4f7b-9023-62223ccab40d", prompt, "--json"]);
    console.log("SUCCESS!");
    console.log("STDOUT:", stdout);
    console.log("STDERR:", stderr);
  } catch (err: any) {
    console.log("FAILED!");
    console.log("Code:", err.code);
    console.log("Signal:", err.signal);
    console.log("Message:", err.message);
    if (err.stdout) console.log("Stdout:", err.stdout);
    if (err.stderr) console.log("Stderr:", err.stderr);
  }
}

main().catch(console.error);
