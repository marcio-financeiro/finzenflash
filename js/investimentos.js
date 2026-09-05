import { supabase, requireAuth, configurarBotaoSair } from './supabaseClient.js';
import { configurarBotaoPrivacidade } from './privacidade.js?v=2';
import { ativarArrastarParaFechar } from './sheetGestos.js?v=2';
import { loadChart } from './loadChart.js';

const fmt = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtPct = (v) => `${v >= 0 ? '+' : ''}${v.toFixed(2).replace('.', ',')}%`;
const fmtMesAno = new Intl.DateTimeFormat('pt-BR', { month: 'short', year: '2-digit' });

const DEFAULT_USD_BRL = 5.15;
const TIPOS_ATIVO = [
  { valor: 'acao_br', texto: 'Ação BR' },
  { valor: 'fii', texto: 'FII' },
  { valor: 'etf_br', texto: 'ETF BR' },
  { valor: 'acao_eua', texto: 'Ação EUA' },
  { valor: 'etf_eua', texto: 'ETF EUA' },
  { valor: 'renda_fixa', texto: 'Renda Fixa' },
];
const CORES_DONUT = ['#0E7C86', '#14A3AE', '#c9963f', '#d9583a', '#8ea198', '#1E9E6E'];
const TIPOS_PROVENTO = [
  { valor: 'dividendo', texto: 'Dividendo' },
  { valor: 'jcp', texto: 'JCP' },
  { valor: 'rendimento', texto: 'Rendimento FII' },
  { valor: 'cupom', texto: 'Cupom / Juros' },
];

let usuarioAtual = null;
let ativos = [];
let contas = [];
let todasContas = [];
let dividendos = [];
let dolarAtual = DEFAULT_USD_BRL;
let chartDonut = null;
let chartEvolucao = null;

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}

