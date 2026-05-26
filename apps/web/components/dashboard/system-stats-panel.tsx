import { Badge } from "@/components/ui/badge";
import { Card, CardTitle } from "@/components/ui/card";
import { Table, Td, Th } from "@/components/ui/table";
import type { ConfiancaFaixas, SystemStats } from "@spc-up/core";

function StatusTable({ title, rows }: { title: string; rows: Record<string, number> }) {
  const entries = Object.entries(rows).sort(([a], [b]) => a.localeCompare(b));
  return (
    <div>
      <h3 className="text-sm font-medium text-up-black">{title}</h3>
      {entries.length === 0 ? (
        <p className="mt-1 text-sm text-muted">Nenhum registro.</p>
      ) : (
        <Table className="mt-2">
          <thead>
            <tr>
              <Th>Status</Th>
              <Th className="text-right">Qtd</Th>
            </tr>
          </thead>
          <tbody>
            {entries.map(([status, total]) => (
              <tr key={status}>
                <Td>{status}</Td>
                <Td className="text-right tabular-nums">{total}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
}

function ConfiancaTable({ faixas }: { faixas: ConfiancaFaixas }) {
  const rows = [
    { label: "< 60%", value: faixas.abaixo60 },
    { label: "60% – 85%", value: faixas.entre60e85 },
    { label: "≥ 85%", value: faixas.acima85 },
  ];
  return (
    <Table>
      <thead>
        <tr>
          <Th>Confiança</Th>
          <Th className="text-right">Movimentações</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.label}>
            <Td>{row.label}</Td>
            <Td className="text-right tabular-nums">{row.value}</Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

export function SystemStatsPanel({ stats }: { stats: SystemStats }) {
  const g = stats.global;
  const s = stats.scoped;

  return (
    <div className="space-y-6">
      <Card>
        <CardTitle>Visão nacional</CardTitle>
        <div className="mt-4 grid gap-8 lg:grid-cols-2">
          <StatusTable title="Movimentações por status" rows={g.movimentacoesPorStatus} />
          <StatusTable title="Arquivos de ingestão por status" rows={g.arquivosPorStatus} />
          <div>
            <h3 className="text-sm font-medium text-up-black">Confiança (todas UFs)</h3>
            <div className="mt-2">
              <ConfiancaTable faixas={g.confiancaFaixas} />
            </div>
          </div>
          <Table>
            <tbody>
              <tr>
                <Td>Bloqueadas para export</Td>
                <Td className="text-right tabular-nums">{g.movimentacoesBloqueadas}</Td>
              </tr>
              <tr>
                <Td>Conflitos de cadastro pendentes</Td>
                <Td className="text-right tabular-nums">{g.conflitosPendentes}</Td>
              </tr>
              <tr>
                <Td>Pessoas PF / PJ</Td>
                <Td className="text-right tabular-nums">
                  {g.pessoasPf} / {g.pessoasPj}
                </Td>
              </tr>
              <tr>
                <Td>Cadastros stub (nome desconhecido)</Td>
                <Td className="text-right tabular-nums">{g.pessoasStub}</Td>
              </tr>
              <tr>
                <Td>Sessões abertas ou em processamento</Td>
                <Td className="text-right tabular-nums">{g.sessoesAbertas}</Td>
              </tr>
              <tr>
                <Td>Diretórios estaduais com CNPJ placeholder</Td>
                <Td className="text-right tabular-nums">{g.diretoriosPlaceholder}</Td>
              </tr>
            </tbody>
          </Table>
        </div>
      </Card>

      <Card>
        <CardTitle>
          UF {stats.uf} · exercício {stats.exercicio}
        </CardTitle>
        <p className="mt-2">
          Exportação SPCA (legado UF):{" "}
          <Badge tone={s.exportavel ? "success" : "danger"}>
            {s.exportavel ? "liberada" : "bloqueada"}
          </Badge>
        </p>
        <p className="mt-1 text-xs text-muted">
          Export por prestador municipal: use o kanban da sessão de prestação.
        </p>
        <div className="mt-4 grid gap-8 lg:grid-cols-2">
          <StatusTable title="Movimentações por status" rows={s.movimentacoesPorStatus} />
          <StatusTable title="Arquivos por status" rows={s.arquivosPorStatus} />
          <div>
            <h3 className="text-sm font-medium text-up-black">Confiança neste escopo</h3>
            <div className="mt-2">
              <ConfiancaTable faixas={s.confiancaFaixas} />
            </div>
          </div>
          <Table>
            <tbody>
              <tr>
                <Td>Bloqueadas para export</Td>
                <Td className="text-right tabular-nums">{s.movimentacoesBloqueadas}</Td>
              </tr>
            </tbody>
          </Table>
        </div>
      </Card>
    </div>
  );
}
