---
name: SPC UP
description: Interface operacional de prestação de contas partidária — clara, institucional, marca UP contida.
colors:
  up-black: "#0f172a"
  up-white: "#fafafa"
  up-yellow: "#F8920E"
  surface-page: "#f8fafc"
  surface-card: "#ffffff"
  text-primary: "#0f172a"
  text-muted: "#475569"
  border-default: "#e2e8f0"
  status-success-bg: "#d1fae5"
  status-success-text: "#065f46"
  status-danger-bg: "#fee2e2"
  status-danger-text: "#991b1b"
  status-warn-bg: "#fef3c7"
  status-warn-text: "#92400e"
typography:
  display:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "1.875rem"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.025em"
  headline:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 500
    lineHeight: 1.35
  body:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: "normal"
rounded:
  sm: "4px"
  md: "6px"
  lg: "8px"
  full: "9999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "32px"
  page-x: "24px"
  page-y: "40px"
components:
  button-primary:
    backgroundColor: "{colors.up-black}"
    textColor: "{colors.up-white}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
  button-primary-hover:
    backgroundColor: "#1e293b"
    textColor: "{colors.up-white}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
  button-outline:
    backgroundColor: "{colors.surface-card}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
  badge-success:
    backgroundColor: "{colors.status-success-bg}"
    textColor: "{colors.status-success-text}"
    rounded: "{rounded.full}"
    padding: "2px 10px"
  badge-danger:
    backgroundColor: "{colors.status-danger-bg}"
    textColor: "{colors.status-danger-text}"
    rounded: "{rounded.full}"
    padding: "2px 10px"
---

# Design System: SPC UP

## Overview

**Creative North Star: "A Sala de Registro"**

Ambiente de trabalho institucional: mesa clara, documentos legíveis, estados de pendência visíveis. A interface prioriza **clareza operacional** (ver bloqueio de export, cadastro PF/PJ, movimentações) com densidade moderada, no espírito **Notion** — neutro, tipografia system sans, conteúdo antes de decoração.

Rejeita explicitamente: SaaS startup clichê, fintech neon, consumer colorido, ERP legado caótico e estética genérica de IA (glassmorphism, gradientes, bordas laterais coloridas).

**Key Characteristics:**

- Tema **claro** para escritório diurno; fundo de página levemente frio (`slate-50`), superfícies de trabalho brancas.
- Marca UP: **preto e branco** dominam estrutura; **amarelo** só em acentos (nav ativa, CTA secundário de destaque, ênfase positiva), não em fundos grandes.
- Profundidade por **borda + tom**, não por sombras dramáticas.
- Tabelas e formulários são o centro visual; cards são suporte, não vitrine.
- Status sempre com **cor + texto** (badges), nunca só cor.

## Colors

Paleta **restrained**: neutros tintados (slate) + acento amarelo UP em fração pequena da superfície. Implementação atual usa Tailwind `slate`; tokens abaixo incluem alvo de marca e mapeamento vigente.

### Primary

- **UP Ink** (`#0f172a` / oklch(23% 0.03 264)): texto principal, botões primários, header. Substitui preto puro; mesma família do ícone atual.
- **UP Signal Yellow** (`#F8920E` / oklch(72% 0.17 55)): acento de marca — link ativo, foco de ação positiva, detalhe no logo. Proibido como fundo de página inteira.

### Secondary

- *(omitido — um acento amarelo + neutros cobrem o piloto)*

### Tertiary

- *(omitido)*

### Neutral

- **Page Mist** (`#f8fafc`): fundo `body` (`bg-slate-50`).
- **Card White** (`#ffffff`): cards, header, inputs outline.
- **Muted Slate** (`#475569`): texto secundário, labels de tabela (`text-slate-600`).
- **Hairline Border** (`#e2e8f0`): bordas de card, header, inputs (`border-slate-200` / `300`).
- **UP Paper** (`#fafafa`): branco de marca levemente aquecido para texto em botão preto.

### Named Rules

**The Yellow Sparingly Rule.** Amarelo UP em ≤10% da área visível de qualquer tela. Se tudo “grita”, nada orienta.

**The No Pure Black Rule.** Não usar `#000` nem `#fff` crus; usar `up-black` e `up-white` tintados.

## Typography

**Display Font:** system UI stack (`ui-sans-serif, system-ui, …`)
**Body Font:** mesma pilha
**Label/Mono Font:** mesma pilha (sem mono dedicado no piloto)

**Character:** Institucional moderno — sem serif decorativa, sem mono de terminal. Hierarquia por peso e escala, não por famílias diferentes.

### Hierarchy

