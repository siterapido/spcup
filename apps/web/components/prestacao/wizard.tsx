"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { AttachmentDropzone } from "@/components/prestacao/attachment-dropzone";
import { PaginaVerificarPanel } from "@/components/prestacao/pagina-verificar-panel";
import { SubmissionProgressPanel } from "@/components/prestacao/submission-progress-panel";
import { useExtratoColumnMap } from "@/hooks/use-extrato-column-map";
import { clientFileKey } from "@/lib/extrato-column-map-client";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import {
  isPdfFile,
  processarPaginaExtrato,
  SubmitCancelledError,
  usePrestacaoSubmit,
  type PaginaVerificarItem,
} from "@/hooks/use-prestacao-submit";

const ExtratoColumnMapPanel = dynamic(
  () =>
    import("@/components/prestacao/extrato-column-map-panel").then(
      (m) => m.ExtratoColumnMapPanel,
    ),
  {
    ssr: false,
    loading: () => (
      <p className="text-sm text-muted">Carregando visualizador de PDF…</p>
    ),
  },
);

const UFS = [
  "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG",
  "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO",
];

type Municipal = { id: string; nomeMunicipio: string; cnpjPrestador: string };

export function PrestacaoWizard() {
  const router = useRouter();
  const [uf, setUf] = useState("SP");
  const [tipo, setTipo] = useState<"ESTADUAL" | "MUNICIPAL">("ESTADUAL");
  const [municipalId, setMunicipalId] = useState("");
  const [municipais, setMunicipais] = useState<Municipal[]>([]);
  const [loadingMunicipais, setLoadingMunicipais] = useState(false);
  const [exercicio, setExercicio] = useState("2025");
  const [files, setFiles] = useState<File[]>([]);
  const [showColumnMap, setShowColumnMap] = useState(false);
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
    cancel,
    reset,
  } = usePrestacaoSubmit();

  const hasPdf = files.some((f) => isPdfFile(f));
  const columnMapState = useExtratoColumnMap(files);

  useEffect(() => {
    if (hasPdf) {
      setShowColumnMap(true);
    } else {
      setShowColumnMap(false);
    }
  }, [hasPdf]);

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
    if (hasPdf && columnMapState.validationError) {
      setShowColumnMap(true);
      return;
    }
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
          extratoColumnMaps: hasPdf ? columnMapState.maps : undefined,
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
    } catch (err) {
      if (err instanceof SubmitCancelledError) return;
      /* hook sets errorMessage / fileErrors */
    }
  }

  function handleCancelProcessing() {
    cancel();
    setPendingRedirect(null);
    setSessaoIdAfterSubmit(null);
    setActiveVerificar(null);
    setMessage(null);
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

  const municipalBlocked =
    tipo === "MUNICIPAL" && !loadingMunicipais && municipais.length === 0;
  const municipalNeedsSelection =
    tipo === "MUNICIPAL" && municipais.length > 0 && !municipalId;
  const canSubmit =
    files.length > 0 &&
    !isProcessing &&
    (tipo === "ESTADUAL" || (municipais.length > 0 && Boolean(municipalId))) &&
    !loadingMunicipais &&
    (!hasPdf || columnMapState.allMapped);

  const continueLabel = "Continuar para planilha";

  return (
    <Card>
      <CardTitle>Nova prestação de contas</CardTitle>

      <div className="mt-4 space-y-4">
        <label className="block text-sm font-medium">
          UF
          <select
            className="mt-1 w-full rounded-md border border-border-default px-3 py-2 text-sm"
            value={uf}
            onChange={(e) => setUf(e.target.value)}
            disabled={isProcessing}
          >
            {UFS.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
        </label>

        <div className="grid gap-3 sm:grid-cols-2">
          <button
            type="button"
            className={`rounded-md border p-4 text-left text-sm ${
              tipo === "ESTADUAL"
                ? "border-up-yellow bg-slate-50 font-medium"
                : "border-border-default"
            }`}
            onClick={() => setTipo("ESTADUAL")}
            disabled={isProcessing}
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
            disabled={isProcessing}
          >
            Municipal
            <span className="mt-1 block text-muted">Comissão municipal (CNPJ próprio)</span>
          </button>
        </div>

        {tipo === "MUNICIPAL" ? (
          <>
            <label className="block text-sm font-medium">
              Município
              <select
                className="mt-1 w-full rounded-md border border-border-default px-3 py-2 text-sm disabled:bg-slate-50 disabled:text-muted"
                value={municipalId}
                onChange={(e) => setMunicipalId(e.target.value)}
                disabled={loadingMunicipais || municipalBlocked || isProcessing}
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
                  Cadastre o diretório municipal antes de iniciar a prestação.
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

        <label className="block text-sm font-medium">
          Exercício
          <select
            className="mt-1 w-full rounded-md border border-border-default px-3 py-2 text-sm"
            value={exercicio}
            onChange={(e) => setExercicio(e.target.value)}
            disabled={isProcessing}
          >
            <option value="2024">2024</option>
            <option value="2025">2025</option>
          </select>
        </label>

        <AttachmentDropzone
          files={files}
          onChange={setFiles}
          disabled={isProcessing}
        />

        {hasPdf ? (
          <div className="space-y-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isProcessing}
              onClick={() => setShowColumnMap((v) => !v)}
            >
              {showColumnMap ? "Ocultar mapeamento de colunas" : "Mapear colunas do extrato"}
            </Button>
            {columnMapState.validationError && !showColumnMap ? (
              <p className="text-xs font-medium text-red-600">
                Aviso: {columnMapState.validationError}
              </p>
            ) : null}
          </div>
        ) : null}

        {showColumnMap && hasPdf ? (
          <div className="space-y-4 rounded-md border border-border-default p-4">
            {columnMapState.pdfFiles.length > 1 ? (
              <div className="flex flex-wrap items-center gap-2">
                {columnMapState.pdfFiles.map((pdf, index) => {
                  const key = clientFileKey(pdf);
                  const isActive = columnMapState.activeKey === key;
                  return (
                    <Button
                      key={key}
                      type="button"
                      variant={isActive ? "default" : "outline"}
                      size="sm"
                      onClick={() => columnMapState.setActiveKey(key)}
                    >
                      Extrato {index + 1}: {pdf.name}
                    </Button>
                  );
                })}
                {columnMapState.activeMapPerPdfValid &&
                columnMapState.pdfFiles.length > 1 ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={!columnMapState.canCopyMapToOtherPdfs}
                    title={
                      columnMapState.canCopyMapToOtherPdfs
                        ? undefined
                        : "Layouts com número de colunas diferente — mapeie cada extrato separadamente"
                    }
                    onClick={() => columnMapState.copyMapToOtherPdfs()}
                  >
                    Usar mesmo layout nos outros
                  </Button>
                ) : null}
              </div>
            ) : null}

            {columnMapState.activeFile ? (
              <ExtratoColumnMapPanel
                file={columnMapState.activeFile}
                map={columnMapState.activeMap}
                selectedCampo={columnMapState.selectedCampo}
                customCampos={columnMapState.customCampos}
                customLabels={columnMapState.customLabels}
                inferirDirecao={columnMapState.inferirDirecao}
                colunaDirecaoDetectada={columnMapState.colunaDirecaoDetectada}
                onInferirDirecaoChange={columnMapState.setInferirDirecao}
                onDirecaoDetectadaChange={columnMapState.setDirecaoDetectada}
                onSelectCampo={columnMapState.setSelectedCampo}
                onAssign={columnMapState.assignColumn}
                onAssignMultiple={columnMapState.assignMultipleColumns}
                onClearColumn={columnMapState.clearColumn}
                onAddCustomField={columnMapState.addCustomField}
                sessionCoverage={columnMapState.sessionCoverageForActive}
                onColumnCountChange={columnMapState.setColumnCountForActiveFile}
              />
            ) : null}

            {columnMapState.validationError ? (
              <p className="text-xs font-medium text-red-600">
                Aviso: {columnMapState.validationError}
              </p>
            ) : null}
          </div>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            disabled={!canSubmit}
            onClick={() => void onSubmit()}
          >
            {isProcessing ? "Processando…" : "Iniciar prestação"}
          </Button>
          {phase === "error" ? (
            <Button type="button" variant="outline" onClick={() => reset()}>
              Tentar novamente
            </Button>
          ) : null}
        </div>

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
            onCancel={isProcessing ? handleCancelProcessing : undefined}
          />
        ) : null}

        {message && phase !== "error" ? (
          <p className="text-sm text-amber-900">{message}</p>
        ) : null}
      </div>

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
