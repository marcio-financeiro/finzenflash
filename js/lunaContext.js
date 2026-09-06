// js/lunaContext.js — Coleta de dados financeiros para a Luna (IA)
// Roda no client (RLS garante que cada usuário só vê os próprios dados).

import { supabase } from './supabaseClient.js';

const DEFAULT_USD_BRL = 5.15;

function dataISO(d) {
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

function convertToBRL(valor, currency, dolar) {
  const v = Number(valor) || 0;
  return currency === 'USD' ? v * dolar : v;
}

async function getUsdBrlRate(userId) {
  const { data } = await supabase
    .from('user_settings')
    .select('setting_value')
    .eq('user_id', userId)
    .eq('setting_key', 'usd_brl')
    .maybeSingle();
  return data ? Number(data.setting_value) || DEFAULT_USD_BRL : DEFAULT_USD_BRL;
}

// ── Contexto completo (para o chat) ─────────────────────────────────────
export async function coletarContexto(userId) {
  const dolarAtual = await getUsdBrlRate(userId).catch(() => DEFAULT_USD_BRL);
  const valorBRL = (t) => convertToBRL(t.amount, t.accounts?.currency || 'BRL', dolarAtual);

  const hoje = new Date();
  const anoMes = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}`;
  const primeiroDia = `${anoMes}-01`;
  const ultimoDia = dataISO(new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0));
  const hojeISO = dataISO(hoje);
  const mes3Atras = dataISO(new Date(hoje.getFullYear(), hoje.getMonth() - 3, 1));

  const [
    { data: contas },
    { data: transacoesMes },
    { data: pendentes },
    { data: parcelasMes },
    { data: recorrentes },
    { data: historico3m },
    { data: orcamentos },
    { data: comprasCartao },
  ] = await Promise.all([
    supabase.from('accounts')
      .select('nome,saldo_atual,currency,account_kind')
      .eq('user_id', userId).eq('active', true),

    supabase.from('transactions')
      .select('type,amount,status,date,accounts:account_id(currency),categories:category_id(nome,icon)')
      .eq('user_id', userId)
      .gte('date', primeiroDia).lte('date', ultimoDia),

    supabase.from('transactions')
      .select('type,amount,date,description,accounts:account_id(currency)')
      .eq('user_id', userId)
      .eq('status', 'pendente')
      .gte('date', hojeISO).lte('date', ultimoDia),

    supabase.from('card_transactions')
      .select('valor_parcela,card_id,credit_cards:card_id(nome,vencimento_dia)')
      .eq('user_id', userId)
      .eq('status', 'aberta')
      .eq('fatura_referencia', anoMes),

    supabase.from('transactions')
      .select('type,amount,recurrence_frequency,description,accounts:account_id(currency)')
      .eq('user_id', userId)
      .eq('is_recurring', true)
      .eq('recurrence_active', true),

    supabase.from('transactions')
      .select('type,amount,date,status,accounts:account_id(currency)')
      .eq('user_id', userId)
      .gte('date', mes3Atras).lte('date', primeiroDia)
      .eq('status', 'pago'),

    supabase.from('budgets')
      .select('valor_planejado,categories:category_id(nome)')
      .eq('user_id', userId)
      .eq('mes_referencia', anoMes),

    supabase.from('card_transactions')
      .select('descricao,valor_parcela,valor_total,parcela_atual,parcelas,fatura_referencia,credit_cards:card_id(nome),categories:category_id(nome,icon)')
      .eq('user_id', userId)
      .eq('status', 'aberta')
      .gte('fatura_referencia', anoMes)
      .order('fatura_referencia', { ascending: true })
      .limit(50),
  ]);

  (transacoesMes || []).forEach((t) => { t.amount = valorBRL(t); });
  (pendentes || []).forEach((t) => { t.amount = valorBRL(t); });
  (recorrentes || []).forEach((t) => { t.amount = valorBRL(t); });
  (historico3m || []).forEach((t) => { t.amount = valorBRL(t); });

  const pagas = (transacoesMes || []).filter((t) => t.status === 'pago');
  const receitasMes = pagas.filter((t) => t.type === 'receita').reduce((s, t) => s + Number(t.amount || 0), 0);
  const despesasMes = pagas.filter((t) => t.type === 'despesa').reduce((s, t) => s + Number(t.amount || 0), 0);
  const saldoTotal = (contas || []).filter((c) => c.account_kind !== 'broker')
    .reduce((s, c) => s + convertToBRL(c.saldo_atual, c.currency || 'BRL', dolarAtual), 0);
  const totalFaturas = (parcelasMes || []).reduce((s, p) => s + Number(p.valor_parcela || 0), 0);

  const receitasPend = (pendentes || []).filter((t) => t.type === 'receita').reduce((s, t) => s + Number(t.amount || 0), 0);
  const despesasPend = (pendentes || []).filter((t) => t.type === 'despesa').reduce((s, t) => s + Number(t.amount || 0), 0);
  const saldoPrevisto = saldoTotal + receitasPend - despesasPend - totalFaturas;

  const porMes = {};
  (historico3m || []).forEach((t) => {
    const m = t.date?.slice(0, 7);
    if (!m) return;
    if (!porMes[m]) porMes[m] = { receitas: 0, despesas: 0 };
    if (t.type === 'receita') porMes[m].receitas += Number(t.amount || 0);
    if (t.type === 'despesa') porMes[m].despesas += Number(t.amount || 0);
  });

  return {
    mesReferencia: anoMes,
    saldoAtual: saldoTotal,
    saldoPrevisto,
    receitasMes,
    despesasMes,
    receitasPendentes: receitasPend,
    despesasPendentes: despesasPend,
    totalFaturas,
    taxaPoupancaMes: receitasMes > 0 ? ((receitasMes - despesasMes) / receitasMes * 100).toFixed(1) : 0,
    lancamentosPendentes: (pendentes || []).slice(0, 10).map((p) => ({
      descricao: p.description,
      tipo: p.type,
      valor: Number(p.amount || 0),
      data: p.date,
    })),
    recorrentes: (recorrentes || []).slice(0, 10).map((r) => ({
      descricao: r.description,
      tipo: r.type,
      valor: Number(r.amount || 0),
      frequencia: r.recurrence_frequency,
    })),
    historico3Meses: Object.entries(porMes).map(([mes, v]) => ({
      mes,
      receitas: v.receitas,
      despesas: v.despesas,
      saldo: v.receitas - v.despesas,
    })).sort((a, b) => a.mes.localeCompare(b.mes)),
    orcamentos: (orcamentos || []).map((o) => ({
      categoria: o.categories?.nome || 'Geral',
      planejado: Number(o.valor_planejado || 0),
    })),
    comprasCartao: (() => {
      const grupos = {};
      (comprasCartao || []).forEach((c) => {
        const ref = c.fatura_referencia || 'sem-ref';
        if (!grupos[ref]) grupos[ref] = { fatura: ref, cartao: c.credit_cards?.nome || 'Cartão', itens: [], total: 0 };
        grupos[ref].itens.push({
          descricao: c.descricao,
          valor: Number(c.valor_parcela || 0),
          categoria: c.categories?.nome || 'Sem categoria',
          parcela: c.parcelas > 1 ? `${c.parcela_atual}/${c.parcelas}` : null,
        });
        grupos[ref].total += Number(c.valor_parcela || 0);
      });
      return Object.values(grupos).sort((a, b) => a.fatura.localeCompare(b.fatura)).slice(0, 3);
    })(),
    gastosPorCategoria: (() => {
      const grupos = {};
      (transacoesMes || []).filter((t) => t.status === 'pago' && t.type === 'despesa').forEach((t) => {
        const cat = t.categories?.nome || 'Sem categoria';
        const icone = t.categories?.icon || '';
        if (!grupos[cat]) grupos[cat] = { categoria: cat, icone, total: 0 };
        grupos[cat].total += Number(t.amount || 0);
      });
      return Object.values(grupos).sort((a, b) => b.total - a.total).slice(0, 8);
    })(),
  };
}

// ── Contexto leve (para insights automáticos na Home) ───────────────────
export async function coletarContextoResumo(userId) {
  const hoje = new Date();
  const hojeStr = dataISO(hoje);
  const em7 = dataISO(new Date(hoje.getTime() + 7 * 86400000));
  const ref = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}`;
  const inicio = `${ref}-01`;

  const queries = [
    supabase.from('accounts').select('saldo_atual,currency,account_kind').eq('user_id', userId).eq('active', true),
    supabase.from('transactions').select('type,amount,status').eq('user_id', userId).gte('date', inicio).lte('date', hojeStr),
    supabase.from('card_transactions').select('valor_parcela').eq('user_id', userId).eq('status', 'aberta').eq('fatura_referencia', ref),
    supabase.from('transactions').select('id').eq('user_id', userId).eq('status', 'pendente').gte('date', hojeStr).lte('date', em7),
    supabase.from('offshore_cycles').select('data_embarque,data_desembarque').eq('user_id', userId).order('data_embarque', { ascending: false }).limit(3),
  ];

  const results = await Promise.allSettled(queries);
  const extrair = (r) => (r.status === 'fulfilled' ? (r.value?.data || []) : []);
  const [contas, txMes, faturas, pendentes, ciclos] = results.map(extrair);

  const saldo = (contas || []).filter((c) => (c.currency || 'BRL') === 'BRL' && c.account_kind !== 'broker')
    .reduce((s, c) => s + Number(c.saldo_atual || 0), 0);

  const pagas = (txMes || []).filter((t) => t.status === 'pago');
  const receitas = pagas.filter((t) => t.type === 'receita').reduce((s, t) => s + Number(t.amount || 0), 0);
  const despesas = pagas.filter((t) => t.type === 'despesa').reduce((s, t) => s + Number(t.amount || 0), 0);
  const totalFaturas = (faturas || []).reduce((s, f) => s + Number(f.valor_parcela || 0), 0);
  const previsao = saldo - totalFaturas;

  const futuros = (ciclos || []).filter((c) => c.data_embarque > hojeStr)
    .sort((a, b) => a.data_embarque.localeCompare(b.data_embarque));
  const proximoCiclo = futuros[0];
  const diasEmbarque = proximoCiclo ? Math.ceil((new Date(proximoCiclo.data_embarque) - hoje) / 86400000) : null;
  const ultimoDesembarque = (ciclos || []).find((c) => c.data_desembarque && c.data_desembarque <= hojeStr)?.data_desembarque || null;

  return {
    saldo: saldo.toFixed(2),
    receitas: receitas.toFixed(2),
    despesas: despesas.toFixed(2),
    faturas: totalFaturas.toFixed(2),
    previsao: previsao.toFixed(2),
    pendentes: (pendentes || []).length,
    proximoEmbarque: proximoCiclo?.data_embarque || null,
    diasEmbarque,
    ultimoDesembarque,
  };
}

