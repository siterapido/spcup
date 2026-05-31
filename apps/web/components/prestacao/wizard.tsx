"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { AttachmentDropzone } from "@/components/prestacao/attachment-dropzone";
import { PaginaVerificarPanel } from "@/components/prestacao/pagina-verificar-panel";
import { SubmissionProgressPanel } from "@/components/prestacao/submission-progress-panel";
import { WizardStepper } from "@/components/prestacao/wizard-stepper";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import {
  processarPaginaExtrato,
  usePrestacaoSubmit,
  type PaginaVerificarItem,
} from "@/hooks/use-prestacao-submit";
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
  const [loadingMunicipais, setLoadingMunicipais] = useState(false);
  const [exercicio, setExercicio] = useState("2025");
  const [files, setFiles] = useState<File[]>([]);
  const [consolidarExtratos, setConsolidarExtratos] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [estadualPlaceholder, setEstadualPlaceholder] = useState(false);
  const [pendingRedirect, setPendingRedirect] = useState<string | null>(null);
  const [sessaoIdAfterSubmit, setSessaoIdAfterSubmit] = useState<string | null>(null);
  const [activeVerificar, setActiveVerificar] = useState<PaginaVerificarItem | null>(
    null,
  );
  const {
    phase,
    progress,
    statusLabel,
    steps,
    fileErrors,
    errorLogs,
    ingestProgress,
    paginasVerificar,
    dismissPaginaVerificar,
    isProcessing,
    submit,
    reset,
  } = usePrestacaoSubmit();

  const showSubmitProgress = phase !== "idle";

  const loadMunicipais = useCallback(async () => {
    if (tipo !== "MUNICIPAL" || uf.length !== 2) {
      setMunicipais([]);
      setLoadingMunicipais(false);
      return;
    }
    setLoadingMunicipais(true);
    try {
      const res = await fetch(
        `/api/admin/diretorios-municipais?uf=${encodeURIComponent(uf.toUpperCase())}`,
      );
      const json = await res.json();
      setMunicipais(json.items ?? []);
    } catch {
      setMunicipais([]);
    } finally {
      setLoadingMunicipais(false);
    }
  }, [tipo, uf]);

  useEffect(() => {
    setMunicipalId("");
  }, [uf, tipo]);

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
    setPendingRedirect(null);
    setSessaoIdAfterSubmit(null);
    setActiveVerificar(null);
    try {
      const { warningMessage, redirectPath, sessaoId, paginasVerificar: verificar } =
        await submit({
        uf,
        tipo,
        municipalId: tipo === "MUNICIPAL" ? municipalId : undefined,
        exercicio,
        files,
        consolidarExtratos,
      });
      if (warningMessage) {
        setMessage(warningMessage);
      }
      if (verificar.length > 0) {
        setPendingRedirect(redirectPath);
        setSessaoIdAfterSubmit(sessaoId);
        return;
      }
      router.push(redirectPath);
    } catch {
      /* hook sets errorMessage / fileErrors */
    }
  }

  function continueAfterVerificar() {
    if (pendingRedirect) {
      router.push(pendingRedirect);
    }
  }

  async function ignorarPaginaVerificar(item: PaginaVerificarItem) {
    if (!sessaoIdAfterSubmit) return;
    const res = await fetch(
      `/api/prestacao/sessoes/${sessaoIdAfterSubmit}/arquivos/${item.arquivoId}/paginas/${item.pagina}/ignorar`,
      { method: "POST" },
    );
    if (!res.ok) {
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(json.error ?? "Não foi possível ignorar a página.");
    }
    const remaining = paginasVerificar.filter(
      (p) => !(p.arquivoId === item.arquivoId && p.pagina === item.pagina),
    );
    dismissPaginaVerificar(item.arquivoId, item.pagina);
    setActiveVerificar(null);
    if (remaining.length === 0 && pendingRedirect) {
      router.push(pendingRedirect);
    }
  }

  async function retryPaginaVerificar(item: PaginaVerificarItem) {
    if (!sessaoIdAfterSubmit) return;
    const res = await processarPaginaExtrato(
      sessaoIdAfterSubmit,
      item.arquivoId,
      item.pagina,
      { force: true },
    );
    if (!res.ok) {
      throw new Error(res.body.error ?? "Erro ao reprocessar a página.");
    }
    if ((res.data.statusPagina ?? "OK") === "VERIFICAR") {
      throw new Error("A página ainda precisa de verificação após nova tentativa.");
    }
    const remaining = paginasVerificar.filter(
      (p) => !(p.arquivoId === item.arquivoId && p.pagina === item.pagina),
    );
    dismissPaginaVerificar(item.arquivoId, item.pagina);
    setActiveVerificar(null);
    if (remaining.length === 0 && pendingRedirect) {
      router.push(pendingRedirect);
    }
  }

  function goToStep(target: number) {
    if (target < step && !isProcessing) {
      setStep(target);
    }
  }

  const municipalBlocked =
    tipo === "MUNICIPAL" && !loadingMunicipais && municipais.length === 0;
  const municipalNeedsSelection =
    tipo === "MUNICIPAL" && municipais.length > 0 && !municipalId;
  const canAdvanceFromPrestador =
    tipo === "ESTADUAL" || (municipais.length > 0 && Boolean(municipalId));

  const continueLabel = pendingRedirect?.includes("/consolidacao")
    ? "Continuar para consolidação"
    : "Continuar para movimentações";

  return (
    <Card>
      <CardTitle>Nova prestação de contas</CardTitle>
      <WizardStepper current={step} onStepClick={goToStep} />

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
            <>
              <label className="block text-sm font-medium">
                Município
                <select
                  className="mt-1 w-full rounded-md border border-border-default px-3 py-2 text-sm disabled:bg-slate-50 disabled:text-muted"
                  value={municipalId}
                  onChange={(e) => setMunicipalId(e.target.value)}
                  disabled={loadingMunicipais || municipalBlocked}
                  aria-invalid={municipalNeedsSelection || municipalBlocked}
                  aria-describedby={
                    municipalBlocked
                      ? "municipal-blocked-msg"
                      : municipalNeedsSelection
                        ? "municipal-select-msg"
                        : undefined
                  }
                  required
                >
                  <option value="">
                    {loadingMunicipais ? "Carregando municípios…" : "Selecione…"}
                  </option>
                  {municipais.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.nomeMunicipio} — CNPJ …{m.cnpjPrestador.slice(-6)}
                    </option>
                  ))}
                </select>
              </label>

              {loadingMunicipais ? (
                <p className="text-sm text-muted">Buscando municípios cadastrados em {uf}…</p>
              ) : null}

              {municipalBlocked ? (
                <div
                  id="municipal-blocked-msg"
                  role="alert"
                  className="rounded-md border border-red-200 bg-red-50 px-3 py-3 text-sm text-red-900"
                >
                  <p className="font-medium">Nenhum município cadastrado para {uf}</p>
                  <p className="mt-1">
                    Cadastre o diretório municipal antes de avançar para exercício e anexos.
                  </p>
                  <Link
                    href={`/admin/diretorios-municipais?uf=${encodeURIComponent(uf)}`}
                    className="mt-3 inline-flex items-center justify-center rounded-md bg-up-black px-3 py-1.5 text-sm font-medium text-up-white hover:bg-up-black-hover"
                  >
                    Cadastrar município
                  </Link>
                </div>
              ) : null}

              {municipalNeedsSelection ? (
                <p id="municipal-select-msg" className="text-sm text-amber-900">
                  Selecione o município prestador para continuar.
                </p>
              ) : null}
            </>
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
              disabled={!canAdvanceFromPrestador || loadingMunicipais}
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
          <label className="flex cursor-pointer items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-1"
              checked={consolidarExtratos}
              disabled={isProcessing}
              onChange={(e) => setConsolidarExtratos(e.target.checked)}
            />
            <span>
              Consolidar extratos bancários
              <span className="mt-0.5 block text-xs text-muted">
                Unifica vários PDFs do mesmo período, cruza com o cadastro da UF e
                mostra confiança antes da revisão final. Importe pessoas em Cadastro antes.
              </span>
            </span>
          </label>
          {showSubmitProgress ? (
            <SubmissionProgressPanel
              progress={progress}
              statusLabel={statusLabel}
              steps={steps}
              fileNames={files.map((f) => f.name)}
              ingestProgress={ingestProgress}
              fileErrors={fileErrors}
              errorLogs={errorLogs}
              paginasVerificar={paginasVerificar}
              onReviewPagina={pendingRedirect ? setActiveVerificar : undefined}
              onContinueAfterVerificar={
                pendingRedirect && paginasVerificar.length > 0
                  ? continueAfterVerificar
                  : undefined
              }
              continueLabel={continueLabel}
            />
          ) : null}
          {message && phase !== "error" ? (
            <p className="text-sm text-amber-900">{message}</p>
          ) : null}
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
      {activeVerificar && sessaoIdAfterSubmit ? (
        <PaginaVerificarPanel
          sessaoId={sessaoIdAfterSubmit}
          arquivoId={activeVerificar.arquivoId}
          pagina={activeVerificar.pagina}
          nomeArquivo={activeVerificar.nomeArquivo}
          incertas={activeVerificar.incertas}
          onIgnorar={() => ignorarPaginaVerificar(activeVerificar)}
          onRetry={() => retryPaginaVerificar(activeVerificar)}
          onClose={() => setActiveVerificar(null)}
        />
      ) : null}
    </Card>
  );
}
