const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_MODEL = "moonshotai/kimi-k2.6";

export const AI_MATCH_SCHEMA = {
  type: "object",
  properties: {
    mesmo_evento: { type: "boolean" },
    confianca: { type: "number" },
    justificativa: { type: "string" },
    pessoa_tipo: { type: "string", enum: ["PF", "PJ", "null"] },
    pessoa_documento: { type: "string" },
    campos_faltantes: { type: "array", items: { type: "string" } },
    evidencias: {
      type: "array",
      items: {
        type: "object",
        properties: {
          tipo: { type: "string" },
          detalhe: { type: "string" },
        },
        required: ["tipo", "detalhe"],
        additionalProperties: false,
      },
    },
  },
  required: [
    "mesmo_evento",
    "confianca",
    "justificativa",
    "pessoa_tipo",
    "pessoa_documento",
    "campos_faltantes",
    "evidencias",
  ],
  additionalProperties: false,
} as const;

export interface AiMatchEvidencia {
  tipo: string;
  detalhe: string;
}

export interface AiMatchResult {
  mesmo_evento: boolean;
  confianca: number;
  justificativa: string;
  pessoa_tipo: "PF" | "PJ" | null;
  pessoa_documento: string | null;
  campos_faltantes: string[];
  evidencias: AiMatchEvidencia[];
}

export interface EvaluateAiMatchInput {
  valor: string;
  dataMovimento: string;
  direcao: string;
  descricaoRaw: string;
  uf: string;
  exercicio: number;
  tipoPrestador: string;
  candidatos: Array<{ tipo: "PF" | "PJ"; documento: string; nome: string }>;
}

export interface EvaluateAiMatchOptions {
  fetch?: typeof fetch;
  apiKey?: string;
  model?: string;
}

function parseAiMatchBody(body: unknown): AiMatchResult {
  if (typeof body !== "object" || body === null) {
    throw new Error("OpenRouter response missing message content");
  }
  const choices = (body as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    throw new Error("OpenRouter response missing message content");
  }
  const content = (choices[0] as { message?: { content?: unknown } })?.message?.content;
  let parsed: unknown;
  if (typeof content === "string") {
    parsed = JSON.parse(content);
  } else if (typeof content === "object" && content !== null) {
    parsed = content;
  } else {
    throw new Error("OpenRouter response content is not valid JSON");
  }

  const record = parsed as Record<string, unknown>;
  const pessoaTipoRaw = String(record.pessoa_tipo ?? "null");
  const pessoaTipo =
    pessoaTipoRaw === "PF" ? "PF" : pessoaTipoRaw === "PJ" ? "PJ" : null;

  return {
    mesmo_evento: Boolean(record.mesmo_evento),
    confianca: Math.min(1, Math.max(0, Number(record.confianca))),
    justificativa: String(record.justificativa ?? ""),
    pessoa_tipo: pessoaTipo,
    pessoa_documento:
      record.pessoa_documento == null || record.pessoa_documento === ""
        ? null
        : String(record.pessoa_documento).replace(/\D/g, ""),
    campos_faltantes: Array.isArray(record.campos_faltantes)
      ? record.campos_faltantes.map(String)
      : [],
    evidencias: Array.isArray(record.evidencias)
      ? record.evidencias.map((ev) => {
          const item = ev as Record<string, unknown>;
          return {
            tipo: String(item.tipo ?? "IA_JUSTIFICATIVA"),
            detalhe: String(item.detalhe ?? ""),
          };
        })
      : [],
  };
}

/** Call Kimi via OpenRouter to evaluate whether extracted data matches cadastro. */
export async function evaluateMovimentacaoWithAi(
  input: EvaluateAiMatchInput,
  options?: EvaluateAiMatchOptions,
): Promise<AiMatchResult> {
  const apiKey = options?.apiKey ?? process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is not configured");
  }

  const model = options?.model ?? process.env.OPENROUTER_MODEL ?? DEFAULT_MODEL;
  const fetchFn = options?.fetch ?? fetch;

  const userPayload = JSON.stringify(input, null, 2);
  const payload = {
    model,
    messages: [
      {
        role: "system",
        content:
          "Você concilia transações bancárias de prestação de contas partidária no Brasil. " +
          "Avalie se os dados extraídos representam o mesmo evento que um cadastro PF/PJ candidato. " +
          "Considere feriados e dia útil seguinte para pequenas diferenças de data. " +
          "Retorne JSON estrito conforme o schema.",
      },
      {
        role: "user",
        content: userPayload,
      },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "ai_match_movimentacao",
        strict: true,
        schema: AI_MATCH_SCHEMA,
      },
    },
  };

  const response = await fetchFn(OPENROUTER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`OpenRouter HTTP ${response.status}`);
  }

  return parseAiMatchBody(await response.json());
}
