import { supabase, requireAuth, configurarBotaoSair } from '../supabaseClient.js';
import { aplicarTemaSalvo } from '../temaService.js';
import { invoiceRef, addMonthsRef } from '../cardService.js';
import { montarNavRail } from './navRail.js';
import { abrirComandos } from './comandos.js';
import { inicializarBoard } from './board.js';
import { configurarModal, abrirModal, fecharModal } from './modal.js';
import { formatarMoeda, carregarCotacaoDolar, paraBRL } from '../currencyService.js';
import { loadChart } from '../loadChart.js';

const fmt = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtData = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit' });
const fmtMes = new Intl.DateTimeFormat('pt-BR', { month: 'long' });
const fmtMesAno = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' });
const fmtDataCurta = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit' });

const CORES_RANKING = ['#0E7C86', '#8b5cf6', '#94a3b8', '#38bdf8', '#f59e0b'];
const OUTROS_ID = '__outros__';
const DIAS_SEMANA = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];

let usuarioAtual = null;
let mesRef = new Date();
mesRef.setDate(1);
let pendentesTipo = 'despesa';
let idCategoriaFatura = null;
let contasCache = [];
let dolarAtual;
let chartSaldoMes = null;

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}

function hojeISO() {
  const hoje = new Date();
  return new Date(hoje.getTime() - hoje.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

function addDiasISO(dataISO, dias) {
  const [y, m, d] = dataISO.split('-').map(Number);
  const data = new Date(y, m - 1, d + dias);
  return `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, '0')}-${String(data.getDate()).padStart(2, '0')}`;
}

function refMesString(data) {
  return `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, '0')}`;
}

function fimMesRef(ref) {
  const [ano, mes] = ref.split('-').map(Number);
  return `${ano}-${String(mes).padStart(2, '0')}-${new Date(ano, mes, 0).getDate()}`;
}

function limitesMes(ref) {
  const ano = ref.getFullYear();
  const mes = ref.getMonth();
  const inicio = new Date(ano, mes, 1);
  const fim = new Date(ano, mes + 1, 0);
  const toISO = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return { inicio: toISO(inicio), fim: toISO(fim) };
}

function proximoFechamento(fechamentoDia) {
  const hoje = new Date();
  let ano = hoje.getFullYear();
  let mes = hoje.getMonth();
  if (hoje.getDate() > fechamentoDia) mes += 1;
  return new Date(ano, mes, fechamentoDia);
}

async function carregarContas(userId) {
  const { data, error } = await supabase
    .from('accounts')
    .select('id, nome, saldo_atual, currency')
    .eq('user_id', userId)
    .eq('active', true)
    .eq('account_kind', 'bank')
    .order('sort_order');
  if (error) throw error;
  return data ?? [];
}

async function carregarCategoriasDespesa(userId) {
  const { data, error } = await supabase
    .from('categories')
    .select('id, nome')
    .eq('user_id', userId)
    .eq('tipo', 'despesa')
    .eq('ativo', true)
    .order('nome');
  if (error) throw error;
  return data ?? [];
}

async function carregarCartoesResumo(userId) {
  const { data, error } = await supabase
    .from('credit_cards')
    .select('id, nome, fechamento_dia, vencimento_dia')
    .eq('user_id', userId)
    .eq('ativo', true)
    .order('sort_order');
  if (error) throw error;

  const cartoes = data ?? [];
  const linhas = await Promise.all(cartoes.map(async (cartao) => {
    // invoiceRef(hoje, ...) devolve a fatura que ainda está ACUMULANDO
    // compras (a próxima a fechar) — não a fatura que acabou de fechar e
    // está aguardando pagamento, que é a "conta deste mês" que o usuário
    // quer ver aqui. Checa a fatura anterior primeiro: se ainda tiver item
    // 'aberta' (fechou mas não foi paga), é ela que importa agora.
    const refAtual = invoiceRef(hojeISO(), cartao.fechamento_dia, cartao.vencimento_dia);
    const refAnterior = addMonthsRef(refAtual, -1);

    const { data: itensAnterior, error: erroAnterior } = await supabase
      .from('card_transactions')
      .select('valor_parcela, status')
      .eq('card_id', cartao.id)
      .eq('fatura_referencia', refAnterior);
    if (erroAnterior) throw erroAnterior;

    const abertosAnterior = (itensAnterior ?? []).filter((c) => c.status === 'aberta');

    let proximaFatura = 0;
    let statusFatura = 'aberta';

    if (abertosAnterior.length > 0) {
      proximaFatura = abertosAnterior.reduce((soma, c) => soma + Number(c.valor_parcela), 0);
      statusFatura = 'fechada';
    } else {
      const { data: itensAtual, error: erroAtual } = await supabase
        .from('card_transactions')
        .select('valor_parcela')
        .eq('card_id', cartao.id)
        .eq('fatura_referencia', refAtual)
        .eq('status', 'aberta');
      if (erroAtual) throw erroAtual;
      const totalAtual = (itensAtual ?? []).reduce((soma, c) => soma + Number(c.valor_parcela), 0);
      const pagosAnterior = (itensAnterior ?? []).filter((c) => c.status === 'paga');

      if (totalAtual > 0) {
        proximaFatura = totalAtual;
        statusFatura = 'aberta';
      } else if (pagosAnterior.length > 0) {
        proximaFatura = pagosAnterior.reduce((soma, c) => soma + Number(c.valor_parcela), 0);
        statusFatura = 'paga';
      }
    }

    return { cartao, fechamento: proximoFechamento(cartao.fechamento_dia), proximaFatura, statusFatura };
  }));

  return linhas;
}

async function carregarLancamentos(userId) {
  const [{ data: transacoes, error: erroTransacoes }, { data: compras, error: erroCompras }] = await Promise.all([
    supabase
      .from('transactions')
      .select('id, type, amount, description, date, status, account_id, is_recurring, recurrence_group_id, accounts(nome), categories(nome, icon)')
      .eq('user_id', userId)
      .or(`date.lte.${hojeISO()},parent_transaction_id.is.null`)
      .order('date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(10),
    supabase
      .from('card_transactions')
      .select('id, descricao, valor_total, data_compra, credit_cards(nome), categories(nome, icon)')
      .eq('user_id', userId)
      .eq('parcela_atual', 1)
      .lte('data_compra', hojeISO())
      .order('data_compra', { ascending: false })
      .limit(10),
  ]);
  if (erroTransacoes) throw erroTransacoes;
  if (erroCompras) throw erroCompras;

  const categoriaLabel = (c) => (c?.nome ? `${c.icon ? escapeHtml(c.icon) + ' ' : ''}${escapeHtml(c.nome)}` : null);

  const doConta = (transacoes ?? []).map((t) => ({
    id: t.id,
    fonte: 'transacao',
    type: t.type,
    status: t.status,
    account_id: t.account_id,
    is_recurring: t.is_recurring,
    recurrence_group_id: t.recurrence_group_id,
    origem: t.type === 'receita' ? 'Receita' : 'Despesa',
    positivo: t.type === 'receita',
    amount: t.amount,
    description: t.description,
    date: t.date,
    nomeOrigem: t.accounts?.nome ?? '',
    categoria: categoriaLabel(t.categories),
  }));
  const doCartao = (compras ?? []).map((c) => ({
    fonte: 'cartao',
    origem: 'Cartão',
    positivo: false,
    amount: c.valor_total,
    description: c.descricao,
    date: c.data_compra,
    nomeOrigem: c.credit_cards?.nome ?? '',
    categoria: categoriaLabel(c.categories),
  }));

  return [...doConta, ...doCartao]
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
    .slice(0, 10);
}

// ── Ranking de categorias (mesma lógica de js/home.js) ──
async function carregarRanking(userId, inicio, fim, inicioAnt, fimAnt, refMesAtual, refMesAntStr) {
  const [
    { data, error },
    { data: dataAnt, error: erroAnt },
    { data: compras, error: erroCompras },
    { data: comprasAnt, error: erroComprasAnt },
  ] = await Promise.all([
    supabase.from('transactions').select('amount, category_id, categories(nome)').eq('user_id', userId).eq('type', 'despesa').gte('date', inicio).lte('date', fim),
    supabase.from('transactions').select('amount, category_id').eq('user_id', userId).eq('type', 'despesa').gte('date', inicioAnt).lte('date', fimAnt),
    supabase.from('card_transactions').select('valor_parcela, category_id, categories(nome)').eq('user_id', userId).eq('fatura_referencia', refMesAtual),
    supabase.from('card_transactions').select('valor_parcela, category_id').eq('user_id', userId).eq('fatura_referencia', refMesAntStr),
  ]);
  if (error) throw error;
  if (erroAnt) throw erroAnt;
  if (erroCompras) throw erroCompras;
  if (erroComprasAnt) throw erroComprasAnt;

  function ignorar(categoriaId) {
    return categoriaId === idCategoriaFatura;
  }

  const porCategoriaAnt = new Map();
  for (const t of dataAnt ?? []) {
    if (ignorar(t.category_id)) continue;
    const chave = t.category_id ?? 'sem-categoria';
    porCategoriaAnt.set(chave, (porCategoriaAnt.get(chave) ?? 0) + Number(t.amount));
  }
  for (const c of comprasAnt ?? []) {
    const chave = c.category_id ?? 'sem-categoria';
    porCategoriaAnt.set(chave, (porCategoriaAnt.get(chave) ?? 0) + Number(c.valor_parcela));
  }

  const porCategoria = new Map();
  for (const t of data ?? []) {
    if (ignorar(t.category_id)) continue;
    const chave = t.category_id ?? 'sem-categoria';
    const nome = t.categories?.nome ?? 'Sem categoria';
    const atual = porCategoria.get(chave) ?? { nome, valor: 0, categoriaId: t.category_id ?? null, chave };
    atual.valor += Number(t.amount);
    porCategoria.set(chave, atual);
  }
  for (const c of compras ?? []) {
    const chave = c.category_id ?? 'sem-categoria';
    const nome = c.categories?.nome ?? 'Sem categoria';
    const atual = porCategoria.get(chave) ?? { nome, valor: 0, categoriaId: c.category_id ?? null, chave };
    atual.valor += Number(c.valor_parcela);
    porCategoria.set(chave, atual);
  }

  const linhas = [...porCategoria.values()].sort((a, b) => b.valor - a.valor);
  const total = linhas.reduce((soma, l) => soma + l.valor, 0);

  let itens = linhas;
  if (linhas.length > 5) {
    const top4 = linhas.slice(0, 4);
    const valorOutros = linhas.slice(4).reduce((soma, l) => soma + l.valor, 0);
    itens = [...top4, { nome: 'Outros', valor: valorOutros, categoriaId: null, chave: null }].sort((a, b) => b.valor - a.valor);
  }

  return {
    itens: itens.map((l) => {
      const anterior = l.chave ? (porCategoriaAnt.get(l.chave) ?? 0) : null;
      return { ...l, pct: total > 0 ? (l.valor / total) * 100 : 0, anterior };
    }),
  };
}

async function carregarEconomia(userId, inicio, fim) {
  const { data, error } = await supabase
    .from('transactions')
    .select('type, amount')
    .eq('user_id', userId)
    .gte('date', inicio)
    .lte('date', fim);
  if (error) throw error;
  let receitas = 0;
  let despesas = 0;
  for (const t of data ?? []) {
    if (t.type === 'receita') receitas += Number(t.amount);
    else despesas += Number(t.amount);
  }
  return { receitas, despesas };
}

async function carregarMetas(userId, ref) {
  const [{ data: orcamentos, error: erroOrc }, { data: despesas, error: erroDesp }] = await Promise.all([
    supabase.from('budgets').select('category_id, valor_planejado, categories(nome)').eq('user_id', userId).eq('mes_referencia', ref),
    supabase.from('transactions').select('category_id, amount').eq('user_id', userId).eq('type', 'despesa').eq('status', 'pago').gte('date', `${ref}-01`).lte('date', fimMesRef(ref)),
  ]);
  if (erroOrc) throw erroOrc;
  if (erroDesp) throw erroDesp;

  const gastoPorCategoria = new Map();
  for (const t of despesas ?? []) {
    gastoPorCategoria.set(t.category_id, (gastoPorCategoria.get(t.category_id) ?? 0) + Number(t.amount));
  }

  const categorias = (orcamentos ?? [])
    .map((o) => ({ nome: o.categories?.nome ?? 'Categoria', planejado: Number(o.valor_planejado), gasto: gastoPorCategoria.get(o.category_id) ?? 0 }))
    .sort((a, b) => (b.gasto / (b.planejado || 1)) - (a.gasto / (a.planejado || 1)));

  const totalPlanejado = categorias.reduce((soma, c) => soma + c.planejado, 0);
  const totalGasto = (despesas ?? []).reduce((soma, t) => soma + Number(t.amount), 0);
  return { categorias, totalPlanejado, totalGasto };
}

async function carregarMapaCalor(userId, inicio, fim) {
  const [{ data, error }, { data: pendentes, error: erroPendentes }, { data: compras, error: erroCompras }] = await Promise.all([
    supabase.from('transactions').select('date, amount, category_id').eq('user_id', userId).eq('type', 'despesa').eq('status', 'pago').gte('date', inicio).lte('date', fim),
    supabase.from('transactions').select('date, amount, category_id').eq('user_id', userId).eq('type', 'despesa').eq('status', 'pendente').gte('date', inicio).lte('date', fim),
    supabase.from('card_transactions').select('data_compra, valor_parcela, status').eq('user_id', userId).gte('data_compra', inicio).lte('data_compra', fim),
  ]);
  if (error) throw error;
  if (erroPendentes) throw erroPendentes;
  if (erroCompras) throw erroCompras;

  const porDia = new Map();
  for (const t of data ?? []) {
    if (t.category_id === idCategoriaFatura) continue;
    const dia = Number(t.date.slice(8, 10));
    porDia.set(dia, (porDia.get(dia) ?? 0) + Number(t.amount));
  }

  const porDiaPendente = new Map();
  for (const t of pendentes ?? []) {
    if (t.category_id === idCategoriaFatura) continue;
    const dia = Number(t.date.slice(8, 10));
    porDiaPendente.set(dia, (porDiaPendente.get(dia) ?? 0) + Number(t.amount));
  }

  for (const c of compras ?? []) {
    const dia = Number(c.data_compra.slice(8, 10));
    const alvo = c.status === 'paga' ? porDia : porDiaPendente;
    alvo.set(dia, (alvo.get(dia) ?? 0) + Number(c.valor_parcela));
  }

  const [ano, mes] = inicio.split('-').map(Number);
  const totalDias = new Date(ano, mes, 0).getDate();
  const primeiroDiaSemana = new Date(ano, mes - 1, 1).getDay();
  const maior = Math.max(0, ...porDia.values());
  const maiorPendente = Math.max(0, ...porDiaPendente.values());
  let pico = null;
  for (const [dia, valor] of porDia) {
    if (!pico || valor > pico.valor) pico = { dia, valor };
  }

  return { ano, mes, totalDias, primeiroDiaSemana, porDia, porDiaPendente, maior, maiorPendente, pico };
}

async function carregarPendentes(userId, tipo, inicio, fim) {
  const { data, error } = await supabase
    .from('transactions')
    .select('amount')
    .eq('user_id', userId)
    .eq('type', tipo)
    .eq('status', 'pendente')
    .gte('date', inicio)
    .lte('date', fim);
  if (error) throw error;
  const total = (data ?? []).reduce((soma, t) => soma + Number(t.amount), 0);
  return { tipo, count: (data ?? []).length, total };
}

async function carregarPendentesLista(userId, tipo, inicio, fim) {
  const { data, error } = await supabase
    .from('transactions')
    .select('id, type, amount, description, date, account_id, accounts(nome)')
    .eq('user_id', userId)
    .eq('type', tipo)
    .eq('status', 'pendente')
    .gte('date', inicio)
    .lte('date', fim)
    .order('date', { ascending: true });
  if (error) throw error;
  return (data ?? []).map((t) => ({ ...t, nomeOrigem: t.accounts?.nome ?? '' }));
}

// ── Render ──
function renderContas(contas) {
  const el = document.getElementById('widget-contas');
  if (contas.length === 0) {
    el.innerHTML = '<div class="lista-vazia">Nenhuma conta cadastrada.</div>';
    return;
  }
  el.innerHTML = contas.map((c) => `
    <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border)">
      <span>${escapeHtml(c.nome)}</span>
      <span class="num valor-sensivel">${formatarMoeda(c.saldo_atual, c.currency)}</span>
    </div>
  `).join('');
}

function renderCartoes(linhas) {
  const el = document.getElementById('widget-cartoes');
  if (linhas.length === 0) {
    el.innerHTML = '<div class="lista-vazia">Nenhum cartão cadastrado.</div>';
    return;
  }
  const rotuloStatus = { aberta: 'Aberta', fechada: 'Fechada', paga: 'Paga' };
  const corStatus = { aberta: 'var(--muted)', fechada: 'var(--warning)', paga: 'var(--success)' };

  el.innerHTML = linhas.map(({ cartao, proximaFatura, statusFatura }) => `
    <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--border)">
      <span>
        ${escapeHtml(cartao.nome)}
        <span style="margin-left:6px;font-size:11px;font-weight:800;color:${corStatus[statusFatura]}">● ${rotuloStatus[statusFatura]}</span>
      </span>
      <span class="num valor-sensivel">${fmt.format(proximaFatura)}</span>
    </div>
  `).join('');
}

function renderLancamentos(itens) {
  const el = document.getElementById('widget-lancamentos');
  if (itens.length === 0) {
    el.innerHTML = '<div class="lista-vazia">Nenhum lançamento recente.</div>';
    return;
  }
  el.innerHTML = `
    <table class="data-table">
      <thead><tr><th>Data</th><th>Descrição</th><th>Categoria</th><th>Origem</th><th class="num">Valor</th></tr></thead>
      <tbody>
        ${itens.map((i, idx) => `
          <tr ${i.fonte === 'transacao' ? `class="clicavel" data-idx="${idx}"` : ''}>
            <td>${fmtData.format(new Date(i.date + 'T00:00:00'))}</td>
            <td>${escapeHtml(i.description || i.origem)} <span style="color:var(--muted)">· ${escapeHtml(i.nomeOrigem)}</span></td>
            <td>${i.categoria ?? '—'}</td>
            <td>${escapeHtml(i.origem)}</td>
            <td class="num ${i.positivo ? 'positivo' : 'negativo'} valor-sensivel">${i.positivo ? '+' : '-'} ${fmt.format(Math.abs(i.amount))}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
  el.querySelectorAll('tr.clicavel').forEach((tr) => {
    tr.style.cursor = 'pointer';
    tr.addEventListener('click', () => abrirDetalhesLancamento(itens[Number(tr.dataset.idx)]));
  });
}

function renderRanking({ itens }) {
  const el = document.getElementById('widget-ranking');
  if (itens.length === 0) {
    el.innerHTML = '<div class="lista-vazia">Sem despesas neste mês.</div>';
    return;
  }
  const maior = itens[0].valor;
  el.innerHTML = itens.map((item, i) => {
    const largura = maior > 0 ? (item.valor / maior) * 100 : 0;
    const cor = CORES_RANKING[i % CORES_RANKING.length];
    const clicavel = !!item.categoriaId;
    let comparativoHtml = '';
    if (item.anterior !== null && item.anterior !== undefined && item.anterior > 0) {
      const deltaPct = Math.round(((item.valor - item.anterior) / item.anterior) * 100);
      const piorou = deltaPct > 0;
      if (deltaPct !== 0) comparativoHtml = `<div class="ranking-comparativo ${piorou ? 'pior' : 'melhor'}">${piorou ? '+' : ''}${deltaPct}% vs mês anterior</div>`;
    } else if (item.anterior === 0 && item.valor > 0) {
      comparativoHtml = '<div class="ranking-comparativo pior">Novo gasto neste mês</div>';
    }
    return `
      <div class="ranking-linha ${clicavel ? 'clicavel' : ''}" ${clicavel ? `data-categoria-id="${item.categoriaId}"` : ''}>
        <div class="ranking-nome">${escapeHtml(item.nome)}</div>
        <div class="ranking-barra-fundo"><div class="ranking-barra-fill" style="width:${largura}%;background:${cor}"><span class="ranking-pct">${item.pct.toFixed(1)}%</span></div></div>
      </div>
      ${comparativoHtml}
    `;
  }).join('');

  el.querySelectorAll('.ranking-linha.clicavel').forEach((linha) => {
    linha.addEventListener('click', () => {
      const ref = refMesString(mesRef);
      window.location.href = `/pages/desktop/extrato.html?categoria=${linha.dataset.categoriaId}&mes=${ref}`;
    });
  });
}

function renderEconomia({ receitas, despesas }, anterior) {
  const el = document.getElementById('widget-economia');
  const economia = receitas - despesas;
  const pct = receitas > 0 ? (economia / receitas) * 100 : 0;
  const pctAro = Math.max(0, Math.min(100, pct));
  const corAro = economia >= 0 ? 'var(--success)' : 'var(--danger)';

  const kpiEconomia = document.getElementById('kpi-economia');
  if (kpiEconomia) {
    kpiEconomia.textContent = `${Math.round(pct)}%`;
    kpiEconomia.classList.toggle('negativo', economia < 0);
  }

  let comparativoHtml = '';
  if (anterior && (anterior.receitas > 0 || anterior.despesas > 0)) {
    const economiaAnterior = anterior.receitas - anterior.despesas;
    const pctAnterior = anterior.receitas > 0 ? (economiaAnterior / anterior.receitas) * 100 : 0;
    const deltaPts = Math.round(pct - pctAnterior);
    const melhor = deltaPts >= 0;
    comparativoHtml = `<div class="economia-comparativo ${melhor ? 'melhor' : 'pior'}">${Math.abs(deltaPts)} pts vs mês anterior</div>`;
  }

  el.innerHTML = `
    <div class="economia-linha">
      <div class="economia-aro" style="background:conic-gradient(${corAro} ${pctAro}%, var(--surface-2) 0)">
        <div class="economia-aro-valor">${Math.round(pct)}%<small>economia</small></div>
      </div>
      <div class="economia-detalhes">
        <div class="economia-item"><div><div class="economia-texto-rotulo">Receitas</div><div class="economia-texto-valor receita valor-sensivel">${fmt.format(receitas)}</div></div></div>
        <div class="economia-item"><div><div class="economia-texto-rotulo">Despesas</div><div class="economia-texto-valor despesa valor-sensivel">${fmt.format(despesas)}</div></div></div>
      </div>
    </div>
    <div class="economia-valor-total">
      <div class="valor valor-sensivel ${economia < 0 ? 'negativo' : ''}">${fmt.format(economia)}</div>
      <div class="rotulo">Valor economizado</div>
      ${comparativoHtml}
    </div>
  `;
}

function renderMetas({ categorias, totalPlanejado, totalGasto }) {
  const el = document.getElementById('widget-metas');
  if (totalPlanejado === 0) {
    el.innerHTML = '<div class="lista-vazia">Nenhuma meta definida — edite em Cadastros → Orçamentos.</div>';
    return;
  }
  const pct = Math.round((totalGasto / totalPlanejado) * 100);
  const estourou = totalGasto > totalPlanejado;
  const pctAro = Math.max(0, Math.min(100, pct));
  const corAro = estourou ? 'var(--danger)' : 'var(--accent)';

  const categoriasHtml = categorias.map((c) => {
    const pctCat = c.planejado > 0 ? Math.min(100, (c.gasto / c.planejado) * 100) : 0;
    const estourouCat = c.gasto > c.planejado;
    return `
      <div class="metas-categoria">
        <div class="metas-categoria-topo ${estourouCat ? 'estourou' : ''}"><span>${escapeHtml(c.nome)}</span><span class="valores valor-sensivel">${fmt.format(c.gasto)} de ${fmt.format(c.planejado)}</span></div>
        <div class="metas-barra-fundo"><div class="metas-barra-fill ${estourouCat ? 'estourou' : ''}" style="width:${pctCat}%"></div></div>
      </div>
    `;
  }).join('');

  el.innerHTML = `
    <div class="metas-linha">
      <div class="metas-aro" style="background:conic-gradient(${corAro} ${pctAro}%, var(--surface-2) 0)">
        <div class="metas-aro-valor">${pct}%<small>do limite</small></div>
      </div>
      <div class="metas-resumo">
        <div class="linha"><span>Gasto</span><span class="valor-sensivel">${fmt.format(totalGasto)}</span></div>
        <div class="linha"><span>Limite</span><span class="valor-sensivel">${fmt.format(totalPlanejado)}</span></div>
        ${estourou ? `<div class="metas-estourou">⚠ Ultrapassou em ${fmt.format(totalGasto - totalPlanejado)}</div>` : ''}
      </div>
    </div>
    ${categoriasHtml}
  `;
}

function corIntensidade(intensidade) {
  if (intensidade <= 0) return 'var(--surface-2)';
  if (intensidade < 0.25) return 'rgba(217,112,90,0.35)';
  if (intensidade < 0.5) return 'rgba(217,112,90,0.6)';
  if (intensidade < 0.8) return 'rgba(217,112,90,0.85)';
  return 'var(--danger)';
}

function corIntensidadePendente(intensidade) {
  if (intensidade <= 0) return 'var(--surface-2)';
  if (intensidade < 0.25) return 'rgba(201,150,63,0.35)';
  if (intensidade < 0.5) return 'rgba(201,150,63,0.6)';
  if (intensidade < 0.8) return 'rgba(201,150,63,0.85)';
  return '#C9963F';
}

function formatCompacto(valor) {
  if (valor >= 1000) return `${(valor / 1000).toFixed(1).replace('.0', '')}k`;
  return String(Math.round(valor));
}

function renderMapaCalor({ ano, mes, totalDias, primeiroDiaSemana, porDia, porDiaPendente, maior, maiorPendente, pico }) {
  const el = document.getElementById('widget-mapacalor');
  const nomeMes = fmtMes.format(new Date(ano, mes - 1, 1)).replace(/^\w/, (c) => c.toUpperCase());
  const celulasVazias = Array.from({ length: primeiroDiaSemana }, () => '<div></div>');
  const cabecalho = DIAS_SEMANA.map((d) => `<div class="mapa-calor-semana">${d}</div>`).join('');

  const dias = [];
  for (let dia = 1; dia <= totalDias; dia++) {
    const valor = porDia.get(dia) ?? 0;
    const valorPendente = porDiaPendente?.get(dia) ?? 0;
    let cor;
    let textoValor;
    if (valor > 0) {
      cor = corIntensidade(valor / maior);
      textoValor = formatCompacto(valor);
    } else if (valorPendente > 0) {
      cor = corIntensidadePendente(valorPendente / maiorPendente);
      textoValor = formatCompacto(valorPendente);
    } else {
      cor = 'var(--surface-2)';
      textoValor = '';
    }
    dias.push(`<div class="mapa-calor-dia" style="background:${cor}"><div class="numero">${dia}</div><div class="valor valor-sensivel">${textoValor}</div></div>`);
  }

  const legenda = ['var(--surface-2)', 'rgba(217,112,90,0.35)', 'rgba(217,112,90,0.6)', 'rgba(217,112,90,0.85)', 'var(--danger)']
    .map((cor) => `<div class="mapa-calor-legenda-ponto" style="background:${cor}"></div>`).join('');

  el.innerHTML = `
    <div class="mapa-calor-grid">${cabecalho}${celulasVazias.join('')}${dias.join('')}</div>
    <div class="mapa-calor-legenda">menos ${legenda} mais</div>
    <div class="mapa-calor-legenda"><div class="mapa-calor-legenda-ponto" style="background:${corIntensidadePendente(0.85)}"></div>contas pendentes (ainda não pagas)</div>
    <div class="mapa-calor-legenda mapa-calor-mes-atual">${nomeMes} · ${ano}</div>
    ${pico ? `<div class="mapa-calor-pico valor-sensivel">Pico do mês: dia ${pico.dia} (${fmt.format(pico.valor)})</div>` : ''}
  `;
}

function renderPendentes({ tipo, count, total }) {
  const el = document.getElementById('widget-pendentes');
  const textoTipo = tipo === 'despesa' ? 'despesas' : 'receitas';

  const kpiPendencias = document.getElementById('kpi-pendencias');
  if (kpiPendencias) kpiPendencias.textContent = fmt.format(total);
  el.innerHTML = `
    <div class="pendentes-abas">
      <button type="button" class="pendentes-aba ${tipo === 'despesa' ? 'ativa' : ''}" data-tipo="despesa">Despesas</button>
      <button type="button" class="pendentes-aba ${tipo === 'receita' ? 'ativa' : ''}" data-tipo="receita">Receitas</button>
    </div>
    <div class="pendentes-conteudo">
      ${count === 0
        ? `<div class="lista-vazia">Nenhuma ${tipo === 'despesa' ? 'despesa' : 'receita'} pendente.</div>`
        : `<div class="pendentes-texto">Você tem <strong>${count} ${textoTipo} pendentes</strong> no total de</div><div class="pendentes-total valor-sensivel">${fmt.format(total)}</div>`}
      <button type="button" class="pendentes-btn" id="btn-ver-pendentes">Ver ${textoTipo} pendentes</button>
    </div>
  `;
  el.querySelectorAll('.pendentes-aba').forEach((btn) => {
    btn.addEventListener('click', async () => {
      pendentesTipo = btn.dataset.tipo;
      await recarregarPendentes();
    });
  });
  document.getElementById('btn-ver-pendentes')?.addEventListener('click', abrirModalPendentes);
}

async function abrirModalPendentes() {
  const textoTipo = pendentesTipo === 'despesa' ? 'Despesas pendentes' : 'Receitas pendentes';
  document.getElementById('titulo-lista-pendentes').textContent = textoTipo;
  const container = document.getElementById('lista-pendentes-itens');
  container.innerHTML = '<div class="lista-vazia">Carregando...</div>';
  abrirModal('modal-pendentes');

  try {
    const { inicio, fim } = limitesMes(mesRef);
    const itens = await carregarPendentesLista(usuarioAtual.id, pendentesTipo, inicio, fim);
    if (itens.length === 0) {
      container.innerHTML = '<div class="lista-vazia">Nenhuma pendência.</div>';
      return;
    }
    container.innerHTML = itens.map((l) => {
      const vencida = l.date <= hojeISO();
      const rotuloVencida = l.date === hojeISO() ? 'vence hoje' : 'vencida';
      return `
      <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;padding:10px 12px;border-bottom:1px solid var(--border);${vencida ? 'background:var(--danger-soft);border-radius:var(--radius-sm)' : ''}">
        <div>
          <div>${escapeHtml(l.description)}</div>
          <div style="font-size:12px;color:var(--muted)">${escapeHtml(l.nomeOrigem)} · ${vencida ? `<span style="color:var(--danger);font-weight:800">${rotuloVencida}</span> ` : ''}vence ${fmtDataCurta.format(new Date(l.date + 'T00:00:00'))}</div>
        </div>
        <div style="display:flex;align-items:center;gap:10px">
          <div class="num ${l.type === 'receita' ? 'positivo' : 'negativo'} valor-sensivel">${fmt.format(Math.abs(l.amount))}</div>
          <button type="button" class="btn-desktop" data-id="${l.id}" style="height:30px;padding:0 10px;font-size:11px;white-space:nowrap">Marcar como ${l.type === 'receita' ? 'recebida' : 'paga'}</button>
        </div>
      </div>
    `;
    }).join('');
    container.querySelectorAll('button[data-id]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const lancamento = itens.find((l) => l.id === btn.dataset.id);
        if (lancamento) darBaixa(lancamento, btn, 'modal-pendentes');
      });
    });
  } catch (err) {
    console.error(err);
    container.innerHTML = '<div class="lista-vazia">Não foi possível carregar.</div>';
  }
}

