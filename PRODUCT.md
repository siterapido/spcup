# Product

## Register

product

## Users

Operadores da **equipe nacional** da Unidade Popular (UP) que consolidam prestação de contas partidárias: ingestão de extratos/planilhas, revisão de pendências, cadastro de PF/PJ, confirmação de movimentações e exportação XML para o SPCA.

Uso previsto também por **usuários estaduais** (presente ou em expansão), em contexto de escritório, com pressão de prazos regulatórios e necessidade de confiar nos dados antes do upload manual no TSE.

Não é público geral nem marketing: é ferramenta interna de back-office financeiro/contábil.

## Product Purpose

**SPC UP** centraliza lançamentos dos diretórios estaduais, identifica responsáveis (CPF/CNPJ), aponta lacunas e gera os três XMLs (origem, aplicação, doação) validados por XSD, **por UF e exercício**, para importação no SPCA.

Sucesso do piloto: **clareza operacional** — enxergar o que bloqueia export, resolver cadastros e pendências, e exportar sem surpresas. A interface serve o fluxo, não vende o produto.

## Brand Personality

**Institucional · formal · confiável**

Tom sóbrio, adequado a contas partidárias e órgãos de controle: precisão de dados, linguagem direta, hierarquia legível. Referência de “jeito” de interface: **Notion** (neutro, conteúdo e estrutura em primeiro lugar), sem virar app consumer nem dashboard de startup.

Identidade UP no app operacional: **preto e branco** da marca, com **destaques em amarelo** (acentos, estados ativos, alertas positivos), sem saturar a tela.

## Anti-references

Evitar explicitamente:

- **SaaS startup**: gradientes decorativos, hero metrics, grids de cards idênticos com ícone + título + texto
- **Fintech/crypto**: dark neon, gráficos chamativos, estética de trading
- **Consumer/social**: cores pastel aleatórias, gamificação, tom informal
- **“Feito por IA”**: glassmorphism padrão, bordas laterais coloridas, texto em gradiente, purple-on-gray genérico
- **ERP legado**: cinza morto, tipografia minúscula, centenas de botões sem hierarquia, densidade caótica

## Design Principles

1. **Operação primeiro** — cada tela responde “o que faço agora?” (pendência, cadastro, export) antes de ornamentar.
2. **Dados auditáveis** — estados, bloqueios e erros de export devem ser óbvios; nunca esconder pendência atrás de UI bonita.
3. **Institucional sem burocracia visual** — formal e legível como sistemas públicos, mas com espaçamento e tipografia modernos (Notion-like), não ERP anos 2000.
4. **Marca contida** — preto/branco + amarelo UP em acentos e navegação; superfícies de trabalho permanecem neutras para leitura longa de tabelas.
5. **Confiança por consistência** — padrões repetíveis (tabelas, formulários, badges de status) valem mais que telas “únicas” por feature.

## Accessibility & Inclusion

Meta do piloto: **básico** — texto legível, contraste suficiente em tema claro de escritório, labels em formulários, foco visível e navegação por teclado nas telas principais. Sem auditoria WCAG formal nesta fase; evitar depender só de cor para status crítico (combinar com texto/ícone).

Tema principal: **claro**, uso diurno em monitor de escritório. Respeitar `prefers-reduced-motion` quando houver animação.
