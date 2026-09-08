import { supabase, requireAuth, configurarBotaoSair } from '../supabaseClient.js';
import { aplicarTemaSalvo } from '../temaService.js';
import { invoiceRef, addMonthsRef } from '../cardService.js';
import { loadChart } from '../loadChart.js';
import { montarNavRail } from './navRail.js';
import { abrirComandos } from './comandos.js';
import { configurarModal, abrirModal, fecharModal } from './modal.js';

const fmt = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtMesCurto = new Intl.DateTimeFormat('pt-BR', { month: 'short' });
const fmtMesAno = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' });

let cartoes = [];
let cartaoSelecionado = null;
let faturaRef = null;
let comprasCache = [];
let contasBancarias = [];
let usuarioAtual = null;
let chartTendencia = null;

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}

function hojeISO() {
  const hoje = new Date();
  return new Date(hoje.getTime() - hoje.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

function rotuloFatura(ref) {
  const [y, m] = ref.split('-').map(Number);
  const data = new Date(y, m - 1, 1);
  return fmtMesAno.format(data).replace(/^\w/, (c) => c.toUpperCase());
}

function cartaoAtual() {
  return cartoes.find((c) => c.id === cartaoSelecionado) ?? null;
}

function renderCartoes() {
  const container = document.getElementById('lista-cartoes-chip');
  container.innerHTML = cartoes.map((c) => `
    <button type="button" class="chip-desktop ${c.id === cartaoSelecionado ? 'selecionada' : ''}" data-id="${c.id}">
      ${escapeHtml(c.nome)}
    </button>
  `).join('');
  container.querySelectorAll('.chip-desktop').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (btn.dataset.id === cartaoSelecionado) return;
      cartaoSelecionado = btn.dataset.id;
      const cartao = cartaoAtual();
      faturaRef = invoiceRef(hojeISO(), cartao.fechamento_dia, cartao.vencimento_dia);
      renderCartoes();
      renderFatura();
      recarregar();
    });
  });
}

function renderFatura() {
  document.getElementById('fatura-atual').textContent = faturaRef ? rotuloFatura(faturaRef) : '—';
  const cartao = cartaoAtual();
  document.getElementById('venc-fatura').textContent = cartao?.vencimento_dia ? `Vence dia ${cartao.vencimento_dia}` : '';
}

async function carregarCartoes(userId) {
  const { data, error } = await supabase
    .from('credit_cards')
    .select('id, nome, limite, fechamento_dia, vencimento_dia')
    .eq('user_id', userId)
    .eq('ativo', true)
    .order('sort_order');
  if (error) throw error;
  cartoes = data ?? [];
  const cartaoUrl = new URLSearchParams(window.location.search).get('cartao');
  cartaoSelecionado = (cartaoUrl && cartoes.some((c) => c.id === cartaoUrl)) ? cartaoUrl : (cartoes[0]?.id ?? null);
  const cartao = cartaoAtual();
  faturaRef = cartao ? invoiceRef(hojeISO(), cartao.fechamento_dia, cartao.vencimento_dia) : null;
  renderCartoes();
  renderFatura();
}