async function recarregarSaldosELista() {
  // carregarDadosDoMes() recalcula a timeline (Saldo Inicial/Atual/Previsto)
  // a partir de contasCache — precisa rodar depois do saldo atualizado ser
  // atribuído a contasCache, não em paralelo com o carregarContas() abaixo.
  const [contas, lancamentos] = await Promise.all([
    carregarContas(usuarioAtual.id),
    carregarLancamentos(usuarioAtual.id),
  ]);
  contasCache = contas;
  renderContas(contas);
  renderLancamentos(lancamentos);
  await carregarDadosDoMes();
}

async function darBaixa(lancamento, btn, modalId = 'modal-pendentes') {
  if (btn) btn.disabled = true;

  const { data: atualizados, error: erroUpdate } = await supabase
    .from('transactions')
    .update({ status: 'pago' })
    .eq('id', lancamento.id)
    .eq('user_id', usuarioAtual.id)
    .eq('status', 'pendente')
    .select('id');
  if (erroUpdate || !atualizados?.length) {
    if (btn) btn.disabled = false;
    return;
  }

  const delta = lancamento.type === 'receita' ? Number(lancamento.amount) : -Number(lancamento.amount);
  await supabase.rpc('increment_account_balance', { p_account_id: lancamento.account_id, p_delta: delta });

  fecharModal(modalId);
  await recarregarSaldosELista();
}

