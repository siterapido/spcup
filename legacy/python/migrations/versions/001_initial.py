"""Initial schema for SPC UP."""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "diretorio_estadual",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("uf", sa.String(length=2), nullable=False),
        sa.Column("cnpj_prestador", sa.String(length=14), nullable=False),
        sa.Column("nome", sa.String(length=255), nullable=False),
        sa.Column("ativo", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("uf"),
    )
    op.create_table(
        "pessoa_fisica",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("cpf", sa.String(length=11), nullable=False),
        sa.Column("nome", sa.String(length=255), nullable=False),
        sa.Column("titulo_eleitor", sa.String(length=12), nullable=True),
        sa.Column("aliases", postgresql.ARRAY(sa.String()), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("cpf"),
    )
    op.create_table(
        "pessoa_juridica",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("cnpj", sa.String(length=14), nullable=False),
        sa.Column("razao_social", sa.String(length=255), nullable=False),
        sa.Column("aliases", postgresql.ARRAY(sa.String()), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("cnpj"),
    )
    op.create_table(
        "conta_bancaria",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("diretorio_estadual_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("agencia", sa.String(length=10), nullable=False),
        sa.Column("conta", sa.String(length=20), nullable=False),
        sa.Column("dv", sa.String(length=2), nullable=True),
        sa.Column("ativo", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["diretorio_estadual_id"], ["diretorio_estadual.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_table(
        "arquivo_ingestao",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("diretorio_estadual_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("uf", sa.String(length=2), nullable=False),
        sa.Column("exercicio", sa.Integer(), nullable=False),
        sa.Column("nome_arquivo", sa.String(length=512), nullable=False),
        sa.Column("hash_arquivo", sa.String(length=64), nullable=False),
        sa.Column("caminho_storage", sa.String(length=1024), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("erro_mensagem", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["diretorio_estadual_id"], ["diretorio_estadual.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_table(
        "movimentacao",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("uf", sa.String(length=2), nullable=False),
        sa.Column("exercicio", sa.Integer(), nullable=False),
        sa.Column("direcao", sa.String(length=10), nullable=False),
        sa.Column("valor", sa.Numeric(precision=15, scale=2), nullable=False),
        sa.Column("data_movimento", sa.Date(), nullable=False),
        sa.Column("descricao_raw", sa.Text(), nullable=False),
        sa.Column("nr_extrato_bancario", sa.String(length=64), nullable=True),
        sa.Column("conta_bancaria_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("pessoa_fisica_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("pessoa_juridica_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("arquivo_ingestao_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("confianca_global", sa.Float(), nullable=False),
        sa.Column("bloqueio_export", sa.Boolean(), nullable=False),
        sa.Column("hash_movimento", sa.String(length=64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["arquivo_ingestao_id"], ["arquivo_ingestao.id"]),
        sa.ForeignKeyConstraint(["conta_bancaria_id"], ["conta_bancaria.id"]),
        sa.ForeignKeyConstraint(["pessoa_fisica_id"], ["pessoa_fisica.id"]),
        sa.ForeignKeyConstraint(["pessoa_juridica_id"], ["pessoa_juridica.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("uf", "exercicio", "hash_movimento", name="uq_mov_uf_exercicio_hash"),
    )
    op.create_index(op.f("ix_movimentacao_exercicio"), "movimentacao", ["exercicio"], unique=False)
    op.create_index(op.f("ix_movimentacao_uf"), "movimentacao", ["uf"], unique=False)
    op.create_table(
        "doacao_financeira_link",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("movimentacao_origem_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("sincronizado", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["movimentacao_origem_id"], ["movimentacao.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("movimentacao_origem_id"),
    )
    op.create_table(
        "match_evidencia",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("movimentacao_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("tipo", sa.String(length=64), nullable=False),
        sa.Column("peso", sa.Float(), nullable=False),
        sa.Column("detalhe", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["movimentacao_id"], ["movimentacao.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_match_evidencia_movimentacao_id"), "match_evidencia", ["movimentacao_id"], unique=False)
    op.create_table(
        "movimentacao_spca",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("movimentacao_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("modulos", postgresql.ARRAY(sa.String()), nullable=True),
        sa.Column("fonte_recurso", sa.String(length=4), nullable=True),
        sa.Column("natureza_recurso", sa.String(length=1), nullable=True),
        sa.Column("tipo_origem_recurso", sa.String(length=2), nullable=True),
        sa.Column("classificacao_receita", sa.String(length=3), nullable=True),
        sa.Column("especie_recurso", sa.String(length=10), nullable=True),
        sa.Column("cd_descricao_gasto", sa.String(length=10), nullable=True),
        sa.Column("tipo_documento", sa.String(length=10), nullable=True),
        sa.Column("nr_documento", sa.String(length=64), nullable=True),
        sa.Column("data_emissao_contratacao", sa.Date(), nullable=True),
        sa.Column("detalhe_situacao", sa.Integer(), nullable=True),
        sa.Column("descricao_resumida", sa.String(length=512), nullable=True),
        sa.Column("nr_recibo_doacao", sa.String(length=64), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["movimentacao_id"], ["movimentacao.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("movimentacao_id"),
    )


def downgrade() -> None:
    op.drop_table("movimentacao_spca")
    op.drop_index(op.f("ix_match_evidencia_movimentacao_id"), table_name="match_evidencia")
    op.drop_table("match_evidencia")
    op.drop_table("doacao_financeira_link")
    op.drop_index(op.f("ix_movimentacao_uf"), table_name="movimentacao")
    op.drop_index(op.f("ix_movimentacao_exercicio"), table_name="movimentacao")
    op.drop_table("movimentacao")
    op.drop_table("arquivo_ingestao")
    op.drop_table("conta_bancaria")
    op.drop_table("pessoa_juridica")
    op.drop_table("pessoa_fisica")
    op.drop_table("diretorio_estadual")
