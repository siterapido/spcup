import dotenv from "dotenv";
dotenv.config();

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const notebookId = "326dffba-1f82-4f7b-9023-62223ccab40d";

async function testPrompt(name: string, promptText: string) {
  console.log(`Testing ${name}...`);
  try {
    const { stdout } = await execFileAsync("nlm", ["query", "notebook", notebookId, promptText, "--json"]);
    console.log(`  ${name} SUCCESS! Length: ${stdout.length}`);
  } catch (err: any) {
    console.log(`  ${name} FAILED:`);
    console.log(`    Message: ${err.message}`);
    if (err.stdout) {
      console.log(`    Stdout: ${err.stdout.trim()}`);
    }
  }
}

async function main() {
  // 1. Simple query (sanity check)
  await testPrompt("1. Simple Query", "List all transactions in the bank statement.");

  // 2. Full prompt but simplified JSON request
  const p2 = `Você concilia transações bancárias.
Analise o extrato "9227bb20-892d-40f8-8eaf-22a54060739c_Extrato Jan PIX (1).pdf".
Extraia todas as transações e retorne como JSON.`;
  await testPrompt("2. Simplified Prompt", p2);

  // 3. Full prompt without column map section
  const p3 = `Você concilia transações bancárias de prestação de contas partidária no Brasil.
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
   - Se NÃO houver CPF/CNPJ explícito na descrição e nenhum match foi feito, retorne "documento_candidato" como null and "nome_candidato" como o nome do favorecido/pagador extraído da descrição (ou null caso não seja identificável).

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
      "documento_candidato": "CPF ou CNPJ del candidato (somente números, ou null)",
      "nome_candidato": "Nome del candidato (ou null)",
      "remetente_destinatario": "Nome da coluna Remetente/Destinatário (ou null)",
      "fonte_recurso": "Código da fonte de recurso",
      "natureza_recurso": "Código da natureza de recurso",
      "tipo_origem_recurso": "Código do tipo de origem do recurso",
      "documento": "Número do documento",
      "historico": "Conteúdo integral de histórico",
      "hora": "Hora",
      "tipo_pix": "Tipo de PIX",
      "situacao": "Situação",
      "saldo": "Saldo"
    }
  ]
}`;
  await testPrompt("3. Full Prompt without column map section", p3);
}

main().catch(console.error);