function hojeISO() {
  const hoje = new Date();
  return new Date(hoje.getTime() - hoje.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

function lerValorMonetario(bruto) {
  const normalizado = String(bruto ?? '').trim().replace(/\./g, '').replace(',', '.');
  const numero = Number(normalizado);
  return Number.isFinite(numero) ? numero : 0;
}

function tipoLabel(t) {
  return TIPOS_ATIVO.find((o) => o.valor === t)?.texto ?? t ?? '-';
}

function classeKey(t) {
  if (t === 'fii') return 'FIIs';
  if (t === 'acao_br') return 'Ações BR';
  if (t === 'etf_br') return 'ETFs BR';
  if (t === 'acao_eua') return 'Ações EUA';
  if (t === 'etf_eua') return 'ETFs EUA';
  if (t === 'renda_fixa') return 'Renda Fixa';
  return 'Outros';
}

function calcAplicado(a) { return Number(a.quantidade) * Number(a.preco_medio); }
function calcAtual(a) { return Number(a.quantidade) * Number(a.cotacao_atual || a.preco_medio); }
function calcBRL(a, v) { return (a.moeda || 'BRL') === 'USD' ? v * dolarAtual : v; }

function campoTexto(id, label, valor, placeholder = '') {
  return `
    <div class="field">
      <label for="${id}">${label}</label>
      <input type="text" id="${id}" value="${escapeHtml(valor ?? '')}" placeholder="${placeholder}">
    </div>
  `;
}

function campoSelect(id, label, opcoes, valorAtual) {
  const options = opcoes.map((o) => `<option value="${o.valor}" ${o.valor === valorAtual ? 'selected' : ''}>${o.texto}</option>`).join('');
  return `
    <div class="field">
      <label for="${id}">${label}</label>
      <select id="${id}">${options}</select>
    </div>
  `;
}

async function carregarDolar(userId) {
  const { data } = await supabase
    .from('user_settings')
    .select('setting_value')
    .eq('user_id', userId)
    .eq('setting_key', 'usd_brl')
    .maybeSingle();
  dolarAtual = data ? Number(data.setting_value) || DEFAULT_USD_BRL : DEFAULT_USD_BRL;
}

async function carregarContas(userId) {
  const { data: broker } = await supabase
    .from('accounts')
    .select('id, nome, currency, saldo_atual')
    .eq('user_id', userId).eq('active', true).eq('account_kind', 'broker')
    .order('nome');
  contas = broker ?? [];

  if (contas.length === 0) {
    const { data: todas } = await supabase
      .from('accounts')
      .select('id, nome, currency, saldo_atual')
      .eq('user_id', userId).eq('active', true)
      .order('nome');
    contas = todas ?? [];
  }
}

async function carregarAtivos(userId) {
  const { data, error } = await supabase
    .from('investments')
    .select('*')
    .eq('user_id', userId)
    .eq('ativo', true)
    .order('created_at', { ascending: true });
  if (error) throw error;
  ativos = data ?? [];
}

async function carregarTodasContas(userId) {
  const { data, error } = await supabase
    .from('accounts')
    .select('id, nome, currency, saldo_atual')
    .eq('user_id', userId).eq('active', true)
    .order('nome');
  if (error) throw error;
  todasContas = data ?? [];
}

async function carregarDividendos(userId) {
  const { data, error } = await supabase
    .from('dividends')
    .select('*')
    .eq('user_id', userId)
    .order('data_pagamento', { ascending: false });
  if (error) throw error;
  dividendos = data ?? [];
}

function calcularKpisProventos() {
  const hoje = new Date();
  const mesAtual = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}`;
  const anoAtual = String(hoje.getFullYear());

  const mes = dividendos.filter((d) => d.data_pagamento?.startsWith(mesAtual)).reduce((s, d) => s + Number(d.valor_total), 0);
  const ano = dividendos.filter((d) => d.data_pagamento?.startsWith(anoAtual)).reduce((s, d) => s + Number(d.valor_total), 0);
  const total = dividendos.reduce((s, d) => s + Number(d.valor_total), 0);
  return { mes, ano, total };
}

async function carregarHistoricoPatrimonio(userId) {
  const { data, error } = await supabase
    .from('patrimony_history')
    .select('reference_month, investments_total')
    .eq('user_id', userId)
    .order('reference_month', { ascending: true });
  if (error) throw error;
  return (data ?? []).slice(-12);
}

function renderKpis({ aplicadoBRL, atualBRL, proventos }) {
  const ganhoCapital = atualBRL - aplicadoBRL;
  const lucroTotal = ganhoCapital + proventos;
  const rentabilidade = aplicadoBRL > 0 ? (ganhoCapital / aplicadoBRL) * 100 : 0;

  document.getElementById('kpi-patrimonio').textContent = fmt.format(atualBRL);
  document.getElementById('kpi-investido').textContent = fmt.format(aplicadoBRL);

  const kpiLucro = document.getElementById('kpi-lucro');
  kpiLucro.textContent = fmt.format(lucroTotal);
  kpiLucro.classList.toggle('positivo', lucroTotal > 0);
  kpiLucro.classList.toggle('negativo', lucroTotal < 0);
  document.getElementById('kpi-ganho-capital').textContent = fmt.format(ganhoCapital);

  document.getElementById('kpi-proventos').textContent = fmt.format(proventos);

  const kpiRent = document.getElementById('kpi-rentabilidade');
  kpiRent.textContent = fmtPct(rentabilidade);
  kpiRent.classList.toggle('positivo', rentabilidade > 0);
  kpiRent.classList.toggle('negativo', rentabilidade < 0);
}

function renderProventosMiniKpis({ mes, ano, total }) {
  document.getElementById('div-mes').textContent = fmt.format(mes);
  document.getElementById('div-ano').textContent = fmt.format(ano);
  document.getElementById('div-total').textContent = fmt.format(total);
}

async function renderDonut() {
  const porClasse = new Map();
  for (const a of ativos) {
    const valor = calcBRL(a, calcAtual(a));
    if (valor <= 0) continue;
    const chave = classeKey(a.tipo);
    porClasse.set(chave, (porClasse.get(chave) ?? 0) + valor);
  }

  const legenda = document.getElementById('donut-legenda');
  const canvas = document.getElementById('chart-donut');

  if (porClasse.size === 0) {
    legenda.innerHTML = '<div class="conta-vazia">Nenhum ativo na carteira ainda.</div>';
    if (chartDonut) { chartDonut.destroy(); chartDonut = null; }
    return;
  }

  const entradas = [...porClasse.entries()].sort((a, b) => b[1] - a[1]);
  const total = entradas.reduce((s, [, v]) => s + v, 0);

  legenda.innerHTML = entradas.map(([nome, valor], i) => `
    <div class="donut-legenda-item">
      <div class="donut-ponto" style="background:${CORES_DONUT[i % CORES_DONUT.length]}"></div>
      <div class="donut-nome">${escapeHtml(nome)}</div>
      <div class="donut-pct">${((valor / total) * 100).toFixed(1)}%</div>
    </div>
  `).join('');

  const Chart = await loadChart();
  if (chartDonut) { chartDonut.destroy(); chartDonut = null; }
  chartDonut = new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels: entradas.map(([nome]) => nome),
      datasets: [{ data: entradas.map(([, v]) => v), backgroundColor: entradas.map((_, i) => CORES_DONUT[i % CORES_DONUT.length]), borderWidth: 0 }],
    },
    options: { cutout: '68%', plugins: { legend: { display: false }, tooltip: { enabled: true } } },
  });
}

async function renderGraficoEvolucao({ aplicadoBRL, atualBRL }, historico) {
  const canvas = document.getElementById('chart-evolucao');
  const card = canvas.closest('.card');

  if (historico.length === 0) {
    card.querySelector('.grafico-wrap').innerHTML = '<div class="conta-vazia">Nenhum histórico disponível ainda — ele vai se formar aos poucos conforme você usa o FinZen.</div>';
    return;
  }

  const hoje = new Date();
  const mesAtualKey = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}`;

  const labels = [];
  const serieAplicado = [];
  const serieGanho = [];

  historico.forEach((h) => {
    const chave = h.reference_month.slice(0, 7);
    const [y, m] = chave.split('-').map(Number);
    labels.push(fmtMesAno.format(new Date(y, m - 1, 1)).replace('.', ''));

    const total = chave === mesAtualKey && atualBRL > 0 ? atualBRL : Number(h.investments_total);
    serieAplicado.push(Math.max(0, aplicadoBRL));
    serieGanho.push(Math.max(0, total - aplicadoBRL));
  });

  const Chart = await loadChart();
  if (chartEvolucao) { chartEvolucao.destroy(); chartEvolucao = null; }
  chartEvolucao = new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'Valor aplicado', data: serieAplicado, backgroundColor: '#8ea198', stack: 's' },
        { label: 'Ganho de Capital', data: serieGanho, backgroundColor: '#1E9E6E', stack: 's' },
      ],
    },
    options: {
      maintainAspectRatio: false,
      scales: { x: { stacked: true, grid: { display: false } }, y: { stacked: true, ticks: { display: false }, grid: { display: false } } },
      plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 10 } } } },
    },
  });
}

