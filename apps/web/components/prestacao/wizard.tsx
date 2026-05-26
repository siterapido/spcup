"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { AttachmentDropzone } from "@/components/prestacao/attachment-dropzone";
import { SubmissionProgressPanel } from "@/components/prestacao/submission-progress-panel";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { usePrestacaoSubmit } from "@/hooks/use-prestacao-submit";
const UFS = [
  "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG",
  "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO",
];

type Municipal = { id: string; nomeMunicipio: string; cnpjPrestador: string };

export function PrestacaoWizard() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [uf, setUf] = useState("SP");
  const [tipo, setTipo] = useState<"ESTADUAL" | "MUNICIPAL">("ESTADUAL");
  const [municipalId, setMunicipalId] = useState("");
  const [municipais, setMunicipais] = useState<Municipal[]>([]);
  const [exercicio, setExercicio] = useState("2025");
  const [files, setFiles] = useState<File[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [estadualPlaceholder, setEstadualPlaceholder] = useState(false);
  const {
    phase,
    progress,
    statusLabel,
    steps,
    errorMessage,
    fileErrors,
    isProcessing,
    submit,
    reset,
  } = usePrestacaoSubmit();

  const showSubmitProgress = phase !== "idle";

  const loadMunicipais = useCallback(async () => {
    if (tipo !== "MUNICIPAL" || uf.length !== 2) return;
    const res = await fetch(
      `/api/admin/diretorios-municipais?uf=${encodeURIComponent(uf.toUpperCase())}`,
    );
    const json = await res.json();
    setMunicipais(json.items ?? []);
  }, [tipo, uf]);

  useEffect(() => {
    void loadMunicipais();
  }, [loadMunicipais]);

  useEffect(() => {
    if (tipo !== "ESTADUAL" || uf.length !== 2) {
      setEstadualPlaceholder(false);
      return;
    }
    void fetch(
      `/api/admin/diretorios-estaduais?uf=${encodeURIComponent(uf.toUpperCase())}`,
    )
      .then((r) => r.json())
      .then((json) => {
        const row = (json.items ?? [])[0];
        setEstadualPlaceholder(Boolean(row?.placeholder));
      })
      .catch(() => setEstadualPlaceholder(false));
  }, [tipo, uf]);

  async function onSubmit() {
    setMessage(null);
    try {
      const { sessaoId, warningMessage } = await submit({
        uf,
        tipo,
        municipalId: tipo === "MUNICIPAL" ? municipalId : undefined,
        exercicio,
        files,
      });
      if (warningMessage) {
        setMessage(warningMessage);
      }
      router.push(`/prestacao/${sessaoId}/kanban`);
    } catch {
      /* hook sets errorMessage / fileErrors */
    }
  }

  return (
    <Card>
      <CardTitle>Nova prestação de contas</CardTitle>
      <p className="mt-1 text-sm text-muted">Passo {step} de 5</p>

      {step === 1 && (
        <div className="mt-4 space-y-3">
          <label className="block text-sm font-medium">
            UF
            <select
              className="mt-1 w-full rounded-md border border-border-default px-3 py-2 text-sm"
              value={uf}
              onChange={(e) => setUf(e.target.value)}
            >
              {UFS.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
          </label>
          <Button type="button" onClick={() => setStep(2)}>
            Continuar
          </Button>
        </div>
      )}

      {step === 2 && (
        <div className="mt-4 space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <button
              type="button"
              className={`rounded-md border p-4 text-left text-sm ${
                tipo === "ESTADUAL"
                  ? "border-up-yellow bg-slate-50 font-medium"
                  : "border-border-default"
              }`}
              onClick={() => setTipo("ESTADUAL")}
            >
              Estadual
              <span className="mt-1 block text-muted">Diretório estadual da UF</span>
            </button>
            <button
              type="button"
              className={`rounded-md border p-4 text-left text-sm ${
                tipo === "MUNICIPAL"
                  ? "border-up-yellow bg-slate-50 font-medium"
                  : "border-border-default"
              }`}
              onClick={() => setTipo("MUNICIPAL")}
            >
              Municipal
              <span className="mt-1 block text-muted">Comissão municipal (CNPJ próprio)</span>
            </button>
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => setStep(1)}>
              Voltar
            </Button>
            <Button type="button" onClick={() => setStep(3)}>
              Continuar
            </Button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="mt-4 space-y-3">
          {tipo === "MUNICIPAL" ? (
            <label className="block text-sm font-medium">
              Município
              <select
                className="mt-1 w-full rounded-md border border-border-default px-3 py-2 text-sm"
                value={municipalId}
                onChange={(e) => setMunicipalId(e.target.value)}
                required
              >
                <option value="">Selecione…</option>
                {municipais.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.nomeMunicipio} — CNPJ …{m.cnpjPrestador.slice(-6)}
                  </option>
                ))}
              </select>
              {municipais.length === 0 && (
                <p className="mt-2 text-sm text-muted">
                  Nenhum município cadastrado.{" "}
                  <a href="/admin/diretorios-municipais" className="underline">
                    Cadastrar
                  </a>
                </p>
              )}
            </label>
          ) : (
            <div className="space-y-2">
              <p className="text-sm text-muted">
                Prestador: diretório estadual de <strong>{uf}</strong> (CNPJ vinculado à UF).
              </p>
              {estadualPlaceholder && (
                <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950">
                  CNPJ do prestador estadual ainda é placeholder. Configure o CNPJ real em{" "}
                  <a href="/admin/diretorios-estaduais" className="font-medium underline">
                    Diretórios estaduais
                  </a>
                  .
                </p>
              )}
            </div>
          )}
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => setStep(2)}>
              Voltar
            </Button>
            <Button
              type="button"
              onClick={() => setStep(4)}
              disabled={tipo === "MUNICIPAL" && !municipalId}
            >
              Continuar
            </Button>
          </div>
        </div>
      )}

      {step === 4 && (
        <div className="mt-4 space-y-3">
          <label className="block text-sm font-medium">
            Exercício
            <select
              className="mt-1 w-full rounded-md border border-border-default px-3 py-2 text-sm"
              value={exercicio}
              onChange={(e) => setExercicio(e.target.value)}
            >
              <option value="2024">2024</option>
              <option value="2025">2025</option>
            </select>
          </label>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => setStep(3)}>
              Voltar
            </Button>
            <Button type="button" onClick={() => setStep(5)}>
              Continuar
            </Button>
          </div>
        </div>
      )}

      {step === 5 && (
        <div className="mt-4 space-y-3">
          <AttachmentDropzone
            files={files}
            onChange={setFiles}
            disabled={isProcessing}
          />
          {showSubmitProgress ? (
            <SubmissionProgressPanel
              progress={progress}
              statusLabel={statusLabel}
              steps={steps}
              fileNames={files.map((f) => f.name)}
              fileErrors={fileErrors}
            />
          ) : null}
          {(message || errorMessage) && (
            <p
              className={`text-sm ${
                phase === "error" ? "text-red-700" : "text-amber-900"
              }`}
              role={phase === "error" ? "alert" : undefined}
            >
              {phase === "error" ? errorMessage : message}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={isProcessing}
              onClick={() => setStep(4)}
            >
              Voltar
            </Button>
            {phase === "error" ? (
              <Button type="button" variant="outline" onClick={() => reset()}>
                Tentar novamente
              </Button>
            ) : null}
            <Button
              type="button"
              disabled={isProcessing}
              onClick={() => void onSubmit()}
            >
              {isProcessing ? "Processando…" : "Iniciar prestação"}
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
