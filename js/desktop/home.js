import { supabase, requireAuth, configurarBotaoSair } from '../supabaseClient.js';
import { aplicarTemaSalvo } from '../temaService.js';
import { invoiceRef } from '../cardService.js';
import { montarNavRail } from './navRail.js';
import { abrirComandos } from './comandos.js';
import { inicializarBoard } from './board.js';

const fmt = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtData = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit' });

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}

function hojeISO() {
  const hoje = new Date();
  return new Date(hoje.getTime() - hoje.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

function limitesMesAtual() {
  const hoje = new Date();
  const inicio = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
  const fim = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0);
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

async function carregarResumoMes(userId) {
  const { inicio, fim } = limitesMesAtual();
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
    const ref = invoiceRef(hojeISO(), cartao.fechamento_dia, cartao.vencimento_dia);
    const { data: compras, error: erroCompras } = await supabase
      .from('card_transactions')
      .select('valor_parcela')
      .eq('card_id', cartao.id)
      .eq('fatura_referencia', ref)
      .eq('status', 'aberta');
    if (erroCompras) throw erroCompras;
    const proximaFatura = (compras ?? []).reduce((soma, c) => soma + Number(c.valor_parcela), 0);
    return { cartao, fechamento: proximoFechamento(cartao.fechamento_dia), proximaFatura };
  }));

  return linhas;
}

async function carregarLancamentos(userId) {
  const [{ data: transacoes, error: erroTransacoes }, { data: compras, error: erroCompras }] = await Promise.all([
    supabase
      .from('transactions')
      .select('id, type, amount, description, date, account_id, accounts(nome)')
      .eq('user_id', userId)
      .or(`date.lte.${hojeISO()},parent_transaction_id.is.null`)
      .order('date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(10),
    supabase
      .from('card_transactions')
      .select('id, descricao, valor_total, data_compra, credit_cards(nome)')
      .eq('user_id', userId)
      .eq('parcela_atual', 1)
      .lte('data_compra', hojeISO())
      .order('data_compra', { ascending: false })
      .limit(10),
  ]);
  if (erroTransacoes) throw erroTransacoes;
  if (erroCompras) throw erroCompras;

  const doConta = (transacoes ?? []).map((t) => ({
    origem: t.type === 'receita' ? 'Receita' : 'Despesa',
    positivo: t.type === 'receita',
    amount: t.amount,
    description: t.description,
    date: t.date,
    nomeOrigem: t.accounts?.nome ?? '',
  }));
  const doCartao = (compras ?? []).map((c) => ({
    origem: 'Cartão',
    positivo: false,
    amount: c.valor_total,
    description: c.descricao,
    date: c.data_compra,
    nomeOrigem: c.credit_cards?.nome ?? '',
  }));

  return [...doConta, ...doCartao]
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
    .slice(0, 10);
}

function renderContas(contas) {
  const el = document.getElementById('widget-contas');
  if (contas.length === 0) {
    el.innerHTML = '<div class="lista-vazia">Nenhuma conta cadastrada.</div>';
    return;
  }
  el.innerHTML = contas.map((c) => `
    <div class="cartoes-linha" style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border)">
      <span>${escapeHtml(c.nome)}</span>
      <span class="num valor-sensivel">${fmt.format(c.saldo_atual)}</span>
    </div>
  `).join('');
}

function renderResumo({ receitas, despesas }) {
  const el = document.getElementById('widget-resumo');
  el.innerHTML = `
    <div>
      <div class="kpi-rotulo">Receitas</div>
      <div class="kpi-valor num positivo valor-sensivel">${fmt.format(receitas)}</div>
    </div>
    <div>
      <div class="kpi-rotulo">Despesas</div>
      <div class="kpi-valor num negativo valor-sensivel">${fmt.format(despesas)}</div>
    </div>
    <div>
      <div class="kpi-rotulo">Saldo do mês</div>
      <div class="kpi-valor num ${receitas - despesas >= 0 ? 'positivo' : 'negativo'} valor-sensivel">${fmt.format(receitas - despesas)}</div>
    </div>
  `;
}

function renderCartoes(linhas) {
  const el = document.getElementById('widget-cartoes');
  if (linhas.length === 0) {
    el.innerHTML = '<div class="lista-vazia">Nenhum cartão cadastrado.</div>';
    return;
  }
  el.innerHTML = linhas.map(({ cartao, proximaFatura }) => `
    <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border)">
      <span>${escapeHtml(cartao.nome)}</span>
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
      <thead>
        <tr><th>Data</th><th>Descrição</th><th>Origem</th><th class="num">Valor</th></tr>
      </thead>
      <tbody>
        ${itens.map((i) => `
          <tr>
            <td>${fmtData.format(new Date(i.date + 'T00:00:00'))}</td>
            <td>${escapeHtml(i.description || i.origem)} <span style="color:var(--muted)">· ${escapeHtml(i.nomeOrigem)}</span></td>
            <td>${escapeHtml(i.origem)}</td>
            <td class="num ${i.positivo ? 'positivo' : 'negativo'} valor-sensivel">${i.positivo ? '+' : '-'} ${fmt.format(Math.abs(i.amount))}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

async function iniciar() {
  aplicarTemaSalvo();
  const user = await requireAuth();
  if (!user) return;

  montarNavRail('home');
  configurarBotaoSair();
  document.getElementById('btn-topbar-busca').addEventListener('click', abrirComandos);

  const [contas, resumo, cartoes, lancamentos] = await Promise.all([
    carregarContas(user.id),
    carregarResumoMes(user.id),
    carregarCartoesResumo(user.id),
    carregarLancamentos(user.id),
  ]);

  renderContas(contas);
  renderResumo(resumo);
  renderCartoes(cartoes);
  renderLancamentos(lancamentos);

  await inicializarBoard('board', 'home', user.id);
}

iniciar();
