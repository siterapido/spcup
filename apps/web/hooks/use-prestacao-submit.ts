"use client";

import { useCallback, useState } from "react";

export type SubmitPhase =
  | "idle"
  | "creating_session"
  | "uploading"
  | "processing"
  | "redirecting"
  | "done"
  | "error";

export type SubmitStepId =
  | "session"
  | "upload"
  | "ingest"
  | "consolidacao"
  | "kanban";

export type SubmitStepStatus = "pending" | "active" | "done" | "error";

export type SubmitStep = {
  id: SubmitStepId;
  label: string;
  status: SubmitStepStatus;
};

export type UploadErroResposta = {
  nome: string;
  codigo: string;
  mensagem: string;
  causaTecnica?: string;
};

export type FileErrorDisplay = {
  nome: string;
  codigo: string;
  mensagem: string;
  causaTecnica: string;
};

export type ErrorLogEntry = {
  etapa: string;
  mensagem: string;
  detalhe?: string;
};

/** Progresso detalhado da etapa «Processar movimentações». */
export type IngestProgressState = {
  /** 0–100 dentro da etapa de ingestão */
  percent: number;
  /** Linha principal do que está acontecendo agora */
  current: string;
  /** Etapas já concluídas (mais recentes no final) */
  completed: string[];
  movimentacoesTotal: number;
};

const STEPS_IDLE: SubmitStep[] = [
  { id: "session", label: "Criar sessão", status: "pending" },
  { id: "upload", label: "Enviar arquivos", status: "pending" },
  { id: "ingest", label: "Processar movimentações", status: "pending" },
  { id: "consolidacao", label: "Consolidar extratos bancários", status: "pending" },
  { id: "kanban", label: "Abrir kanban", status: "pending" },
];

export type PrestacaoSubmitInput = {
  uf: string;
  tipo: "ESTADUAL" | "MUNICIPAL";
  municipalId?: string;
  exercicio: string;
  files: File[];
  consolidarExtratos?: boolean;
};

export type IncertaPreview = {
  id: string;
  score: number;
  motivo: string;
  preview: { data?: string; valor?: unknown; direcao?: string; nome?: string };
};

export type PaginaProcessadaStatus =
  | "OK"
  | "NAO_TRANSACIONAL"
  | "VERIFICAR"
  | "ERRO";

export type PaginaProcessada = {
  pagina: number;
  totalPaginas: number;
  movimentacoes_criadas: number;
  linhas_ignoradas_sem_doc?: number;
  statusPagina: PaginaProcessadaStatus;
  modo: "texto" | "imagem";
  linhas_incertas?: number;
  incertas?: IncertaPreview[];
  error?: string;
  codigo?: string;
  causaTecnica?: string;
};

export type PaginaVerificarItem = {
  arquivoId: string;
  nomeArquivo: string;
  pagina: number;
  totalPaginas: number;
  statusPagina: "VERIFICAR";
  incertas: IncertaPreview[];
  linhas_incertas?: number;
  modo: "texto" | "imagem";
};

export type PrestacaoSubmitResult = {
  sessaoId: string;
  warningMessage: string | null;
  redirectPath: string;
  paginasVerificar: PaginaVerificarItem[];
};

export function countPdfFiles(files: File[]): number {
  return files.filter((f) => f.name.toLowerCase().endsWith(".pdf")).length;
}

export function shouldRedirectToConsolidacao(
  consolidarExtratos: boolean,
  pdfCount: number,
): boolean {
  return Boolean(consolidarExtratos) && pdfCount >= 2;
}

export function shouldBlockRedirect(
  status: number,
  totalMovimentacoes: number,
  errosCount: number,
): boolean {
  if (status === 422) return true;
  return totalMovimentacoes === 0 && errosCount > 0;
}

function setStepStatus(
  steps: SubmitStep[],
  id: SubmitStepId,
  status: SubmitStepStatus,
): SubmitStep[] {
  return steps.map((s) => (s.id === id ? { ...s, status } : s));
}