// ── System prompt (chat) ─────────────────────────────────────────────────
export function buildSystemPrompt(contexto) {
  const fmt = (v) => Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const c = contexto;

  return `Você é a Luna, assistente financeira pessoal integrada ao app FinZen Flash.
Você tem acesso aos dados financeiros reais do usuário e deve responder de forma clara, objetiva e em português brasileiro.
Seja direta e concisa. Use bullet points quando listar itens. Formate valores sempre em R$.

## Dados Financeiros Atuais (${c.mesReferencia})

- Saldo atual em contas: ${fmt(c.saldoAtual)}
- Saldo previsto fim do mês: ${fmt(c.saldoPrevisto)}
- Receitas pagas no mês: ${fmt(c.receitasMes)}
- Despesas pagas no mês: ${fmt(c.despesasMes)}
- Saldo do mês: ${fmt(c.receitasMes - c.despesasMes)}
- Taxa de poupança: ${c.taxaPoupancaMes}%
- Faturas de cartão abertas: ${fmt(c.totalFaturas)}
- Receitas pendentes até fim do mês: ${fmt(c.receitasPendentes)}
- Despesas pendentes até fim do mês: ${fmt(c.despesasPendentes)}

### Gastos por categoria (mês atual)
${c.gastosPorCategoria?.length
  ? c.gastosPorCategoria.map((g) => `- ${g.icone || ''} ${g.categoria}: ${fmt(g.total)}`).join('\n')
  : '- Sem dados de categoria'}

### Histórico últimos 3 meses
${c.historico3Meses?.length
  ? c.historico3Meses.map((h) => `- ${h.mes}: receitas ${fmt(h.receitas)}, despesas ${fmt(h.despesas)}, saldo ${fmt(h.saldo)}`).join('\n')
  : '- Sem histórico disponível'}

### Lançamentos pendentes
${c.lancamentosPendentes?.length
  ? c.lancamentosPendentes.map((p) => `- [${p.tipo}] ${p.descricao}: ${fmt(p.valor)} em ${p.data}`).join('\n')
  : '- Nenhum lançamento pendente'}

### Recorrentes ativos
${c.recorrentes?.length
  ? c.recorrentes.map((r) => `- [${r.tipo}] ${r.descricao}: ${fmt(r.valor)} (${r.frequencia})`).join('\n')
  : '- Nenhum recorrente'}

### Orçamentos do mês
${c.orcamentos?.length
  ? c.orcamentos.map((o) => `- ${o.categoria}: planejado ${fmt(o.planejado)}`).join('\n')
  : '- Sem orçamentos configurados'}

### Compras abertas no cartão
${c.comprasCartao?.length
  ? c.comprasCartao.map((f) =>
      `**${f.cartao} — fatura ${f.fatura} (R$ ${Number(f.total).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}):**\n` +
      f.itens.slice(0, 8).map((i) =>
        `  - ${i.descricao}${i.parcela ? ' (' + i.parcela + ')' : ''}: ${fmt(i.valor)} [${i.categoria}]`
      ).join('\n')
    ).join('\n')
  : '- Sem compras abertas no cartão'}

## Instruções
- Responda sempre em português brasileiro
- Use os dados reais acima — nunca invente números
- Formate valores em R$ com vírgula decimal
- Respostas concisas: prefira bullet points a parágrafos longos
- Se não souber algo (ex: cotação em tempo real), diga claramente
- Nunca sugira investimentos específicos (ex: "compre PETR4") — fale em classes e diversificação`;
}

// ── Renderização de markdown simples ─────────────────────────────────────
function escapeHtmlBasico(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function renderMd(text) {
  return escapeHtmlBasico(text)
    .replace(/^---+$/gm, '')
    .replace(/^# (.+)$/gm, '<h4 class="luna-h4">$1</h4>')
    .replace(/^## (.+)$/gm, '<h4 class="luna-h4">$1</h4>')
    .replace(/^### (.+)$/gm, '<h4 class="luna-h4">$1</h4>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/^\d+\. (.+)$/gm, '<li>$1</li>')
    .replace(/^[\-\*] (.+)$/gm, '<li>$1</li>')
    .replace(/(<li>.*<\/li>\n?)+/gs, (m) => `<ul class="luna-ul">${m}</ul>`)
    .replace(/\n{2,}/g, '</p><p class="luna-p">')
    .replace(/\n/g, '<br>')
    .replace(/^(?!<)(.+)/, '<p class="luna-p">$1');
}