async function desfazerBaixa(lancamento) {
  document.querySelectorAll('#modal-lancamento-conteudo .btn-desktop').forEach((b) => { b.disabled = true; });

  const { error } = await supabase.rpc('fz_desfazer_baixa', { p_transaction_id: lancamento.id });
  if (error) {
    document.querySelectorAll('#modal-lancamento-conteudo .btn-desktop').forEach((b) => { b.disabled = false; });
    return;
  }

  fecharModal('modal-lancamento');
  await recarregarSaldosELista();
}

function abrirDetalhesLancamento(lancamento) {
  const conteudo = document.getElementById('modal-lancamento-conteudo');
  const pendente = lancamento.status === 'pendente';
  const paga = lancamento.status === 'pago';
  conteudo.innerHTML = `
    <div class="modal-titulo">${escapeHtml(lancamento.description)}</div>
    <div style="display:flex;flex-direction:column;gap:10px;margin-top:10px">
      ${pendente ? `<button type="button" class="btn-desktop primario" id="btn-dar-baixa">Marcar como ${lancamento.type === 'receita' ? 'recebida' : 'paga'}</button>` : ''}
      ${paga ? `<button type="button" class="btn-desktop" id="btn-desfazer-baixa">Desfazer baixa</button>` : ''}
      <button type="button" class="btn-desktop primario" id="btn-editar-lancamento">Editar</button>
      <button type="button" class="btn-desktop perigo" id="btn-excluir-lancamento">Excluir</button>
    </div>
  `;
  if (pendente) {
    document.getElementById('btn-dar-baixa').addEventListener('click', () => darBaixa(lancamento, null, 'modal-lancamento'));
  }
  if (paga) {
    document.getElementById('btn-desfazer-baixa').addEventListener('click', () => desfazerBaixa(lancamento));
  }
  document.getElementById('btn-editar-lancamento').addEventListener('click', () => {
    window.location.href = `/pages/desktop/lancar.html?id=${lancamento.id}`;
  });
  document.getElementById('btn-excluir-lancamento').addEventListener('click', () => confirmarExclusaoLancamento(lancamento));
  abrirModal('modal-lancamento');
}

