import { supabase, requireAuth, configurarBotaoSair } from '../supabaseClient.js';
import { aplicarTemaSalvo } from '../temaService.js';
import { montarNavRail } from './navRail.js';
import { abrirComandos } from './comandos.js';
import { configurarModal, abrirModal, fecharModal } from './modal.js';
import { carregarCotacaoDolar, paraBRL, formatarMoeda } from '../currencyService.js';

const fmt = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
let dolarAtual;
const fmtData = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit' });
const fmtMesAno = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' });

let mesRef = new Date();
mesRef.setDate(1);
let contaFiltro = '';
let categoriaFiltro = '';
let usuarioAtual = null;

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
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
  const [{ data: dadosContas }, { data: dadosCategorias }, dolar] = await Promise.all([
    supabase.from('accounts').select('id, nome').eq('user_id', userId).eq('active', true).eq('account_kind', 'bank').order('sort_order'),
    supabase.from('categories').select('id, nome').eq('user_id', userId).eq('ativo', true).in('tipo', ['despesa', 'receita']).order('nome'),
    carregarCotacaoDolar(supabase, userId),
  ]);
  dolarAtual = dolar;

  const selectConta = document.getElementById('filtro-conta');
  selectConta.innerHTML = '<option value="">Todas contas</option>' + (dadosContas ?? []).map((c) => `<option value="${c.id}">${escapeHtml(c.nome)}</option>`).join('');

  const selectCategoria = document.getElementById('filtro-categoria');
  selectCategoria.innerHTML = '<option value="">Todas categorias</option>' + (dadosCategorias ?? []).map((c) => `<option value="${c.id}">${escapeHtml(c.nome)}</option>`).join('');
}

async function carregarLancamentos(userId) {
  const { inicio, fim } = limitesMes(mesRef);
  let query = supabase
    .from('transactions')
    .select('id, type, amount, description, date, status, account_id, category_id, is_recurring, recurrence_group_id, accounts(nome, currency), categories(nome, icon)')
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
    const valorBRL = paraBRL(l.amount, l.accounts?.currency, dolarAtual);
    if (l.type === 'receita') entradas += valorBRL;
    else saidas += valorBRL;
  }
  document.getElementById('total-entradas').textContent = fmt.format(entradas);
  document.getElementById('total-saidas').textContent = fmt.format(saidas);
}

function renderTabela(lancamentos) {
  const corpo = document.getElementById('corpo-lancamentos');
  if (lancamentos.length === 0) {
    corpo.innerHTML = '<tr><td colspan="6" class="lista-vazia">Nenhum lançamento neste mês.</td></tr>';
    return;
  }
  corpo.innerHTML = lancamentos.map((l) => {
    const receita = l.type === 'receita';
    const categoria = l.categories?.nome ? `${l.categories.icon ? escapeHtml(l.categories.icon) + ' ' : ''}${escapeHtml(l.categories.nome)}` : '—';
    return `
      <tr>
        <td>${fmtData.format(new Date(l.date + 'T00:00:00'))}</td>
        <td>${escapeHtml(l.description)}</td>
        <td>${categoria}</td>
        <td>${escapeHtml(l.accounts?.nome ?? '')}</td>
        <td class="num ${receita ? 'positivo' : 'negativo'} valor-sensivel">${receita ? '+' : '-'} ${formatarMoeda(Math.abs(l.amount), l.accounts?.currency)}</td>
        <td><button type="button" class="btn-desktop" data-id="${l.id}">Detalhes</button></td>
      </tr>
    `;
  }).join('');

  corpo.querySelectorAll('button[data-id]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const lancamento = lancamentos.find((l) => l.id === btn.dataset.id);
      if (lancamento) abrirDetalhes(lancamento);
    });
  });
}

