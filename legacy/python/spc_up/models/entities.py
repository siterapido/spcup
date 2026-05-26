"""SQLAlchemy entity models."""

import enum
import uuid
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import ARRAY, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from spc_up.models.base import Base


class MovimentacaoDirecao(str, enum.Enum):
    ENTRADA = "ENTRADA"
    SAIDA = "SAIDA"


class MovimentacaoStatus(str, enum.Enum):
    RASCUNHO = "RASCUNHO"
    PENDENTE_REVISAO = "PENDENTE_REVISAO"
    CONFIRMADO = "CONFIRMADO"
    EXPORTADO = "EXPORTADO"
    REJEITADO = "REJEITADO"


class ArquivoIngestaoStatus(str, enum.Enum):
    PENDENTE = "PENDENTE"
    PROCESSANDO = "PROCESSANDO"
    CONCLUIDO = "CONCLUIDO"
    ERRO = "ERRO"


class DiretorioEstadual(Base):
    __tablename__ = "diretorio_estadual"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    uf: Mapped[str] = mapped_column(String(2), unique=True, nullable=False)
    cnpj_prestador: Mapped[str] = mapped_column(String(14), nullable=False)
    nome: Mapped[str] = mapped_column(String(255), nullable=False)
    ativo: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    contas_bancarias: Mapped[list["ContaBancaria"]] = relationship(back_populates="diretorio_estadual")
    arquivos_ingestao: Mapped[list["ArquivoIngestao"]] = relationship(back_populates="diretorio_estadual")


class ContaBancaria(Base):
    __tablename__ = "conta_bancaria"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    diretorio_estadual_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("diretorio_estadual.id"), nullable=False
    )
    agencia: Mapped[str] = mapped_column(String(10), nullable=False)
    conta: Mapped[str] = mapped_column(String(20), nullable=False)
    dv: Mapped[str | None] = mapped_column(String(2))
    ativo: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    diretorio_estadual: Mapped["DiretorioEstadual"] = relationship(back_populates="contas_bancarias")
    movimentacoes: Mapped[list["Movimentacao"]] = relationship(back_populates="conta_bancaria")


class PessoaFisica(Base):
    __tablename__ = "pessoa_fisica"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    cpf: Mapped[str] = mapped_column(String(11), unique=True, nullable=False)
    nome: Mapped[str] = mapped_column(String(255), nullable=False)
    titulo_eleitor: Mapped[str | None] = mapped_column(String(12))
    aliases: Mapped[list[str] | None] = mapped_column(ARRAY(String))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    movimentacoes: Mapped[list["Movimentacao"]] = relationship(
        back_populates="pessoa_fisica", foreign_keys="Movimentacao.pessoa_fisica_id"
    )


class PessoaJuridica(Base):
    __tablename__ = "pessoa_juridica"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    cnpj: Mapped[str] = mapped_column(String(14), unique=True, nullable=False)
    razao_social: Mapped[str] = mapped_column(String(255), nullable=False)
    aliases: Mapped[list[str] | None] = mapped_column(ARRAY(String))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    movimentacoes: Mapped[list["Movimentacao"]] = relationship(
        back_populates="pessoa_juridica", foreign_keys="Movimentacao.pessoa_juridica_id"
    )


class ArquivoIngestao(Base):
    __tablename__ = "arquivo_ingestao"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    diretorio_estadual_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("diretorio_estadual.id"), nullable=False
    )
    uf: Mapped[str] = mapped_column(String(2), nullable=False)
    exercicio: Mapped[int] = mapped_column(Integer, nullable=False)
    nome_arquivo: Mapped[str] = mapped_column(String(512), nullable=False)
    hash_arquivo: Mapped[str] = mapped_column(String(64), nullable=False)
    caminho_storage: Mapped[str] = mapped_column(String(1024), nullable=False)
    status: Mapped[ArquivoIngestaoStatus] = mapped_column(
        String(20), default=ArquivoIngestaoStatus.PENDENTE, nullable=False
    )
    erro_mensagem: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    diretorio_estadual: Mapped["DiretorioEstadual"] = relationship(back_populates="arquivos_ingestao")
    movimentacoes: Mapped[list["Movimentacao"]] = relationship(back_populates="arquivo_ingestao")