function uploadFormData(
  url: string,
  formData: FormData,
  onUploadProgress: (loaded: number, total: number) => void,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        onUploadProgress(event.loaded, event.total);
      }
    };
    xhr.onload = () => {
      resolve({ status: xhr.status, body: xhr.responseText });
    };
    xhr.onerror = () => reject(new Error("Erro de rede no upload."));
    xhr.onabort = () => reject(new Error("Upload cancelado."));
    xhr.send(formData);
  });
}

type ArquivoUp = {
  nome: string;
  movimentacoes_criadas: number;
  arquivo_id?: string;
  paginas?: number;
  modo?: "armazenar";
  linhas_ignoradas_sem_doc?: number;
};

export function isPdfFile(file: File): boolean {
  return file.name.toLowerCase().endsWith(".pdf");
}

function formatPdfPageProgressLabel(
  fileIndex: number,
  totalFiles: number,
  nome: string,
  pagina: number,
  totalPaginas: number,
): string {
  const filePart =
    totalFiles === 1
      ? nome
      : `Arquivo ${fileIndex + 1} de ${totalFiles} — ${nome}`;
  if (totalPaginas === 1) {
    return filePart;
  }
  return `${filePart} — página ${pagina}/${totalPaginas}`;
}

export async function processarPaginaExtrato(
  sessaoId: string,
  arquivoId: string,
  pagina: number,
  options?: { force?: boolean },
): Promise<
  | { ok: true; data: PaginaProcessada }
  | { ok: false; status: number; body: PaginaProcessada & { error?: string } }
> {
  const init: RequestInit = { method: "POST" };
  if (options?.force) {
    init.headers = { "Content-Type": "application/json" };
    init.body = JSON.stringify({ force: true });
  }
  const res = await fetch(
    `/api/prestacao/sessoes/${sessaoId}/arquivos/${arquivoId}/paginas/${pagina}/processar`,
    init,
  );
  let json: PaginaProcessada & { error?: string; codigo?: string; causaTecnica?: string };
  try {
    json = (await res.json()) as typeof json;
  } catch {
    return {
      ok: false,
      status: res.status,
      body: {
        pagina,
        totalPaginas: pagina,
        movimentacoes_criadas: 0,
        statusPagina: "ERRO",
        modo: "texto",
        error: "Resposta inválida",
      },
    };
  }
  if (!res.ok) {
    return { ok: false, status: res.status, body: json };
  }
  return { ok: true, data: json };
}

