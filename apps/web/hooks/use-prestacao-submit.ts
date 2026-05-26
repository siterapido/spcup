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
  | "kanban";

export type SubmitStepStatus = "pending" | "active" | "done" | "error";

export type SubmitStep = {
  id: SubmitStepId;
  label: string;
  status: SubmitStepStatus;
};

const STEPS_IDLE: SubmitStep[] = [
  { id: "session", label: "Criar sessão", status: "pending" },
  { id: "upload", label: "Enviar arquivos", status: "pending" },
  { id: "ingest", label: "Processar movimentações", status: "pending" },
  { id: "kanban", label: "Abrir kanban", status: "pending" },
];

export type PrestacaoSubmitInput = {
  uf: string;
  tipo: "ESTADUAL" | "MUNICIPAL";
  municipalId?: string;
  exercicio: string;
  files: File[];
};

export type PrestacaoSubmitResult = {
  sessaoId: string;
  warningMessage: string | null;
};

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
  linhas_ignoradas_sem_doc?: number;
};

function buildUploadWarning(upJson: {
  erros?: string[];
  arquivos?: ArquivoUp[];
}): string | null {
  let uploadMsg: string | null = null;
  if (upJson.erros?.length) {
    uploadMsg = `Upload parcial: ${upJson.erros.join("; ")}`;
  }
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
  const [activeFileName, setActiveFileName] = useState<string | null>(null);

  const reset = useCallback(() => {
    setPhase("idle");
    setProgress(0);
    setStatusLabel("");
    setSteps(STEPS_IDLE);
    setErrorMessage(null);
    setActiveFileName(null);
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
          }),
          });
        } catch {
          const msg = "Erro de rede ao criar sessão.";
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

        if (input.files.length > 0) {
          const label =
            input.files.length === 1
              ? input.files[0]!.name
              : `${input.files.length} arquivos`;
          setActiveFileName(label);
          setPhase("uploading");
          setStatusLabel(`Enviando ${label}…`);

          const data = new FormData();
          for (const file of input.files) {
            data.append("files", file);
          }

          let status: number;
          let body: string;
          try {
            const res = await uploadFormData(
              `/api/prestacao/sessoes/${sessaoId}/upload`,
              data,
              (loaded, total) => {
                const ratio = total > 0 ? loaded / total : 0;
                setProgress(15 + Math.round(70 * ratio));
                if (loaded >= total) {
                  currentSteps = setStepStatus(
                    setStepStatus(currentSteps, "upload", "done"),
                    "ingest",
                    "active",
                  );
                  setSteps(currentSteps);
                  setPhase("processing");
                  setProgress(85);
                  setStatusLabel("Processando movimentações…");
                }
              },
            );
            status = res.status;
            body = res.body;
          } catch (uploadErr) {
            const msg =
              uploadErr instanceof Error
                ? uploadErr.message
                : "Erro de rede no upload.";
            currentSteps = setStepStatus(
              setStepStatus(currentSteps, "upload", "error"),
              "ingest",
              "error",
            );
            setSteps(currentSteps);
            setPhase("error");
            setProgress((p) => Math.max(p, 15));
            setErrorMessage(msg);
            setStatusLabel(msg);
            throw new Error(msg);
          }

          let upJson: { error?: string; erros?: string[]; arquivos?: ArquivoUp[] };
          try {
            upJson = JSON.parse(body) as typeof upJson;
          } catch {
            upJson = { error: "Resposta inválida do servidor" };
          }

          if (status < 200 || status >= 300) {
            const msg = upJson.error ?? "Erro no upload";
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

          currentSteps = setStepStatus(
            setStepStatus(currentSteps, "ingest", "done"),
            "kanban",
            "active",
          );
          setSteps(currentSteps);
          setProgress(92);
          warningMessage = buildUploadWarning(upJson);
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

        return { sessaoId, warningMessage };
      } catch (error) {
        const msg = error instanceof Error ? error.message : "Erro de rede.";
        setPhase((p) => (p === "error" ? p : "error"));
        setErrorMessage((m) => m ?? msg);
        setStatusLabel((l) => (l || msg));
        throw error;
      }
    },
    [reset],
  );

  const isProcessing =
    phase !== "idle" && phase !== "error" && phase !== "done";

  return {
    phase,
    progress,
    statusLabel,
    steps,
    errorMessage,
    activeFileName,
    isProcessing,
    submit,
    reset,
  };
}
