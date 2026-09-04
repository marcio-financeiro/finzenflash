import { supabase, requireAuth, configurarBotaoSair } from './supabaseClient.js';

const fmt = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtDia = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'long' });
const fmtMes = new Intl.DateTimeFormat('pt-BR', { month: 'long' });

let mesRef = new Date();
mesRef.setDate(1);

const CARDS_PADRAO = ['ranking', 'economia', 'pendentes'];
const CORES_RANKING = ['#0E7C86', '#8b5cf6', '#94a3b8', '#38bdf8', '#f59e0b'];
let ordemCards = [...CARDS_PADRAO];
let pendentesContaIndex = 0;
let pendentesTipo = 'despesa';

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

async function carregarOrdemCards(userId) {
  const { data } = await supabase
    .from('user_settings')
    .select('setting_value')
    .eq('user_id', userId)
    .eq('setting_key', 'flash_home_cards_order')
    .maybeSingle();

  let ordem = [];
  try {
    ordem = data?.setting_value ? JSON.parse(data.setting_value) : [];
  } catch {
    ordem = [];
  }
  ordem = ordem.filter((id) => CARDS_PADRAO.includes(id));
  for (const id of CARDS_PADRAO) {
    if (!ordem.includes(id)) ordem.push(id);
  }
  return ordem.length > 0 ? ordem : [...CARDS_PADRAO];
}

async function salvarOrdemCards(userId, ordem) {
  await supabase
    .from('user_settings')
    .upsert({ user_id: userId, setting_key: 'flash_home_cards_order', setting_value: JSON.stringify(ordem) }, { onConflict: 'user_id,setting_key' });
}

async function carregarRanking(userId, inicio, fim) {
  const { data, error } = await supabase
    .from('transactions')
    .select('amount, categories(nome)')
    .eq('user_id', userId)
    .eq('type', 'despesa')
    .gte('date', inicio)
    .lte('date', fim);
  if (error) throw error;

  const porCategoria = new Map();
  for (const t of data ?? []) {
    const nome = t.categories?.nome ?? 'Sem categoria';
    porCategoria.set(nome, (porCategoria.get(nome) ?? 0) + Number(t.amount));
  }

  const linhas = [...porCategoria.entries()].sort((a, b) => b[1] - a[1]);
  const total = linhas.reduce((soma, [, valor]) => soma + valor, 0);

  let itens = linhas;
  if (linhas.length > 5) {
    const top4 = linhas.slice(0, 4);
    const outros = linhas.slice(4).reduce((soma, [, valor]) => soma + valor, 0);
    itens = [...top4, ['Outros', outros]].sort((a, b) => b[1] - a[1]);
  }

  return {
    itens: itens.map(([nome, valor]) => ({ nome, valor, pct: total > 0 ? (valor / total) * 100 : 0 })),
  };
}

async function carregarEconomia(userId, inicio, fim) {
  const { data, error } = await supabase
    .from('transactions')
    .select('type, amount')
    .eq('user_id', userId)
    .gte('date', inicio)
    .lte('date', fim);
  if (error) throw error;

  let receitas = 0;
  let despesas = 0;
  for (const t of data ?? []) {
    if (t.type === 'receita') receitas += Number(t.amount);
    else despesas += Number(t.amount);
  }
  return { receitas, despesas };
}

async function carregarPendentes(userId, conta, tipo) {
  if (!conta) return { conta: null, tipo, count: 0, total: 0 };
  const { data, error } = await supabase
    .from('transactions')
    .select('amount')
    .eq('user_id', userId)
    .eq('account_id', conta.id)
    .eq('type', tipo)
    .eq('status', 'pendente');
  if (error) throw error;

  const total = (data ?? []).reduce((soma, t) => soma + Number(t.amount), 0);
  return { conta, tipo, count: (data ?? []).length, total };
}

function renderCardWrapper(id, titulo, conteudoHtml, index, total) {
  return `
    <div class="card-resumo" data-card="${id}">
      <div class="card-resumo-topo">
        <div class="card-resumo-titulo">${escapeHtml(titulo)}</div>
        <div class="card-resumo-ordem">
          <button type="button" class="btn-mover-cima" data-id="${id}" ${index === 0 ? 'disabled' : ''} aria-label="Mover para cima">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M18 15l-6-6-6 6"/></svg>
          </button>
          <button type="button" class="btn-mover-baixo" data-id="${id}" ${index === total - 1 ? 'disabled' : ''} aria-label="Mover para baixo">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>
          </button>
        </div>
      </div>
      ${conteudoHtml}
    </div>
  `;
}