- **Display** (600, 1.875rem / `text-3xl`, tracking-tight): título de página (`Prestação de Contas`).
- **Headline** (500, 1.125rem / `text-lg`): títulos de card (`CardTitle`).
- **Title** (500, 0.875rem / `text-sm` + `font-medium`): labels de formulário.
- **Body** (400, 0.875rem / `text-sm`, line-height 1.5): parágrafos, células de tabela; máx. ~70ch em blocos de texto.
- **Label** (500, 0.75rem / `text-xs`): badges, metadados de status.

### Named Rules

**The Table-First Rule.** Em telas de dados, corpo `text-sm` e cabeçalhos `font-medium text-slate-600` vencem display grande.

## Elevation

Sistema **plano com leve lift**: profundidade vem de borda `1px` e contraste de fundo, não de sombras empilhadas.

- Cards: `shadow-sm` opcional + `border border-slate-200`.
- Header: `border-b` apenas, sem sombra.
- Hover em botões: mudança de background, sem `translateY` exagerado.

### Shadow Vocabulary

- **Card rest** (`0 1px 2px 0 rgb(0 0 0 / 0.05)`): único shadow padrão em `Card`.

### Named Rules

**The Flat-By-Default Rule.** Superfícies em repouso são planas. Sombra não marca hierarquia de informação, só separação leve de bloco.

## Components

Componentes em `apps/web/components/ui/` — variantes explícitas, Tailwind inline.

### Buttons

- **Shape:** cantos suaves (`rounded-md`, 6px).
- **Primary:** fundo `up-black`, texto branco tintado; hover um tom mais claro de slate (`slate-800`).
- **Outline:** borda slate, fundo branco; hover `slate-50`.
- **Ghost:** hover `slate-100` sem borda.
- **Destructive:** vermelho semântico (`red-600`) para ações irreversíveis apenas.
- **Focus:** ring slate no input; botões herdam outline do browser se não customizado — preferir `focus-visible:ring-2 ring-slate-500` em evoluções.

### Chips

- **Badge:** pill `rounded-full`, `text-xs`, tons `success` | `danger` | `warn` | `neutral` (fundos pastel + texto escuro da mesma família).

### Cards / Containers

- **Corner:** `rounded-lg` (8px).
- **Background:** branco, borda `slate-200`, padding `p-6`.
- **Shadow:** `shadow-sm` leve.
- **Uso:** agrupar formulários (filtro UF, upload, export), não aninhar card dentro de card.

### Inputs / Fields

- **Style:** borda `slate-300`, `rounded-md`, `text-sm`, padding vertical confortável.
- **Focus:** borda + ring `slate-500` (1px ring).
- **Error:** texto `red-600` abaixo do campo (login); sem borda vermelha gritante no piloto.

### Navigation

- **App header:** fundo branco, borda inferior, logo/nome `SPC UP` semibold, links `text-slate-600` → hover `slate-900`.
- **Estado ativo (alvo):** sublinhado ou `text-up-black` + detalhe amarelo (underline ou bottom border 2px `#F8920E`), não fundo colorido inteiro.
- **Email / sign-out:** texto muted, mesma linha de nav.

### Tables

- **Style:** `text-sm`, cabeçalho `border-b slate-200`, linhas `border-b slate-100`.
- **Densidade:** padding `px-3 py-2` — legível sem virar ERP microscópico.

## Do's and Don'ts

### Do:

- **Do** manter fundo de página `surface-page` e blocos de trabalho em branco com borda hairline.
- **Do** usar amarelo UP só para acento de marca e ênfase positiva, com texto escuro adjacente quando sobre amarelo.
- **Do** combinar Badge + texto descritivo para export bloqueado/liberado e pendências.
- **Do** limitar largura de conteúdo (`max-w-3xl` dashboard, `max-w-6xl` header) para leitura confortável.
- **Do** respeitar `prefers-reduced-motion` em transições futuras.

### Don't:

- **Don't** usar gradientes decorativos, hero metrics ou grids de cards idênticos com ícone (anti-referência SaaS startup).
- **Don't** usar dark neon, gráficos chamativos ou estética crypto (anti-referência fintech).
- **Don't** usar cores pastel consumer, gamificação ou tom informal de rede social.
- **Don't** usar glassmorphism padrão, bordas laterais coloridas >1px, texto em gradiente ou purple-on-gray genérico (anti-referência “feito por IA”).
- **Don't** empilhar dezenas de botões, fonte minúscula ou cinza morto sem hierarquia (anti-referência ERP legado).
- **Don't** aninhar cards; **Don't** usar `#000` / `#fff` puros.
- **Don't** indicar erro ou bloqueio apenas com cor — sempre com label legível.