async function carregarCompras() {
  if (!cartaoSelecionado || !faturaRef) return [];
  const { data, error } = await supabase
    .from('card_transactions')
    .select('id, descricao, valor_parcela, parcela_atual, parcelas, data_compra, status, purchase_group_id')
    .eq('card_id', cartaoSelecionado)
    .eq('fatura_referencia', faturaRef)
    .order('data_compra', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

async function grupoTemParcelaPaga(grupoId) {
  if (!grupoId) return false;
  const { data, error } = await supabase
    .from('card_transactions')
    .select('id')
    .eq('purchase_group_id', grupoId)
    .eq('status', 'paga')
    .limit(1);
  if (error) throw error;
  return (data ?? []).length > 0;
}

async function carregarContasBancarias(userId) {
  const { data, error } = await supabase
    .from('accounts')
    .select('id, nome')
    .eq('user_id', userId)
    .eq('active', true)
    .eq('account_kind', 'bank')
    .order('sort_order');
  if (error) throw error;
  return data ?? [];
}

async function obterCategoriaFatura(userId) {
  const { data: existentes, error: erroBusca } = await supabase
    .from('categories')
    .select('id, nome')
    .eq('user_id', userId)
    .eq('tipo', 'despesa');
  if (erroBusca) throw erroBusca;

  const achada = (existentes ?? []).find((c) => c.nome.trim().toLowerCase() === 'fatura de cartão');
  if (achada) return achada.id;

  const { data, error } = await supabase
    .from('categories')
    .insert({ user_id: userId, nome: 'Fatura de Cartão', tipo: 'despesa', icon: '💳', ativo: true })
    .select('id')
    .single();
  if (error) throw error;
  return data.id;
}

async function carregarLimiteUsado() {
  if (!cartaoSelecionado) return 0;
  const { data, error } = await supabase
    .from('card_transactions')
    .select('valor_parcela')
    .eq('card_id', cartaoSelecionado)
    .eq('status', 'aberta');
  if (error) throw error;
  return (data ?? []).reduce((soma, r) => soma + Number(r.valor_parcela), 0);
}

function renderCompras(compras) {
  const container = document.getElementById('lista-compras');
  if (compras.length === 0) {
    container.innerHTML = '<div class="lista-vazia">Nenhuma compra nesta fatura.</div>';
    return;
  }
  container.innerHTML = compras.map((c) => `
    <div class="compra-linha" data-id="${c.id}">
      <div>
        <div>${escapeHtml(c.descricao)}</div>
        <div class="compra-parcela">${c.parcelas > 1 ? `Parcela ${c.parcela_atual}/${c.parcelas}` : 'À vista'}</div>
      </div>
      <div class="num valor-sensivel">${fmt.format(Number(c.valor_parcela))}</div>
    </div>
  `).join('');

  container.querySelectorAll('.compra-linha').forEach((el) => {
    el.addEventListener('click', () => {
      const compra = compras.find((c) => c.id === el.dataset.id);
      if (compra) abrirDetalhesCompra(compra);
    });
  });
}

async function abrirDetalhesCompra(compra) {
  const conteudo = document.getElementById('modal-compra-conteudo');

  if (compra.status === 'paga') {
    conteudo.innerHTML = `
      <div class="modal-titulo">${escapeHtml(compra.descricao)}</div>
      <p style="color:var(--muted);font-size:13px">Essa parcela já foi paga — não é possível editar ou excluir.</p>
    `;
    abrirModal('modal-compra');
    return;
  }

  conteudo.innerHTML = `<div class="modal-titulo">Verificando…</div>`;
  abrirModal('modal-compra');

  let bloqueado = false;
  try {
    bloqueado = await grupoTemParcelaPaga(compra.purchase_group_id);
  } catch (err) {
    console.error(err);
  }

  if (bloqueado) {
    conteudo.innerHTML = `
      <div class="modal-titulo">${escapeHtml(compra.descricao)}</div>
      <p style="color:var(--muted);font-size:13px">Essa compra já tem parcela paga em outra fatura — não é possível editar ou excluir.</p>
    `;
    return;
  }

  conteudo.innerHTML = `
    <div class="modal-titulo">${escapeHtml(compra.descricao)}</div>
    <div style="display:flex;flex-direction:column;gap:10px;margin-top:10px">
      <a class="btn-desktop primario" href="/pages/comprar-cartao.html?grupo=${compra.purchase_group_id}">Editar</a>
      <button type="button" class="btn-desktop perigo" id="btn-excluir-compra">Excluir</button>
    </div>
  `;
  document.getElementById('btn-excluir-compra').addEventListener('click', () => confirmarExclusaoCompra(compra));
}

function confirmarExclusaoCompra(compra) {
  const conteudo = document.getElementById('modal-compra-conteudo');
  conteudo.innerHTML = `
    <div class="modal-titulo">Excluir "${escapeHtml(compra.descricao)}"?</div>
    <p style="color:var(--muted);font-size:13px">Remove todas as parcelas dessa compra. Essa ação não pode ser desfeita.</p>
    <button type="button" class="btn-desktop perigo" id="btn-confirmar-exclusao-compra" style="margin-top:10px">Excluir compra</button>
  `;
  document.getElementById('btn-confirmar-exclusao-compra').addEventListener('click', () => excluirCompra(compra));
}

async function excluirCompra(compra) {
  const btn = document.getElementById('btn-confirmar-exclusao-compra');
  btn.disabled = true;
  btn.textContent = 'Excluindo...';

  const { error } = await supabase
    .from('card_transactions')
    .delete()
    .eq('purchase_group_id', compra.purchase_group_id)
    .eq('user_id', usuarioAtual.id);

  if (error) {
    btn.disabled = false;
    btn.textContent = 'Excluir compra';
    return;
  }

  fecharModal('modal-compra');
  await recarregar();
}

function renderResumo(totalFatura, limiteUsado) {
  const cartao = cartaoAtual();
  document.getElementById('total-fatura').textContent = fmt.format(totalFatura);

  const limite = Number(cartao?.limite || 0);
  const disponivel = Math.max(limite - limiteUsado, 0);
  const percentual = limite > 0 ? Math.min((limiteUsado / limite) * 100, 100) : 0;

  document.getElementById('limite-barra-fill').style.width = `${percentual}%`;
  document.getElementById('limite-usado').textContent = `Usado ${fmt.format(limiteUsado)}`;
  document.getElementById('limite-disponivel').textContent = `Disp. ${fmt.format(disponivel)}`;
}

function renderBotaoPagar() {
  const temAberto = comprasCache.some((c) => c.status === 'aberta');
  document.getElementById('btn-pagar-fatura').hidden = !temAberto;
  document.getElementById('fatura-paga-aviso').hidden = temAberto || comprasCache.length === 0;
}

async function carregarTendenciaFatura() {
  if (!cartaoSelecionado || !faturaRef) return { anterior: 0, atual: 0, proxima: 0 };
  const refs = [addMonthsRef(faturaRef, -1), faturaRef, addMonthsRef(faturaRef, 1)];
  const { data, error } = await supabase
    .from('card_transactions')
    .select('valor_parcela, fatura_referencia')
    .eq('card_id', cartaoSelecionado)
    .in('fatura_referencia', refs);
  if (error) throw error;

  const totais = { [refs[0]]: 0, [refs[1]]: 0, [refs[2]]: 0 };
  (data ?? []).forEach((r) => { totais[r.fatura_referencia] = (totais[r.fatura_referencia] || 0) + Number(r.valor_parcela || 0); });
  return { anterior: totais[refs[0]], atual: totais[refs[1]], proxima: totais[refs[2]], refs };
}

async function renderTendenciaFatura() {
  let dados;
  try {
    dados = await carregarTendenciaFatura();
  } catch (err) {
    console.error(err);
    return;
  }

  document.getElementById('tendencia-anterior').textContent = fmt.format(dados.anterior || 0);
  document.getElementById('tendencia-atual').textContent = fmt.format(dados.atual || 0);
  document.getElementById('tendencia-proxima').textContent = fmt.format(dados.proxima || 0);

  if (!dados.refs) return;

  try {
    const Chart = await loadChart();
    if (chartTendencia) { chartTendencia.destroy(); chartTendencia = null; }
    const labels = dados.refs.map((ref) => {
      const [y, m] = ref.split('-').map(Number);
      return fmtMesCurto.format(new Date(y, m - 1, 1)).replace('.', '');
    });
    const muted = getComputedStyle(document.documentElement).getPropertyValue('--muted').trim();
    const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
    chartTendencia = new Chart(document.getElementById('chart-tendencia-fatura'), {
      type: 'line',
      data: {
        labels,
        datasets: [{
          data: [dados.anterior, dados.atual, dados.proxima],
          borderColor: accent,
          backgroundColor: accent + '20',
          borderWidth: 2,
          fill: true,
          tension: 0.35,
          pointRadius: [4, 6, 4],
          pointBackgroundColor: [muted, accent, '#c9c9c9'],
        }],
      },
      options: {
        maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: (ctx) => ' ' + fmt.format(ctx.raw) } } },
        scales: {
          x: { grid: { display: false }, ticks: { color: muted, font: { size: 10 } } },
          y: { display: false },
        },
      },
    });
  } catch (err) { console.error(err); }
}

