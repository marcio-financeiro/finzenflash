// exportIAIndicadores.js — camada 3 da exportação "Análise com IA":
// indicadores calculados a partir dos dados primários (nunca o contrário).
// Cada indicador carrega valor/período/unidade/fórmula/origem — a IA deve
// conseguir recalcular qualquer um deles a partir dos CSVs primários.

function media(valores) {
  const v = valores.filter((n) => n !== null && n !== undefined && !Number.isNaN(n));
  if (!v.length) return null;
  return v.reduce((s, n) => s + n, 0) / v.length;
}

function desvioPadrao(valores) {
  const v = valores.filter((n) => n !== null && n !== undefined && !Number.isNaN(n));
  if (v.length < 2) return null;
  const m = media(v);
  const variancia = v.reduce((s, n) => s + (n - m) ** 2, 0) / (v.length - 1);
  return Math.sqrt(variancia);
}

function soma(valores) {
  return valores.filter((n) => n !== null && n !== undefined && !Number.isNaN(n)).reduce((s, n) => s + n, 0);
}

function divisao(a, b) {
  if (!b) return null;
  return a / b;
}

function ind(valor, periodo, unidade, formula, source) {
  return { valor: valor === null || valor === undefined || Number.isNaN(valor) ? null : Math.round(valor * 10000) / 10000, periodo, unidade, formula, source };
}