function renderPosicoes() {
  const container = document.getElementById('lista-posicoes');
  if (ativos.length === 0) {
    container.innerHTML = '<div class="conta-vazia">Nenhum ativo cadastrado ainda.</div>';
    return;
  }

  container.innerHTML = ativos.map((a) => {
    const aplicado = calcAplicado(a);
    const atual = calcAtual(a);
    const pct = aplicado > 0 ? ((atual - aplicado) / aplicado) * 100 : 0;
    return `
      <button type="button" class="posicao-item" data-id="${a.id}">
        <div class="posicao-icone">${escapeHtml((a.ticker || '?').slice(0, 4))}</div>
        <div class="posicao-info">
          <div class="posicao-ticker">${escapeHtml(a.ticker)}</div>
          <div class="posicao-detalhe">${tipoLabel(a.tipo)} · ${Number(a.quantidade)} cotas</div>
        </div>
        <div class="posicao-valores">
          <div class="posicao-valor valor-sensivel">${fmt.format(calcBRL(a, atual))}</div>
          <div class="posicao-var ${pct >= 0 ? 'positivo' : 'negativo'}">${fmtPct(pct)}</div>
        </div>
      </button>
    `;
  }).join('');

  container.querySelectorAll('.posicao-item').forEach((el) => {
    const ativo = ativos.find((a) => a.id === el.dataset.id);
    if (ativo) el.addEventListener('click', () => abrirSheetAcaoPosicao(ativo));
  });
}

async function recarregarTudo() {
  const aplicadoBRL = ativos.reduce((s, a) => s + calcBRL(a, calcAplicado(a)), 0);
  const atualBRL = ativos.reduce((s, a) => s + calcBRL(a, calcAtual(a)), 0);

  let historico = [];
  try {
    await Promise.all([
      carregarDividendos(usuarioAtual.id),
      carregarHistoricoPatrimonio(usuarioAtual.id).then((h) => { historico = h; }),
    ]);
  } catch (err) {
    console.error(err);
  }

  const kpisProventos = calcularKpisProventos();
  renderKpis({ aplicadoBRL, atualBRL, proventos: kpisProventos.total });
  renderProventosMiniKpis(kpisProventos);
  renderPosicoes();
  // Falha ao carregar o Chart.js (rede instável, bloqueio etc.) não pode
  // apagar o que já carregou certinho acima (KPIs e posições).
  try {
    await Promise.all([
      renderDonut(),
      renderGraficoEvolucao({ aplicadoBRL, atualBRL }, historico),
    ]);
  } catch (err) {
    console.error(err);
  }
}

// ── Sheet: ação da posição (editar/excluir) ──
function abrirSheetAcaoPosicao(ativo) {
  const conteudo = document.getElementById('sheet-acao-posicao-conteudo');
  conteudo.innerHTML = `
    <div class="sheet-titulo">${escapeHtml(ativo.ticker)}</div>
    <button type="button" class="sheet-acao-btn" id="btn-editar-posicao">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>
      Editar posição
    </button>
    <button type="button" class="sheet-acao-btn perigo" id="btn-excluir-posicao">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
      Remover da carteira
    </button>
    <button type="button" class="sheet-acao-btn" id="btn-cancelar-acao-posicao">Cancelar</button>
  `;
  document.getElementById('btn-editar-posicao').addEventListener('click', () => abrirSheetEditarPosicao(ativo));
  document.getElementById('btn-excluir-posicao').addEventListener('click', () => confirmarExclusaoPosicao(ativo));
  document.getElementById('btn-cancelar-acao-posicao').addEventListener('click', fecharSheetAcaoPosicao);
  document.getElementById('sheet-acao-posicao').hidden = false;
}