function confirmarExclusaoLancamento(lancamento) {
  const recorrente = Boolean(lancamento.is_recurring || lancamento.recurrence_group_id);
  const conteudo = document.getElementById('modal-lancamento-conteudo');

  if (recorrente) {
    conteudo.innerHTML = `
      <div class="modal-titulo">Excluir recorrência</div>
      <p style="color:var(--muted);font-size:13px">Este lançamento faz parte de uma recorrência. Escolha o alcance da exclusão.</p>
      <div style="display:flex;flex-direction:column;gap:10px;margin-top:10px">
        <button type="button" class="btn-desktop perigo" id="btn-excluir-only">Excluir somente esta ocorrência</button>
        <button type="button" class="btn-desktop perigo" id="btn-excluir-future">Excluir esta e futuras</button>
        <button type="button" class="btn-desktop perigo" id="btn-excluir-series">Excluir toda a série</button>
      </div>
    `;
    document.getElementById('btn-excluir-only').addEventListener('click', () => excluirLancamentoDaHome(lancamento, 'only'));
    document.getElementById('btn-excluir-future').addEventListener('click', () => excluirLancamentoDaHome(lancamento, 'future'));
    document.getElementById('btn-excluir-series').addEventListener('click', () => excluirLancamentoDaHome(lancamento, 'series'));
    return;
  }

  conteudo.innerHTML = `
    <div class="modal-titulo">Excluir "${escapeHtml(lancamento.description)}"?</div>
    <p style="color:var(--muted);font-size:13px">Essa ação não pode ser desfeita.</p>
    <button type="button" class="btn-desktop perigo" id="btn-confirmar-exclusao" style="margin-top:10px">Excluir lançamento</button>
  `;
  document.getElementById('btn-confirmar-exclusao').addEventListener('click', () => excluirLancamentoDaHome(lancamento, 'only'));
}

