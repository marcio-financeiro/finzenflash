import { supabase, requireAuth, configurarBotaoSair } from './supabaseClient.js';
import { aplicarTemaSalvo } from './temaService.js?v=3';
import { configurarBotaoPrivacidade } from './privacidade.js?v=2';
import { montarNavInferior } from './navInferior.js?v=6';
import { ativarArrastarParaFechar } from './sheetGestos.js?v=2';

const fmt = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtDia = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'long' });
const fmtMesAno = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' });

let mesRef = new Date();
mesRef.setDate(1);
let contaFiltro = '';
let categoriaFiltro = '';
let contas = [];
let categorias = [];
let usuarioAtual = null;

function iconReceita() {
  return '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="var(--success)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg>';
}
function iconDespesa() {
  return '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="var(--danger)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8"/><path d="M9 12h6"/></svg>';
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}

function rotuloDia(dataISO) {
  const data = new Date(dataISO + 'T00:00:00');
  return fmtDia.format(data).toUpperCase();
}

function limitesMes(ref) {
  const ano = ref.getFullYear();
  const mes = ref.getMonth();
  const inicio = new Date(ano, mes, 1);
  const fim = new Date(ano, mes + 1, 0);
  const toISO = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return { inicio: toISO(inicio), fim: toISO(fim) };
}

async function carregarFiltros(userId) {
  const [{ data: dadosContas }, { data: dadosCategorias }] = await Promise.all([
    supabase.from('accounts').select('id, nome').eq('user_id', userId).eq('active', true).eq('account_kind', 'bank').order('sort_order'),
    supabase.from('categories').select('id, nome').eq('user_id', userId).eq('ativo', true).in('tipo', ['despesa', 'receita']).order('sort_order'),
  ]);
  contas = dadosContas ?? [];
  categorias = dadosCategorias ?? [];

  const selectConta = document.getElementById('filtro-conta');
  selectConta.innerHTML = '<option value="">Todas contas</option>' + contas.map((c) => `<option value="${c.id}">${escapeHtml(c.nome)}</option>`).join('');
  if (contaFiltro) selectConta.value = contaFiltro;

  const selectCategoria = document.getElementById('filtro-categoria');
  selectCategoria.innerHTML = '<option value="">Todas categorias</option>' + categorias.map((c) => `<option value="${c.id}">${escapeHtml(c.nome)}</option>`).join('');
  if (categoriaFiltro) selectCategoria.value = categoriaFiltro;
}