function fecharSheetAcaoPosicao() {
  document.getElementById('sheet-acao-posicao').hidden = true;
}

function confirmarExclusaoPosicao(ativo) {
  const conteudo = document.getElementById('sheet-acao-posicao-conteudo');
  conteudo.innerHTML = `
    <div class="sheet-titulo">Remover ${escapeHtml(ativo.ticker)} da carteira?</div>
    <div class="sheet-aviso" style="font-size:13px;color:var(--muted);text-align:center;margin-top:-8px;">Não apaga o histórico de aportes/vendas já feitos, só some da lista de posições.</div>
    <button type="button" class="sheet-acao-btn perigo" id="btn-confirmar-excluir-posicao">Remover</button>
    <button type="button" class="sheet-acao-btn" id="btn-cancelar-acao-posicao">Cancelar</button>
  `;
  document.getElementById('btn-confirmar-excluir-posicao').addEventListener('click', async () => {
    const btn = document.getElementById('btn-confirmar-excluir-posicao');
    btn.disabled = true;
    btn.textContent = 'Removendo...';
    const { error } = await supabase.from('investments').update({ ativo: false }).eq('id', ativo.id).eq('user_id', usuarioAtual.id);
    if (error) { btn.disabled = false; btn.textContent = 'Remover'; return; }
    fecharSheetAcaoPosicao();
    await carregarAtivos(usuarioAtual.id);
    await recarregarTudo();
  });
  document.getElementById('btn-cancelar-acao-posicao').addEventListener('click', fecharSheetAcaoPosicao);
}

// ── Sheet: editar posição diretamente (corrige qtd/preço médio manualmente) ──
function abrirSheetEditarPosicao(ativo) {
  const conteudo = document.getElementById('sheet-form-conteudo');
  conteudo.innerHTML = `
    <div class="sheet-titulo">Editar posição</div>
    ${campoTexto('f-ticker', 'Ticker', ativo.ticker)}
    ${campoTexto('f-nome', 'Nome (opcional)', ativo.nome)}
    ${campoSelect('f-tipo', 'Tipo', TIPOS_ATIVO, ativo.tipo)}
    <div class="form-linha">
      ${campoTexto('f-quantidade', 'Quantidade', String(ativo.quantidade).replace('.', ','))}
      ${campoTexto('f-preco', 'Preço médio', String(ativo.preco_medio).replace('.', ','))}
    </div>
    ${campoSelect('f-moeda', 'Moeda', [{ valor: 'BRL', texto: 'BRL — Real' }, { valor: 'USD', texto: 'USD — Dólar' }], ativo.moeda || 'BRL')}
    <div class="error-msg" id="erro-form"></div>
    <button type="button" class="btn-primary" id="btn-salvar-form">Salvar</button>
    <button type="button" class="sheet-acao-btn" id="btn-cancelar-form">Cancelar</button>
  `;
  document.getElementById('btn-cancelar-form').addEventListener('click', () => { document.getElementById('sheet-form').hidden = true; });
  document.getElementById('btn-salvar-form').addEventListener('click', () => salvarEdicaoPosicao(ativo.id));
  document.getElementById('sheet-acao-posicao').hidden = true;
  document.getElementById('sheet-form').hidden = false;
}

async function salvarEdicaoPosicao(id) {
  const erroEl = document.getElementById('erro-form');
  erroEl.textContent = '';

  const ticker = document.getElementById('f-ticker').value.trim().toUpperCase();
  const nome = document.getElementById('f-nome').value.trim();
  const tipo = document.getElementById('f-tipo').value;
  const quantidade = lerValorMonetario(document.getElementById('f-quantidade').value);
  const preco = lerValorMonetario(document.getElementById('f-preco').value);
  const moeda = document.getElementById('f-moeda').value;

  if (!ticker || !tipo || quantidade <= 0 || preco <= 0) {
    erroEl.textContent = 'Preencha ticker, tipo, quantidade e preço médio.';
    return;
  }

  const btn = document.getElementById('btn-salvar-form');
  btn.disabled = true;
  btn.textContent = 'Salvando...';

  const { error } = await supabase.from('investments').update({
    ticker, nome, tipo, moeda, quantidade, preco_medio: preco, cotacao_atual: preco,
  }).eq('id', id).eq('user_id', usuarioAtual.id);

  if (error) {
    erroEl.textContent = 'Não foi possível salvar. Tente novamente.';
    btn.disabled = false;
    btn.textContent = 'Salvar';
    return;
  }

  document.getElementById('sheet-form').hidden = true;
  await carregarAtivos(usuarioAtual.id);
  await recarregarTudo();
}

