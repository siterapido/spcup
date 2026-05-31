---
target: fluxo prestação wizard horizontal
total_score: 28
p0_count: 0
p1_count: 1
p2_count: 2
timestamp: 2026-05-27T21-59-05Z
slug: apps-web-components-prestacao-wizard-tsx
---
## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | Stepper horizontal melhora orientação; submit progress ainda condensado em mobile |
| 2 | Match System / Real World | 4 | Termos UF, exercício, prestador alinhados ao domínio TSE/SPCA |
| 3 | User Control and Freedom | 3 | Voltar por etapa concluída no stepper; sem cancelar wizard inteiro |
| 4 | Consistency and Standards | 3 | Stepper e progress panel agora coerentes; kanban já era horizontal |
| 5 | Error Prevention | 2 | Município obrigatório só no passo 5; placeholder CNPJ é aviso, não bloqueio |
| 6 | Recognition Rather Than Recall | 3 | Labels curtos no stepper; detalhe fica no painel da etapa |
| 7 | Flexibility and Efficiency | 2 | Wizard ainda linear; power user não pula para anexos |
| 8 | Aesthetic and Minimalist Design | 3 | Institucional limpo; amarelo só no anel da etapa ativa |
| 9 | Error Recovery | 3 | SubmissionProgressPanel com erros por arquivo e log técnico |
| 10 | Help and Documentation | 2 | Checkbox consolidar extratos explica bem; demais etapas sem microcopy |
| **Total** | | **28/40** | **Good — operacional, com gaps de eficiência** |

## Anti-Patterns Verdict

**LLM assessment:** Não parece "feito por IA". Superfície neutra slate/branco, sem gradientes, glassmorphism ou hero metrics. O fluxo anterior (texto "Passo X de 5" + lista vertical) era genérico de wizard SaaS; o stepper horizontal com conectores reduz essa sensação.

**Deterministic scan:** Indisponível (`bundled detector not found`). Revisão manual do markup: sem bordas laterais coloridas, sem gradient text, sem side-stripe alerts (avisos usam borda completa amber).

## Overall Impression

O wizard de nova prestação ganha legibilidade operacional com o stepper horizontal: o operador enxerga o pipeline inteiro (UF → Anexos) antes de concluir. A maior oportunidade restante é dar feedback mais cedo sobre bloqueios (CNPJ placeholder, município vazio) e encurtar o caminho para usuários recorrentes.

## What's Working

1. **Hierarquia institucional contida** — preto/branco + amarelo só no foco da etapa ativa respeita a regra de marca UP.
2. **Painel de submit com erros auditáveis** — código, mensagem e detalhe técnico por arquivo atendem operadores que precisam corrigir ingestão.
3. **Kanban já horizontal** — colunas com scroll lateral coerentes com revisão de movimentações.

## Priority Issues

**[P1] Orientação fraca no fluxo vertical anterior**
- **Why:** Operador não via o pipeline completo; "Passo 3 de 5" exige memória.
- **Fix:** Stepper horizontal com labels e navegação às etapas concluídas. *(Implementado nesta sessão.)*
- **Suggested command:** `impeccable layout`

**[P2] Validação tardia de prestador municipal**
- **Why:** Só descobre município obrigatório ao tentar avançar do passo 3; aumenta idas e vindas.
- **Fix:** Desabilitar "Continuar" com mensagem inline quando lista vazia; link para cadastro mais visível.
- **Suggested command:** `impeccable harden`

**[P2] Progresso de submit ilegível em telas estreitas**
- **Why:** Cinco labels longos em fila horizontal podem truncar ("Consolidar extratos bancários").
- **Fix:** Abreviar labels no stepper de submit ou empilhar em breakpoint sm.
- **Suggested command:** `impeccable adapt`

**[P3] Falta atalho para operação recorrente**
- **Why:** Equipe nacional repete UF/exercício; wizard sempre reinicia do passo 1.
- **Fix:** Lembrar última UF/tipo via query ou localStorage; CTA "Repetir última prestação".
- **Suggested command:** `impeccable onboard`

## Persona Red Flags

**Alex (Power User):** Cinco cliques mínimos antes de anexar arquivos. Sem atalho de teclado entre etapas. Checkbox de consolidar extratos só no último passo.

**Jordan (First-Timer):** Label "Prestador" no passo 3 pode confundir quem espera "Município" sempre; copy muda conforme tipo. Aviso de CNPJ placeholder parece secundário, fácil ignorar.

**Operador UP (persona do produto):** Fluxo guiado no dashboard ainda é card com parágrafo + botões, não espelha o stepper da nova prestação.

## Minor Observations

- `max-w-3xl` na página nova prestação acomoda melhor o stepper que `max-w-2xl`.
- Etapas concluídas são botões circulares; foco visível presente, bom para teclado.
- Submission progress: conectores horizontais entre ícones alinham visualmente com o wizard.

## Questions to Consider

- O operador precisa ver todas as cinco etapas sempre, ou UF + exercício poderiam ser filtros globais no header?
- Consolidar extratos deveria aparecer antes do upload, quando ainda dá para escolher PDFs?
- O dashboard deveria mostrar o mesmo stepper horizontal como mapa do fluxo end-to-end?