function renderConteudoRanking({ itens }) {
  if (itens.length === 0) {
    return '<div class="conta-vazia">Sem despesas neste mês.</div>';
  }
  const maior = itens[0].valor;
  return itens.map((item, i) => {
    const largura = maior > 0 ? (item.valor / maior) * 100 : 0;
    const cor = CORES_RANKING[i % CORES_RANKING.length];
    return `
      <div class="ranking-linha">
        <div class="ranking-nome">${escapeHtml(item.nome)}</div>
        <div class="ranking-barra-fundo">
          <div class="ranking-barra-fill" style="width:${largura}%;background:${cor}">
            <span class="ranking-pct">${item.pct.toFixed(1)}%</span>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

function renderConteudoEconomia({ receitas, despesas }) {
  const economia = receitas - despesas;
  const pct = receitas > 0 ? (economia / receitas) * 100 : 0;
  const pctAro = Math.max(0, Math.min(100, pct));
  const corAro = economia >= 0 ? 'var(--success)' : 'var(--danger)';
  return `
    <div class="economia-linha">
      <div class="economia-aro" style="background:conic-gradient(${corAro} ${pctAro}%, var(--surface-2) 0)">
        <div class="economia-aro-valor">${Math.round(pct)}%<small>de economia</small></div>
      </div>
      <div class="economia-detalhes">
        <div class="economia-item">
          <div class="economia-icone receita">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--success)" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12l7 7 7-7"/></svg>
          </div>
          <div>
            <div class="economia-texto-rotulo">Receitas consideradas</div>
            <div class="economia-texto-valor receita">${fmt.format(receitas)}</div>
          </div>
        </div>
        <div class="economia-item">
          <div class="economia-icone despesa">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--danger)" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg>
          </div>
          <div>
            <div class="economia-texto-rotulo">Despesas consideradas</div>
            <div class="economia-texto-valor despesa">${fmt.format(despesas)}</div>
          </div>
        </div>
      </div>
    </div>
    <div class="economia-valor-total">
      <div class="valor ${economia < 0 ? 'negativo' : ''}">${fmt.format(economia)}</div>
      <div class="rotulo">Valor economizado</div>
    </div>
  `;
}

function renderConteudoPendentes({ conta, tipo, count, total }, temMultiplasContas) {
  if (!conta) {
    return '<div class="conta-vazia">Nenhuma conta cadastrada ainda — cadastre no FinZen.</div>';
  }
  const textoTipo = tipo === 'despesa' ? 'despesas' : 'receitas';
  return `
    <div class="pendentes-abas">
      <button type="button" class="pendentes-aba ${tipo === 'despesa' ? 'ativa' : ''}" data-tipo="despesa">Despesas</button>
      <button type="button" class="pendentes-aba ${tipo === 'receita' ? 'ativa' : ''}" data-tipo="receita">Receitas</button>
    </div>
    <div class="pendentes-conta">
      <button type="button" id="btn-pendentes-conta-anterior" aria-label="Conta anterior" ${!temMultiplasContas ? 'disabled' : ''}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
      </button>
      <div class="pendentes-avatar">${escapeHtml(conta.nome.charAt(0).toUpperCase())}</div>
      <button type="button" id="btn-pendentes-conta-proxima" aria-label="Próxima conta" ${!temMultiplasContas ? 'disabled' : ''}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>
      </button>
    </div>
    <div class="pendentes-conteudo">
      <div class="pendentes-nome-conta">${escapeHtml(conta.nome).toUpperCase()}</div>
      ${count === 0
        ? `<div class="conta-vazia">Nenhuma ${tipo === 'despesa' ? 'despesa' : 'receita'} pendente.</div>`
        : `
          <div class="pendentes-texto">Você tem <strong>${count} ${textoTipo} pendentes</strong><br>no total de</div>
          <div class="pendentes-total">${fmt.format(total)}</div>
        `}
      <button type="button" class="pendentes-btn" id="btn-ver-pendentes">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>
        Ver ${textoTipo} pendentes
      </button>
    </div>
  `;
}

const cacheResumo = { ranking: null, economia: null, pendentes: null };
let usuarioAtual = null;

function renderResumoCards() {
  const container = document.getElementById('secao-resumo');
  if (!container) return;
  const total = ordemCards.length;
  let html = '';
  ordemCards.forEach((id, i) => {
    if (id === 'ranking' && cacheResumo.ranking) {
      html += renderCardWrapper('ranking', 'Ranking categorias (Despesas)', renderConteudoRanking(cacheResumo.ranking), i, total);
    } else if (id === 'economia' && cacheResumo.economia) {
      html += renderCardWrapper('economia', 'Economia mensal', renderConteudoEconomia(cacheResumo.economia), i, total);
    } else if (id === 'pendentes' && cacheResumo.pendentes) {
      html += renderCardWrapper('pendentes', 'Pendências', renderConteudoPendentes(cacheResumo.pendentes, contasCache.length > 1), i, total);
    }
  });
  container.innerHTML = html;
  wireResumoEventos();
}

function wireResumoEventos() {
  const container = document.getElementById('secao-resumo');
  container.querySelectorAll('.btn-mover-cima').forEach((btn) => {
    btn.addEventListener('click', () => moverCard(btn.dataset.id, -1));
  });
  container.querySelectorAll('.btn-mover-baixo').forEach((btn) => {
    btn.addEventListener('click', () => moverCard(btn.dataset.id, 1));
  });
  container.querySelectorAll('.pendentes-aba').forEach((btn) => {
    btn.addEventListener('click', async () => {
      pendentesTipo = btn.dataset.tipo;
      await recarregarCardPendentes();
    });
  });
  document.getElementById('btn-pendentes-conta-anterior')?.addEventListener('click', async () => {
    pendentesContaIndex = (pendentesContaIndex - 1 + contasCache.length) % contasCache.length;
    await recarregarCardPendentes();
  });
  document.getElementById('btn-pendentes-conta-proxima')?.addEventListener('click', async () => {
    pendentesContaIndex = (pendentesContaIndex + 1) % contasCache.length;
    await recarregarCardPendentes();
  });
  document.getElementById('btn-ver-pendentes')?.addEventListener('click', () => {
    const conta = contasCache[pendentesContaIndex];
    if (conta) window.location.href = `/pages/extrato.html?conta=${conta.id}`;
  });
}

function moverCard(id, delta) {
  const i = ordemCards.indexOf(id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= ordemCards.length) return;
  [ordemCards[i], ordemCards[j]] = [ordemCards[j], ordemCards[i]];
  renderResumoCards();
  if (usuarioAtual) salvarOrdemCards(usuarioAtual.id, ordemCards);
}

async function recarregarResumoMensal() {
  try {
    const { inicio, fim } = limitesMes(mesRef);
    const [ranking, economia] = await Promise.all([
      carregarRanking(usuarioAtual.id, inicio, fim),
      carregarEconomia(usuarioAtual.id, inicio, fim),
    ]);
    cacheResumo.ranking = ranking;
    cacheResumo.economia = economia;
    renderResumoCards();
  } catch (err) {
    console.error(err);
  }
}

async function recarregarCardPendentes() {
  try {
    const conta = contasCache[pendentesContaIndex] ?? null;
    cacheResumo.pendentes = await carregarPendentes(usuarioAtual.id, conta, pendentesTipo);
    renderResumoCards();
  } catch (err) {
    console.error(err);
  }
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

  usuarioAtual = user;

  document.getElementById('btn-mes-anterior').addEventListener('click', () => {
    mesRef.setMonth(mesRef.getMonth() - 1);
    renderMes();
    recarregarTimeline(user);
    recarregarResumoMensal();
  });
  document.getElementById('btn-mes-proximo').addEventListener('click', () => {
    mesRef.setMonth(mesRef.getMonth() + 1);
    renderMes();
    recarregarTimeline(user);
    recarregarResumoMensal();
  });

  try {
    const [contas, lancamentos, ordem] = await Promise.all([
      carregarContas(user.id),
      carregarLancamentos(user.id),
      carregarOrdemCards(user.id),
    ]);
    contasCache = contas;
    ordemCards = ordem;
    pendentesContaIndex = 0;
    pendentesTipo = 'despesa';

    renderContas(contas);
    renderLancamentos(lancamentos);
    await recarregarTimeline(user);
    await Promise.all([recarregarResumoMensal(), recarregarCardPendentes()]);
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
