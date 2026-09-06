import { supabase, requireAuth, configurarBotaoSair } from './supabaseClient.js';
import { configurarBotaoPrivacidade } from './privacidade.js?v=2';
import { montarNavInferior } from './navInferior.js?v=3';
import { loadChart } from './loadChart.js';

const fmt = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtDataCurta = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short' });

let usuarioAtual = null;
let horizonteDias = 30;
let chartProjecao = null;

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}

function hojeISO() {
  const hoje = new Date();
  return new Date(hoje.getTime() - hoje.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

function dataAdicionar(iso, dias) {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + dias);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

function fmtData(iso) {
  return fmtDataCurta.format(new Date(iso + 'T00:00:00')).replace('.', '');
}

async function carregarSaldoInicial(userId) {
  const { data, error } = await supabase
    .from('accounts')
    .select('saldo_atual')
    .eq('user_id', userId)
    .eq('active', true)
    .eq('account_kind', 'bank');
  if (error) throw error;
  return (data ?? []).reduce((s, c) => s + Number(c.saldo_atual || 0), 0);
}

async function carregarLancamentosPendentes(userId, inicio, fim) {
  const { data, error } = await supabase
    .from('transactions')
    .select('date, type, amount, description, is_recurring')
    .eq('user_id', userId)
    .eq('status', 'pendente')
    .gte('date', inicio)
    .lte('date', fim)
    .order('date');
  if (error) throw error;
  return (data ?? []).map((t) => ({
    data: t.date,
    valor: t.type === 'receita' ? Number(t.amount) : -Number(t.amount),
    nome: t.description || (t.type === 'receita' ? 'Receita' : 'Despesa'),
    recorrente: !!t.is_recurring,
    tipo: 'lancamento',
  }));
}

async function carregarFaturasFuturas(userId, inicio, fim) {
  const { data: cartoes, error: erroCartoes } = await supabase
    .from('credit_cards')
    .select('id, nome, vencimento_dia')
    .eq('user_id', userId)
    .eq('ativo', true);
  if (erroCartoes) throw erroCartoes;
  if (!cartoes?.length) return [];

  const { data: compras, error: erroCompras } = await supabase
    .from('card_transactions')
    .select('card_id, valor_parcela, fatura_referencia')
    .eq('user_id', userId)
    .eq('status', 'aberta');
  if (erroCompras) throw erroCompras;

  const totaisPorFatura = {};
  (compras ?? []).forEach((c) => {
    const chave = `${c.card_id}|${c.fatura_referencia}`;
    totaisPorFatura[chave] = (totaisPorFatura[chave] || 0) + Number(c.valor_parcela || 0);
  });

  const eventos = [];
  Object.entries(totaisPorFatura).forEach(([chave, total]) => {
    const [cardId, ref] = chave.split('|');
    const cartao = cartoes.find((c) => c.id === cardId);
    if (!cartao || !cartao.vencimento_dia) return;
    const dataVenc = `${ref}-${String(cartao.vencimento_dia).padStart(2, '0')}`;
    if (dataVenc < inicio || dataVenc > fim) return;
    eventos.push({ data: dataVenc, valor: -total, nome: `Fatura ${cartao.nome}`, tipo: 'fatura' });
  });
  return eventos;
}

function renderProjecao({ saldoInicial, eventos, hoje, fim }) {
  let saldo = saldoInicial;
  let menorSaldo = saldoInicial;
  let menorData = hoje;

  eventos.forEach((ev) => {
    saldo += ev.valor;
    ev.saldoApos = saldo;
    if (saldo < menorSaldo) { menorSaldo = saldo; menorData = ev.data; }
  });

  const saldoFinal = saldo;
  const painel = document.getElementById('painel-projecao');
  const eventoNegativo = eventos.find((ev) => ev.saldoApos < 0);

  painel.classList.toggle('critico', menorSaldo < 0);
  document.getElementById('projecao-titulo').textContent = menorSaldo >= 0
    ? `Aguenta os ${horizonteDias} dias`
    : `Fica no vermelho em ${eventoNegativo ? Math.max(1, Math.round((new Date(eventoNegativo.data) - new Date(hoje)) / 86400000)) : '?'} dias`;
  document.getElementById('projecao-sub').textContent = `Menor folga ${fmt.format(menorSaldo)} em ${fmtData(menorData)}`;

  document.getElementById('menor-folga-valor').textContent = fmt.format(menorSaldo);
  document.getElementById('menor-folga-valor').style.color = menorSaldo < 0 ? '#ffb4a8' : '';
  document.getElementById('menor-folga-data').textContent = fmtData(menorData);
  document.getElementById('saldo-final-valor').textContent = fmt.format(saldoFinal);
  document.getElementById('saldo-final-data').textContent = fmtData(fim);

  document.getElementById('eventos-titulo').textContent = `O que acontece até ${fmtData(fim)}`;

  const listaEl = document.getElementById('lista-eventos');
  if (eventos.length === 0) {
    listaEl.innerHTML = '<div class="conta-vazia">Nada agendado nesse período — o saldo permanece o mesmo.</div>';
  } else {
    listaEl.innerHTML = eventos.map((ev) => `
      <div class="evento-item">
        <div class="evento-ponto" style="background:${ev.valor >= 0 ? 'var(--success)' : 'var(--danger)'}"></div>
        <div class="evento-info">
          <div class="evento-nome">${escapeHtml(ev.nome)}</div>
          <div class="evento-data">${fmtData(ev.data)}${ev.recorrente ? ' · recorrente' : ev.tipo === 'fatura' ? ' · fatura' : ''}</div>
        </div>
        <div class="evento-direita">
          <div class="evento-valor ${ev.valor >= 0 ? 'positivo' : 'negativo'}">${ev.valor >= 0 ? '+' : ''}${fmt.format(ev.valor)}</div>
          <div class="evento-saldo">${fmt.format(ev.saldoApos)}</div>
        </div>
      </div>
    `).join('');
  }

  renderGrafico(saldoInicial, eventos, hoje);
}

async function renderGrafico(saldoInicial, eventos, hoje) {
  const labels = [fmtData(hoje), ...eventos.map((ev) => fmtData(ev.data))];
  const pontos = [saldoInicial, ...eventos.map((ev) => ev.saldoApos)];

  try {
    const Chart = await loadChart();
    if (chartProjecao) { chartProjecao.destroy(); chartProjecao = null; }
    const minY = Math.min(0, ...pontos);
    chartProjecao = new Chart(document.getElementById('chart-projecao'), {
      type: 'line',
      data: {
        labels,
        datasets: [{
          data: pontos,
          borderColor: '#ffffff',
          backgroundColor: 'rgba(255,255,255,0.15)',
          borderWidth: 2,
          stepped: true,
          fill: true,
          pointRadius: (ctx) => (ctx.dataIndex === 0 ? 4 : 0),
          pointBackgroundColor: '#ffffff',
        }],
      },
      options: {
        maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: (ctx) => ' ' + fmt.format(ctx.raw) } } },
        scales: {
          x: { grid: { display: false }, ticks: { color: 'rgba(255,255,255,0.75)', font: { size: 9 }, autoSkip: true, maxTicksLimit: 4 } },
          y: { display: false, min: minY },
        },
      },
    });
  } catch (err) { console.error(err); }
}