async function carregarLancamentos(userId) {
  const { inicio, fim } = limitesMes(mesRef);
  let query = supabase
    .from('transactions')
    .select('id, type, amount, description, date, status, account_id, is_recurring, recurrence_group_id, accounts(nome)')
    .eq('user_id', userId)
    .gte('date', inicio)
    .lte('date', fim)
    .order('date', { ascending: false })
    .order('created_at', { ascending: false });

  if (contaFiltro) query = query.eq('account_id', contaFiltro);
  if (categoriaFiltro) query = query.eq('category_id', categoriaFiltro);

  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

function renderResumo(lancamentos) {
  let entradas = 0;
  let saidas = 0;
  for (const l of lancamentos) {
    if (l.type === 'receita') entradas += Number(l.amount);
    else saidas += Number(l.amount);
  }
  document.getElementById('total-entradas').textContent = fmt.format(entradas);
  document.getElementById('total-saidas').textContent = fmt.format(saidas);
}

function renderLista(lancamentos) {
  const container = document.getElementById('lista-lancamentos');
  if (lancamentos.length === 0) {
    container.innerHTML = '<div class="conta-vazia">Nenhum lançamento neste mês.</div>';
    return;
  }
  let html = '';
  let diaAtual = null;
  for (const l of lancamentos) {
    if (l.date !== diaAtual) {
      diaAtual = l.date;
      html += `<div class="dia-label">${rotuloDia(l.date)}</div>`;
    }
    const receita = l.type === 'receita';
    const sinal = receita ? '+' : '-';
    html += `
      <button type="button" class="lancamento-card" data-id="${l.id}">
        <div class="lancamento-icone ${receita ? 'is-receita' : 'is-despesa'}">${receita ? iconReceita() : iconDespesa()}</div>
        <div class="lancamento-info">
          <div class="lancamento-desc">${escapeHtml(l.description)}</div>
          <div class="lancamento-conta">${escapeHtml(l.accounts?.nome ?? '')}</div>
        </div>
        <div class="lancamento-valor valor-sensivel ${receita ? 'is-receita' : 'is-despesa'}">${sinal}${fmt.format(Math.abs(l.amount))}</div>
      </button>
    `;
  }
  container.innerHTML = html;
  container.querySelectorAll('.lancamento-card').forEach((el) => {
    const lancamento = lancamentos.find((l) => l.id === el.dataset.id);
    if (lancamento) attachToqueSegurar(el, () => abrirSheetLancamento(lancamento));
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

function abrirSheetLancamento(lancamento) {
  const conteudo = document.getElementById('sheet-lancamento-conteudo');
  conteudo.innerHTML = `
    <div class="sheet-titulo">${escapeHtml(lancamento.description)}</div>
    <button type="button" class="sheet-acao-btn" id="btn-editar-lancamento">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>
      Editar
    </button>
    <button type="button" class="sheet-acao-btn perigo" id="btn-excluir-lancamento">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
      Excluir
    </button>
    <button type="button" class="sheet-acao-btn" id="btn-cancelar-sheet-lancamento">Cancelar</button>
  `;

  document.getElementById('btn-editar-lancamento').addEventListener('click', () => {
    window.location.href = `/pages/lancar.html?id=${lancamento.id}`;
  });
  document.getElementById('btn-excluir-lancamento').addEventListener('click', () => confirmarExclusao(lancamento));
  document.getElementById('btn-cancelar-sheet-lancamento').addEventListener('click', fecharSheetLancamento);

  document.getElementById('sheet-lancamento').hidden = false;
}

function confirmarExclusao(lancamento) {
  const recorrente = Boolean(lancamento.is_recurring || lancamento.recurrence_group_id);
  if (recorrente) { escolherEscopoExclusao(lancamento); return; }

  const conteudo = document.getElementById('sheet-lancamento-conteudo');
  conteudo.innerHTML = `
    <div class="sheet-titulo">Excluir "${escapeHtml(lancamento.description)}"?</div>
    <div class="sheet-aviso">Essa ação não pode ser desfeita.</div>
    <button type="button" class="sheet-acao-btn perigo" id="btn-confirmar-exclusao">Excluir lançamento</button>
    <button type="button" class="sheet-acao-btn" id="btn-cancelar-sheet-lancamento">Cancelar</button>
  `;

  document.getElementById('btn-confirmar-exclusao').addEventListener('click', () => excluirLancamento(lancamento, 'only'));
  document.getElementById('btn-cancelar-sheet-lancamento').addEventListener('click', fecharSheetLancamento);
}

function escolherEscopoExclusao(lancamento) {
  const conteudo = document.getElementById('sheet-lancamento-conteudo');
  conteudo.innerHTML = `
    <div class="sheet-titulo">Excluir recorrência</div>
    <div class="sheet-aviso">Este lançamento faz parte de uma recorrência. Escolha o alcance da exclusão.</div>
    <button type="button" class="sheet-acao-btn perigo" id="btn-excluir-only">Excluir somente esta ocorrência</button>
    <button type="button" class="sheet-acao-btn perigo" id="btn-excluir-future">Excluir esta e futuras</button>
    <button type="button" class="sheet-acao-btn perigo" id="btn-excluir-series">Excluir toda a série</button>
    <button type="button" class="sheet-acao-btn" id="btn-cancelar-sheet-lancamento">Cancelar</button>
  `;

  document.getElementById('btn-excluir-only').addEventListener('click', () => excluirLancamento(lancamento, 'only'));
  document.getElementById('btn-excluir-future').addEventListener('click', () => excluirLancamento(lancamento, 'future'));
  document.getElementById('btn-excluir-series').addEventListener('click', () => excluirLancamento(lancamento, 'series'));
  document.getElementById('btn-cancelar-sheet-lancamento').addEventListener('click', fecharSheetLancamento);
}

function fecharSheetLancamento() {
  document.getElementById('sheet-lancamento').hidden = true;
}

async function excluirLancamento(lancamento, scope) {
  document.querySelectorAll('#sheet-lancamento-conteudo .sheet-acao-btn').forEach((b) => { b.disabled = true; });

  const grupoId = lancamento.recurrence_group_id || lancamento.id;
  let query = supabase.from('transactions').select('id, type, amount, status, account_id').eq('user_id', usuarioAtual.id);
  if (scope === 'future') query = query.eq('recurrence_group_id', grupoId).gte('date', lancamento.date);
  else if (scope === 'series') query = query.eq('recurrence_group_id', grupoId);
  else query = query.eq('id', lancamento.id);

  const { data: alvos, error: erroAlvos } = await query;
  if (erroAlvos || !alvos || !alvos.length) {
    document.querySelectorAll('#sheet-lancamento-conteudo .sheet-acao-btn').forEach((b) => { b.disabled = false; });
    return;
  }

  const ids = alvos.map((a) => a.id);
  const { error: erroDelete } = await supabase.from('transactions').delete().eq('user_id', usuarioAtual.id).in('id', ids);

  if (erroDelete) {
    document.querySelectorAll('#sheet-lancamento-conteudo .sheet-acao-btn').forEach((b) => { b.disabled = false; });
    return;
  }

  // Pendente nunca afetou o saldo — só reverte se já tiver sido contabilizado.
  for (const item of alvos) {
    if (item.status === 'pago') {
      const delta = item.type === 'receita' ? -Number(item.amount) : Number(item.amount);
      await supabase.rpc('increment_account_balance', { p_account_id: item.account_id, p_delta: delta });
    }
  }

  fecharSheetLancamento();
  await recarregar(usuarioAtual.id);
}

function renderMes() {
  document.getElementById('mes-atual').textContent = fmtMesAno.format(mesRef).replace(/^\w/, (c) => c.toUpperCase());
}

async function recarregar(userId) {
  try {
    const lancamentos = await carregarLancamentos(userId);
    renderResumo(lancamentos);
    renderLista(lancamentos);
  } catch (err) {
    console.error(err);
    document.getElementById('lista-lancamentos').innerHTML = '<div class="conta-vazia">Não foi possível carregar os lançamentos.</div>';
  }
}

async function init() {
  aplicarTemaSalvo();
  montarNavInferior('extrato');
  configurarBotaoSair();
  configurarBotaoPrivacidade('btn-privacidade');

  const user = await requireAuth();
  if (!user) return;
  usuarioAtual = user;

  const sheetLancamento = document.getElementById('sheet-lancamento');
  sheetLancamento.addEventListener('click', (e) => { if (e.target === sheetLancamento) fecharSheetLancamento(); });
  ativarArrastarParaFechar(sheetLancamento);

  const params = new URLSearchParams(window.location.search);
  const contaUrl = params.get('conta');
  if (contaUrl) contaFiltro = contaUrl;
  const categoriaUrl = params.get('categoria');
  if (categoriaUrl) categoriaFiltro = categoriaUrl;
  const mesUrl = params.get('mes');
  if (mesUrl && /^\d{4}-\d{2}$/.test(mesUrl)) {
    const [ano, mes] = mesUrl.split('-').map(Number);
    mesRef = new Date(ano, mes - 1, 1);
  }

  renderMes();

  document.getElementById('btn-mes-anterior').addEventListener('click', () => {
    mesRef.setMonth(mesRef.getMonth() - 1);
    renderMes();
    recarregar(user.id);
  });
  document.getElementById('btn-mes-proximo').addEventListener('click', () => {
    mesRef.setMonth(mesRef.getMonth() + 1);
    renderMes();
    recarregar(user.id);
  });
  document.getElementById('filtro-conta').addEventListener('change', (e) => {
    contaFiltro = e.target.value;
    recarregar(user.id);
  });
  document.getElementById('filtro-categoria').addEventListener('change', (e) => {
    categoriaFiltro = e.target.value;
    recarregar(user.id);
  });

  try {
    await carregarFiltros(user.id);
  } catch (err) {
    console.error(err);
  }
  await recarregar(user.id);
}

init();