// ── Sheet: histórico de proventos ──
async function abrirSheetListaProventos() {
  const container = document.getElementById('lista-proventos-itens');
  container.innerHTML = '<div class="conta-vazia">Carregando...</div>';
  document.getElementById('sheet-lista-proventos').hidden = false;

  if (dividendos.length === 0) {
    container.innerHTML = '<div class="conta-vazia">Nenhum provento registrado ainda.</div>';
    return;
  }

  container.innerHTML = dividendos.map((d) => {
    const conta = todasContas.find((c) => c.id === d.account_id);
    return `
      <button type="button" class="posicao-item" data-id="${d.id}">
        <div class="posicao-icone">${escapeHtml((d.ticker || '?').slice(0, 4))}</div>
        <div class="posicao-info">
          <div class="posicao-ticker">${escapeHtml(d.ticker)}</div>
          <div class="posicao-detalhe">${tipoProventoLabel(d.tipo)} · ${escapeHtml(conta?.nome ?? '-')} · ${fmtDataCurta(d.data_pagamento)}</div>
        </div>
        <div class="posicao-valores">
          <div class="posicao-valor valor-sensivel positivo">+${fmt.format(d.valor_total)}</div>
        </div>
      </button>
    `;
  }).join('');

  container.querySelectorAll('.posicao-item').forEach((el) => {
    const dividendo = dividendos.find((d) => d.id === el.dataset.id);
    if (dividendo) el.addEventListener('click', () => confirmarExclusaoProvento(dividendo));
  });
}

function tipoProventoLabel(t) {
  return TIPOS_PROVENTO.find((o) => o.valor === t)?.texto ?? t ?? '-';
}