function truncateBody(body: string, max = 800): string {
  const trimmed = body.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max)}…`;
}

function formatUploadErrors(erros: UploadErroResposta[]): string {
  return erros
    .map((e) => {
      const codigo = e.codigo ? ` [${e.codigo}]` : "";
      const tech = e.causaTecnica ? ` — ${e.causaTecnica}` : "";
      return `${e.nome}${codigo}: ${e.mensagem}${tech}`;
    })
    .join(" · ");
}

function toFileErrorDisplay(erro: UploadErroResposta): FileErrorDisplay {
  return {
    nome: erro.nome,
    codigo: erro.codigo,
    mensagem: erro.mensagem,
    causaTecnica: erro.causaTecnica ?? erro.mensagem,
  };
}

type UploadResponseBody = {
  error?: string;
  erros?: UploadErroResposta[];
  arquivos?: ArquivoUp[];
  total_movimentacoes?: number;
};

function mergeUploadResponses(parts: UploadResponseBody[]): UploadResponseBody {
  const arquivos: ArquivoUp[] = [];
  const erros: UploadErroResposta[] = [];
  for (const part of parts) {
    arquivos.push(...(part.arquivos ?? []));
    erros.push(...(part.erros ?? []));
  }
  return {
    arquivos,
    erros,
    total_movimentacoes: arquivos.reduce((s, a) => s + a.movimentacoes_criadas, 0),
  };
}

function buildUploadWarning(upJson: {
  erros?: UploadErroResposta[];
  arquivos?: ArquivoUp[];
}): string | null {
  const erros = upJson.erros ?? [];
  let uploadMsg: string | null =
    erros.length > 0 ? `Upload parcial: ${formatUploadErrors(erros)}` : null;

  const arquivos = upJson.arquivos ?? [];
  const arquivoParts = arquivos
    .filter(
      (a) =>
        a.movimentacoes_criadas === 0 ||
        ((a.linhas_ignoradas_sem_doc ?? 0) > 0),
    )
    .map((a) => {
      const n = a.movimentacoes_criadas;
      const movLabel = n === 1 ? "1 movimentação" : `${n} movimentações`;
      const ignored = a.linhas_ignoradas_sem_doc ?? 0;
      let part = `${a.nome}: ${movLabel}`;
      if (ignored > 0) {
        part += `; ${ignored === 1 ? "1 linha" : `${ignored} linhas`} sem CPF/CNPJ válido`;
      }
      return part;
    });
  if (arquivoParts.length > 0) {
    const resumoArquivos = arquivoParts.join(" · ");
    uploadMsg = uploadMsg ? `${uploadMsg} · ${resumoArquivos}` : resumoArquivos;
  }
  return uploadMsg;
}

export function usePrestacaoSubmit() {
  const [phase, setPhase] = useState<SubmitPhase>("idle");
  const [progress, setProgress] = useState(0);
  const [statusLabel, setStatusLabel] = useState("");
  const [steps, setSteps] = useState<SubmitStep[]>(STEPS_IDLE);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [fileErrors, setFileErrors] = useState<FileErrorDisplay[]>([]);
  const [errorLogs, setErrorLogs] = useState<ErrorLogEntry[]>([]);
  const [activeFileName, setActiveFileName] = useState<string | null>(null);
  const [ingestProgress, setIngestProgress] = useState<IngestProgressState | null>(
    null,
  );
  const [paginasVerificar, setPaginasVerificar] = useState<PaginaVerificarItem[]>(
    [],
  );

  const pushErrorLog = useCallback((entry: ErrorLogEntry) => {
    setErrorLogs((prev) => [...prev, entry]);
  }, []);

  const reset = useCallback(() => {
    setPhase("idle");
    setProgress(0);
    setStatusLabel("");
    setSteps(STEPS_IDLE);
    setErrorMessage(null);
    setFileErrors([]);
    setErrorLogs([]);
    setActiveFileName(null);
    setIngestProgress(null);
    setPaginasVerificar([]);
  }, []);

  const submit = useCallback(
    async (input: PrestacaoSubmitInput): Promise<PrestacaoSubmitResult> => {
      reset();
      let currentSteps = STEPS_IDLE.map((s) =>
        s.id === "session" ? { ...s, status: "active" as const } : s,
      );
      setSteps(currentSteps);
      setPhase("creating_session");
      setProgress(5);
      setStatusLabel("Criando sessão…");

      try {
        let sessaoRes: Response;
        try {
          sessaoRes = await fetch("/api/prestacao/sessoes", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              uf: input.uf.toUpperCase(),
              tipoPrestador: input.tipo,
              diretorioMunicipalId:
                input.tipo === "MUNICIPAL" ? input.municipalId : undefined,
              exercicio: Number.parseInt(input.exercicio, 10),
              consolidarExtratos: input.consolidarExtratos ?? false,
            }),
          });
        } catch (networkErr) {
          const msg = "Erro de rede ao criar sessão.";
          const detalhe =
            networkErr instanceof Error ? networkErr.message : String(networkErr);
          pushErrorLog({ etapa: "Criar sessão", mensagem: msg, detalhe });
          currentSteps = setStepStatus(currentSteps, "session", "error");
          setSteps(currentSteps);
          setPhase("error");
          setProgress(15);
          setErrorMessage(msg);
          setStatusLabel(msg);
          throw new Error(msg);
        }

        const sessaoJson = (await sessaoRes.json()) as {
          id?: string;
          error?: string;
        };

        if (!sessaoRes.ok) {
          const msg = sessaoJson.error ?? "Erro ao criar sessão";
          pushErrorLog({
            etapa: "Criar sessão",
            mensagem: msg,
            detalhe: `HTTP ${sessaoRes.status} — ${JSON.stringify(sessaoJson)}`,
          });
          currentSteps = setStepStatus(currentSteps, "session", "error");
          setSteps(currentSteps);
          setPhase("error");
          setProgress(15);
          setErrorMessage(msg);
          setStatusLabel(msg);
          throw new Error(msg);
        }

        const sessaoId = sessaoJson.id as string;
        currentSteps = setStepStatus(
          setStepStatus(currentSteps, "session", "done"),
          "upload",
          "active",
        );
        setSteps(currentSteps);
        setProgress(15);

        let warningMessage: string | null = null;
        let collectedPaginasVerificar: PaginaVerificarItem[] = [];

        if (input.files.length > 0) {
          const label =
            input.files.length === 1
              ? input.files[0]!.name
              : `${input.files.length} arquivos`;
          setActiveFileName(label);
          setPhase("uploading");
          setStatusLabel(`Enviando ${label}…`);

          const fileCount = input.files.length;
          const uploadParts: UploadResponseBody[] = [];
          const pdfJobs: Array<{
            nome: string;
            arquivoId: string;
            paginas: number;
            fileIndex: number;
            movimentacoes_criadas: number;
            linhas_ignoradas_sem_doc: number;
            paginasVerificar: PaginaVerificarItem[];
          }> = [];
          let status = 200;
          let body = "";

          const ingestCompletedLines: string[] = [];
          let movimentacoesIngestTotal = 0;

          const movimentacoesFromJobs = () =>
            pdfJobs.reduce((s, j) => s + j.movimentacoes_criadas, 0) +
            movimentacoesIngestTotal;

          const markIngestActive = () => {
            currentSteps = setStepStatus(
              setStepStatus(currentSteps, "upload", "done"),
              "ingest",
              "active",
            );
            setSteps(currentSteps);
            setPhase("processing");
          };

          const reportIngest = (
            current: string,
            percent: number,
            movimentacoesTotal?: number,
          ) => {
            markIngestActive();
            setIngestProgress({
              percent: Math.min(100, Math.max(0, Math.round(percent))),
              current,
              completed: [...ingestCompletedLines],
              movimentacoesTotal: movimentacoesTotal ?? movimentacoesFromJobs(),
            });
            setStatusLabel(current);
          };

          try {
            for (let fileIndex = 0; fileIndex < fileCount; fileIndex++) {
              const file = input.files[fileIndex]!;
              const data = new FormData();
              data.append("files", file);
              if (isPdfFile(file)) {
                data.append("modo", "armazenar");
              }

              setActiveFileName(file.name);
              setPhase("uploading");
              setStatusLabel(
                fileCount === 1
                  ? `Enviando ${file.name}…`
                  : `Enviando ${file.name} (${fileIndex + 1}/${fileCount})…`,
              );

              const res = await uploadFormData(
                `/api/prestacao/sessoes/${sessaoId}/upload`,
                data,
                (loaded, total) => {
                  const fileRatio = total > 0 ? loaded / total : 0;
                  const overallRatio = (fileIndex + fileRatio) / fileCount;
                  setProgress(15 + Math.round(25 * overallRatio));
                  if (total > 0 && loaded >= total && !isPdfFile(file)) {
                    reportIngest(
                      `Processando movimentações de ${file.name}…`,
                      Math.round(((fileIndex + 0.5) / fileCount) * 100),
                    );
                  }
                },
              );

              status = res.status;
              body = res.body;

              let partJson: UploadResponseBody;
              try {
                partJson = JSON.parse(res.body) as UploadResponseBody;
              } catch {
                const snippet = truncateBody(res.body);
                pushErrorLog({
                  etapa: "Enviar arquivos",
                  mensagem: `HTTP ${res.status}: resposta não é JSON válido`,
                  detalhe: snippet || "(corpo vazio)",
                });
                throw new Error("Resposta inválida do servidor");
              }

              if (status < 200 || status >= 300) {
                uploadParts.push(partJson);
                break;
              }

              const stored = partJson.arquivos?.[0];
              if (isPdfFile(file) && stored?.arquivo_id && stored.paginas) {
                pdfJobs.push({
                  nome: stored.nome,
                  arquivoId: stored.arquivo_id,
                  paginas: stored.paginas,
                  fileIndex,
                  movimentacoes_criadas: 0,
                  linhas_ignoradas_sem_doc: 0,
                  paginasVerificar: [],
                });
              } else {
                uploadParts.push(partJson);
                const created = partJson.arquivos?.[0]?.movimentacoes_criadas ?? 0;
                movimentacoesIngestTotal += created;
                ingestCompletedLines.push(
                  `${file.name}: ${created} movimentação${created === 1 ? "" : "ões"}`,
                );
                reportIngest(
                  `${file.name} processado`,
                  Math.round(((fileIndex + 1) / fileCount) * 100),
                );
              }
            }

            const totalPaginas = pdfJobs.reduce((s, j) => s + j.paginas, 0);
            let paginasFeitas = 0;

            if (pdfJobs.length > 0) {
              reportIngest(
                totalPaginas === 1
                  ? "Iniciando extração do extrato com IA…"
                  : `Iniciando extração de ${totalPaginas} páginas em ${pdfJobs.length} extrato(s)…`,
                0,
              );
            }

            for (const job of pdfJobs) {
              for (let pagina = 1; pagina <= job.paginas; pagina += 1) {
                const pageLabel = formatPdfPageProgressLabel(
                  job.fileIndex,
                  fileCount,
                  job.nome,
                  pagina,
                  job.paginas,
                );

                reportIngest(
                  pageLabel,
                  (paginasFeitas / Math.max(totalPaginas, 1)) * 100,
                );
                setProgress(
                  40 +
                    Math.round(
                      (45 * (paginasFeitas + 0.5)) / Math.max(totalPaginas, 1),
                    ),
                );

                const pageRes = await processarPaginaExtrato(
                  sessaoId,
                  job.arquivoId,
                  pagina,
                );
                paginasFeitas += 1;

                if (!pageRes.ok) {
                  const errBody = pageRes.body;
                  const codigo = errBody.codigo ?? "INGESTAO_DESCONHECIDA";
                  const mensagem =
                    errBody.error ?? `Erro na página ${pagina} de ${job.nome}`;
                  const causaTecnica = errBody.causaTecnica ?? mensagem;
                  pushErrorLog({
                    etapa: `Extrato: ${job.nome} (p.${pagina})`,
                    mensagem: `[${codigo}] ${mensagem}`,
                    detalhe: causaTecnica,
                  });
                  uploadParts.push({
                    erros: [
                      {
                        nome: `${job.nome} (p.${pagina})`,
                        codigo,
                        mensagem,
                        causaTecnica,
                      },
                    ],
                  });
                  status = pageRes.status;
                  throw new Error(causaTecnica !== mensagem ? `${mensagem} — ${causaTecnica}` : mensagem);
                }

                job.movimentacoes_criadas += pageRes.data.movimentacoes_criadas;
                job.linhas_ignoradas_sem_doc +=
                  pageRes.data.linhas_ignoradas_sem_doc ?? 0;

                if ((pageRes.data.statusPagina ?? "OK") === "VERIFICAR") {
                  job.paginasVerificar.push({
                    arquivoId: job.arquivoId,
                    nomeArquivo: job.nome,
                    pagina,
                    totalPaginas: job.paginas,
                    statusPagina: "VERIFICAR",
                    incertas: pageRes.data.incertas ?? [],
                    linhas_incertas: pageRes.data.linhas_incertas,
                    modo: pageRes.data.modo,
                  });
                }

                const n = pageRes.data.movimentacoes_criadas;
                const pageStatus = pageRes.data.statusPagina ?? "OK";
                const statusNote =
                  pageStatus === "VERIFICAR"
                    ? " — verificar"
                    : pageStatus === "NAO_TRANSACIONAL"
                      ? " — não transacional"
                      : "";
                const pageDone =
                  job.paginas === 1
                    ? `${job.nome}: ${n} movimentação${n === 1 ? "" : "ões"}${statusNote}`
                    : `${job.nome} (p.${pagina}): ${n} movimentação${n === 1 ? "" : "ões"}${statusNote}`;
                ingestCompletedLines.push(pageDone);

                reportIngest(
                  paginasFeitas >= totalPaginas
                    ? "Extração concluída"
                    : `Página ${paginasFeitas}/${totalPaginas} concluída`,
                  (paginasFeitas / Math.max(totalPaginas, 1)) * 100,
                );
                setProgress(
                  40 + Math.round((45 * paginasFeitas) / Math.max(totalPaginas, 1)),
                );
              }
            }

            collectedPaginasVerificar = pdfJobs.flatMap((j) => j.paginasVerificar);
            setPaginasVerificar(collectedPaginasVerificar);

            if (pdfJobs.length > 0) {
              const mergedPdfPart: UploadResponseBody = {
                arquivos: pdfJobs.map((j) => ({
                  nome: j.nome,
                  movimentacoes_criadas: j.movimentacoes_criadas,
                  ...(j.linhas_ignoradas_sem_doc > 0
                    ? { linhas_ignoradas_sem_doc: j.linhas_ignoradas_sem_doc }
                    : {}),
                })),
              };
              uploadParts.push(mergedPdfPart);
            }
          } catch (uploadErr) {
            const msg =
              uploadErr instanceof Error
                ? uploadErr.message
                : "Erro de rede no upload.";
            pushErrorLog({
              etapa: "Enviar arquivos",
              mensagem: msg,
              detalhe:
                uploadErr instanceof Error ? uploadErr.stack ?? uploadErr.message : undefined,
            });
            currentSteps = setStepStatus(
              setStepStatus(currentSteps, "upload", "error"),
              "ingest",
              "error",
            );
            setSteps(currentSteps);
            setPhase("error");
            setProgress((p) => Math.max(p, 15));
            setIngestProgress(null);
            setErrorMessage(msg);
            setStatusLabel(msg);
            throw new Error(msg);
          }

          const upJson: UploadResponseBody =
            uploadParts.length > 0
              ? mergeUploadResponses(uploadParts)
              : { error: "Resposta inválida do servidor" };

          const erros = upJson.erros ?? [];
          const totalMov = upJson.total_movimentacoes ?? 0;
          const displayErrors = erros.map(toFileErrorDisplay);

          for (const erro of erros) {
            pushErrorLog({
              etapa: `Arquivo: ${erro.nome}`,
              mensagem: `[${erro.codigo}] ${erro.mensagem}`,
              detalhe: erro.causaTecnica,
            });
          }

          if (shouldBlockRedirect(status, totalMov, erros.length)) {
            const msg =
              formatUploadErrors(erros) ||
              upJson.error ||
              "Nenhum arquivo foi processado com sucesso.";
            if (erros.length === 0 && upJson.error) {
              pushErrorLog({
                etapa: "Processar movimentações",
                mensagem: upJson.error,
                detalhe: `HTTP ${status}`,
              });
            }
            currentSteps = setStepStatus(
              setStepStatus(currentSteps, "upload", "error"),
              "ingest",
              "error",
            );
            setSteps(currentSteps);
            setPhase("error");
            setProgress(85);
            setErrorMessage(msg);
            setFileErrors(displayErrors);
            setStatusLabel(msg);
            throw new Error(msg);
          }

          if (status < 200 || status >= 300) {
            const msg = upJson.error ?? `Erro no upload (HTTP ${status})`;
            pushErrorLog({
              etapa: "Enviar arquivos",
              mensagem: msg,
              detalhe: truncateBody(body),
            });
            currentSteps = setStepStatus(
              setStepStatus(currentSteps, "upload", "error"),
              "ingest",
              "error",
            );
            setSteps(currentSteps);
            setPhase("error");
            setErrorMessage(msg);
            setStatusLabel(msg);
            throw new Error(msg);
          }

          const goConsolidacao = shouldRedirectToConsolidacao(
            input.consolidarExtratos ?? false,
            countPdfFiles(input.files),
          );

          setIngestProgress({
            percent: 100,
            current: `${totalMov} movimentação${totalMov === 1 ? "" : "ões"} processada${totalMov === 1 ? "" : "s"}`,
            completed: ingestCompletedLines,
            movimentacoesTotal: totalMov,
          });

          currentSteps = setStepStatus(currentSteps, "ingest", "done");
          if (goConsolidacao) {
            currentSteps = setStepStatus(currentSteps, "consolidacao", "active");
            setSteps(currentSteps);
            setPhase("processing");
            setStatusLabel("Consolidando extratos…");
            setProgress(94);

            await fetch(`/api/prestacao/sessoes/${sessaoId}/consolidacao/run`, {
              method: "POST",
            });

            currentSteps = setStepStatus(currentSteps, "consolidacao", "done");
          }
          currentSteps = setStepStatus(currentSteps, "kanban", "active");
          setSteps(currentSteps);
          setProgress(96);
          warningMessage = buildUploadWarning(upJson);
          if (displayErrors.length > 0) {
            setFileErrors(displayErrors);
          }

          const redirectPath = goConsolidacao
            ? `/prestacao/${sessaoId}/consolidacao`
            : `/prestacao/${sessaoId}/kanban`;

          setPhase("redirecting");
          setStatusLabel(
            goConsolidacao ? "Abrindo consolidação…" : "Abrindo kanban…",
          );
          setProgress(98);
          currentSteps = setStepStatus(currentSteps, "kanban", "done");
          setSteps(currentSteps);
          setProgress(100);
          setPhase("done");

          return {
            sessaoId,
            warningMessage,
            redirectPath,
            paginasVerificar: collectedPaginasVerificar,
          };
        } else {
          currentSteps = setStepStatus(
            setStepStatus(currentSteps, "upload", "done"),
            "ingest",
            "done",
          );
          currentSteps = setStepStatus(currentSteps, "kanban", "active");
          setSteps(currentSteps);
          setProgress(92);
        }

        setPhase("redirecting");
        setStatusLabel("Abrindo kanban…");
        setProgress(98);

        currentSteps = setStepStatus(currentSteps, "kanban", "done");
        setSteps(currentSteps);
        setProgress(100);
        setPhase("done");

        return {
          sessaoId,
          warningMessage,
          redirectPath: `/prestacao/${sessaoId}/kanban`,
          paginasVerificar: collectedPaginasVerificar,
        };
      } catch (error) {
        const msg = error instanceof Error ? error.message : "Erro de rede.";
        setPhase((p) => (p === "error" ? p : "error"));
        setErrorMessage((m) => m ?? msg);
        setStatusLabel((l) => l || msg);
        throw error;
      }
    },
    [pushErrorLog, reset],
  );

  const dismissPaginaVerificar = useCallback(
    (arquivoId: string, pagina: number) => {
      setPaginasVerificar((prev) =>
        prev.filter((p) => !(p.arquivoId === arquivoId && p.pagina === pagina)),
      );
    },
    [],
  );

  const isProcessing =
    phase !== "idle" && phase !== "error" && phase !== "done";

  return {
    phase,
    progress,
    statusLabel,
    steps,
    errorMessage,
    fileErrors,
    errorLogs,
    activeFileName,
    ingestProgress,
    paginasVerificar,
    dismissPaginaVerificar,
    isProcessing,
    submit,
    reset,
  };
}
