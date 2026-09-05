import { supabase, requireAuth } from './supabaseClient.js';
import { ativarArrastarParaFechar } from './sheetGestos.js?v=2';

const fmt = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtData = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });

let contas = [];
let contaOrigem = null;
let contaDestino = null;
let usuarioAtual = null;

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

async function carregarHistorico(userId) {
  const { data, error } = await supabase
    .from('account_transfers')
    .select('id, amount, date, description, from_account:from_account_id(nome), to_account:to_account_id(nome)')
    .eq('user_id', userId)
    .order('date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) throw error;
  return data ?? [];
}

async function abrirSheetHistorico() {
  const container = document.getElementById('lista-historico');
  container.innerHTML = '<div class="conta-vazia">Carregando...</div>';
  document.getElementById('sheet-historico').hidden = false;

  try {
    const itens = await carregarHistorico(usuarioAtual.id);
    if (itens.length === 0) {
      container.innerHTML = '<div class="conta-vazia">Nenhuma transferência ainda.</div>';
      return;
    }
    container.innerHTML = itens.map((t) => `
      <button type="button" class="historico-item" data-id="${t.id}">
        <div class="historico-icone">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="M7 21l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>
        </div>
        <div class="historico-info">
          <div class="historico-desc">${escapeHtml(t.description) || 'Transferência'}</div>
          <div class="historico-contas">${escapeHtml(t.from_account?.nome ?? '')} → ${escapeHtml(t.to_account?.nome ?? '')} · ${fmtData.format(new Date(t.date + 'T00:00:00'))}</div>
        </div>
        <div class="historico-valor valor-sensivel">${fmt.format(t.amount)}</div>
      </button>
    `).join('');
    container.querySelectorAll('.historico-item').forEach((el) => {
      const item = itens.find((t) => t.id === el.dataset.id);
      if (item) el.addEventListener('click', () => abrirSheetAcaoHistorico(item));
    });
  } catch (err) {
    console.error(err);
    container.innerHTML = '<div class="conta-vazia">Não foi possível carregar o histórico.</div>';
  }
}

function abrirSheetAcaoHistorico(transferencia) {
  const conteudo = document.getElementById('sheet-acao-historico-conteudo');
  conteudo.innerHTML = `
    <div class="sheet-titulo">Excluir transferência de ${fmt.format(transferencia.amount)}?</div>
    <div class="sheet-aviso">Reverte o valor nas duas contas. Essa ação não pode ser desfeita.</div>
    <button type="button" class="sheet-acao-btn perigo" id="btn-confirmar-excluir-transferencia">Excluir transferência</button>
    <button type="button" class="sheet-acao-btn" id="btn-cancelar-acao-historico">Cancelar</button>
  `;
  document.getElementById('btn-confirmar-excluir-transferencia').addEventListener('click', () => excluirTransferencia(transferencia));
  document.getElementById('btn-cancelar-acao-historico').addEventListener('click', fecharSheetAcaoHistorico);
  document.getElementById('sheet-acao-historico').hidden = false;
}

function fecharSheetAcaoHistorico() {
  document.getElementById('sheet-acao-historico').hidden = true;
}

async function excluirTransferencia(transferencia) {
  const btn = document.getElementById('btn-confirmar-excluir-transferencia');
  btn.disabled = true;
  btn.textContent = 'Excluindo...';

  const { error } = await supabase.rpc('delete_account_transfer', { p_transfer_id: transferencia.id });

  if (error) {
    btn.disabled = false;
    btn.textContent = 'Excluir transferência';
    return;
  }

  fecharSheetAcaoHistorico();
  document.getElementById('sheet-historico').hidden = true;
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
  usuarioAtual = user;

  configurarTecladoValor();
  document.getElementById('btn-salvar').addEventListener('click', () => salvar(user));

  document.getElementById('btn-historico').addEventListener('click', abrirSheetHistorico);
  const sheetHistorico = document.getElementById('sheet-historico');
  sheetHistorico.addEventListener('click', (e) => { if (e.target === sheetHistorico) sheetHistorico.hidden = true; });
  ativarArrastarParaFechar(sheetHistorico);

  const sheetAcaoHistorico = document.getElementById('sheet-acao-historico');
  sheetAcaoHistorico.addEventListener('click', (e) => { if (e.target === sheetAcaoHistorico) fecharSheetAcaoHistorico(); });
  ativarArrastarParaFechar(sheetAcaoHistorico);

  try {
    await carregarContas(user.id);
  } catch (err) {
    console.error(err);
    document.getElementById('erro-transferir').textContent = 'Não foi possível carregar as contas.';
  }
}

init();