async function carregarTudo() {
  const hoje = hojeISO();
  const fim = dataAdicionar(hoje, horizonteDias);
  const inicio = dataAdicionar(hoje, 1);

  document.getElementById('lista-eventos').innerHTML = '<div class="conta-vazia">Carregando...</div>';

  try {
    const [saldoInicial, lancamentos, faturas] = await Promise.all([
      carregarSaldoInicial(usuarioAtual.id),
      carregarLancamentosPendentes(usuarioAtual.id, inicio, fim),
      carregarFaturasFuturas(usuarioAtual.id, inicio, fim),
    ]);

    const eventos = [...lancamentos, ...faturas].sort((a, b) => a.data.localeCompare(b.data));
    renderProjecao({ saldoInicial, eventos, hoje, fim });
  } catch (err) {
    console.error(err);
    document.getElementById('lista-eventos').innerHTML = '<div class="conta-vazia">Não foi possível calcular a projeção.</div>';
  }
}

function selecionarHorizonte(dias) {
  horizonteDias = dias;
  document.querySelectorAll('.tab-horizonte').forEach((btn) => {
    btn.classList.toggle('ativo', Number(btn.dataset.dias) === dias);
  });
  carregarTudo();
}

async function init() {
  montarNavInferior('projecao');
  configurarBotaoSair();
  configurarBotaoPrivacidade('btn-privacidade');

  const user = await requireAuth();
  if (!user) return;
  usuarioAtual = user;

  document.querySelectorAll('.tab-horizonte').forEach((btn) => {
    btn.addEventListener('click', () => selecionarHorizonte(Number(btn.dataset.dias)));
  });

  await carregarTudo();
}

init();