function fmtDataCurta(iso) {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y.slice(2)}`;
}

function confirmarExclusaoProvento(dividendo) {
  const conteudo = document.getElementById('sheet-acao-provento-conteudo');
  conteudo.innerHTML = `
    <div class="sheet-titulo">Excluir provento de ${escapeHtml(dividendo.ticker)}?</div>
    <div style="font-size:13px;color:var(--muted);text-align:center;margin-top:-8px;">Remove só o registro aqui — não estorna o saldo já creditado na conta.</div>
    <button type="button" class="sheet-acao-btn perigo" id="btn-confirmar-excluir-provento">Excluir</button>
    <button type="button" class="sheet-acao-btn" id="btn-cancelar-acao-provento">Cancelar</button>
  `;
  document.getElementById('btn-confirmar-excluir-provento').addEventListener('click', async () => {
    const btn = document.getElementById('btn-confirmar-excluir-provento');
    btn.disabled = true;
    btn.textContent = 'Excluindo...';
    const { error } = await supabase.from('dividends').delete().eq('id', dividendo.id).eq('user_id', usuarioAtual.id);
    if (error) { btn.disabled = false; btn.textContent = 'Excluir'; return; }
    document.getElementById('sheet-acao-provento').hidden = true;
    await carregarDividendos(usuarioAtual.id);
    renderProventosMiniKpis(calcularKpisProventos());
    await abrirSheetListaProventos();
  });
  document.getElementById('btn-cancelar-acao-provento').addEventListener('click', () => { document.getElementById('sheet-acao-provento').hidden = true; });
  document.getElementById('sheet-acao-provento').hidden = false;
}

// ── Sheet: registrar provento ──
function abrirSheetFormDividendo() {
  const conteudo = document.getElementById('sheet-form-conteudo');
  conteudo.innerHTML = `
    <div class="sheet-titulo">Registrar provento</div>
    ${campoSelect('f-div-ativo', 'Ativo', [{ valor: '', texto: 'Selecione o ativo' }, ...ativos.map((a) => ({ valor: a.id, texto: a.ticker }))], '')}
    ${campoSelect('f-div-tipo', 'Tipo', TIPOS_PROVENTO, 'dividendo')}
    <div class="form-linha">
      ${campoTexto('f-div-valor-cota', 'Valor por cota', '', '0,00')}
      ${campoTexto('f-div-qtd-cotas', 'Qtd cotas na data', '', 'Preenchido automaticamente')}
    </div>
    ${campoSelect('f-div-moeda', 'Moeda do recebimento', [{ valor: 'BRL', texto: 'BRL — Real' }, { valor: 'USD', texto: 'USD — Dólar' }], 'BRL')}
    ${campoTexto('f-div-valor-total', 'Ou valor total recebido', '', '0,00')}
    ${campoSelect('f-div-conta', 'Conta de destino', [{ valor: '', texto: 'Selecione a conta' }, ...todasContas.map((c) => ({ valor: c.id, texto: c.nome }))], '')}
    <div class="form-linha">
      <div class="field"><label for="f-div-data">Data de pagamento</label><input type="date" id="f-div-data" value="${hojeISO()}"></div>
    </div>
    ${campoTexto('f-div-obs', 'Observação (opcional)', '', '')}
    <div class="error-msg" id="erro-form"></div>
    <button type="button" class="btn-primary" id="btn-salvar-form">Registrar provento</button>
    <button type="button" class="sheet-acao-btn" id="btn-cancelar-form">Cancelar</button>
  `;

  document.getElementById('f-div-ativo').addEventListener('change', (e) => {
    const ativo = ativos.find((a) => a.id === e.target.value);
    if (ativo) document.getElementById('f-div-qtd-cotas').value = String(ativo.quantidade).replace('.', ',');
  });
  document.getElementById('btn-cancelar-form').addEventListener('click', () => { document.getElementById('sheet-form').hidden = true; });
  document.getElementById('btn-salvar-form').addEventListener('click', salvarDividendo);
  document.getElementById('sheet-form').hidden = false;
}

async function salvarDividendo() {
  const erroEl = document.getElementById('erro-form');
  erroEl.textContent = '';

  const ativoId = document.getElementById('f-div-ativo').value;
  const tipo = document.getElementById('f-div-tipo').value;
  const valorCota = lerValorMonetario(document.getElementById('f-div-valor-cota').value);
  const qtdCotas = lerValorMonetario(document.getElementById('f-div-qtd-cotas').value);
  const moedaDiv = document.getElementById('f-div-moeda').value;
  const valorTotalInformado = lerValorMonetario(document.getElementById('f-div-valor-total').value);
  const contaId = document.getElementById('f-div-conta').value;
  const dataPag = document.getElementById('f-div-data').value || hojeISO();
  const obs = document.getElementById('f-div-obs').value.trim();

  const valorTotalMoeda = valorTotalInformado || valorCota * qtdCotas;

  if (!ativoId || !tipo || !valorTotalMoeda || !contaId) {
    erroEl.textContent = 'Preencha ativo, tipo, valor e conta.';
    return;
  }

  const ativo = ativos.find((a) => a.id === ativoId);
  const conta = todasContas.find((c) => c.id === contaId);
  if (!ativo || !conta) { erroEl.textContent = 'Ativo ou conta não encontrados.'; return; }

  const totalUSD = moedaDiv === 'USD' ? valorTotalMoeda : 0;
  const totalBRL = moedaDiv === 'USD' ? valorTotalMoeda * dolarAtual : valorTotalMoeda;
  const qtd = qtdCotas || Number(ativo.quantidade);
  const valorCotaBRL = qtd > 0 ? totalBRL / qtd : 0;
  const contaMoeda = conta.currency || 'BRL';
  const valorConta = contaMoeda === 'USD' ? totalUSD : totalBRL;

  const btn = document.getElementById('btn-salvar-form');
  btn.disabled = true;
  btn.textContent = 'Registrando...';

  try {
    const { data: divRow, error: erroDiv } = await supabase.from('dividends').insert({
      user_id: usuarioAtual.id, investment_id: ativoId, ticker: ativo.ticker,
      tipo, valor_por_cota: valorCotaBRL, quantidade_cotas: qtd,
      valor_total: totalBRL, account_id: contaId, data_pagamento: dataPag,
      observacao: obs || null,
    }).select('id').single();
    if (erroDiv) throw erroDiv;

    const { error: erroSaldo } = await supabase.rpc('increment_account_balance', { p_account_id: contaId, p_delta: valorConta });
    if (erroSaldo) throw erroSaldo;

    const { data: catInv } = await supabase.from('categories')
      .select('id').eq('user_id', usuarioAtual.id).eq('tipo', 'receita')
      .ilike('nome', 'Investimentos').limit(1).maybeSingle();

    const { data: txRow } = await supabase.from('transactions').insert({
      user_id: usuarioAtual.id, account_id: contaId, category_id: catInv?.id ?? null,
      type: 'receita', amount: valorConta,
      description: `Dividendo ${ativo.ticker} (${tipoProventoLabel(tipo)})`,
      date: dataPag, status: 'pago',
      notes: obs || `Provento de ${ativo.ticker}`,
    }).select('id').single();

    if (txRow?.id) {
      await supabase.from('dividends').update({ transaction_id: txRow.id }).eq('id', divRow.id).eq('user_id', usuarioAtual.id);
    }

    document.getElementById('sheet-form').hidden = true;
    await Promise.all([carregarDividendos(usuarioAtual.id), carregarTodasContas(usuarioAtual.id), carregarContas(usuarioAtual.id)]);
    renderProventosMiniKpis(calcularKpisProventos());
  } catch (err) {
    console.error(err);
    erroEl.textContent = 'Não foi possível salvar. Tente novamente.';
    btn.disabled = false;
    btn.textContent = 'Registrar provento';
  }
}

// ── Sheet: novo lançamento (aporte/venda) ──
let operacaoAtual = 'compra';

function abrirSheetLancamento() {
  operacaoAtual = 'compra';
  const conteudo = document.getElementById('sheet-form-conteudo');
  conteudo.innerHTML = `
    <div class="sheet-titulo">Aportar / Vender</div>
    <div class="toggle-tipo">
      <button type="button" id="btn-op-compra" class="ativo-compra">Compra</button>
      <button type="button" id="btn-op-venda">Venda</button>
    </div>
    ${campoTexto('f-ticker', 'Ticker', '', 'Ex: BBAS3, VOO')}
    ${campoTexto('f-nome', 'Nome (opcional)', '', 'Ex: Banco do Brasil')}
    ${campoSelect('f-tipo', 'Tipo', [{ valor: '', texto: 'Selecione' }, ...TIPOS_ATIVO], '')}
    ${campoSelect('f-corretora', 'Corretora (conta)', [{ valor: '', texto: 'Selecione a conta' }, ...contas.map((c) => ({ valor: c.id, texto: c.nome }))], '')}
    <div class="form-linha">
      ${campoTexto('f-quantidade', 'Quantidade', '', '0')}
      ${campoTexto('f-preco', 'Preço unitário', '', '0,00')}
    </div>
    ${campoTexto('f-valor-total', 'Ou valor total (se não souber o unitário)', '', '0,00')}
    <div class="form-linha">
      ${campoSelect('f-moeda', 'Moeda', [{ valor: 'BRL', texto: 'BRL — Real' }, { valor: 'USD', texto: 'USD — Dólar' }], 'BRL')}
      <div class="field"><label for="f-data">Data</label><input type="date" id="f-data" value="${hojeISO()}"></div>
    </div>
    ${campoTexto('f-obs', 'Observação (opcional)', '', 'Ex: aporte mensal')}
    <div class="error-msg" id="erro-form"></div>
    <button type="button" class="btn-primary" id="btn-salvar-form">Salvar lançamento</button>
    <button type="button" class="sheet-acao-btn" id="btn-cancelar-form">Cancelar</button>
  `;

  document.getElementById('btn-op-compra').addEventListener('click', () => selecionarOperacao('compra'));
  document.getElementById('btn-op-venda').addEventListener('click', () => selecionarOperacao('venda'));
  document.getElementById('btn-cancelar-form').addEventListener('click', () => { document.getElementById('sheet-form').hidden = true; });
  document.getElementById('btn-salvar-form').addEventListener('click', salvarLancamento);
  document.getElementById('sheet-form').hidden = false;
}

function selecionarOperacao(op) {
  operacaoAtual = op;
  document.getElementById('btn-op-compra').classList.toggle('ativo-compra', op === 'compra');
  document.getElementById('btn-op-venda').classList.toggle('ativo-venda', op === 'venda');
}

async function salvarLancamento() {
  const erroEl = document.getElementById('erro-form');
  erroEl.textContent = '';

  const ticker = document.getElementById('f-ticker').value.trim().toUpperCase();
  const nome = document.getElementById('f-nome').value.trim();
  const tipo = document.getElementById('f-tipo').value;
  const contaId = document.getElementById('f-corretora').value;
  const quantidade = lerValorMonetario(document.getElementById('f-quantidade').value);
  let preco = lerValorMonetario(document.getElementById('f-preco').value);
  const valorTotalInformado = lerValorMonetario(document.getElementById('f-valor-total').value);
  const moeda = document.getElementById('f-moeda').value;
  const data = document.getElementById('f-data').value || hojeISO();
  const obs = document.getElementById('f-obs').value.trim();

  if (!preco && valorTotalInformado && quantidade) preco = valorTotalInformado / quantidade;
  const valorTotal = valorTotalInformado || quantidade * preco;

  if (!ticker || !tipo || !contaId || !quantidade || !preco) {
    erroEl.textContent = 'Preencha ticker, tipo, corretora, quantidade e preço (ou valor total).';
    return;
  }

  const conta = contas.find((c) => c.id === contaId);
  if (!conta) { erroEl.textContent = 'Conta não encontrada.'; return; }

  if (operacaoAtual === 'compra' && Number(conta.saldo_atual) < valorTotal) {
    erroEl.textContent = `Saldo insuficiente na conta (${fmt.format(conta.saldo_atual || 0)}).`;
    return;
  }

  const btn = document.getElementById('btn-salvar-form');
  btn.disabled = true;
  btn.textContent = 'Salvando...';

  try {
    const existing = ativos.find((a) => a.ticker === ticker && (a.moeda || 'BRL') === moeda);
    let investmentId;

    if (operacaoAtual === 'compra') {
      if (existing) {
        const novaQtd = Number(existing.quantidade) + quantidade;
        const novoPM = (Number(existing.quantidade) * Number(existing.preco_medio) + quantidade * preco) / novaQtd;
        const { error } = await supabase.from('investments').update({
          nome: nome || existing.nome, tipo, quantidade: novaQtd, preco_medio: novoPM,
        }).eq('id', existing.id).eq('user_id', usuarioAtual.id);
        if (error) throw error;
        investmentId = existing.id;
      } else {
        const { data: novo, error } = await supabase.from('investments').insert({
          user_id: usuarioAtual.id, ticker, nome, tipo, moeda,
          quantidade, preco_medio: preco, cotacao_atual: preco,
          corretora: conta.nome, exchange_rate: moeda === 'USD' ? dolarAtual : null, ativo: true,
        }).select('id').single();
        if (error) throw error;
        investmentId = novo.id;
      }
    } else {
      if (!existing) { erroEl.textContent = `Você não possui ${ticker} para vender.`; btn.disabled = false; btn.textContent = 'Salvar lançamento'; return; }
      const novaQtd = Number(existing.quantidade) - quantidade;
      if (novaQtd <= 0) {
        const { error } = await supabase.from('investments').update({ ativo: false }).eq('id', existing.id).eq('user_id', usuarioAtual.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('investments').update({ quantidade: novaQtd }).eq('id', existing.id).eq('user_id', usuarioAtual.id);
        if (error) throw error;
      }
      investmentId = existing.id;
    }

    const { error: erroTx } = await supabase.from('investment_transactions').insert({
      user_id: usuarioAtual.id, investment_id: investmentId, ticker, tipo,
      tipo_movimento: operacaoAtual, quantidade,
      preco_unitario: preco, preco, valor_total: valorTotal,
      moeda, account_id: contaId,
      exchange_rate: moeda === 'USD' ? dolarAtual : null,
      data_movimento: data, observacao: obs,
    });
    if (erroTx) throw erroTx;

    const { error: erroSaldo } = await supabase.rpc('increment_account_balance', {
      p_account_id: contaId,
      p_delta: operacaoAtual === 'compra' ? -valorTotal : valorTotal,
    });
    if (erroSaldo) throw erroSaldo;

    const categoriaLabel = operacaoAtual === 'compra' ? 'Compra' : 'Venda';
    await supabase.from('transactions').insert({
      user_id: usuarioAtual.id, account_id: contaId,
      type: operacaoAtual === 'compra' ? 'despesa' : 'receita',
      amount: valorTotal,
      description: `${categoriaLabel} ${ticker} (${quantidade}x ${fmt.format(preco)})`,
      date: data, status: 'pago',
      notes: obs || `${tipoLabel(tipo)} via ${conta.nome}`,
    });

    document.getElementById('sheet-form').hidden = true;
    await Promise.all([carregarAtivos(usuarioAtual.id), carregarContas(usuarioAtual.id)]);
    await recarregarTudo();
  } catch (err) {
    console.error(err);
    erroEl.textContent = 'Não foi possível salvar. Tente novamente.';
    btn.disabled = false;
    btn.textContent = 'Salvar lançamento';
  }
}

async function init() {
  configurarBotaoSair();
  configurarBotaoPrivacidade('btn-privacidade');

  const user = await requireAuth();
  if (!user) return;
  usuarioAtual = user;

  document.getElementById('btn-novo-lancamento').addEventListener('click', (e) => { e.preventDefault(); abrirSheetLancamento(); });
  document.getElementById('btn-novo-provento').addEventListener('click', abrirSheetFormDividendo);
  document.getElementById('btn-ver-proventos').addEventListener('click', abrirSheetListaProventos);

  const sheetForm = document.getElementById('sheet-form');
  sheetForm.addEventListener('click', (e) => { if (e.target === sheetForm) sheetForm.hidden = true; });
  ativarArrastarParaFechar(sheetForm);

  const sheetAcaoPosicao = document.getElementById('sheet-acao-posicao');
  sheetAcaoPosicao.addEventListener('click', (e) => { if (e.target === sheetAcaoPosicao) fecharSheetAcaoPosicao(); });
  ativarArrastarParaFechar(sheetAcaoPosicao);

  const sheetListaProventos = document.getElementById('sheet-lista-proventos');
  sheetListaProventos.addEventListener('click', (e) => { if (e.target === sheetListaProventos) sheetListaProventos.hidden = true; });
  ativarArrastarParaFechar(sheetListaProventos);

  const sheetAcaoProvento = document.getElementById('sheet-acao-provento');
  sheetAcaoProvento.addEventListener('click', (e) => { if (e.target === sheetAcaoProvento) sheetAcaoProvento.hidden = true; });
  ativarArrastarParaFechar(sheetAcaoProvento);

  try {
    await carregarDolar(user.id);
    await Promise.all([carregarContas(user.id), carregarTodasContas(user.id), carregarAtivos(user.id)]);
    await recarregarTudo();
  } catch (err) {
    console.error(err);
    document.getElementById('lista-posicoes').innerHTML = '<div class="conta-vazia">Não foi possível carregar os investimentos.</div>';
  }
}

init();
