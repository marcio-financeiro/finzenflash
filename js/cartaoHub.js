import { supabase, requireAuth, configurarBotaoSair } from './supabaseClient.js';
import { invoiceRef, addMonthsRef } from './cardService.js';
import { configurarBotaoPrivacidade } from './privacidade.js?v=2';
import { ativarArrastarParaFechar } from './sheetGestos.js?v=2';

const fmt = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtMesAno = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' });

let cartoes = [];
let cartaoSelecionado = null;
let faturaRef = null;
let comprasCache = [];
let contasBancarias = [];
let usuarioAtual = null;

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
    <button type="button" class="chip-conta ${c.id === cartaoSelecionado ? 'selecionada' : ''}" data-id="${c.id}">
      ${escapeHtml(c.nome)}
    </button>
  `).join('');
  container.querySelectorAll('.chip-conta').forEach((btn) => {
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
    container.innerHTML = '<div class="conta-vazia">Nenhuma compra nesta fatura.</div>';
    return;
  }
  container.innerHTML = compras.map((c) => `
    <div class="compra-card" data-id="${c.id}">
      <div class="compra-info">
        <div class="compra-desc">${escapeHtml(c.descricao)}</div>
        <div class="compra-parcela">${c.parcelas > 1 ? `Parcela ${c.parcela_atual}/${c.parcelas}` : 'À vista'}</div>
      </div>
      <div class="compra-valor valor-sensivel">${fmt.format(Number(c.valor_parcela))}</div>
    </div>
  `).join('');

  container.querySelectorAll('.compra-card').forEach((el) => {
    const compra = compras.find((c) => c.id === el.dataset.id);
    if (compra) attachToqueSegurar(el, () => abrirSheetCompra(compra));
  });
}

function attachToqueSegurar(el, aoAcionar) {
  let timer = null;
  let moveu = false;
  const iniciar = () => {
    moveu = false;
    timer = setTimeout(() => {
      if (!moveu) {
        el.classList.remove('pressionando');
        aoAcionar();
      }
    }, 500);
    el.classList.add('pressionando');
  };
  const cancelar = () => {
    clearTimeout(timer);
    timer = null;
    el.classList.remove('pressionando');
  };
  const mover = () => { moveu = true; cancelar(); };
  el.addEventListener('touchstart', iniciar, { passive: true });
  el.addEventListener('touchend', cancelar);
  el.addEventListener('touchmove', mover, { passive: true });
  el.addEventListener('touchcancel', cancelar);
  el.addEventListener('mousedown', iniciar);
  el.addEventListener('mouseup', cancelar);
  el.addEventListener('mouseleave', cancelar);
}

async function abrirSheetCompra(compra) {
  const conteudo = document.getElementById('sheet-compra-conteudo');

  if (compra.status === 'paga') {
    conteudo.innerHTML = `
      <div class="sheet-titulo">${escapeHtml(compra.descricao)}</div>
      <div class="sheet-aviso">Essa parcela já foi paga — não é possível editar ou excluir.</div>
      <button type="button" class="sheet-acao-btn" id="btn-fechar-sheet-compra">Fechar</button>
    `;
    document.getElementById('btn-fechar-sheet-compra').addEventListener('click', fecharSheetCompra);
    document.getElementById('sheet-compra').hidden = false;
    return;
  }

  conteudo.innerHTML = `<div class="sheet-titulo">Verificando…</div>`;
  document.getElementById('sheet-compra').hidden = false;

  let bloqueado = false;
  try {
    bloqueado = await grupoTemParcelaPaga(compra.purchase_group_id);
  } catch (err) {
    console.error(err);
  }

  if (bloqueado) {
    conteudo.innerHTML = `
      <div class="sheet-titulo">${escapeHtml(compra.descricao)}</div>
      <div class="sheet-aviso">Essa compra já tem parcela paga em outra fatura — não é possível editar ou excluir.</div>
      <button type="button" class="sheet-acao-btn" id="btn-fechar-sheet-compra">Fechar</button>
    `;
    document.getElementById('btn-fechar-sheet-compra').addEventListener('click', fecharSheetCompra);
    return;
  }

  conteudo.innerHTML = `
    <div class="sheet-titulo">${escapeHtml(compra.descricao)}</div>
    <button type="button" class="sheet-acao-btn" id="btn-editar-compra">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>
      Editar
    </button>
    <button type="button" class="sheet-acao-btn perigo" id="btn-excluir-compra">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
      Excluir
    </button>
    <button type="button" class="sheet-acao-btn" id="btn-cancelar-sheet-compra">Cancelar</button>
  `;

  document.getElementById('btn-editar-compra').addEventListener('click', () => {
    window.location.href = `/pages/comprar-cartao.html?grupo=${compra.purchase_group_id}`;
  });
  document.getElementById('btn-excluir-compra').addEventListener('click', () => confirmarExclusaoCompra(compra));
  document.getElementById('btn-cancelar-sheet-compra').addEventListener('click', fecharSheetCompra);
}

function confirmarExclusaoCompra(compra) {
  const conteudo = document.getElementById('sheet-compra-conteudo');
  conteudo.innerHTML = `
    <div class="sheet-titulo">Excluir "${escapeHtml(compra.descricao)}"?</div>
    <div class="sheet-aviso">Remove todas as parcelas dessa compra. Essa ação não pode ser desfeita.</div>
    <button type="button" class="sheet-acao-btn perigo" id="btn-confirmar-exclusao-compra">Excluir compra</button>
    <button type="button" class="sheet-acao-btn" id="btn-cancelar-sheet-compra">Cancelar</button>
  `;
  document.getElementById('btn-confirmar-exclusao-compra').addEventListener('click', () => excluirCompra(compra));
  document.getElementById('btn-cancelar-sheet-compra').addEventListener('click', fecharSheetCompra);
}

function fecharSheetCompra() {
  document.getElementById('sheet-compra').hidden = true;
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

  fecharSheetCompra();
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

async function recarregar() {
  try {
    const [compras, limiteUsado] = await Promise.all([carregarCompras(), carregarLimiteUsado()]);
    comprasCache = compras;
    const totalFatura = compras.reduce((soma, c) => soma + Number(c.valor_parcela), 0);
    renderCompras(compras);
    renderResumo(totalFatura, limiteUsado);
    renderBotaoPagar();
  } catch (err) {
    console.error(err);
    document.getElementById('lista-compras').innerHTML = '<div class="conta-vazia">Não foi possível carregar a fatura.</div>';
  }
}

function abrirSheetPagar() {
  const totalAberto = comprasCache.filter((c) => c.status === 'aberta').reduce((soma, c) => soma + Number(c.valor_parcela), 0);
  document.getElementById('sheet-valor-pagar').textContent = fmt.format(totalAberto);
  document.getElementById('erro-pagar').textContent = '';

  const select = document.getElementById('sheet-select-conta');
  select.innerHTML = '<option value="">Selecione a conta</option>' + contasBancarias.map((c) => `<option value="${c.id}">${escapeHtml(c.nome)}</option>`).join('');

  document.getElementById('sheet-pagar').hidden = false;
}

async function confirmarPagamento() {
  const erroEl = document.getElementById('erro-pagar');
  erroEl.textContent = '';

  const contaId = document.getElementById('sheet-select-conta').value;
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

    document.getElementById('sheet-pagar').hidden = true;
    await recarregar();
  } catch (err) {
    console.error(err);
    erroEl.textContent = 'Não foi possível concluir o pagamento. Tente novamente.';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Confirmar pagamento';
  }
}

async function init() {
  configurarBotaoSair();
  configurarBotaoPrivacidade('btn-privacidade');

  const user = await requireAuth();
  if (!user) return;

  usuarioAtual = user;

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

  document.getElementById('btn-pagar-fatura').addEventListener('click', abrirSheetPagar);
  document.getElementById('btn-confirmar-pagamento').addEventListener('click', confirmarPagamento);
  const sheetPagar = document.getElementById('sheet-pagar');
  sheetPagar.addEventListener('click', (e) => { if (e.target === sheetPagar) sheetPagar.hidden = true; });
  ativarArrastarParaFechar(sheetPagar);

  const sheetCompra = document.getElementById('sheet-compra');
  sheetCompra.addEventListener('click', (e) => { if (e.target === sheetCompra) fecharSheetCompra(); });
  ativarArrastarParaFechar(sheetCompra);

  try {
    contasBancarias = await carregarContasBancarias(user.id);
  } catch (err) {
    console.error(err);
  }

  try {
    await carregarCartoes(user.id);
  } catch (err) {
    console.error(err);
    document.getElementById('lista-compras').innerHTML = '<div class="conta-vazia">Não foi possível carregar os cartões.</div>';
    return;
  }

  if (!cartaoSelecionado) {
    document.getElementById('lista-compras').innerHTML = '<div class="conta-vazia">Cadastre um cartão no FinZen para começar.</div>';
    return;
  }

  await recarregar();
}

init();
