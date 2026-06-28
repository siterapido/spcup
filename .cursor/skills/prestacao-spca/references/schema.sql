CREATE TABLE prestacao (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    estado TEXT NOT NULL,
    estado_uf TEXT NOT NULL,
    ano INTEGER NOT NULL,
    escopo TEXT,
    raiz TEXT NOT NULL,
    pasta_ano TEXT NOT NULL,
    atualizado_em TEXT,
    UNIQUE(estado, ano, escopo)
);

CREATE TABLE mes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    prestacao_id INTEGER NOT NULL REFERENCES prestacao(id) ON DELETE CASCADE,
    mes_slug TEXT NOT NULL,
    output_dir TEXT NOT NULL,
    cred_pix INTEGER DEFAULT 0,
    sucesso INTEGER DEFAULT 0,
    pendencias INTEGER DEFAULT 0,
    elegivel_xml INTEGER DEFAULT 0, revisao_atual INTEGER DEFAULT 0,
    UNIQUE(prestacao_id, mes_slug)
);

CREATE TABLE prontas_exportar (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    mes_id INTEGER NOT NULL REFERENCES mes(id) ON DELETE CASCADE,
    chave TEXT NOT NULL,
    data TEXT,
    valor TEXT,
    documento TEXT,
    nr_extrato_bancario TEXT,
    historico TEXT,
    nome_doador TEXT,
    cpf TEXT,
    cnpj TEXT,
    tipo_pessoa TEXT,
    fonte_recurso TEXT,
    natureza_recurso TEXT,
    classificacao_receita TEXT,
    nr_banco TEXT,
    agencia TEXT,
    dv_agencia TEXT,
    conta TEXT,
    dv_conta TEXT,
    cnpj_prestador TEXT,
    nome_diretorio TEXT,
    aprovado TEXT DEFAULT '', reincluir INTEGER DEFAULT 0,
    UNIQUE(mes_id, chave)
);

CREATE TABLE bloqueadas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    mes_id INTEGER NOT NULL REFERENCES mes(id) ON DELETE CASCADE,
    chave TEXT NOT NULL,
    data TEXT,
    valor TEXT,
    documento TEXT,
    historico TEXT,
    nome_pix TEXT,
    cpf_extrato TEXT,
    categoria TEXT,
    motivo TEXT,
    ignorar_exportacao TEXT DEFAULT '',
    UNIQUE(mes_id, chave)
);

CREATE TABLE fora_cadastro (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    prestacao_id INTEGER NOT NULL REFERENCES prestacao(id) ON DELETE CASCADE,
    situacao TEXT NOT NULL,
    nome TEXT NOT NULL,
    meses TEXT,
    qtd_transacoes TEXT,
    motivo TEXT,
    motivo_revisao TEXT,
    nome_cadastro_candidato TEXT,
    documento_candidato TEXT,
    similaridade TEXT,
    decisao TEXT DEFAULT '',
    observacao TEXT DEFAULT '',
    UNIQUE(prestacao_id, nome, situacao)
);

CREATE TABLE extrato_linha (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    mes_id INTEGER NOT NULL REFERENCES mes(id) ON DELETE CASCADE,
    data TEXT,
    valor TEXT,
    documento TEXT,
    historico TEXT,
    UNIQUE(mes_id, data, valor, documento, historico)
);

CREATE TABLE pessoas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    estado TEXT NOT NULL,
    ano INTEGER NOT NULL,
    nome TEXT NOT NULL,
    cpf_cnpj TEXT DEFAULT '',
    tipo_pessoa TEXT DEFAULT '',
    status TEXT DEFAULT '',
    atualizado_em TEXT,
    UNIQUE(estado, ano, nome, cpf_cnpj)
);

CREATE TABLE exportacao_xml (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    mes_id INTEGER NOT NULL REFERENCES mes(id) ON DELETE CASCADE,
    revisao_n INTEGER NOT NULL,
    path TEXT NOT NULL,
    origens INTEGER DEFAULT 0,
    gerado_em TEXT,
    UNIQUE(mes_id, revisao_n)
);

CREATE TABLE exportacao_xml_linha (
    mes_id INTEGER NOT NULL REFERENCES mes(id) ON DELETE CASCADE,
    chave TEXT NOT NULL,
    revisao_n INTEGER NOT NULL,
    exportado_em TEXT NOT NULL,
    reincluido INTEGER DEFAULT 0,
    PRIMARY KEY (mes_id, chave, revisao_n)
);

CREATE TABLE processamento_mes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    mes_id INTEGER NOT NULL REFERENCES mes(id) ON DELETE CASCADE,
    gerado_em TEXT NOT NULL,
    tipo TEXT NOT NULL,
    prontas_antes INTEGER DEFAULT 0,
    prontas_depois INTEGER DEFAULT 0,
    bloqueadas_antes INTEGER DEFAULT 0,
    bloqueadas_depois INTEGER DEFAULT 0,
    aprovadas_preservadas INTEGER DEFAULT 0,
    linhas_novas INTEGER DEFAULT 0,
    linhas_removidas INTEGER DEFAULT 0
);

CREATE INDEX idx_prontas_mes ON prontas_exportar(mes_id);

CREATE INDEX idx_bloqueadas_mes ON bloqueadas(mes_id);

CREATE INDEX idx_fora_prestacao ON fora_cadastro(prestacao_id);

CREATE INDEX idx_extrato_mes ON extrato_linha(mes_id);

CREATE INDEX idx_pessoas_estado_ano ON pessoas(estado, ano);

CREATE INDEX idx_exportacao_mes ON exportacao_xml(mes_id);

CREATE INDEX idx_exportacao_linha_mes ON exportacao_xml_linha(mes_id);

CREATE INDEX idx_processamento_mes ON processamento_mes(mes_id);

