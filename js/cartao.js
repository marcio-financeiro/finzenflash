import { supabase, requireAuth } from './supabaseClient.js';
import { invoiceRef, addMonthsRef, novoGrupoCompra } from './cardService.js';

let cartaoSelecionado = null;
let categoriaSelecionada = null;
let cartoes = [];
let categorias = [];
let parcelas = 1;

function formatarValorDigitado(valorCentavos) {
  return (valorCentavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function valorEmReais() {
  const digitos = document.getElementById('valor').dataset.centavos || '0';
  return Number(digitos) / 100;
}

function atualizarDisplaysValor(centavos) {
  const texto = formatarValorDigitado(Number(centavos));
  document.getElementById('valor').dataset.centavos = centavos;
  document.getElementById('valor').textContent = texto;
  document.getElementById('sheet-valor-display').textContent = texto;
  atualizarValorParcela();
}

function configurarTecladoValor() {
  atualizarDisplaysValor('0');

  document.querySelectorAll('.tecla').forEach((tecla) => {
    tecla.addEventListener('click', () => {
      const acao = tecla.dataset.acao;
      let centavos = document.getElementById('valor').dataset.centavos || '0';
      if (acao === 'apagar') {
        centavos = centavos.slice(0, -1) || '0';
      } else {
        centavos = (centavos === '0' ? '' : centavos) + acao;
        centavos = centavos.slice(0, 12);
      }
      atualizarDisplaysValor(centavos);
    });
  });

  const sheet = document.getElementById('sheet-valor');
  document.getElementById('btn-abrir-valor').addEventListener('click', () => {
    sheet.hidden = false;
  });
  document.getElementById('btn-concluir-valor').addEventListener('click', () => {
    sheet.hidden = true;
  });
  sheet.addEventListener('click', (e) => {
    if (e.target === sheet) sheet.hidden = true;
  });
}

function atualizarValorParcela() {
  const total = valorEmReais();
  const porParcela = parcelas > 0 ? total / parcelas : 0;
  document.getElementById('valor-parcela').textContent = porParcela.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function configurarParcelas() {
  document.getElementById('parcelas-num').textContent = `${parcelas}x`;
  document.getElementById('btn-menos-parcela').addEventListener('click', () => {
    if (parcelas > 1) parcelas -= 1;
    document.getElementById('parcelas-num').textContent = `${parcelas}x`;
    atualizarValorParcela();
  });
  document.getElementById('btn-mais-parcela').addEventListener('click', () => {
    if (parcelas < 24) parcelas += 1;
    document.getElementById('parcelas-num').textContent = `${parcelas}x`;
    atualizarValorParcela();
  });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
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
      cartaoSelecionado = btn.dataset.id;
      renderCartoes();
    });
  });
}

function renderCategorias() {
  const container = document.getElementById('lista-categorias-chip');
  if (!categorias.some((c) => c.id === categoriaSelecionada)) {
    categoriaSelecionada = categorias[0]?.id ?? null;
  }
  container.innerHTML = categorias.map((c) => `
    <button type="button" class="chip-categoria ${c.id === categoriaSelecionada ? 'selecionada' : ''}" data-id="${c.id}">
      ${escapeHtml(c.nome)}
    </button>
  `).join('');
  container.querySelectorAll('.chip-categoria').forEach((btn) => {
    btn.addEventListener('click', () => {
      categoriaSelecionada = btn.dataset.id;
      renderCategorias();
    });
  });
}

async function carregarCartoesECategorias(userId) {
  const [{ data: dadosCartoes, error: erroCartoes }, { data: dadosCategorias, error: erroCategorias }] = await Promise.all([
    supabase.from('credit_cards').select('id, nome, fechamento_dia, vencimento_dia').eq('user_id', userId).eq('ativo', true).order('sort_order'),
    supabase.from('categories').select('id, nome').eq('user_id', userId).eq('ativo', true).eq('tipo', 'despesa').order('sort_order'),
  ]);

  if (erroCartoes) throw erroCartoes;
  if (erroCategorias) throw erroCategorias;

  cartoes = dadosCartoes ?? [];
  categorias = dadosCategorias ?? [];
  cartaoSelecionado = cartoes[0]?.id ?? null;

  renderCartoes();
  renderCategorias();
}

function hojeISO() {
  const hoje = new Date();
  return new Date(hoje.getTime() - hoje.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

async function salvar(user) {
  const valorTotal = valorEmReais();
  const descricao = document.getElementById('descricao').value.trim();
  const erroEl = document.getElementById('erro-cartao');
  erroEl.textContent = '';

  if (valorTotal <= 0) {
    erroEl.textContent = 'Informe um valor maior que zero.';
    return;
  }
  if (!descricao) {
    erroEl.textContent = 'Informe uma descrição.';
    return;
  }
  const cartao = cartoes.find((c) => c.id === cartaoSelecionado);
  if (!cartao) {
    erroEl.textContent = 'Cadastre um cartão no FinZen antes de lançar.';
    return;
  }

  const btn = document.getElementById('btn-salvar');
  btn.disabled = true;
  btn.textContent = 'Salvando...';

  const dataCompra = hojeISO();
  const referenciaBase = invoiceRef(dataCompra, cartao.fechamento_dia, cartao.vencimento_dia);
  const grupo = novoGrupoCompra();
  const valorParcela = Math.round((valorTotal / parcelas) * 100) / 100;

  const registros = Array.from({ length: parcelas }, (_, i) => ({
    user_id: user.id,
    card_id: cartaoSelecionado,
    category_id: categoriaSelecionada,
    descricao,
    valor_total: valorTotal,
    parcelas,
    parcela_atual: i + 1,
    valor_parcela: valorParcela,
    data_compra: dataCompra,
    fatura_referencia: addMonthsRef(referenciaBase, i),
    purchase_group_id: grupo,
  }));

  let { error } = await supabase.from('card_transactions').insert(registros);
  if (error && (error.code === 'PGRST204' || /purchase_group_id/i.test(error.message || ''))) {
    const semGrupo = registros.map(({ purchase_group_id, ...resto }) => resto);
    ({ error } = await supabase.from('card_transactions').insert(semGrupo));
  }

  if (error) {
    erroEl.textContent = 'Não foi possível salvar. Tente novamente.';
    btn.disabled = false;
    btn.textContent = 'Salvar compra';
    return;
  }

  window.location.href = '/pages/home.html';
}

async function init() {
  const user = await requireAuth();
  if (!user) return;

  configurarTecladoValor();
  configurarParcelas();
  document.getElementById('btn-salvar').addEventListener('click', () => salvar(user));

  try {
    await carregarCartoesECategorias(user.id);
  } catch (err) {
    console.error(err);
    document.getElementById('erro-cartao').textContent = 'Não foi possível carregar cartões/categorias.';
  }
}

init();
