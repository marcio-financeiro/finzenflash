import { supabase, requireAuth, configurarBotaoSair } from './supabaseClient.js';
import { aplicarTemaSalvo } from './temaService.js?v=2';
import { configurarBotaoPrivacidade } from './privacidade.js?v=2';
import { montarNavInferior } from './navInferior.js?v=5';
import { loadChart } from './loadChart.js';

const fmt = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const CORES_CATEGORIA = ['#0E7C86', '#14A3AE', '#c9963f', '#D9583A', '#8ea198', '#1E9E6E', '#4b84f3', '#9b6bd6'];

let usuarioAtual = null;
let charts = {};
const modo = { tipo: 'mes', mes: '', inicio: '', fim: '' };

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}

function hojeISO() {
  const hoje = new Date();
  return new Date(hoje.getTime() - hoje.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

function inicioMes(ym) { return ym + '-01'; }

function fimMes(ym) {
  const [a, m] = ym.split('-').map(Number);
  const d = new Date(a, m, 0);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

function mesAdicionar(ym, n) {
  const [a, m] = ym.split('-').map(Number);
  const d = new Date(a, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function ultimosNMeses(ym, n) {
  const meses = [];
  for (let i = n - 1; i >= 0; i--) meses.push(mesAdicionar(ym, -i));
  return meses;
}

function mesesEntre(inicioISO, fimISO) {
  const meses = [];
  let atual = inicioISO.slice(0, 7);
  const limite = fimISO.slice(0, 7);
  while (atual <= limite) {
    meses.push(atual);
    atual = mesAdicionar(atual, 1);
  }
  return meses;
}

function nomeMes(ym) {
  const [a, m] = ym.split('-');
  return new Date(a, m - 1, 1).toLocaleString('pt-BR', { month: 'short', year: '2-digit' }).replace('.', '');
}

function mesLabel(ym) {
  const [a, m] = ym.split('-');
  const texto = new Date(a, m - 1, 1).toLocaleString('pt-BR', { month: 'long', year: 'numeric' });
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

function destroyChart(key) {
  if (charts[key]) { charts[key].destroy(); delete charts[key]; }
}

function corTema(varName) {
  return getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
}

// ── Consultas ─────────────────────────────────────────────────────────────
async function carregarTendencia12Meses(mesFinal) {
  const meses = ultimosNMeses(mesFinal, 12);
  const inicio = inicioMes(meses[0]);
  const fim = fimMes(meses[meses.length - 1]);

  const [{ data: tx }, { data: cardTx }] = await Promise.all([
    supabase.from('transactions').select('type,amount,date').eq('user_id', usuarioAtual.id)
      .gte('date', inicio).lte('date', fim).eq('status', 'pago'),
    supabase.from('card_transactions').select('valor_parcela,fatura_referencia').eq('user_id', usuarioAtual.id)
      .in('fatura_referencia', meses),
  ]);

  const receitas = meses.map((m) => (tx || []).filter((t) => t.date?.startsWith(m) && t.type === 'receita').reduce((s, t) => s + Number(t.amount || 0), 0));
  const despesas = meses.map((m) =>
    (tx || []).filter((t) => t.date?.startsWith(m) && t.type === 'despesa').reduce((s, t) => s + Number(t.amount || 0), 0) +
    (cardTx || []).filter((c) => c.fatura_referencia === m).reduce((s, c) => s + Number(c.valor_parcela || 0), 0)
  );

  return { labels: meses.map(nomeMes), receitas, despesas };
}

async function carregarTransacoesPeriodo(inicioISO, fimISO) {
  const meses = mesesEntre(inicioISO, fimISO);
  const [{ data: tx }, { data: cardTx }] = await Promise.all([
    supabase.from('transactions').select('type,amount,date,category_id,categories:category_id(nome)').eq('user_id', usuarioAtual.id)
      .gte('date', inicioISO).lte('date', fimISO).eq('status', 'pago'),
    supabase.from('card_transactions').select('valor_parcela,fatura_referencia,category_id,categories:category_id(nome)').eq('user_id', usuarioAtual.id)
      .in('fatura_referencia', meses),
  ]);
  return { tx: tx || [], cardTx: cardTx || [] };
}

async function carregarOrcamento(mes) {
  const [{ data: budgets }, { data: tx }, { data: cardTx }] = await Promise.all([
    supabase.from('budgets').select('valor_planejado,category_id,categories:category_id(nome,icon)').eq('user_id', usuarioAtual.id).eq('mes_referencia', mes),
    supabase.from('transactions').select('amount,category_id').eq('user_id', usuarioAtual.id)
      .gte('date', inicioMes(mes)).lte('date', fimMes(mes)).eq('status', 'pago').eq('type', 'despesa'),
    supabase.from('card_transactions').select('valor_parcela,category_id').eq('user_id', usuarioAtual.id).eq('fatura_referencia', mes),
  ]);

  const gastos = {};
  (tx || []).forEach((t) => { if (t.category_id) gastos[t.category_id] = (gastos[t.category_id] || 0) + Number(t.amount || 0); });
  (cardTx || []).forEach((c) => { if (c.category_id) gastos[c.category_id] = (gastos[c.category_id] || 0) + Number(c.valor_parcela || 0); });

  return (budgets || []).map((b) => ({
    nome: b.categories?.nome || 'Categoria',
    icon: b.categories?.icon || '',
    planejado: Number(b.valor_planejado || 0),
    realizado: gastos[b.category_id] || 0,
  })).sort((a, b) => b.realizado - a.realizado);
}

// ── Render: Balanço do mês (com variação vs mês anterior) ────────────────
function renderBalanco({ receitasMes, despesasMes, receitasAnt, despesasAnt }) {
  const card = document.getElementById('card-balanco');
  card.hidden = false;

  const balancoMes = receitasMes - despesasMes;
  document.getElementById('balanco-receitas').textContent = fmt.format(receitasMes);
  document.getElementById('balanco-despesas').textContent = fmt.format(despesasMes);
  document.getElementById('balanco-total').textContent = fmt.format(balancoMes);
  document.getElementById('balanco-total').style.color = balancoMes >= 0 ? 'var(--success)' : 'var(--danger)';

  const badge = document.getElementById('balanco-badge');
  if (despesasAnt > 0) {
    const variacao = ((despesasMes - despesasAnt) / despesasAnt) * 100;
    badge.hidden = false;
    badge.className = `balanco-badge ${variacao >= 0 ? 'subiu' : 'desceu'}`;
    badge.textContent = `Despesas ${variacao >= 0 ? '+' : ''}${variacao.toFixed(0)}% vs mês anterior`;
  } else {
    badge.hidden = true;
  }
}

// ── Render: Receita vs Despesa ───────────────────────────────────────────
async function renderRecDes() {
  const muted = corTema('--muted');
  const border = corTema('--border');
  const success = corTema('--success');
  const danger = corTema('--danger');

  destroyChart('recdes');

  if (modo.tipo === 'mes') {
    document.getElementById('titulo-recdes').textContent = 'Receita vs Despesa — últimos 12 meses';
    const { labels, receitas, despesas } = await carregarTendencia12Meses(modo.mes);
    renderBalanco({
      receitasMes: receitas[receitas.length - 1],
      despesasMes: despesas[despesas.length - 1],
      receitasAnt: receitas[receitas.length - 2],
      despesasAnt: despesas[despesas.length - 2],
    });
    try {
      const Chart = await loadChart();
      charts.recdes = new Chart(document.getElementById('chart-recdes'), {
        type: 'bar',
        data: {
          labels,
          datasets: [
            { label: 'Receitas', data: receitas, backgroundColor: success, borderRadius: 4 },
            { label: 'Despesas', data: despesas, backgroundColor: danger, borderRadius: 4 },
          ],
        },
        options: {
          maintainAspectRatio: false,
          interaction: { mode: 'index', intersect: false },
          plugins: { legend: { labels: { color: muted, boxWidth: 10, font: { size: 10 } } } },
          scales: {
            x: { grid: { display: false }, ticks: { color: muted, font: { size: 9 } } },
            y: { grid: { color: border }, ticks: { color: muted, font: { size: 9 } } },
          },
        },
      });
    } catch (err) { console.error(err); }
  } else {
    document.getElementById('card-balanco').hidden = true;
    document.getElementById('titulo-recdes').textContent = 'Receita vs Despesa no período';
    const { tx, cardTx } = await carregarTransacoesPeriodo(modo.inicio, modo.fim);
    const receitas = tx.filter((t) => t.type === 'receita').reduce((s, t) => s + Number(t.amount || 0), 0);
    const despesas = tx.filter((t) => t.type === 'despesa').reduce((s, t) => s + Number(t.amount || 0), 0) +
      cardTx.reduce((s, c) => s + Number(c.valor_parcela || 0), 0);

    try {
      const Chart = await loadChart();
      charts.recdes = new Chart(document.getElementById('chart-recdes'), {
        type: 'bar',
        data: {
          labels: ['Receitas', 'Despesas'],
          datasets: [{ data: [receitas, despesas], backgroundColor: [success, danger], borderRadius: 4 }],
        },
        options: {
          maintainAspectRatio: false,
          plugins: { legend: { display: false }, tooltip: { callbacks: { label: (ctx) => ' ' + fmt.format(ctx.raw) } } },
          scales: {
            x: { grid: { display: false }, ticks: { color: muted, font: { size: 11, weight: '700' } } },
            y: { grid: { color: border }, ticks: { color: muted, font: { size: 9 } } },
          },
        },
      });
    } catch (err) { console.error(err); }
    return { tx, cardTx };
  }
}

// ── Render: Despesas por Categoria + ranking ─────────────────────────────
async function renderCategorias(dadosPeriodo) {
  let tx, cardTx;
  if (modo.tipo === 'mes') {
    [{ data: tx }, { data: cardTx }] = await Promise.all([
      supabase.from('transactions').select('amount,categories:category_id(nome)').eq('user_id', usuarioAtual.id)
        .gte('date', inicioMes(modo.mes)).lte('date', fimMes(modo.mes)).eq('status', 'pago').eq('type', 'despesa'),
      supabase.from('card_transactions').select('valor_parcela,categories:category_id(nome)').eq('user_id', usuarioAtual.id).eq('fatura_referencia', modo.mes),
    ]);
  } else {
    tx = (dadosPeriodo?.tx || []).filter((t) => t.type === 'despesa');
    cardTx = dadosPeriodo?.cardTx || [];
  }

  const mapa = {};
  (tx || []).forEach((t) => {
    const nome = t.categories?.nome || 'Outros';
    mapa[nome] = (mapa[nome] || 0) + Number(t.amount || 0);
  });
  (cardTx || []).forEach((c) => {
    const nome = c.categories?.nome || 'Cartão';
    mapa[nome] = (mapa[nome] || 0) + Number(c.valor_parcela || 0);
  });

  const itens = Object.entries(mapa).map(([nome, valor]) => ({ nome, valor })).sort((a, b) => b.valor - a.valor);
  const top8 = itens.slice(0, 8);
  const outros = itens.slice(8).reduce((s, i) => s + i.valor, 0);
  if (outros > 0) top8.push({ nome: 'Outros', valor: outros });
  const total = top8.reduce((s, i) => s + i.valor, 0);

  destroyChart('cat');
  if (top8.length === 0) {
    document.getElementById('ranking-categorias').innerHTML = '<div class="conta-vazia">Nenhuma despesa no período.</div>';
    return;
  }

  document.getElementById('ranking-categorias').innerHTML = top8.map((item, i) => `
    <div class="ranking-item">
      <div class="ranking-ponto" style="background:${CORES_CATEGORIA[i % CORES_CATEGORIA.length]}"></div>
      <div class="ranking-nome">${escapeHtml(item.nome)}</div>
      <div class="ranking-valor">${fmt.format(item.valor)}</div>
      <div class="ranking-pct">${total > 0 ? ((item.valor / total) * 100).toFixed(1) : '0'}%</div>
    </div>
  `).join('');

  try {
    const muted = corTema('--muted');
    const surface = corTema('--surface');
    const Chart = await loadChart();
    charts.cat = new Chart(document.getElementById('chart-categorias'), {
      type: 'doughnut',
      data: {
        labels: top8.map((i) => i.nome),
        datasets: [{ data: top8.map((i) => i.valor), backgroundColor: CORES_CATEGORIA.slice(0, top8.length), borderWidth: 2, borderColor: surface }],
      },
      options: {
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'right', labels: { color: muted, font: { size: 10 }, boxWidth: 10, padding: 8 } },
          tooltip: { callbacks: { label: (ctx) => ` ${ctx.label}: ${fmt.format(ctx.raw)}` } },
        },
      },
    });
  } catch (err) { console.error(err); }
}

// ── Render: Orçamento vs Realizado (só no modo mês — orçamento é mensal) ─
async function renderOrcamento() {
  const wrap = document.getElementById('wrap-orcamento');
  destroyChart('orc');

  if (modo.tipo !== 'mes') {
    wrap.innerHTML = '<div class="conta-vazia">Disponível apenas no modo "Mês" — orçamentos são sempre mensais.</div>';
    return;
  }

  const itens = await carregarOrcamento(modo.mes);
  if (itens.length === 0) {
    wrap.innerHTML = '<div class="conta-vazia">Nenhum orçamento cadastrado para este mês.</div>';
    return;
  }

  wrap.innerHTML = `<div class="grafico-wrap" style="height:${Math.max(180, itens.length * 44)}px"><canvas id="chart-orcamento"></canvas></div>`;

  const muted = corTema('--muted');
  const border = corTema('--border');
  const success = corTema('--success');
  const warning = '#c9963f';
  const danger = corTema('--danger');
  const info = '#4b84f3';

  const pcts = itens.map((i) => (i.planejado > 0 ? (i.realizado / i.planejado) * 100 : 0));
  const cores = pcts.map((p) => (p <= 80 ? success : p <= 100 ? warning : danger));

  try {
    const Chart = await loadChart();
    charts.orc = new Chart(document.getElementById('chart-orcamento'), {
      type: 'bar',
      data: {
        labels: itens.map((i) => `${i.icon ? i.icon + ' ' : ''}${i.nome}`),
        datasets: [
          { label: 'Realizado', data: itens.map((i) => i.realizado), backgroundColor: cores, borderRadius: 4 },
          { label: 'Orçamento', data: itens.map((i) => i.planejado), backgroundColor: info + '33', borderColor: info, borderWidth: 1, borderRadius: 4 },
        ],
      },
      options: {
        indexAxis: 'y',
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { labels: { color: muted, boxWidth: 10, font: { size: 10 } } },
          tooltip: { callbacks: { label: (ctx) => ` ${ctx.dataset.label}: ${fmt.format(ctx.raw)}` } },
        },
        scales: {
          x: { grid: { color: border }, ticks: { color: muted, font: { size: 9 } } },
          y: { grid: { display: false }, ticks: { color: muted, font: { size: 10 } } },
        },
      },
    });
  } catch (err) { console.error(err); }
}

// ── Orquestração ──────────────────────────────────────────────────────────
async function renderTudo() {
  const dadosPeriodo = await renderRecDes();
  await Promise.all([renderCategorias(dadosPeriodo), renderOrcamento()]);
}

function atualizarLabelMes() {
  document.getElementById('mes-atual').textContent = mesLabel(modo.mes);
}

async function mudarMes(delta) {
  modo.mes = mesAdicionar(modo.mes, delta);
  atualizarLabelMes();
  await renderTudo();
}

function alternarModo(tipo) {
  modo.tipo = tipo;
  document.getElementById('tab-mes').classList.toggle('ativo', tipo === 'mes');
  document.getElementById('tab-periodo').classList.toggle('ativo', tipo === 'periodo');
  document.getElementById('seletor-mes').hidden = tipo !== 'mes';
  document.getElementById('seletor-periodo').hidden = tipo !== 'periodo';
  renderTudo();
}

async function init() {
  aplicarTemaSalvo();
  montarNavInferior('relatorios');
  configurarBotaoSair();
  configurarBotaoPrivacidade('btn-privacidade');

  const user = await requireAuth();
  if (!user) return;
  usuarioAtual = user;

  const hoje = new Date();
  modo.mes = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}`;
  modo.fim = hojeISO();
  modo.inicio = mesAdicionar(modo.mes, -1) + '-01';
  atualizarLabelMes();
  document.getElementById('periodo-inicio').value = modo.inicio;
  document.getElementById('periodo-fim').value = modo.fim;

  document.getElementById('tab-mes').addEventListener('click', () => alternarModo('mes'));
  document.getElementById('tab-periodo').addEventListener('click', () => alternarModo('periodo'));
  document.getElementById('btn-mes-anterior').addEventListener('click', () => mudarMes(-1));
  document.getElementById('btn-mes-proximo').addEventListener('click', () => mudarMes(1));
  document.getElementById('periodo-inicio').addEventListener('change', (e) => { modo.inicio = e.target.value; renderTudo(); });
  document.getElementById('periodo-fim').addEventListener('change', (e) => { modo.fim = e.target.value; renderTudo(); });
  document.getElementById('btn-exportar').addEventListener('click', () => window.print());

  try {
    await renderTudo();
  } catch (err) {
    console.error(err);
    document.getElementById('wrap-orcamento').innerHTML = '<div class="conta-vazia">Não foi possível carregar os relatórios.</div>';
  }
}

init();