async function excluirLancamentoDaHome(lancamento, scope) {
  const grupoId = lancamento.recurrence_group_id || lancamento.id;
  let query = supabase.from('transactions').select('id, type, amount, status, account_id').eq('user_id', usuarioAtual.id);
  if (scope === 'future') query = query.eq('recurrence_group_id', grupoId).gte('date', lancamento.date);
  else if (scope === 'series') query = query.eq('recurrence_group_id', grupoId);
  else query = query.eq('id', lancamento.id);

  const { data: alvos, error: erroAlvos } = await query;
  if (erroAlvos || !alvos || !alvos.length) return;

  const ids = alvos.map((a) => a.id);
  const { error: erroDelete } = await supabase.from('transactions').delete().eq('user_id', usuarioAtual.id).in('id', ids);
  if (erroDelete) return;

  for (const item of alvos) {
    if (item.status === 'pago') {
      const delta = item.type === 'receita' ? -Number(item.amount) : Number(item.amount);
      await supabase.rpc('increment_account_balance', { p_account_id: item.account_id, p_delta: delta });
    }
  }

  fecharModal('modal-lancamento');
  await recarregarSaldosELista();
}

async function recarregarPendentes() {
  const { inicio, fim } = limitesMes(mesRef);
  const pendentes = await carregarPendentes(usuarioAtual.id, pendentesTipo, inicio, fim);
  renderPendentes(pendentes);
}

