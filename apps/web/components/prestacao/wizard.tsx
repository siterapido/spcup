"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

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
  const [files, setFiles] = useState<FileList | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [estadualPlaceholder, setEstadualPlaceholder] = useState(false);

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
    setLoading(true);
    setMessage(null);
    try {
      const sessaoRes = await fetch("/api/prestacao/sessoes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          uf: uf.toUpperCase(),
          tipoPrestador: tipo,
          diretorioMunicipalId: tipo === "MUNICIPAL" ? municipalId : undefined,
          exercicio: Number.parseInt(exercicio, 10),
        }),
      });
      const sessaoJson = await sessaoRes.json();
      if (!sessaoRes.ok) {
        setMessage(sessaoJson.error ?? "Erro ao criar sessão");
        return;
      }

      if (files && files.length > 0) {
        const data = new FormData();
        for (const file of files) {
          data.append("files", file);
        }
        const upRes = await fetch(`/api/prestacao/sessoes/${sessaoJson.id}/upload`, {
          method: "POST",
          body: data,
        });
        const upJson = await upRes.json();
        if (!upRes.ok) {
          setMessage(upJson.error ?? "Erro no upload");
          return;
        }

        let uploadMsg: string | null = null;
        if (upJson.erros?.length) {
          uploadMsg = `Upload parcial: ${upJson.erros.join("; ")}`;
        }

        type ArquivoUp = {
          nome: string;
          movimentacoes_criadas: number;
          linhas_ignoradas_sem_doc?: number;
        };
        const arquivos = (upJson.arquivos ?? []) as ArquivoUp[];
        const arquivoParts = arquivos
          .filter(
            (a) =>
              a.movimentacoes_criadas === 0 ||
              ((a.linhas_ignoradas_sem_doc ?? 0) > 0),
          )
          .map((a) => {
            const n = a.movimentacoes_criadas;
            const movLabel =
              n === 1 ? "1 movimentação" : `${n} movimentações`;
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

        if (uploadMsg) {
          setMessage(uploadMsg);
        }
      }

      router.push(`/prestacao/${sessaoJson.id}/kanban`);
    } catch {
      setMessage("Erro de rede.");
    } finally {
      setLoading(false);
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
          <label className="block text-sm font-medium">
            Anexos (PDF, Excel, OFX)
            <Input
              type="file"
              multiple
              accept=".pdf,.xlsx,.xls,.ofx"
              className="mt-1"
              onChange={(e) => setFiles(e.target.files)}
            />
          </label>
          {message && <p className="text-sm text-red-700">{message}</p>}
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => setStep(4)}>
              Voltar
            </Button>
            <Button type="button" disabled={loading} onClick={() => void onSubmit()}>
              {loading ? "Processando…" : "Iniciar prestação"}
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