function abrirDetalhes(lancamento) {
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
    document.getElementById('btn-dar-baixa').addEventListener('click', () => darBaixa(lancamento));
  }
  if (paga) {
    document.getElementById('btn-desfazer-baixa').addEventListener('click', () => desfazerBaixa(lancamento));
  }
  document.getElementById('btn-editar-lancamento').addEventListener('click', () => {
    window.location.href = `/pages/desktop/lancar.html?id=${lancamento.id}`;
  });
  document.getElementById('btn-excluir-lancamento').addEventListener('click', () => confirmarExclusao(lancamento));
  abrirModal('modal-lancamento');
}

async function darBaixa(lancamento) {
  document.querySelectorAll('#modal-lancamento-conteudo .btn-desktop').forEach((b) => { b.disabled = true; });

  const { data: atualizados, error: erroUpdate } = await supabase
    .from('transactions')
    .update({ status: 'pago' })
    .eq('id', lancamento.id)
    .eq('user_id', usuarioAtual.id)
    .eq('status', 'pendente')
    .select('id');
  if (erroUpdate || !atualizados?.length) {
    document.querySelectorAll('#modal-lancamento-conteudo .btn-desktop').forEach((b) => { b.disabled = false; });
    return;
  }

  const delta = lancamento.type === 'receita' ? Number(lancamento.amount) : -Number(lancamento.amount);
  await supabase.rpc('increment_account_balance', { p_account_id: lancamento.account_id, p_delta: delta });

  fecharModal('modal-lancamento');
  await recarregar(usuarioAtual.id);
}

async function desfazerBaixa(lancamento) {
  document.querySelectorAll('#modal-lancamento-conteudo .btn-desktop').forEach((b) => { b.disabled = true; });

  const { error } = await supabase.rpc('fz_desfazer_baixa', { p_transaction_id: lancamento.id });
  if (error) {
    document.querySelectorAll('#modal-lancamento-conteudo .btn-desktop').forEach((b) => { b.disabled = false; });
    return;
  }

  fecharModal('modal-lancamento');
  await recarregar(usuarioAtual.id);
}

function confirmarExclusao(lancamento) {
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
    document.getElementById('btn-excluir-only').addEventListener('click', () => excluirLancamento(lancamento, 'only'));
    document.getElementById('btn-excluir-future').addEventListener('click', () => excluirLancamento(lancamento, 'future'));
    document.getElementById('btn-excluir-series').addEventListener('click', () => excluirLancamento(lancamento, 'series'));
    return;
  }

  conteudo.innerHTML = `
    <div class="modal-titulo">Excluir "${escapeHtml(lancamento.description)}"?</div>
    <p style="color:var(--muted);font-size:13px">Essa ação não pode ser desfeita.</p>
    <button type="button" class="btn-desktop perigo" id="btn-confirmar-exclusao" style="margin-top:10px">Excluir lançamento</button>
  `;
  document.getElementById('btn-confirmar-exclusao').addEventListener('click', () => excluirLancamento(lancamento, 'only'));
}

async function excluirLancamento(lancamento, scope) {
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
  await recarregar(usuarioAtual.id);
}

function renderMes() {
  document.getElementById('mes-atual').textContent = fmtMesAno.format(mesRef).replace(/^\w/, (c) => c.toUpperCase());
}

async function recarregar(userId) {
  try {
    const lancamentos = await carregarLancamentos(userId);
    renderResumo(lancamentos);
    renderTabela(lancamentos);
  } catch (err) {
    console.error(err);
    document.getElementById('corpo-lancamentos').innerHTML = '<tr><td colspan="5" class="lista-vazia">Não foi possível carregar os lançamentos.</td></tr>';
  }
}

async function iniciar() {
  aplicarTemaSalvo();
  const user = await requireAuth();
  if (!user) return;
  usuarioAtual = user;

  montarNavRail('extrato');
  configurarBotaoSair();
  document.getElementById('btn-topbar-busca').addEventListener('click', abrirComandos);

  configurarModal('modal-lancamento');
  document.getElementById('btn-fechar-modal-lancamento').addEventListener('click', () => fecharModal('modal-lancamento'));

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

  await carregarFiltros(user.id);
  await recarregar(user.id);
}

iniciar();
