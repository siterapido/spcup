"use client";

import { useCallback, useEffect, useState } from "react";

import { MovimentacoesExportMenu } from "@/components/movimentacoes-export-menu";
import { ReviewDrawer } from "@/components/prestacao/review-drawer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, Td, Th } from "@/components/ui/table";
import {
  getDefaultMes,
  getDefaultUf,
  setDefaultUf,
} from "@/lib/movimentacoes-filters";
import { maskCnpj, maskCpf } from "@/lib/mask-document";

interface MovimentacaoAprovadaItem {
  id: string;
  uf: string;
  exercicio: number;
  data_movimento: string;
  valor: string;
  direcao: string;
  descricao_raw: string;
  cred_dev: string | null;
  status: "CONFIRMADO" | "EXPORTADO";
  confianca_global: number;
  pessoa_nome: string | null;
  pessoa_documento: string | null;
  cnpj_prestador: string;
  prestador_nome: string | null;
  sessao_prestacao_id: string | null;
  nome_arquivo: string | null;
}

interface MovimentacoesListResponse {
  uf: string;
  mes: string;
  exercicio: number;
  page: number;
  limit: number;
  total: number;
  total_pages: number;
  resumo: { confirmadas: number; exportadas: number };
  prestadores: Array<{ cnpj: string; nome: string | null }>;
  items: MovimentacaoAprovadaItem[];
}

function maskPessoaDocumento(doc: string | null): string {
  if (!doc) return "—";
  const digits = doc.replace(/\D/g, "");
  return digits.length === 11 ? maskCpf(digits) : maskCnpj(digits);
}

function formatPessoa(m: MovimentacaoAprovadaItem): string {
  const nome = m.pessoa_nome?.trim();
  const doc = maskPessoaDocumento(m.pessoa_documento);
  if (nome) return `${nome} (${doc})`;
  return doc;
}

function formatPrestador(m: MovimentacaoAprovadaItem): string {
  if (m.prestador_nome?.trim()) return m.prestador_nome;
  const digits = m.cnpj_prestador.replace(/\D/g, "");
  return digits.length === 14 ? maskCnpj(digits) : m.cnpj_prestador;
}

function statusTone(status: MovimentacaoAprovadaItem["status"]): "success" | "neutral" {
  return status === "CONFIRMADO" ? "success" : "neutral";
}

export function MovimentacoesTable({
  initialUf,
  initialMes,
}: {
  initialUf?: string;
  initialMes?: string;
} = {}) {
  const [uf, setUf] = useState(initialUf ?? "SP");
  const [mes, setMes] = useState(initialMes ?? getDefaultMes);
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<MovimentacaoAprovadaItem[]>([]);
  const [exercicio, setExercicio] = useState(() =>
    Number.parseInt(getDefaultMes().slice(0, 4), 10),
  );
  const [prestadores, setPrestadores] = useState<
    MovimentacoesListResponse["prestadores"]
  >([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [drawerId, setDrawerId] = useState<string | null>(null);
  const [drawerSessaoId, setDrawerSessaoId] = useState<string | null>(null);

  useEffect(() => {
    if (!initialUf) setUf(getDefaultUf());
  }, [initialUf]);

  const load = useCallback(
    async (targetPage: number) => {
      setLoading(true);
      setMessage(null);
      try {
        const params = new URLSearchParams({
          uf: uf.toUpperCase(),
          mes,
          page: String(targetPage),
          limit: "50",
        });
        const res = await fetch(`/api/movimentacoes?${params}`);
        const json = (await res.json()) as MovimentacoesListResponse & { error?: string };
        if (!res.ok) {
          setMessage(json.error ?? "Erro ao carregar");
          return;
        }
        setItems(json.items ?? []);
        setExercicio(json.exercicio ?? Number.parseInt(mes.slice(0, 4), 10));
        setPrestadores(json.prestadores ?? []);
        setTotal(json.total ?? 0);
        setTotalPages(json.total_pages ?? 0);
        setPage(json.page ?? targetPage);
      } catch {
        setMessage("Erro de rede.");
      } finally {
        setLoading(false);
      }
    },
    [uf, mes],
  );

  useEffect(() => {
    void load(page);
  }, [load, page]);

  function handleAtualizar() {
    setDefaultUf(uf);
    setPage(1);
    void load(1);
  }

  function openDrawer(item: MovimentacaoAprovadaItem) {
    setDrawerId(item.id);
    setDrawerSessaoId(item.sessao_prestacao_id);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm">
          UF
          <Input
            maxLength={2}
            value={uf}
            onChange={(e) => setUf(e.target.value.toUpperCase())}
            className="mt-1 w-20"
          />
        </label>
        <label className="text-sm">
          Mês/ano
          <Input
            type="month"
            value={mes}
            onChange={(e) => setMes(e.target.value)}
            className="mt-1 w-40"
          />
        </label>
        <Button type="button" variant="outline" onClick={handleAtualizar} disabled={loading}>
          Atualizar
        </Button>
        <MovimentacoesExportMenu
          uf={uf}
          mes={mes}
          prestadores={prestadores}
          exercicio={exercicio}
        />
      </div>

      {message ? <p className="text-sm text-red-600">{message}</p> : null}

      <div className="overflow-x-auto rounded-lg border border-border bg-surface-card">
        <Table>
          <thead>
            <tr>
              <Th>Data</Th>
              <Th>Valor</Th>
              <Th>Direção</Th>
              <Th>PF/PJ</Th>
              <Th>Prestador</Th>
              <Th>Descrição</Th>
              <Th>UF</Th>
              <Th>Status</Th>
            </tr>
          </thead>
          <tbody>
            {items.map((m) => (
              <tr
                key={m.id}
                className="cursor-pointer hover:bg-surface-muted/50"
                onClick={() => openDrawer(m)}
              >
                <Td>{m.data_movimento}</Td>
                <Td>R$ {m.valor}</Td>
                <Td>{m.direcao}</Td>
                <Td className="max-w-[12rem] truncate" title={formatPessoa(m)}>
                  {formatPessoa(m)}
                </Td>
                <Td className="max-w-[10rem] truncate" title={formatPrestador(m)}>
                  {formatPrestador(m)}
                </Td>
                <Td className="max-w-xs line-clamp-2" title={m.descricao_raw}>
                  {m.descricao_raw}
                </Td>
                <Td>{m.uf}</Td>
                <Td>
                  <Badge tone={statusTone(m.status)}>{m.status}</Badge>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
        {!items.length && !loading ? (
          <p className="p-4 text-sm text-muted">Nenhuma movimentação aprovada neste período.</p>
        ) : null}
      </div>

      {totalPages > 0 ? (
        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            variant="outline"
            disabled={loading || page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            Anterior
          </Button>
          <span className="text-sm text-muted">
            Página {page} de {totalPages} ({total} total)
          </span>
          <Button
            type="button"
            variant="outline"
            disabled={loading || page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            Próxima
          </Button>
        </div>
      ) : null}

      <ReviewDrawer
        movimentacaoId={drawerId}
        sessaoId={drawerSessaoId ?? undefined}
        open={drawerId != null}
        onClose={() => {
          setDrawerId(null);
          setDrawerSessaoId(null);
        }}
        onUpdated={() => {}}
        readOnly
        planilhaHref={
          drawerSessaoId ? `/prestacao/${drawerSessaoId}/planilha` : undefined
        }
      />
    </div>
  );
}