export function calcularIndicadores(movimentos, monthly, patrimonio, inicioYM, fimYM) {
  const periodo = `${inicioYM}/${fimYM}`;
  const receitas = monthly.map((m) => m.receita_total);
  const despesas = monthly.map((m) => m.despesa_total);
  const saldos = monthly.map((m) => m.saldo);

  const receitaTotalPeriodo = soma(receitas);
  const despesaTotalPeriodo = soma(despesas);
  const despesasFixasTotal = soma(monthly.map((m) => m.despesas_fixas));
  const despesasVariaveisTotal = soma(monthly.map((m) => m.despesas_variaveis));
  const despesasEssenciaisTotal = soma(monthly.map((m) => m.despesas_essenciais));
  const despesasNaoEssenciaisTotal = soma(monthly.map((m) => m.despesas_nao_essenciais));
  const investimentosTotal = soma(monthly.map((m) => m.investimentos_realizados));
  const dividasPagasTotal = soma(monthly.map((m) => m.dividas_pagas));

  const patrimonioOrdenado = [...patrimonio].sort((a, b) => (a.mes < b.mes ? -1 : 1));
  const patrimonioInicio = patrimonioOrdenado[0]?.patrimonio_liquido ?? null;
  const patrimonioFim = patrimonioOrdenado[patrimonioOrdenado.length - 1]?.patrimonio_liquido ?? null;
  const disponibilidadeAtual = patrimonioOrdenado[patrimonioOrdenado.length - 1]?.disponibilidade ?? null;
  const dividaAtual = patrimonioOrdenado[patrimonioOrdenado.length - 1]?.dividas ?? null;

  const despesaRecorrenteTotal = soma(movimentos.filter((m) => m.tipo === 'despesa' && m.recorrente).map((m) => m.valor));

  const porCategoria = new Map();
  for (const m of movimentos) {
    if (m.tipo !== 'despesa') continue;
    const chave = m.categoria || 'Sem categoria';
    porCategoria.set(chave, (porCategoria.get(chave) || 0) + m.valor);
  }
  const maiorCategoria = [...porCategoria.entries()].sort((a, b) => b[1] - a[1])[0];

  const primeiraDespesa = despesas[0];
  const ultimaDespesa = despesas[despesas.length - 1];
  const primeiraReceita = receitas[0];
  const ultimaReceita = receitas[receitas.length - 1];
  const crescimentoDespesas = primeiraDespesa > 0 ? (ultimaDespesa - primeiraDespesa) / primeiraDespesa : null;
  const crescimentoReceita = primeiraReceita > 0 ? (ultimaReceita - primeiraReceita) / primeiraReceita : null;

  return {
    fluxo_de_caixa: {
      receita_media_mensal: ind(media(receitas), periodo, 'BRL', 'média(monthly.receita_total)', 'finzen_monthly.csv'),
      despesa_media_mensal: ind(media(despesas), periodo, 'BRL', 'média(monthly.despesa_total)', 'finzen_monthly.csv'),
      saldo_medio_mensal: ind(media(saldos), periodo, 'BRL', 'média(monthly.saldo)', 'finzen_monthly.csv'),
      maior_receita: ind(receitas.length ? Math.max(...receitas) : null, periodo, 'BRL', 'máx(monthly.receita_total)', 'finzen_monthly.csv'),
      maior_despesa: ind(despesas.length ? Math.max(...despesas) : null, periodo, 'BRL', 'máx(monthly.despesa_total)', 'finzen_monthly.csv'),
      volatilidade_receita: ind(desvioPadrao(receitas), periodo, 'BRL', 'desvio_padrão(monthly.receita_total)', 'finzen_monthly.csv'),
      volatilidade_despesas: ind(desvioPadrao(despesas), periodo, 'BRL', 'desvio_padrão(monthly.despesa_total)', 'finzen_monthly.csv'),
    },
    poupanca_e_investimento: {
      taxa_poupanca: ind(divisao(receitaTotalPeriodo - despesaTotalPeriodo, receitaTotalPeriodo), periodo, 'percentual', '(receitas - despesas) / receitas — somas do período', 'finzen_monthly.csv'),
      taxa_investimento: ind(divisao(investimentosTotal, receitaTotalPeriodo), periodo, 'percentual', 'investimentos_realizados / receita_total — somas do período', 'finzen_monthly.csv'),
      percentual_renda_investido: ind(divisao(investimentosTotal, receitaTotalPeriodo), periodo, 'percentual', 'igual a taxa_investimento', 'finzen_monthly.csv'),
      crescimento_patrimonial: ind(patrimonioInicio ? (patrimonioFim - patrimonioInicio) / Math.abs(patrimonioInicio) : null, periodo, 'percentual', '(patrimônio líquido fim - patrimônio líquido início) / |início|', 'finzen_patrimonio.csv'),
    },
    estrutura_das_despesas: {
      percentual_despesas_essenciais: ind(divisao(despesasEssenciaisTotal, despesaTotalPeriodo), periodo, 'percentual', 'despesas_essenciais / despesa_total — só categorias classificadas', 'finzen_monthly.csv'),
      percentual_despesas_nao_essenciais: ind(divisao(despesasNaoEssenciaisTotal, despesaTotalPeriodo), periodo, 'percentual', 'despesas_nao_essenciais / despesa_total — só categorias classificadas', 'finzen_monthly.csv'),
      percentual_despesas_fixas: ind(divisao(despesasFixasTotal, despesaTotalPeriodo), periodo, 'percentual', 'despesas_fixas / despesa_total — só categorias classificadas', 'finzen_monthly.csv'),
      percentual_despesas_variaveis: ind(divisao(despesasVariaveisTotal, despesaTotalPeriodo), periodo, 'percentual', 'despesas_variaveis / despesa_total — só categorias classificadas', 'finzen_monthly.csv'),
      recurring_expense_ratio: ind(divisao(despesaRecorrenteTotal, despesaTotalPeriodo), periodo, 'percentual', 'soma(despesas recorrentes) / despesa_total', 'finzen_movimentacoes.csv'),
      discretionary_spending: ind(despesasNaoEssenciaisTotal, periodo, 'BRL', 'soma(despesas_nao_essenciais) do período', 'finzen_monthly.csv'),
    },
    dividas: {
      divida_total: ind(dividaAtual, fimYM, 'BRL', 'finzen_patrimonio.csv.dividas do mês mais recente (fatura de cartão em aberto — não há tabela de empréstimos no FinZen)', 'finzen_patrimonio.csv'),
      comprometimento_renda_dividas: ind(divisao(dividasPagasTotal, receitaTotalPeriodo), periodo, 'percentual', 'dividas_pagas / receita_total — somas do período', 'finzen_monthly.csv'),
      debt_to_income: ind(divisao(dividaAtual, media(receitas)), fimYM, 'razão', 'divida_total / receita_media_mensal', 'finzen_patrimonio.csv + finzen_monthly.csv'),
      custo_mensal_dividas: ind(media(monthly.map((m) => m.dividas_pagas)), periodo, 'BRL', 'média(monthly.dividas_pagas)', 'finzen_monthly.csv'),
    },
    liquidez: {
      liquidez_disponivel: ind(disponibilidadeAtual, fimYM, 'BRL', 'finzen_patrimonio.csv.disponibilidade do mês mais recente', 'finzen_patrimonio.csv'),
      reserva_emergencia: ind(disponibilidadeAtual, fimYM, 'BRL', 'igual a liquidez_disponivel', 'finzen_patrimonio.csv'),
      reserva_em_meses: ind(divisao(disponibilidadeAtual, media(despesas)), fimYM, 'meses', 'liquidez_disponivel / despesa_media_mensal', 'finzen_patrimonio.csv + finzen_monthly.csv'),
      financial_runway: ind(divisao(disponibilidadeAtual, media(despesas)), fimYM, 'meses', 'igual a reserva_em_meses', 'finzen_patrimonio.csv + finzen_monthly.csv'),
      burn_rate: ind(media(despesas), periodo, 'BRL', 'despesa_media_mensal', 'finzen_monthly.csv'),
    },
    comportamento: {
      crescimento_despesas: ind(crescimentoDespesas, periodo, 'percentual', '(despesa do último mês - despesa do primeiro mês) / despesa do primeiro mês', 'finzen_monthly.csv'),
      crescimento_receita: ind(crescimentoReceita, periodo, 'percentual', '(receita do último mês - receita do primeiro mês) / receita do primeiro mês', 'finzen_monthly.csv'),
      lifestyle_inflation: ind(crescimentoDespesas !== null && crescimentoReceita !== null ? crescimentoDespesas - crescimentoReceita : null, periodo, 'percentual', 'crescimento_despesas - crescimento_receita (positivo = despesas crescendo mais rápido que a renda)', 'finzen_monthly.csv'),
      concentracao_gastos: ind(maiorCategoria ? divisao(maiorCategoria[1], despesaTotalPeriodo) : null, periodo, 'percentual', 'maior categoria de despesa / despesa_total', 'finzen_movimentacoes.csv'),
    },
  };
}

