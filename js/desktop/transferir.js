import { supabase, requireAuth } from '../supabaseClient.js';
import { aplicarTemaSalvo } from '../temaService.js';
import { montarNavRail } from './navRail.js';
import { abrirComandos } from './comandos.js';
import { configurarModal, abrirModal, fecharModal } from './modal.js';

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

function atualizarDisplayValor(centavos) {
  document.getElementById('valor').dataset.centavos = centavos;
  document.getElementById('valor').textContent = formatarValorDigitado(Number(centavos));
}

function configurarInputValor() {
  atualizarDisplayValor('0');
  document.getElementById('valor').addEventListener('keydown', (e) => {
    if (e.key >= '0' && e.key <= '9') {
      let centavos = document.getElementById('valor').dataset.centavos || '0';
      centavos = (centavos === '0' ? '' : centavos) + e.key;
      atualizarDisplayValor(centavos.slice(0, 12));
    } else if (e.key === 'Backspace') {
      let centavos = document.getElementById('valor').dataset.centavos || '0';
      atualizarDisplayValor(centavos.slice(0, -1) || '0');
    }
    e.preventDefault();
  });
  document.getElementById('valor').setAttribute('tabindex', '0');
}

function renderContasOrigem() {
  const container = document.getElementById('lista-contas-origem');
  container.innerHTML = contas.map((c) => `
    <button type="button" class="chip-desktop ${c.id === contaOrigem ? 'selecionada' : ''}" data-id="${c.id}">
      ${escapeHtml(c.nome)}
    </button>
  `).join('');
  container.querySelectorAll('.chip-desktop').forEach((btn) => {
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
      <button type="button" class="chip-desktop ${c.id === contaDestino ? 'selecionada' : ''}" data-id="${c.id}" ${desabilitada ? 'disabled' : ''}>
        ${escapeHtml(c.nome)}
      </button>
    `;
  }).join('');
  container.querySelectorAll('.chip-desktop:not(:disabled)').forEach((btn) => {
    btn.addEventListener('click', () => {
      contaDestino = btn.dataset.id;
      renderContasDestino();
    });
  });
}

async function carregarContaPrincipal(userId) {
  const { data } = await supabase
    .from('user_settings')
    .select('setting_value')
    .eq('user_id', userId)
    .eq('setting_key', 'flash_conta_principal')
    .maybeSingle();
  return data?.setting_value || null;
}

async function carregarContas(userId) {
  const [{ data, error }, contaPrincipalId] = await Promise.all([
    supabase.from('accounts').select('id, nome, currency').eq('user_id', userId).eq('active', true).eq('account_kind', 'bank').order('sort_order'),
    carregarContaPrincipal(userId),
  ]);
  if (error) throw error;
  contas = data ?? [];
  const principalValida = contaPrincipalId && contas.some((c) => c.id === contaPrincipalId);
  contaOrigem = principalValida ? contaPrincipalId : (contas[0]?.id ?? null);
  contaDestino = contas.find((c) => c.id !== contaOrigem)?.id ?? null;
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

async function abrirHistorico() {
  const container = document.getElementById('lista-historico');
  container.innerHTML = '<div class="lista-vazia">Carregando...</div>';
  abrirModal('modal-historico');

  try {
    const itens = await carregarHistorico(usuarioAtual.id);
    if (itens.length === 0) {
      container.innerHTML = '<div class="lista-vazia">Nenhuma transferência ainda.</div>';
      return;
    }
    container.innerHTML = itens.map((t) => `
      <button type="button" class="historico-item" data-id="${t.id}">
        <div class="historico-icone">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="M7 21l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>
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
      if (item) el.addEventListener('click', () => abrirAcaoHistorico(item));
    });
  } catch (err) {
    console.error(err);
    container.innerHTML = '<div class="lista-vazia">Não foi possível carregar o histórico.</div>';
  }
}

function abrirAcaoHistorico(transferencia) {
  const conteudo = document.getElementById('modal-acao-historico-conteudo');
  conteudo.innerHTML = `
    <div class="modal-titulo">Excluir transferência de ${fmt.format(transferencia.amount)}?</div>
    <p style="color:var(--muted);font-size:13px">Reverte o valor nas duas contas. Essa ação não pode ser desfeita.</p>
    <button type="button" class="btn-desktop perigo" id="btn-confirmar-excluir-transferencia" style="margin-top:10px">Excluir transferência</button>
  `;
  document.getElementById('btn-confirmar-excluir-transferencia').addEventListener('click', () => excluirTransferencia(transferencia));
  abrirModal('modal-acao-historico');
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

  fecharModal('modal-acao-historico');
  fecharModal('modal-historico');
}

async function salvar() {
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

  window.location.href = '/pages/desktop/home.html';
}

async function iniciar() {
  aplicarTemaSalvo();
  const user = await requireAuth();
  if (!user) return;
  usuarioAtual = user;

  montarNavRail('transferir');
  document.getElementById('btn-topbar-busca').addEventListener('click', abrirComandos);

  configurarInputValor();
  document.getElementById('btn-salvar').addEventListener('click', salvar);

  configurarModal('modal-historico');
  document.getElementById('btn-fechar-modal-historico').addEventListener('click', () => fecharModal('modal-historico'));
  document.getElementById('btn-historico').addEventListener('click', abrirHistorico);

  configurarModal('modal-acao-historico');
  document.getElementById('btn-fechar-modal-acao-historico').addEventListener('click', () => fecharModal('modal-acao-historico'));

  try {
    await carregarContas(user.id);
  } catch (err) {
    console.error(err);
    document.getElementById('erro-transferir').textContent = 'Não foi possível carregar as contas.';
  }
}

iniciar();
