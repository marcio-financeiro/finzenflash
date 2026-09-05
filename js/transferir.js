import { supabase, requireAuth } from './supabaseClient.js';

let contas = [];
let contaOrigem = null;
let contaDestino = null;

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}

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

function renderContasOrigem() {
  const container = document.getElementById('lista-contas-origem');
  container.innerHTML = contas.map((c) => `
    <button type="button" class="chip-conta ${c.id === contaOrigem ? 'selecionada' : ''}" data-id="${c.id}">
      ${escapeHtml(c.nome)}
    </button>
  `).join('');
  container.querySelectorAll('.chip-conta').forEach((btn) => {
    btn.addEventListener('click', () => {
      contaOrigem = btn.dataset.id;
      if (contaDestino === contaOrigem) contaDestino = null;
      renderContasOrigem();
      renderContasDestino();
    });
  });
}

function renderContasDestino() {
  const container = document.getElementById('lista-contas-destino');
  const origem = contas.find((c) => c.id === contaOrigem);
  container.innerHTML = contas.map((c) => {
    const mesmaConta = c.id === contaOrigem;
    const moedaDiferente = origem && c.currency !== origem.currency;
    const desabilitada = mesmaConta || moedaDiferente;
    return `
      <button type="button" class="chip-conta ${c.id === contaDestino ? 'selecionada' : ''}" data-id="${c.id}" ${desabilitada ? 'disabled' : ''}>
        ${escapeHtml(c.nome)}
      </button>
    `;
  }).join('');
  container.querySelectorAll('.chip-conta:not(:disabled)').forEach((btn) => {
    btn.addEventListener('click', () => {
      contaDestino = btn.dataset.id;
      renderContasDestino();
    });
  });
}

async function carregarContas(userId) {
  const { data, error } = await supabase
    .from('accounts')
    .select('id, nome, currency')
    .eq('user_id', userId)
    .eq('active', true)
    .eq('account_kind', 'bank')
    .order('sort_order');
  if (error) throw error;
  contas = data ?? [];
  contaOrigem = contas[0]?.id ?? null;
  contaDestino = contas[1]?.id ?? null;
  renderContasOrigem();
  renderContasDestino();
}

async function salvar(user) {
  const valor = valorEmReais();
  const erroEl = document.getElementById('erro-transferir');
  erroEl.textContent = '';

  if (!contaOrigem || !contaDestino) {
    erroEl.textContent = 'Selecione a conta de origem e destino.';
    return;
  }
  if (contaOrigem === contaDestino) {
    erroEl.textContent = 'As contas de origem e destino não podem ser iguais.';
    return;
  }
  if (valor <= 0) {
    erroEl.textContent = 'Informe um valor maior que zero.';
    return;
  }

  const btn = document.getElementById('btn-salvar');
  btn.disabled = true;
  btn.textContent = 'Transferindo...';

  const hoje = new Date();
  const dataISO = new Date(hoje.getTime() - hoje.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const descricao = document.getElementById('descricao').value.trim();

  const { error } = await supabase.rpc('create_account_transfer', {
    p_from_account_id: contaOrigem,
    p_to_account_id: contaDestino,
    p_amount: valor,
    p_date: dataISO,
    p_description: descricao || null,
  });

  if (error) {
    erroEl.textContent = error.message || 'Não foi possível transferir. Tente novamente.';
    btn.disabled = false;
    btn.textContent = 'Transferir';
    return;
  }

  window.location.href = '/pages/home.html';
}

async function init() {
  const user = await requireAuth();
  if (!user) return;

  configurarTecladoValor();
  document.getElementById('btn-salvar').addEventListener('click', () => salvar(user));

  try {
    await carregarContas(user.id);
  } catch (err) {
    console.error(err);
    document.getElementById('erro-transferir').textContent = 'Não foi possível carregar as contas.';
  }
}

init();