function renderMesLabel() {
  document.getElementById('mes-atual').textContent = fmtMesAno.format(mesRef).replace(/^\w/, (c) => c.toUpperCase());
}

// Busca as transações do intervalo que cobre o mês selecionado e hoje, e a
// partir do saldo real de hoje projeta o saldo em qualquer outra data do
// mês somando/subtraindo o fluxo (receitas - despesas) entre as duas datas.
// Mesma lógica do mobile (js/home.js) — mantém os dois em sincronia.
async function carregarTimeline(userId, contaIds, saldoAtualReal) {
  const hoje = hojeISO();
  const { inicio, fim } = limitesMes(mesRef);
  const desde = inicio < hoje ? inicio : hoje;
  const ate = fim > hoje ? fim : hoje;

  let transacoes = [];
  if (contaIds.length > 0) {
    const { data, error } = await supabase
      .from('transactions')
      .select('type, amount, date, status')
      .eq('user_id', userId)
      .in('account_id', contaIds)
      .gte('date', desde)
      .lte('date', ate);
    if (error) throw error;
    transacoes = data ?? [];
  }

  function fluxoRealizado(de, ateData) {
    if (de > ateData) return 0;
    return transacoes
      .filter((t) => t.status === 'pago' && t.date >= de && t.date <= ateData)
      .reduce((soma, t) => soma + (t.type === 'receita' ? Number(t.amount) : -Number(t.amount)), 0);
  }

  function fluxoPendente(de, ateData) {
    if (de > ateData) return 0;
    return transacoes
      .filter((t) => t.status === 'pendente' && t.date >= de && t.date <= ateData)
      .reduce((soma, t) => soma + (t.type === 'receita' ? Number(t.amount) : -Number(t.amount)), 0);
  }

  function saldoNoFimDoDia(dataISO) {
    if (dataISO >= hoje) return saldoAtualReal + fluxoPendente(addDiasISO(hoje, 1), dataISO);
    const limiteSuperior = fim > hoje ? fim : hoje;
    return saldoAtualReal - fluxoRealizado(addDiasISO(dataISO, 1), limiteSuperior);
  }

  const diaAntesInicio = addDiasISO(inicio, -1);
  const inicial = saldoNoFimDoDia(diaAntesInicio);
  const pontoAtual = hoje < inicio ? diaAntesInicio : hoje > fim ? fim : hoje;
  const atual = saldoNoFimDoDia(pontoAtual);
  const previsto = saldoNoFimDoDia(fim);

  // Série dia a dia do mês inteiro (do 1º ao último dia) pro gráfico de
  // linha — reaproveita a mesma saldoNoFimDoDia já usada pros 3 números.
  const serie = [];
  for (let dia = inicio; dia <= fim; dia = addDiasISO(dia, 1)) {
    serie.push({ data: dia, saldo: saldoNoFimDoDia(dia) });
  }

  return { inicial, atual, previsto, serie, hoje };
}

