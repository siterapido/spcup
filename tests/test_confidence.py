from types import SimpleNamespace

from spc_up.services.confidence import (
    Evidence,
    compute_confidence,
    evaluate_movimentacao,
)


def test_conflict_caps_score():
    ev = [
        Evidence("CPF_EXATO", 0.45),
        Evidence("CONFLITO_CPF", 0.0, cap=0.40),
    ]
    assert compute_confidence(ev) == 0.40


def test_evaluate_movimentacao_blocks_export_without_spca():
    movimentacao = SimpleNamespace(
        confianca_global=0.0,
        bloqueio_export=False,
        spca=None,
        evidencias=[],
    )

    score = evaluate_movimentacao(
        movimentacao,
        evidences=[Evidence("CPF_EXATO", 0.45)],
    )

    assert score == 0.45
    assert movimentacao.confianca_global == 0.45
    assert movimentacao.bloqueio_export is True


def test_evaluate_movimentacao_unblocks_when_spca_complete():
    spca = SimpleNamespace(
        fonte_recurso="FP",
        natureza_recurso="0",
        tipo_origem_recurso="PF",
    )
    movimentacao = SimpleNamespace(
        confianca_global=0.0,
        bloqueio_export=True,
        spca=spca,
        evidencias=[],
    )

    evaluate_movimentacao(
        movimentacao,
        evidences=[Evidence("CPF_EXATO", 0.45), Evidence("VALOR_DATA", 0.25)],
    )

    assert movimentacao.confianca_global == 0.70
    assert movimentacao.bloqueio_export is False
