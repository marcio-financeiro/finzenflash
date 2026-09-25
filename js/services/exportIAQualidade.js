// exportIAQualidade.js — validações, metadados e dicionário de dados da
// exportação "Análise com IA". Problemas não-críticos NUNCA bloqueiam a
// exportação — só ficam registrados aqui pra o usuário (e a IA) saberem
// que existem.

export function validarQualidade(dados, movimentos) {
  const problemas = {
    duplicidades: 0,
    sem_data: 0,
    sem_valor: 0,
    sem_categoria: 0,
    valores_invalidos: 0,
    parcelamentos_inconsistentes: 0,
    transferencias_inconsistentes: 0,
    investimentos_sem_ticker: 0,
    investimentos_sem_preco: 0,
    patrimonio_inconsistente: 0,
    meses_sem_snapshot_patrimonio: 0,
  };

  const vistos = new Set();
  for (const m of movimentos) {
    if (!m.data) problemas.sem_data += 1;
    if (m.valor === null || m.valor === undefined || Number.isNaN(m.valor)) problemas.sem_valor += 1;
    else if (m.valor < 0) problemas.valores_invalidos += 1;
    if ((m.tipo === 'receita' || m.tipo === 'despesa') && !m.categoria) problemas.sem_categoria += 1;

    // parcela_atual entra na chave porque parcelas da mesma compra
    // compartilham data/descrição/conta (e às vezes até o mesmo valor) de
    // propósito — sem isso, toda compra parcelada seria marcada como
    // "duplicidade" só por ser parcelada.
    const chave = `${m.data}|${m.valor}|${m.descricao}|${m.conta}|${m.parcela_atual ?? ''}`;
    if (vistos.has(chave)) problemas.duplicidades += 1;
    vistos.add(chave);
  }

  for (const c of dados.cardTransactions) {
    if (Number(c.parcela_atual) > Number(c.parcelas)) problemas.parcelamentos_inconsistentes += 1;
  }

  for (const at of dados.accountTransfers) {
    if (at.from_account_id === at.to_account_id) problemas.transferencias_inconsistentes += 1;
  }

  for (const inv of dados.investments) {
    if (!inv.ticker) problemas.investimentos_sem_ticker += 1;
    if (inv.cotacao_atual === null || inv.cotacao_atual === undefined) problemas.investimentos_sem_preco += 1;
  }

  for (const p of dados.patrimonyHistory) {
    const esperado = Number(p.accounts_total) + Number(p.investments_total) - Number(p.cards_total);
    if (Math.abs(esperado - Number(p.net_worth)) > 0.05) problemas.patrimonio_inconsistente += 1;
  }

  const totalProblemasNaoCriticos = Object.values(problemas).reduce((s, n) => s + n, 0);
  const status = totalProblemasNaoCriticos === 0 ? 'ok' : totalProblemasNaoCriticos < movimentos.length * 0.05 ? 'warning' : 'attention';

  return {
    status, // 'ok' | 'warning' | 'attention' — nunca bloqueia a exportação
    movimentacoes_analisadas: movimentos.length,
    ...problemas,
  };
}

export function montarMetadata({ inicio, fim, movimentos, dados, qualidade, appVersion }) {
  return {
    produto: 'FinZen Flash',
    schema_version: '1.0',
    gerado_em: new Date().toISOString(),
    app_version: appVersion || null,
    currency: 'BRL',
    period_start: inicio,
    period_end: fim,
    total_movimentacoes: movimentos.length,
    total_contas: dados.accounts.length,
    total_cartoes: dados.creditCards.length,
    total_categorias: dados.categories.length,
    total_investimentos: dados.investments.length,
    arquivos_incluidos: [
      'finzen_movimentacoes.csv',
      'finzen_monthly.csv',
      'finzen_patrimonio.csv',
      'finzen_investimentos.csv',
      'finzen_indicadores.json',
      'finzen_carteira.json',
      'finzen_data_quality.json',
      'finzen_metadata.json',
      'finzen_data_dictionary.json',
      'finzen_prompt_sugerido.txt',
    ],
    qualidade_dos_dados: qualidade.status,
  };
}

