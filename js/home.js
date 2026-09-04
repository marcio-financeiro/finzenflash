import { supabase, requireAuth, configurarBotaoSair } from './supabaseClient.js';

const fmt = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtDia = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'long' });
const fmtMes = new Intl.DateTimeFormat('pt-BR', { month: 'long' });

let mesRef = new Date();
mesRef.setDate(1);

function iconReceita() {
  return '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="var(--success)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg>';
}
function iconDespesa() {
  return '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="var(--danger)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8"/><path d="M9 12h6"/></svg>';
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}

function rotuloDia(dataISO) {
  const hoje = new Date();
  const data = new Date(dataISO + 'T00:00:00');
  const hojeStr = hoje.toISOString().slice(0, 10);
  const ontem = new Date(hoje);
  ontem.setDate(ontem.getDate() - 1);
  const ontemStr = ontem.toISOString().slice(0, 10);
  if (dataISO === hojeStr) return 'HOJE';
  if (dataISO === ontemStr) return 'ONTEM';
  return fmtDia.format(data).toUpperCase();
}

async function carregarContas(userId) {
  const { data, error } = await supabase
    .from('accounts')
    .select('id, nome, saldo_atual, currency')
    .eq('user_id', userId)
    .eq('active', true)
    .eq('account_kind', 'bank')
    .order('sort_order');

  if (error) throw error;
  return data ?? [];
}

