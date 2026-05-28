# Distribuição do spcup para usuários finais

A CLI **`spcup`** pode ser instalada **sem clonar o repositório**. Basta Node.js 20+.

Repositório: **https://github.com/siterapido/spcup**

## Para o usuário final (instalação em uma linha)

```bash
curl -fsSL https://raw.githubusercontent.com/siterapido/spcup/main/scripts/install-spcup.sh | bash
```

O script baixa automaticamente o **último release** do GitHub (arquivo `spc-up-cli-*.tgz`).

### Se der erro 404

Significa que **ainda não há release publicado**. Peça à equipe UP o arquivo `.tgz` e instale:

```bash
SPCUP_LOCAL_TARBALL=/caminho/spc-up-cli-0.1.0.tgz \
  bash -c "$(curl -fsSL https://raw.githubusercontent.com/siterapido/spcup/main/scripts/install-spcup.sh)"
```

Ou envie o `.tgz` por e-mail/Drive e:

```bash
npm install -g /caminho/spc-up-cli-0.1.0.tgz
spcup install
```

## Para a equipe UP (publicar nova versão)

```bash
./scripts/pack-cli.sh
git tag v0.1.0
git push origin v0.1.0
# GitHub Actions anexa dist/releases/spc-up-cli-0.1.0.tgz ao release
```

Depois disso, o comando de uma linha acima funciona para todos.

### Gerar .tgz sem publicar (enviar manualmente)

```bash
./scripts/pack-cli.sh
# Enviar dist/releases/spc-up-cli-0.1.0.tgz ao usuário
```

## Após instalar

1. Editar `~/.spc-up/.env` com `DATABASE_URL` e `OPENROUTER_API_KEY` (fornecidos pela UP)
2. Web UP: criar sessão em `/prestacao/nova`
3. No computador local:

```bash
spcup cadastro import --uf BA --exercicio 2025 --file pessoas.xlsx
spcup prestacao run --sessao <uuid> --path ./extratos/
```

4. Web UP: kanban → exportar

## Requisitos

- Node.js 20+
- `DATABASE_URL` (Neon da UP)
- `OPENROUTER_API_KEY` (para PDF)
- Kanban e export na **web** (não precisa rodar o app localmente)