export const DATA_DICTIONARY = {
  finzen_movimentacoes: {
    descricao: 'Uma linha por movimentação financeira real (não um resumo). Fonte de verdade — todo indicador pode ser recalculado a partir daqui.',
    campos: {
      id: { description: 'Identificador único, prefixado pela tabela de origem (tx_/ct_/at_/ex_/it_/dv_).', type: 'string' },
      data: { description: 'Data do evento (ISO YYYY-MM-DD).', type: 'string', format: 'date' },
      mes_referencia: { description: 'Mês usado para agrupamento mensal. Para compras no cartão é o mês da FATURA (não o mês da compra) — segue a mesma regra do resto do FinZen.', type: 'string' },
      tipo: { description: 'Tipo econômico/financeiro da movimentação.', type: 'string', allowed_values: ['receita', 'despesa', 'transferencia_interna', 'cambio', 'investimento_compra', 'investimento_venda', 'dividendo', 'pagamento_fatura'] },
      descricao: { description: 'Descrição livre digitada pelo usuário (ou gerada automaticamente pra transferências/câmbio/investimentos).', type: 'string' },
      valor: { description: 'Valor absoluto (sem sinal) na moeda do campo moeda.', type: 'number', unit: 'currency' },
      moeda: { description: 'Moeda do valor.', type: 'string', allowed_values: ['BRL', 'USD'] },
      categoria: { description: 'Nome da categoria (null pra transferências/câmbio).', type: 'string|null' },
      subcategoria: { description: 'Sempre null hoje — FinZen não tem subcategoria estruturada (só um campo parent_id não usado na prática).', type: 'null' },
      conta: { description: 'Nome da conta ou cartão envolvido.', type: 'string|null' },
      forma_pagamento: { description: 'Como o dinheiro se moveu.', type: 'string', allowed_values: ['conta', 'cartao', 'transferencia', 'cambio'] },
      fixo_variavel: { description: 'Classificação manual da categoria. Null = usuário não classificou essa categoria ainda.', type: 'string|null', allowed_values: ['fixo', 'variavel', null] },
      essencial_nao_essencial: { description: 'Classificação manual da categoria. Null = usuário não classificou essa categoria ainda.', type: 'string|null', allowed_values: ['essencial', 'nao_essencial', null] },
      parcelado: { description: 'true se a compra no cartão tem mais de 1 parcela.', type: 'boolean' },
      parcela_atual: { description: 'Número da parcela desta linha (só compras no cartão).', type: 'number|null' },
      total_parcelas: { description: 'Total de parcelas da compra (só compras no cartão).', type: 'number|null' },
      valor_parcela: { description: 'Valor desta parcela (redundante com "valor" pra linhas de cartão, mantido por clareza).', type: 'number|null' },
      recorrente: { description: 'true se a transação faz parte de uma recorrência (conta fixa, assinatura, etc).', type: 'boolean' },
      tags: { description: 'Tags livres do usuário, separadas por ";". Null se não houver.', type: 'string|null' },
      observacao: { description: 'Campo de notas livre do lançamento.', type: 'string|null' },
      status: { description: "Situação da movimentação. 'pago' = já efetivada (entra nos indicadores de fluxo de caixa); 'pendente' = ainda não aconteceu de fato.", type: 'string' },
    },
  },
  finzen_monthly: { descricao: 'Uma linha por mês — consolidação, nunca substitui finzen_movimentacoes.csv.' },
  finzen_patrimonio: { descricao: 'Uma linha por mês, copiada diretamente de patrimony_history (calculado pelo próprio FinZen). dividas = fatura de cartão em aberto — o FinZen não tem conceito de empréstimo/financiamento; saldo negativo de conta já reduz "disponibilidade" em vez de aparecer aqui.' },
  finzen_investimentos: { descricao: 'Uma linha por ativo na carteira (posição atual, não histórico de operações — isso está em finzen_movimentacoes.csv com tipo investimento_compra/investimento_venda/dividendo).' },
  finzen_indicadores: {
    descricao: 'Camada 3 — dois blocos: "periodo_atual" (indicadores do período pedido) e "periodo_anterior" (mesmo indicadores, calculados pro período de mesmo tamanho imediatamente anterior — pra IA comparar tendência, não só foto). Dentro de cada bloco, cada indicador tem valor/período/unidade/fórmula/origem e pode ser recalculado a partir dos CSVs primários citados em "source". "periodo_anterior" pode vir todo com valor null se não houver dados nesse intervalo (ex: conta nova).',
  },
  finzen_carteira: { descricao: 'Seis dimensões independentes de avaliação financeira do período atual (fluxo de caixa, liquidez, poupança, endividamento, patrimônio, investimentos). Deliberadamente SEM um score único — ver seção 10 da especificação original.' },
  finzen_prompt_sugerido: { descricao: 'Texto pronto (não JSON/CSV) com um prompt sugerido pra colar numa IA externa junto com o pacote — poupa descrever o contexto toda vez.' },
};