async function recarregar() {
  try {
    const [compras, limiteUsado] = await Promise.all([carregarCompras(), carregarLimiteUsado()]);
    comprasCache = compras;
    const totalFatura = compras.reduce((soma, c) => soma + Number(c.valor_parcela), 0);
    renderCompras(compras);
    renderResumo(totalFatura, limiteUsado);
    renderBotaoPagar();
    renderTendenciaFatura();
  } catch (err) {
    console.error(err);
    document.getElementById('lista-compras').innerHTML = '<div class="lista-vazia">Não foi possível carregar a fatura.</div>';
  }
}

function abrirModalPagar() {
  const totalAberto = comprasCache.filter((c) => c.status === 'aberta').reduce((soma, c) => soma + Number(c.valor_parcela), 0);
  document.getElementById('modal-valor-pagar').textContent = fmt.format(totalAberto);
  document.getElementById('erro-pagar').textContent = '';

  const select = document.getElementById('modal-select-conta');
  select.innerHTML = '<option value="">Selecione a conta</option>' + contasBancarias.map((c) => `<option value="${c.id}">${escapeHtml(c.nome)}</option>`).join('');

  abrirModal('modal-pagar');
}

async function confirmarPagamento() {
  const erroEl = document.getElementById('erro-pagar');
  erroEl.textContent = '';

  const contaId = document.getElementById('modal-select-conta').value;
  if (!contaId) {
    erroEl.textContent = 'Selecione uma conta para pagar.';
    return;
  }

  const itensAbertos = comprasCache.filter((c) => c.status === 'aberta');
  if (itensAbertos.length === 0) return;

  const total = itensAbertos.reduce((soma, c) => soma + Number(c.valor_parcela), 0);
  const cartao = cartaoAtual();

  const btn = document.getElementById('btn-confirmar-pagamento');
  btn.disabled = true;
  btn.textContent = 'Pagando...';

  try {
    const ids = itensAbertos.map((c) => c.id);
    const { error: erroFatura } = await supabase
      .from('card_transactions')
      .update({ status: 'paga' })
      .in('id', ids)
      .eq('user_id', usuarioAtual.id);
    if (erroFatura) throw erroFatura;

    const categoryId = await obterCategoriaFatura(usuarioAtual.id);
    const { error: erroTx } = await supabase.from('transactions').insert({
      user_id: usuarioAtual.id,
      account_id: contaId,
      category_id: categoryId,
      type: 'despesa',
      amount: Number(total.toFixed(2)),
      description: `Fatura ${cartao?.nome ?? ''} ${rotuloFatura(faturaRef)}`,
      date: hojeISO(),
      status: 'pago',
      notes: 'Pagamento de fatura de cartão de crédito',
    });
    if (erroTx) throw erroTx;

    const { error: erroSaldo } = await supabase.rpc('increment_account_balance', {
      p_account_id: contaId,
      p_delta: -total,
    });
    if (erroSaldo) throw erroSaldo;

    fecharModal('modal-pagar');
    await recarregar();
  } catch (err) {
    console.error(err);
    erroEl.textContent = 'Não foi possível concluir o pagamento. Tente novamente.';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Confirmar pagamento';
  }
}