function renderTimeline({ inicial, atual, previsto }) {
  const elInicial = document.getElementById('valor-inicial');
  const elAtual = document.getElementById('valor-atual');
  const elPrevisto = document.getElementById('valor-previsto');
  if (!elInicial || !elAtual || !elPrevisto) return;

  elInicial.textContent = fmt.format(inicial);
  elAtual.textContent = fmt.format(atual);
  elPrevisto.textContent = fmt.format(previsto);

  elInicial.classList.toggle('negativo', inicial < 0);
  elAtual.classList.toggle('negativo', atual < 0);
  elPrevisto.classList.toggle('negativo', previsto < 0);

  const kpiSaldoAtual = document.getElementById('kpi-saldo-atual');
  const kpiPrevisto = document.getElementById('kpi-previsto');
  if (kpiSaldoAtual) {
    kpiSaldoAtual.textContent = fmt.format(atual);
    kpiSaldoAtual.classList.toggle('negativo', atual < 0);
  }
  if (kpiPrevisto) {
    kpiPrevisto.textContent = fmt.format(previsto);
    kpiPrevisto.classList.toggle('negativo', previsto < 0);
  }
}

async function renderGraficoSaldoMes(serie, hoje) {
  const canvas = document.getElementById('chart-saldo-mes');
  if (!canvas) return;

  const Chart = await loadChart();
  const labels = serie.map((p) => String(Number(p.data.slice(8, 10))));
  const dados = serie.map((p) => p.saldo);
  const corLinha = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#0E7C86';

  if (chartSaldoMes) { chartSaldoMes.destroy(); chartSaldoMes = null; }
  chartSaldoMes = new Chart(canvas, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        data: dados,
        borderColor: corLinha,
        backgroundColor: `${corLinha}22`,
        borderWidth: 2,
        pointRadius: (ctx) => (serie[ctx.dataIndex]?.data === hoje ? 4 : 0),
        pointBackgroundColor: corLinha,
        fill: true,
        tension: 0.25,
        // Trecho depois de hoje é projeção, não fato — mesma distinção
        // visual (linha pontilhada) que o timeline do mobile já usa.
        segment: {
          borderDash: (ctx) => (serie[ctx.p1DataIndex]?.data > hoje ? [5, 4] : undefined),
        },
      }],
    },
    options: {
      maintainAspectRatio: false,
      interaction: { intersect: false, mode: 'index' },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: (items) => `Dia ${labels[items[0].dataIndex]}`,
            label: (item) => fmt.format(item.parsed.y),
          },
        },
      },
      scales: {
        x: { grid: { display: false }, ticks: { maxTicksLimit: 8, font: { size: 10 } } },
        y: {
          grid: { color: 'rgba(128,128,128,0.12)' },
          ticks: {
            font: { size: 10 },
            callback: (v) => (Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(1).replace('.0', '')}k` : v),
          },
        },
      },
    },
  });
}

async function recarregarTimeline() {
  try {
    const saldoAtualReal = contasCache.reduce((soma, c) => soma + paraBRL(c.saldo_atual, c.currency, dolarAtual), 0);
    const timeline = await carregarTimeline(usuarioAtual.id, contasCache.map((c) => c.id), saldoAtualReal);
    renderTimeline(timeline);
    await renderGraficoSaldoMes(timeline.serie, timeline.hoje);
  } catch (err) {
    console.error(err);
  }
}

async function carregarDadosDoMes() {
  const { inicio, fim } = limitesMes(mesRef);
  const mesAnterior = new Date(mesRef.getFullYear(), mesRef.getMonth() - 1, 1);
  const { inicio: inicioAnt, fim: fimAnt } = limitesMes(mesAnterior);
  const refMesAtual = refMesString(mesRef);
  const refMesAnt = refMesString(mesAnterior);

  const [ranking, economia, economiaAnt, metas, mapacalor, pendentes] = await Promise.all([
    carregarRanking(usuarioAtual.id, inicio, fim, inicioAnt, fimAnt, refMesAtual, refMesAnt),
    carregarEconomia(usuarioAtual.id, inicio, fim),
    carregarEconomia(usuarioAtual.id, inicioAnt, fimAnt),
    carregarMetas(usuarioAtual.id, refMesAtual),
    carregarMapaCalor(usuarioAtual.id, inicio, fim),
    carregarPendentes(usuarioAtual.id, pendentesTipo, inicio, fim),
    recarregarTimeline(),
  ]);

  renderRanking(ranking);
  renderEconomia(economia, economiaAnt);
  renderMetas(metas);
  renderMapaCalor(mapacalor);
  renderPendentes(pendentes);
}

async function mudarMes(delta) {
  mesRef.setMonth(mesRef.getMonth() + delta);
  renderMesLabel();
  await carregarDadosDoMes();
}

async function iniciar() {
  aplicarTemaSalvo();
  const user = await requireAuth();
  if (!user) return;
  usuarioAtual = user;

  montarNavRail('home');
  configurarBotaoSair();
  document.getElementById('btn-topbar-busca').addEventListener('click', abrirComandos);
  configurarModal('modal-pendentes');
  document.getElementById('btn-fechar-modal-pendentes').addEventListener('click', () => fecharModal('modal-pendentes'));
  configurarModal('modal-lancamento');
  document.getElementById('btn-fechar-modal-lancamento').addEventListener('click', () => fecharModal('modal-lancamento'));

  renderMesLabel();
  document.getElementById('btn-mes-anterior').addEventListener('click', () => mudarMes(-1));
  document.getElementById('btn-mes-proximo').addEventListener('click', () => mudarMes(1));

  // As quatro buscas são independentes entre si (nenhuma usa o resultado
  // da outra pra montar sua própria query) — rodar em paralelo em vez de
  // esperar as categorias antes de sequer começar a buscar contas/cartões/
  // lançamentos cortava um estágio inteiro de rede do carregamento inicial.
  const [categoriasDespesa, contas, cartoes, lancamentos, dolar] = await Promise.all([
    carregarCategoriasDespesa(user.id).catch(() => []),
    carregarContas(user.id),
    carregarCartoesResumo(user.id),
    carregarLancamentos(user.id),
    carregarCotacaoDolar(supabase, user.id),
  ]);
  idCategoriaFatura = categoriasDespesa.find((c) => c.nome === 'Fatura de Cartão')?.id ?? null;
  contasCache = contas;
  dolarAtual = dolar;

  renderContas(contas);
  renderCartoes(cartoes);
  renderLancamentos(lancamentos);
  await carregarDadosDoMes();

  await inicializarBoard({ principal: 'board-principal', lateral: 'board-lateral' }, 'home', user.id);
}

iniciar();