// ── Dimensões (sem score único — seção 10 da especificação) ─────────────
export function calcularDimensoes(indicadores, investimentosCsv) {
  const totalInvestido = investimentosCsv.reduce((s, i) => s + (i.valor_atual || 0), 0);
  const maiorPosicao = investimentosCsv.length ? Math.max(...investimentosCsv.map((i) => i.percentual_carteira || 0)) : null;
  const rentabilidadeMedia = investimentosCsv.length
    ? investimentosCsv.filter((i) => i.rentabilidade !== null).reduce((s, i, _, arr) => s + i.rentabilidade / arr.length, 0)
    : null;

  return {
    fluxo_de_caixa: {
      estabilidade_receita: indicadores.fluxo_de_caixa.volatilidade_receita,
      comportamento_despesas: indicadores.comportamento.crescimento_despesas,
      geracao_de_saldo: indicadores.fluxo_de_caixa.saldo_medio_mensal,
      tendencia: indicadores.comportamento.lifestyle_inflation,
    },
    liquidez: {
      dinheiro_disponivel: indicadores.liquidez.liquidez_disponivel,
      reserva: indicadores.liquidez.reserva_emergencia,
      meses_de_cobertura: indicadores.liquidez.reserva_em_meses,
      runway: indicadores.liquidez.financial_runway,
    },
    poupanca: {
      taxa_de_poupanca: indicadores.poupanca_e_investimento.taxa_poupanca,
      consistencia: indicadores.fluxo_de_caixa.volatilidade_despesas,
      evolucao: indicadores.comportamento.crescimento_despesas,
    },
    endividamento: {
      divida: indicadores.dividas.divida_total,
      custo: indicadores.dividas.custo_mensal_dividas,
      comprometimento_da_renda: indicadores.dividas.comprometimento_renda_dividas,
      evolucao: indicadores.dividas.debt_to_income,
    },
    patrimonio: {
      patrimonio_liquido: indicadores.poupanca_e_investimento.crescimento_patrimonial,
      crescimento: indicadores.poupanca_e_investimento.crescimento_patrimonial,
      composicao: ind(divisao(totalInvestido, (indicadores.liquidez.liquidez_disponivel.valor || 0) + totalInvestido), null, 'percentual', 'valor_investido / (disponibilidade + valor_investido)', 'finzen_investimentos.csv + finzen_patrimonio.csv'),
      evolucao_temporal: indicadores.poupanca_e_investimento.crescimento_patrimonial,
    },
    investimentos: {
      patrimonio_investido: ind(totalInvestido, null, 'BRL', 'soma(finzen_investimentos.valor_atual)', 'finzen_investimentos.csv'),
      alocacao: ind(investimentosCsv.length, null, 'contagem', 'quantidade de ativos distintos', 'finzen_investimentos.csv'),
      concentracao: ind(maiorPosicao, null, 'percentual', 'maior percentual_carteira entre os ativos', 'finzen_investimentos.csv'),
      rentabilidade: ind(rentabilidadeMedia, null, 'percentual', 'média(rentabilidade) dos ativos com dado', 'finzen_investimentos.csv'),
      geracao_de_renda: ind(investimentosCsv.reduce((s, i) => s + (i.dividendos_recebidos || 0), 0), null, 'BRL', 'soma(finzen_investimentos.dividendos_recebidos)', 'finzen_investimentos.csv'),
    },
  };
}
