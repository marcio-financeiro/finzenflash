import { supabase, requireAuth } from './supabaseClient.js';

let tipo = 'despesa';
let contaSelecionada = null;
let categoriaSelecionada = null;
let contas = [];
let categorias = [];
let lancamentoOriginal = null;

function formatarValorDigitado(valorCentavos) {
  const reais = valorCentavos / 100;
  return reais.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
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

function selecionarTipo(novoTipo) {
  tipo = novoTipo;
  document.getElementById('btn-despesa').classList.toggle('ativo-despesa', tipo === 'despesa');
  document.getElementById('btn-receita').classList.toggle('ativo-receita', tipo === 'receita');
  document.getElementById('valor').classList.toggle('cor-despesa', tipo === 'despesa');
  document.getElementById('valor').classList.toggle('cor-receita', tipo === 'receita');
  document.getElementById('sheet-valor-display').classList.toggle('cor-despesa', tipo === 'despesa');
  document.getElementById('sheet-valor-display').classList.toggle('cor-receita', tipo === 'receita');
  renderCategorias();
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}

function renderContas() {
  const container = document.getElementById('lista-contas-chip');
  container.innerHTML = contas.map((c) => `
    <button type="button" class="chip-conta ${c.id === contaSelecionada ? 'selecionada' : ''}" data-id="${c.id}">
      ${escapeHtml(c.nome)}
    </button>
  `).join('');
  container.querySelectorAll('.chip-conta').forEach((btn) => {
    btn.addEventListener('click', () => {
      contaSelecionada = btn.dataset.id;
      renderContas();
    });
  });
}

function renderCategorias() {
  const container = document.getElementById('lista-categorias-chip');
  const filtradas = categorias.filter((c) => c.tipo === tipo);
  if (!filtradas.some((c) => c.id === categoriaSelecionada)) {
    categoriaSelecionada = filtradas[0]?.id ?? null;
  }
  container.innerHTML = filtradas.map((c) => `
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

async function carregarContasECategorias(userId) {
  const [{ data: dadosContas, error: erroContas }, { data: dadosCategorias, error: erroCategorias }] = await Promise.all([
    supabase.from('accounts').select('id, nome').eq('user_id', userId).eq('active', true).eq('account_kind', 'bank').order('sort_order'),
    supabase.from('categories').select('id, nome, tipo').eq('user_id', userId).eq('ativo', true).in('tipo', ['despesa', 'receita']).order('sort_order'),
  ]);

  if (erroContas) throw erroContas;
  if (erroCategorias) throw erroCategorias;

  contas = dadosContas ?? [];
  categorias = dadosCategorias ?? [];
  contaSelecionada = lancamentoOriginal?.account_id ?? (contas[0]?.id ?? null);

  renderContas();
  renderCategorias();
}

async function salvar(user) {
  const valor = valorEmReais();
  const descricao = document.getElementById('descricao').value.trim();
  const erroEl = document.getElementById('erro-lancar');
  erroEl.textContent = '';

  if (valor <= 0) {
    erroEl.textContent = 'Informe um valor maior que zero.';
    return;
  }
  if (!descricao) {
    erroEl.textContent = 'Informe uma descrição.';
    return;
  }
  if (!contaSelecionada) {
    erroEl.textContent = 'Cadastre uma conta no FinZen antes de lançar.';
    return;
  }

  const btn = document.getElementById('btn-salvar');
  const textoBotaoPadrao = lancamentoOriginal ? 'Salvar alterações' : 'Salvar lançamento';
  btn.disabled = true;
  btn.textContent = 'Salvando...';

  if (lancamentoOriginal) {
    const { error: erroUpdate } = await supabase.from('transactions').update({
      account_id: contaSelecionada,
      category_id: categoriaSelecionada,
      type: tipo,
      amount: valor,
      description: descricao,
    }).eq('id', lancamentoOriginal.id).eq('user_id', user.id);

    if (erroUpdate) {
      erroEl.textContent = 'Não foi possível salvar. Tente novamente.';
      btn.disabled = false;
      btn.textContent = textoBotaoPadrao;
      return;
    }

    // Desfaz o efeito do lançamento original na conta antiga e aplica o
    // novo valor/tipo na conta escolhida — cobre também troca de conta.
    const deltaReverso = lancamentoOriginal.type === 'receita' ? -Number(lancamentoOriginal.amount) : Number(lancamentoOriginal.amount);
    await supabase.rpc('increment_account_balance', { p_account_id: lancamentoOriginal.account_id, p_delta: deltaReverso });

    const deltaNovo = tipo === 'receita' ? valor : -valor;
    const { error: erroSaldo } = await supabase.rpc('increment_account_balance', { p_account_id: contaSelecionada, p_delta: deltaNovo });

    if (erroSaldo) {
      erroEl.textContent = 'Lançamento salvo, mas o saldo não pôde ser atualizado.';
      btn.disabled = false;
      btn.textContent = textoBotaoPadrao;
      return;
    }

    window.location.href = '/pages/home.html';
    return;
  }

  const hoje = new Date();
  const dataISO = new Date(hoje.getTime() - hoje.getTimezoneOffset() * 60000).toISOString().slice(0, 10);

  const { error: erroInsercao } = await supabase.from('transactions').insert({
    user_id: user.id,
    account_id: contaSelecionada,
    category_id: categoriaSelecionada,
    type: tipo,
    amount: valor,
    description: descricao,
    date: dataISO,
  });

  if (erroInsercao) {
    erroEl.textContent = 'Não foi possível salvar. Tente novamente.';
    btn.disabled = false;
    btn.textContent = textoBotaoPadrao;
    return;
  }

  const delta = tipo === 'receita' ? valor : -valor;
  const { error: erroSaldo } = await supabase.rpc('increment_account_balance', {
    p_account_id: contaSelecionada,
    p_delta: delta,
  });

  if (erroSaldo) {
    erroEl.textContent = 'Lançamento salvo, mas o saldo não pôde ser atualizado.';
    btn.disabled = false;
    btn.textContent = textoBotaoPadrao;
    return;
  }

  window.location.href = '/pages/home.html';
}

async function init() {
  const user = await requireAuth();
  if (!user) return;

  configurarTecladoValor();
  document.getElementById('btn-despesa').addEventListener('click', () => selecionarTipo('despesa'));
  document.getElementById('btn-receita').addEventListener('click', () => selecionarTipo('receita'));
  document.getElementById('btn-salvar').addEventListener('click', () => salvar(user));

  const idUrl = new URLSearchParams(window.location.search).get('id');
  if (idUrl) {
    const { data, error } = await supabase
      .from('transactions')
      .select('id, account_id, category_id, type, amount, description')
      .eq('id', idUrl)
      .eq('user_id', user.id)
      .single();

    if (!error && data) {
      lancamentoOriginal = data;
      document.getElementById('topo-titulo').textContent = 'Editar lançamento';
      document.getElementById('btn-salvar').textContent = 'Salvar alterações';
      document.getElementById('descricao').value = data.description ?? '';
      categoriaSelecionada = data.category_id;
      atualizarDisplaysValor(String(Math.round(Number(data.amount) * 100)));
    }
  }

  selecionarTipo(lancamentoOriginal?.type ?? 'despesa');

  try {
    await carregarContasECategorias(user.id);
  } catch (err) {
    console.error(err);
    document.getElementById('erro-lancar').textContent = 'Não foi possível carregar contas/categorias.';
  }
}

init();