function hojeISO() {
  const hoje = new Date();
  return new Date(hoje.getTime() - hoje.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

function addDiasISO(dataISO, dias) {
  const [y, m, d] = dataISO.split('-').map(Number);
  const data = new Date(y, m - 1, d + dias);
  return `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, '0')}-${String(data.getDate()).padStart(2, '0')}`;
}

function limitesMes(ref) {
  const ano = ref.getFullYear();
  const mes = ref.getMonth();
  const inicio = new Date(ano, mes, 1);
  const fim = new Date(ano, mes + 1, 0);
  const toISO = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return { inicio: toISO(inicio), fim: toISO(fim) };
}

// Busca as transações do intervalo que cobre o mês selecionado e hoje, e a
// partir do saldo real de hoje projeta o saldo em qualquer outra data do
// mês somando/subtraindo o fluxo (receitas - despesas) entre as duas datas.
async function carregarTimeline(userId, contaIds, saldoAtualReal) {
  const hoje = hojeISO();
  const { inicio, fim } = limitesMes(mesRef);
  const desde = inicio < hoje ? inicio : hoje;
  const ate = fim > hoje ? fim : hoje;

  let transacoes = [];
  if (contaIds.length > 0) {
    const { data, error } = await supabase
      .from('transactions')
      .select('type, amount, date')
      .eq('user_id', userId)
      .in('account_id', contaIds)
      .gte('date', desde)
      .lte('date', ate);
    if (error) throw error;
    transacoes = data ?? [];
  }

  function fluxo(de, ateData) {
    if (de > ateData) return 0;
    return transacoes
      .filter((t) => t.date >= de && t.date <= ateData)
      .reduce((soma, t) => soma + (t.type === 'receita' ? Number(t.amount) : -Number(t.amount)), 0);
  }

  function saldoNoFimDoDia(dataISO) {
    if (dataISO >= hoje) return saldoAtualReal + fluxo(addDiasISO(hoje, 1), dataISO);
    return saldoAtualReal - fluxo(addDiasISO(dataISO, 1), hoje);
  }

  const diaAntesInicio = addDiasISO(inicio, -1);
  const inicial = saldoNoFimDoDia(diaAntesInicio);
  const pontoAtual = hoje < inicio ? diaAntesInicio : hoje > fim ? fim : hoje;
  const atual = saldoNoFimDoDia(pontoAtual);
  const previsto = saldoNoFimDoDia(fim);

  return { inicial, atual, previsto };
}

async function carregarLancamentos(userId) {
  // O FinZen projeta lançamentos recorrentes com data futura (ex: contas
  // fixas já lançadas até fevereiro/2027). Sem o filtro de data, essas
  // entradas futuras aparecem antes dos lançamentos reais mais recentes.
  const { data, error } = await supabase
    .from('transactions')
    .select('id, type, amount, description, date, accounts(nome)')
    .eq('user_id', userId)
    .lte('date', hojeISO())
    .order('date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(15);

  if (error) throw error;
  return data ?? [];
}

function renderContas(contas) {
  const container = document.getElementById('lista-contas');
  if (contas.length === 0) {
    container.innerHTML = '<div class="conta-vazia">Nenhuma conta cadastrada ainda — cadastre no FinZen.</div>';
    return;
  }
  container.innerHTML = contas.map((c) => `
    <div class="conta-card">
      <div class="conta-nome">${escapeHtml(c.nome).toUpperCase()}</div>
      <div class="conta-saldo">${fmt.format(c.saldo_atual)}</div>
    </div>
  `).join('');
}

function renderLancamentos(lancamentos) {
  const container = document.getElementById('lista-lancamentos');
  if (lancamentos.length === 0) {
    container.innerHTML = '<div class="conta-vazia">Nenhum lançamento ainda. Toque em + para lançar o primeiro.</div>';
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
  document.getElementById('mes-atual').textContent = fmtMes.format(mesRef).replace(/^\w/, (c) => c.toUpperCase());
}

function classeSinal(valor) {
  return valor < 0 ? 'negativo' : 'positivo';
}

function renderTimeline({ inicial, atual, previsto }) {
  document.getElementById('valor-inicial').textContent = fmt.format(inicial);
  document.getElementById('valor-atual').textContent = fmt.format(atual);
  document.getElementById('valor-previsto').textContent = fmt.format(previsto);

  document.getElementById('valor-inicial').classList.toggle('negativo', inicial < 0);
  document.getElementById('valor-atual').classList.toggle('negativo', atual < 0);
  document.getElementById('valor-previsto').classList.toggle('negativo', previsto < 0);

  const pontoAtual = document.getElementById('ponto-atual');
  pontoAtual.classList.remove('positivo', 'negativo');
  pontoAtual.classList.add(classeSinal(atual));
}

let contasCache = [];

async function recarregarTimeline(user) {
  try {
    const saldoAtualReal = contasCache.reduce((soma, c) => soma + Number(c.saldo_atual), 0);
    const timeline = await carregarTimeline(user.id, contasCache.map((c) => c.id), saldoAtualReal);
    renderTimeline(timeline);
  } catch (err) {
    console.error(err);
  }
}

async function init() {
  const user = await requireAuth();
  if (!user) return;

  renderMes();

  document.getElementById('btn-mes-anterior').addEventListener('click', () => {
    mesRef.setMonth(mesRef.getMonth() - 1);
    renderMes();
    recarregarTimeline(user);
  });
  document.getElementById('btn-mes-proximo').addEventListener('click', () => {
    mesRef.setMonth(mesRef.getMonth() + 1);
    renderMes();
    recarregarTimeline(user);
  });

  try {
    const [contas, lancamentos] = await Promise.all([
      carregarContas(user.id),
      carregarLancamentos(user.id),
    ]);
    contasCache = contas;

    renderContas(contas);
    renderLancamentos(lancamentos);
    await recarregarTimeline(user);
  } catch (err) {
    console.error(err);
    document.getElementById('lista-lancamentos').innerHTML =
      '<div class="conta-vazia">Não foi possível carregar seus dados. Puxe pra atualizar.</div>';
  }
}

configurarBotaoSair();

init();

// Safari (principalmente em PWA standalone) pode restaurar a página do
// bfcache ao voltar de outra tela, sem recarregar — o que mostra dados
// desatualizados. Recarrega os dados sempre que a página volta a ficar
// visível.
window.addEventListener('pageshow', (event) => {
  if (event.persisted) init();
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') init();
});