async function iniciar() {
  aplicarTemaSalvo();
  const user = await requireAuth();
  if (!user) return;
  usuarioAtual = user;

  montarNavRail('cartao');
  configurarBotaoSair();
  document.getElementById('btn-topbar-busca').addEventListener('click', abrirComandos);

  configurarModal('modal-compra');
  configurarModal('modal-pagar');
  document.getElementById('btn-fechar-modal-compra').addEventListener('click', () => fecharModal('modal-compra'));
  document.getElementById('btn-fechar-modal-pagar').addEventListener('click', () => fecharModal('modal-pagar'));

  document.getElementById('btn-fatura-anterior').addEventListener('click', () => {
    if (!faturaRef) return;
    faturaRef = addMonthsRef(faturaRef, -1);
    renderFatura();
    recarregar();
  });
  document.getElementById('btn-fatura-proxima').addEventListener('click', () => {
    if (!faturaRef) return;
    faturaRef = addMonthsRef(faturaRef, 1);
    renderFatura();
    recarregar();
  });

  document.getElementById('btn-pagar-fatura').addEventListener('click', abrirModalPagar);
  document.getElementById('btn-confirmar-pagamento').addEventListener('click', confirmarPagamento);

  try {
    contasBancarias = await carregarContasBancarias(user.id);
  } catch (err) {
    console.error(err);
  }

  try {
    await carregarCartoes(user.id);
  } catch (err) {
    console.error(err);
    document.getElementById('lista-compras').innerHTML = '<div class="lista-vazia">Não foi possível carregar os cartões.</div>';
    return;
  }

  if (!cartaoSelecionado) {
    document.getElementById('lista-compras').innerHTML = '<div class="lista-vazia">Cadastre um cartão no FinZen para começar.</div>';
    return;
  }

  await recarregar();
}

iniciar();