class Movimentacao(Base):
    __tablename__ = "movimentacao"
    __table_args__ = (UniqueConstraint("uf", "exercicio", "hash_movimento", name="uq_mov_uf_exercicio_hash"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    uf: Mapped[str] = mapped_column(String(2), nullable=False, index=True)
    exercicio: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    direcao: Mapped[MovimentacaoDirecao] = mapped_column(String(10), nullable=False)
    valor: Mapped[Decimal] = mapped_column(Numeric(15, 2), nullable=False)
    data_movimento: Mapped[date] = mapped_column(Date, nullable=False)
    descricao_raw: Mapped[str] = mapped_column(Text, nullable=False)
    nr_extrato_bancario: Mapped[str | None] = mapped_column(String(64))
    conta_bancaria_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("conta_bancaria.id")
    )
    pessoa_fisica_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("pessoa_fisica.id")
    )
    pessoa_juridica_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("pessoa_juridica.id")
    )
    arquivo_ingestao_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("arquivo_ingestao.id")
    )
    status: Mapped[MovimentacaoStatus] = mapped_column(
        String(20), default=MovimentacaoStatus.RASCUNHO, nullable=False
    )
    confianca_global: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    bloqueio_export: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    hash_movimento: Mapped[str] = mapped_column(String(64), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    conta_bancaria: Mapped["ContaBancaria | None"] = relationship(back_populates="movimentacoes")
    pessoa_fisica: Mapped["PessoaFisica | None"] = relationship(
        back_populates="movimentacoes", foreign_keys=[pessoa_fisica_id]
    )
    pessoa_juridica: Mapped["PessoaJuridica | None"] = relationship(
        back_populates="movimentacoes", foreign_keys=[pessoa_juridica_id]
    )
    arquivo_ingestao: Mapped["ArquivoIngestao | None"] = relationship(back_populates="movimentacoes")
    spca: Mapped["MovimentacaoSpca | None"] = relationship(
        back_populates="movimentacao", uselist=False, cascade="all, delete-orphan"
    )
    evidencias: Mapped[list["MatchEvidencia"]] = relationship(
        back_populates="movimentacao", cascade="all, delete-orphan"
    )
    doacao_link: Mapped["DoacaoFinanceiraLink | None"] = relationship(
        back_populates="movimentacao_origem", uselist=False, cascade="all, delete-orphan"
    )


class MovimentacaoSpca(Base):
    __tablename__ = "movimentacao_spca"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    movimentacao_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("movimentacao.id"), unique=True, nullable=False
    )
    modulos: Mapped[list[str] | None] = mapped_column(ARRAY(String))
    fonte_recurso: Mapped[str | None] = mapped_column(String(4))
    natureza_recurso: Mapped[str | None] = mapped_column(String(1))
    tipo_origem_recurso: Mapped[str | None] = mapped_column(String(2))
    classificacao_receita: Mapped[str | None] = mapped_column(String(3))
    especie_recurso: Mapped[str | None] = mapped_column(String(10))
    cd_descricao_gasto: Mapped[str | None] = mapped_column(String(10))
    tipo_documento: Mapped[str | None] = mapped_column(String(10))
    nr_documento: Mapped[str | None] = mapped_column(String(64))
    data_emissao_contratacao: Mapped[date | None] = mapped_column(Date)
    detalhe_situacao: Mapped[int | None] = mapped_column(Integer)
    descricao_resumida: Mapped[str | None] = mapped_column(String(512))
    nr_recibo_doacao: Mapped[str | None] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    movimentacao: Mapped["Movimentacao"] = relationship(back_populates="spca")


class MatchEvidencia(Base):
    __tablename__ = "match_evidencia"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    movimentacao_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("movimentacao.id"), nullable=False, index=True
    )
    tipo: Mapped[str] = mapped_column(String(64), nullable=False)
    peso: Mapped[float] = mapped_column(Float, nullable=False)
    detalhe: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    movimentacao: Mapped["Movimentacao"] = relationship(back_populates="evidencias")


class DoacaoFinanceiraLink(Base):
    __tablename__ = "doacao_financeira_link"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    movimentacao_origem_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("movimentacao.id"), unique=True, nullable=False
    )
    sincronizado: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    movimentacao_origem: Mapped["Movimentacao"] = relationship(back_populates="doacao_link")
