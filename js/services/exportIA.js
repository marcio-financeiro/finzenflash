// exportIA.js — camada 1 e 2 da exportação "Análise com IA": coleta os
// dados brutos do usuário e monta as tabelas unificadas (movimentações,
// resumo mensal, patrimônio, investimentos). Não calcula indicadores (isso
// é js/services/exportIAIndicadores.js) e não gera arquivo nenhum (isso é
// js/services/exportIAArquivos.js) — este módulo só lê o banco e organiza.
//
// Princípio: dados primários são a fonte de verdade. Reaproveita a mesma
// lógica já usada no resto do app (exclusão da categoria "Fatura de
// Cartão" pra não contar a compra do cartão duas vezes — o mesmo cuidado
// que já existe em saude.js/relatorios.js) em vez de reinventar regra nova.
import { paraBRL, DEFAULT_USD_BRL } from '../currencyService.js';

// Uma compra/venda de ativo e um recebimento de dividendo geram, além do
// registro "de verdade" (investment_transactions/dividends), uma transação
// sintética em `transactions` só pra aparecer no dashboard (não existe FK
// ligando as duas). Sem filtrar isso, a movimentação apareceria duplicada:
// uma vez como investimento, outra como despesa/receita solta.
const REGEX_TRANSACAO_INVESTIMENTO = /^(Compra|Venda) \S+ \(/;

function mesRef(dataISO) {
  return (dataISO || '').slice(0, 7);
}

function addMesesISO(ym, n) {
  const [a, m] = ym.split('-').map(Number);
  const d = new Date(a, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function mesesEntre(inicioYM, fimYM) {
  const meses = [];
  let atual = inicioYM;
  let guard = 0;
  while (atual <= fimYM && guard < 600) {
    meses.push(atual);
    atual = addMesesISO(atual, 1);
    guard += 1;
  }
  return meses;
}

// ── Coleta ───────────────────────────────────────────────────────────────
export async function coletarDados(supabase, userId, { inicio, fim }) {
  const [
    { data: accounts, error: e1 },
    { data: creditCards, error: e2 },
    { data: categories, error: e3 },
    { data: transactions, error: e4 },
    { data: cardTransactions, error: e5 },
    { data: accountTransfers, error: e6 },
    { data: exchangeTransactions, error: e7 },
    { data: investments, error: e8 },
    { data: investmentTransactions, error: e9 },
    { data: dividends, error: e10 },
    { data: patrimonyHistory, error: e11 },
  ] = await Promise.all([
    supabase.from('accounts').select('id, nome, tipo, currency, active, saldo_atual, saldo_inicial, account_kind').eq('user_id', userId),
    supabase.from('credit_cards').select('id, nome, limite, fechamento_dia, vencimento_dia, ativo').eq('user_id', userId),
    supabase.from('categories').select('id, nome, tipo, icon, ativo, fixo_variavel, essencial, parent_id').eq('user_id', userId),
    supabase.from('transactions').select('id, account_id, category_id, type, amount, description, date, status, notes, is_recurring, recurrence_group_id, tags')
      .eq('user_id', userId).gte('date', inicio).lte('date', fim),
    supabase.from('card_transactions').select('id, card_id, category_id, descricao, valor_total, parcelas, parcela_atual, valor_parcela, data_compra, fatura_referencia, status, purchase_group_id')
      .eq('user_id', userId).gte('data_compra', inicio).lte('data_compra', fim),
    supabase.from('account_transfers').select('id, from_account_id, to_account_id, amount, date, description').eq('user_id', userId).gte('date', inicio).lte('date', fim),
    supabase.from('exchange_transactions').select('id, from_account_id, to_account_id, from_currency, to_currency, source_amount, target_amount, exchange_rate, date, description').eq('user_id', userId).gte('date', inicio).lte('date', fim),
    supabase.from('investments').select('id, ticker, nome, tipo, quantidade, preco_medio, moeda, corretora, cotacao_atual, valor_atual_brl, valor_aplicado_brl, ativo, created_at, exchange_rate').eq('user_id', userId),
    supabase.from('investment_transactions').select('id, investment_id, ticker, tipo_movimento, quantidade, preco_unitario, valor_total, moeda, data_movimento, account_id, observacao').eq('user_id', userId).gte('data_movimento', inicio).lte('data_movimento', fim),
    supabase.from('dividends').select('id, investment_id, ticker, tipo, valor_total, data_pagamento, transaction_id, account_id').eq('user_id', userId).gte('data_pagamento', inicio).lte('data_pagamento', fim),
    supabase.from('patrimony_history').select('reference_month, accounts_total, investments_total, cards_total, net_worth').eq('user_id', userId).order('reference_month'),
  ]);

  const erro = e1 || e2 || e3 || e4 || e5 || e6 || e7 || e8 || e9 || e10 || e11;
  if (erro) throw erro;

  const categoriaFatura = (categories || []).find((c) => c.nome === 'Fatura de Cartão' && c.tipo === 'despesa');

  return {
    accounts: accounts || [], creditCards: creditCards || [], categories: categories || [],
    transactions: transactions || [], cardTransactions: cardTransactions || [],
    accountTransfers: accountTransfers || [], exchangeTransactions: exchangeTransactions || [],
    investments: investments || [], investmentTransactions: investmentTransactions || [],
    dividends: dividends || [], patrimonyHistory: patrimonyHistory || [],
    idCategoriaFatura: categoriaFatura?.id ?? null,
  };
}

// ── Movimentações unificadas ────────────────────────────────────────────
export function construirMovimentacoes(dados) {
  const { accounts, creditCards, categories, transactions, cardTransactions, accountTransfers, exchangeTransactions, investmentTransactions, dividends, idCategoriaFatura } = dados;

  const contaPorId = new Map(accounts.map((a) => [a.id, a]));
  const cartaoPorId = new Map(creditCards.map((c) => [c.id, c]));
  const categoriaPorId = new Map(categories.map((c) => [c.id, c]));
  const idsTransacaoDividendo = new Set(dividends.map((d) => d.transaction_id).filter(Boolean));

  const movimentos = [];

  for (const t of transactions) {
    // Excluídas por serem representação derivada de outro dado primário —
    // não é perda de informação, é evitar contar o mesmo fato duas vezes:
    // a compra/venda de ativo e o dividendo já entram pelas tabelas
    // certas mais abaixo (investment_transactions/dividends).
    if (idsTransacaoDividendo.has(t.id)) continue;
    if (REGEX_TRANSACAO_INVESTIMENTO.test(t.description || '')) continue;

    const conta = contaPorId.get(t.account_id);
    const categoria = categoriaPorId.get(t.category_id);
    const ehFatura = idCategoriaFatura && t.category_id === idCategoriaFatura;

    movimentos.push({
      id: `tx_${t.id}`,
      data: t.date,
      mes_referencia: mesRef(t.date),
      // pagamento_fatura fica fora de receita/despesa (a despesa real já
      // foi contada quando a compra do cartão aconteceu) mas continua
      // visível — é um evento de caixa real (saiu dinheiro da conta).
      tipo: ehFatura ? 'pagamento_fatura' : t.type,
      descricao: t.description,
      valor: Number(t.amount),
      moeda: conta?.currency || 'BRL',
      categoria: categoria?.nome ?? null,
      subcategoria: null,
      conta: conta?.nome ?? null,
      forma_pagamento: 'conta',
      fixo_variavel: categoria?.fixo_variavel ?? null,
      essencial_nao_essencial: categoria?.essencial === true ? 'essencial' : categoria?.essencial === false ? 'nao_essencial' : null,
      parcelado: false,
      parcela_atual: null,
      total_parcelas: null,
      valor_parcela: null,
      recorrente: Boolean(t.is_recurring || t.recurrence_group_id),
      tags: t.tags && t.tags.length ? t.tags.join(';') : null,
      observacao: t.notes ?? null,
      status: t.status,
    });
  }

  for (const c of cardTransactions) {
    const cartao = cartaoPorId.get(c.card_id);
    const categoria = categoriaPorId.get(c.category_id);
    movimentos.push({
      id: `ct_${c.id}`,
      data: c.data_compra,
      mes_referencia: c.fatura_referencia,
      tipo: 'despesa',
      descricao: c.descricao,
      valor: Number(c.valor_parcela),
      moeda: 'BRL',
      categoria: categoria?.nome ?? null,
      subcategoria: null,
      conta: cartao?.nome ?? null,
      forma_pagamento: 'cartao',
      fixo_variavel: categoria?.fixo_variavel ?? null,
      essencial_nao_essencial: categoria?.essencial === true ? 'essencial' : categoria?.essencial === false ? 'nao_essencial' : null,
      parcelado: Number(c.parcelas) > 1,
      parcela_atual: c.parcela_atual,
      total_parcelas: c.parcelas,
      valor_parcela: Number(c.valor_parcela),
      recorrente: false,
      tags: null,
      observacao: null,
      status: c.status === 'aberta' ? 'pendente' : 'pago',
    });
  }

  for (const at of accountTransfers) {
    const de = contaPorId.get(at.from_account_id);
    const para = contaPorId.get(at.to_account_id);
    movimentos.push({
      id: `at_${at.id}`,
      data: at.date,
      mes_referencia: mesRef(at.date),
      tipo: 'transferencia_interna',
      descricao: at.description || 'Transferência entre contas',
      valor: Number(at.amount),
      moeda: de?.currency || 'BRL',
      categoria: null, subcategoria: null,
      conta: `${de?.nome ?? '?'} -> ${para?.nome ?? '?'}`,
      forma_pagamento: 'transferencia',
      fixo_variavel: null, essencial_nao_essencial: null,
      parcelado: false, parcela_atual: null, total_parcelas: null, valor_parcela: null,
      recorrente: false, tags: null, observacao: null, status: 'pago',
    });
  }

  for (const ex of exchangeTransactions) {
    const de = contaPorId.get(ex.from_account_id);
    const para = contaPorId.get(ex.to_account_id);
    movimentos.push({
      id: `ex_${ex.id}`,
      data: ex.date,
      mes_referencia: mesRef(ex.date),
      tipo: 'cambio',
      descricao: ex.description || `Câmbio ${ex.from_currency}->${ex.to_currency}`,
      valor: Number(ex.source_amount),
      moeda: ex.from_currency,
      categoria: null, subcategoria: null,
      conta: `${de?.nome ?? '?'} -> ${para?.nome ?? '?'}`,
      forma_pagamento: 'cambio',
      fixo_variavel: null, essencial_nao_essencial: null,
      parcelado: false, parcela_atual: null, total_parcelas: null, valor_parcela: null,
      recorrente: false, tags: null,
      observacao: `Cotação: ${ex.exchange_rate} — valor recebido: ${ex.target_amount} ${ex.to_currency}`,
      status: 'pago',
    });
  }

  for (const it of investmentTransactions) {
    const conta = contaPorId.get(it.account_id);
    movimentos.push({
      id: `it_${it.id}`,
      data: it.data_movimento,
      mes_referencia: mesRef(it.data_movimento),
      tipo: it.tipo_movimento === 'venda' ? 'investimento_venda' : 'investimento_compra',
      descricao: `${it.tipo_movimento === 'venda' ? 'Venda' : 'Compra'} de ${it.ticker}`,
      valor: Number(it.valor_total),
      moeda: it.moeda || 'BRL',
      categoria: 'Investimentos', subcategoria: it.ticker,
      conta: conta?.nome ?? null,
      forma_pagamento: 'conta',
      fixo_variavel: null, essencial_nao_essencial: null,
      parcelado: false, parcela_atual: null, total_parcelas: null, valor_parcela: null,
      recorrente: false, tags: null, observacao: it.observacao ?? null, status: 'pago',
    });
  }

  for (const d of dividends) {
    const conta = contaPorId.get(d.account_id);
    movimentos.push({
      id: `dv_${d.id}`,
      data: d.data_pagamento,
      mes_referencia: mesRef(d.data_pagamento),
      tipo: 'dividendo',
      descricao: `Dividendo de ${d.ticker}`,
      valor: Number(d.valor_total),
      moeda: 'BRL',
      categoria: 'Investimentos', subcategoria: d.ticker,
      conta: conta?.nome ?? null,
      forma_pagamento: 'conta',
      fixo_variavel: null, essencial_nao_essencial: null,
      parcelado: false, parcela_atual: null, total_parcelas: null, valor_parcela: null,
      recorrente: false, tags: null, observacao: null, status: 'pago',
    });
  }

  movimentos.sort((a, b) => (a.data < b.data ? -1 : a.data > b.data ? 1 : 0));
  return movimentos;
}

// ── Resumo mensal ────────────────────────────────────────────────────────
// dolarAtual: finzen_monthly.csv/finzen_indicadores.json documentam seus
// valores como unidade 'BRL' — um movimento com moeda USD (conta Nomad)
// precisa ser convertido aqui, senão a soma mistura BRL e USD em silêncio.
// finzen_movimentacoes.csv continua com o valor original (moeda indica
// qual é) — só o agregado mensal precisa estar numa moeda só.
export function construirMonthly(movimentos, patrimonyHistory, inicioYM, fimYM, dolarAtual = DEFAULT_USD_BRL) {
  const patrimonioPorMes = new Map(patrimonyHistory.map((p) => [String(p.reference_month).slice(0, 7), p]));
  const meses = mesesEntre(inicioYM, fimYM);

  return meses.map((mes) => {
    const doMes = movimentos.filter((m) => m.mes_referencia === mes);
    const soma = (tipo, filtro) => doMes.filter((m) => m.tipo === tipo && (!filtro || filtro(m))).reduce((s, m) => s + paraBRL(m.valor, m.moeda, dolarAtual), 0);

    const receitaTotal = soma('receita');
    const despesaTotal = soma('despesa');
    const patrimAtual = patrimonioPorMes.get(mes);
    const patrimAnterior = patrimonioPorMes.get(addMesesISO(mes, -1));

    return {
      mes,
      receita_total: receitaTotal,
      despesa_total: despesaTotal,
      saldo: receitaTotal - despesaTotal,
      despesas_fixas: soma('despesa', (m) => m.fixo_variavel === 'fixo'),
      despesas_variaveis: soma('despesa', (m) => m.fixo_variavel === 'variavel'),
      despesas_essenciais: soma('despesa', (m) => m.essencial_nao_essencial === 'essencial'),
      despesas_nao_essenciais: soma('despesa', (m) => m.essencial_nao_essencial === 'nao_essencial'),
      investimentos_realizados: soma('investimento_compra'),
      resgates: soma('investimento_venda'),
      dividas_pagas: soma('pagamento_fatura'),
      // Aproximação: valor de compras no cartão feitas neste mês (não é
      // "nova dívida" no sentido de empréstimo — o FinZen não tem esse
      // conceito, ver finzen_data_dictionary.json).
      novas_dividas: doMes.filter((m) => m.forma_pagamento === 'cartao' && m.parcela_atual === 1).reduce((s, m) => s + (m.total_parcelas > 1 ? m.valor_parcela * m.total_parcelas : m.valor), 0),
      patrimonio_inicio: patrimAnterior ? Number(patrimAnterior.net_worth) : null,
      patrimonio_fim: patrimAtual ? Number(patrimAtual.net_worth) : null,
    };
  });
}

// ── Patrimônio ───────────────────────────────────────────────────────────
// Fonte de verdade: patrimony_history, já calculado e persistido pelo
// próprio FinZen (js/services/patrimonySnapshot.js) — não recalculado
// aqui, só reorganizado nas colunas do export.
export function construirPatrimonio(patrimonyHistory) {
  return patrimonyHistory.map((p) => ({
    mes: String(p.reference_month).slice(0, 7),
    ativos: Number(p.accounts_total) + Number(p.investments_total),
    investimentos: Number(p.investments_total),
    disponibilidade: Number(p.accounts_total),
    imoveis: null,
    veiculos: null,
    outros_ativos: null,
    passivos: Number(p.cards_total),
    dividas: Number(p.cards_total),
    patrimonio_liquido: Number(p.net_worth),
  }));
}

// ── Investimentos (posições atuais) ─────────────────────────────────────
export function construirInvestimentos(dados) {
  const { investments, investmentTransactions, dividends } = dados;
  const totalCarteira = investments.reduce((s, inv) => s + (Number(inv.valor_atual_brl) || Number(inv.quantidade) * Number(inv.cotacao_atual || inv.preco_medio) || 0), 0);

  return investments.map((inv) => {
    const movsDoAtivo = investmentTransactions.filter((it) => it.investment_id === inv.id);
    const comprasDoAtivo = movsDoAtivo.filter((it) => it.tipo_movimento === 'compra');
    const dividendosDoAtivo = dividends.filter((d) => d.investment_id === inv.id);
    const valorInvestido = inv.valor_aplicado_brl != null ? Number(inv.valor_aplicado_brl) : Number(inv.quantidade) * Number(inv.preco_medio);
    const valorAtual = inv.valor_atual_brl != null ? Number(inv.valor_atual_brl) : Number(inv.quantidade) * Number(inv.cotacao_atual || inv.preco_medio);
    const datasMovs = movsDoAtivo.map((m) => m.data_movimento).sort();

    return {
      id: inv.id,
      ticker: inv.ticker,
      nome: inv.nome ?? null,
      classe: inv.tipo,
      quantidade: Number(inv.quantidade),
      preco_medio: Number(inv.preco_medio),
      preco_atual: inv.cotacao_atual != null ? Number(inv.cotacao_atual) : null,
      valor_investido: valorInvestido || null,
      valor_atual: valorAtual || null,
      rentabilidade: valorInvestido > 0 ? (valorAtual - valorInvestido) / valorInvestido : null,
      dividendos_recebidos: dividendosDoAtivo.reduce((s, d) => s + Number(d.valor_total), 0),
      percentual_carteira: totalCarteira > 0 ? (valorAtual / totalCarteira) * 100 : null,
      corretora: inv.corretora ?? null,
      data_primeira_compra: comprasDoAtivo.length ? comprasDoAtivo.map((c) => c.data_movimento).sort()[0] : null,
      data_ultima_movimentacao: datasMovs.length ? datasMovs[datasMovs.length - 1] : null,
      ativo: inv.ativo !== false,
    };
  });
}

// ── Período anterior (para comparação) ──────────────────────────────────
// Mesmo número de dias do período pedido, imediatamente anterior a ele —
// usado pra comparar indicadores (ex: taxa de poupança piorou ou melhorou
// vs o período equivalente logo antes).
export function periodoAnterior(inicioISO, fimISO) {
  const toISO = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const inicioD = new Date(inicioISO + 'T00:00:00');
  const fimD = new Date(fimISO + 'T00:00:00');
  const dias = Math.round((fimD - inicioD) / 86400000) + 1;
  const fimAntD = new Date(inicioD.getTime() - 86400000);
  const inicioAntD = new Date(fimAntD.getTime() - (dias - 1) * 86400000);
  return { inicio: toISO(inicioAntD), fim: toISO(fimAntD) };
}

// ── Anonimização (opcional, a pedido do usuário) ────────────────────────
// Troca nomes reais de conta/cartão por rótulos genéricos ("Conta 1",
// "Cartão 1"), mantendo a mesma consistência dentro do pacote (a mesma
// conta sempre vira o mesmo rótulo). Não gera nenhum mapa de volta pro
// nome real dentro dos arquivos exportados — só no app, pra quem gerou.
export function anonimizarMovimentos(movimentos) {
  const mapaContas = new Map();
  const mapaCartoes = new Map();

  function apelido(mapa, prefixo, nome) {
    if (!nome) return nome;
    if (!mapa.has(nome)) mapa.set(nome, `${prefixo} ${mapa.size + 1}`);
    return mapa.get(nome);
  }

  return movimentos.map((m) => {
    let conta = m.conta;
    if (conta && conta.includes(' -> ')) {
      const [de, para] = conta.split(' -> ');
      conta = `${apelido(mapaContas, 'Conta', de)} -> ${apelido(mapaContas, 'Conta', para)}`;
    } else if (m.forma_pagamento === 'cartao') {
      conta = apelido(mapaCartoes, 'Cartão', conta);
    } else {
      conta = apelido(mapaContas, 'Conta', conta);
    }
    return { ...m, conta };
  });
}

export { mesRef, addMesesISO, mesesEntre };
