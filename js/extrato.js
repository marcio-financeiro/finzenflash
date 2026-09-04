import { supabase, requireAuth, configurarBotaoSair } from './supabaseClient.js';

const fmt = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtDia = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'long' });
const fmtMesAno = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' });

let mesRef = new Date();
mesRef.setDate(1);
let contaFiltro = '';
let categoriaFiltro = '';
let contas = [];
let categorias = [];

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

  const selectCategoria = document.getElementById('filtro-categoria');
  selectCategoria.innerHTML = '<option value="">Todas categorias</option>' + categorias.map((c) => `<option value="${c.id}">${escapeHtml(c.nome)}</option>`).join('');
}

async function carregarLancamentos(userId) {
  const { inicio, fim } = limitesMes(mesRef);
  let query = supabase
    .from('transactions')
    .select('id, type, amount, description, date, accounts(nome)')
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
      <div class="lancamento-card">
        <div class="lancamento-icone ${receita ? 'is-receita' : 'is-despesa'}">${receita ? iconReceita() : iconDespesa()}</div>
        <div class="lancamento-info">
          <div class="lancamento-desc">${escapeHtml(l.description)}</div>
          <div class="lancamento-conta">${escapeHtml(l.accounts?.nome ?? '')}</div>
        </div>
        <div class="lancamento-valor ${receita ? 'is-receita' : 'is-despesa'}">${sinal}${fmt.format(Math.abs(l.amount))}</div>
      </div>
    `;
  }
  container.innerHTML = html;
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
  const user = await requireAuth();
  if (!user) return;

  configurarBotaoSair();
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
