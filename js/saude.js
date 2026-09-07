import { supabase, requireAuth, configurarBotaoSair } from './supabaseClient.js';
import { aplicarTemaSalvo } from './temaService.js?v=3';
import { montarNavInferior } from './navInferior.js?v=5';

const fmtData = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });

let usuarioAtual = null;

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

function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

// ── Coleta de dados ───────────────────────────────────────────────────────
async function coletarDados(userId) {
  const hoje = new Date();
  const mesAtual = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}`;
  const inicio = inicioMes(mesAtual);
  const fim = hojeISO();
  const mes3Atras = mesAdicionar(mesAtual, -3);

  const [
    { data: contas },
    { data: txMes },
    { data: cardTxMes },
    { data: txHist },
    { data: cartoes },
    { data: cardTxAbertas },
    { data: budgets },
  ] = await Promise.all([
    supabase.from('accounts').select('saldo_atual').eq('user_id', userId).eq('active', true).eq('account_kind', 'bank'),
    supabase.from('transactions').select('type,amount,date,category_id').eq('user_id', userId)
      .eq('status', 'pago').gte('date', inicio).lte('date', fim),
    supabase.from('card_transactions').select('valor_parcela,category_id').eq('user_id', userId).eq('fatura_referencia', mesAtual),
    supabase.from('transactions').select('type,amount,date').eq('user_id', userId)
      .eq('status', 'pago').eq('type', 'despesa').gte('date', inicioMes(mes3Atras)).lte('date', fimMes(mesAdicionar(mesAtual, -1))),
    supabase.from('credit_cards').select('id,limite').eq('user_id', userId).eq('ativo', true),
    supabase.from('card_transactions').select('card_id,valor_parcela').eq('user_id', userId).eq('status', 'aberta'),
    supabase.from('budgets').select('category_id,valor_planejado').eq('user_id', userId).eq('mes_referencia', mesAtual),
  ]);

  return {
    mesAtual, hoje,
    contas: contas ?? [],
    txMes: txMes ?? [],
    cardTxMes: cardTxMes ?? [],
    txHist: txHist ?? [],
    cartoes: cartoes ?? [],
    cardTxAbertas: cardTxAbertas ?? [],
    budgets: budgets ?? [],
  };
}

// ── Cálculo das 6 sub-métricas ────────────────────────────────────────────
function calcularMetricas(dados) {
  const { contas, txMes, cardTxMes, txHist, cartoes, cardTxAbertas, budgets, hoje } = dados;

  const receitasMes = txMes.filter((t) => t.type === 'receita').reduce((s, t) => s + Number(t.amount || 0), 0);
  const despesasTx = txMes.filter((t) => t.type === 'despesa').reduce((s, t) => s + Number(t.amount || 0), 0);
  const despesasCard = cardTxMes.reduce((s, c) => s + Number(c.valor_parcela || 0), 0);
  const despesasMes = despesasTx + despesasCard;

  // 1) Poupança
  const taxaPoupanca = receitasMes > 0 ? ((receitasMes - despesasMes) / receitasMes) * 100 : 0;
  const poupanca = { nome: 'Poupança', nota: Math.round(clamp((taxaPoupanca / 20) * 100, 0, 100)), desc: `Taxa de poupança em ${taxaPoupanca.toFixed(1)}% (referência: 20%).` };

  // 2) Reserva — saldo em conta ÷ média de despesa mensal (últimos 3 meses)
  const saldoContas = contas.reduce((s, c) => s + Number(c.saldo_atual || 0), 0);
  const porMes = {};
  txHist.forEach((t) => { const m = t.date.slice(0, 7); porMes[m] = (porMes[m] || 0) + Number(t.amount || 0); });
  const mesesComDado = Object.keys(porMes).length;
  const mediaDespesa = mesesComDado > 0 ? Object.values(porMes).reduce((s, v) => s + v, 0) / mesesComDado : despesasMes;
  const mesesCobertura = mediaDespesa > 0 ? saldoContas / mediaDespesa : (saldoContas > 0 ? 3 : 0);
  const reserva = { nome: 'Reserva', nota: Math.round(clamp((mesesCobertura / 3) * 100, 0, 100)), desc: `Cobre ${mesesCobertura.toFixed(1)} meses de despesas (alvo: 3 a 6).` };

  // 3) Dívidas — uso agregado do limite do cartão
  const limiteTotal = cartoes.reduce((s, c) => s + Number(c.limite || 0), 0);
  const usadoTotal = cardTxAbertas.reduce((s, c) => s + Number(c.valor_parcela || 0), 0);
  const pctUso = limiteTotal > 0 ? (usadoTotal / limiteTotal) * 100 : 0;
  const dividas = { nome: 'Dívidas', nota: Math.round(clamp(100 - pctUso, 0, 100)), desc: cartoes.length ? `Uso do cartão em ${pctUso.toFixed(0)}% do limite.` : 'Sem cartões cadastrados.' };

  // 4) Orçamento — % das categorias orçadas que não estouraram
  const gastosPorCategoria = {};
  txMes.filter((t) => t.type === 'despesa').forEach((t) => { if (t.category_id) gastosPorCategoria[t.category_id] = (gastosPorCategoria[t.category_id] || 0) + Number(t.amount || 0); });
  cardTxMes.forEach((c) => { if (c.category_id) gastosPorCategoria[c.category_id] = (gastosPorCategoria[c.category_id] || 0) + Number(c.valor_parcela || 0); });
  const dentroDoLimite = budgets.filter((b) => (gastosPorCategoria[b.category_id] || 0) <= Number(b.valor_planejado || 0)).length;
  const orcamento = budgets.length > 0
    ? { nome: 'Orçamento', nota: Math.round((dentroDoLimite / budgets.length) * 100), desc: `${dentroDoLimite}/${budgets.length} orçamentos dentro do limite.` }
    : { nome: 'Orçamento', nota: 100, desc: 'Nenhum orçamento cadastrado este mês.' };

  // 5) Regularidade — % dos dias do mês (até hoje) com lançamento
  const diasComLancamento = new Set([...txMes.map((t) => t.date)]).size;
  const diasPassados = hoje.getDate();
  const regularidade = { nome: 'Regularidade', nota: Math.round(clamp((diasComLancamento / diasPassados) * 100, 0, 100)), desc: `Lançamentos em ${Math.round((diasComLancamento / diasPassados) * 100)}% dos dias do mês.` };

  // 6) Fontes de renda — categorias de receita distintas usadas no mês
  const fontesReceita = new Set(txMes.filter((t) => t.type === 'receita' && t.category_id).map((t) => t.category_id)).size;
  const fontes = { nome: 'Fontes de renda', nota: Math.round(clamp((fontesReceita / 3) * 100, 0, 100)), desc: `${fontesReceita} fonte(s) de renda registrada(s).` };

  const metricas = [poupanca, reserva, dividas, orcamento, regularidade, fontes];
  const score = Math.round(metricas.reduce((s, m) => s + m.nota, 0) / metricas.length);

  return { score, metricas, taxaPoupanca, pctUso, mesesCobertura, receitasMes, despesasMes };
}

function classificacao(score) {
  if (score >= 80) return { label: 'Excelente', classe: 'excelente' };
  if (score >= 60) return { label: 'Bom', classe: 'bom' };
  if (score >= 40) return { label: 'Regular', classe: 'regular' };
  return { label: 'Precisa de atenção', classe: 'atencao' };
}

function corNota(nota) {
  if (nota >= 80) return 'var(--success)';
  if (nota >= 60) return 'var(--accent)';
  if (nota >= 40) return '#c9963f';
  return 'var(--danger)';
}

function renderTudo({ score, metricas, taxaPoupanca, pctUso, mesesCobertura, receitasMes, despesasMes }) {
  const cls = classificacao(score);
  document.getElementById('score-numero').innerHTML = `${score} <span>/100</span>`;
  const badge = document.getElementById('score-badge');
  badge.className = `score-badge ${cls.classe}`;
  badge.textContent = cls.label;
  document.getElementById('score-data').textContent = `Analisado em ${fmtData.format(new Date())}`;

  document.getElementById('lista-metricas').innerHTML = metricas.map((m) => `
    <div class="metrica">
      <div class="metrica-linha">
        <div class="metrica-nome">${m.nome}</div>
        <div class="metrica-nota" style="color:${corNota(m.nota)}">${m.nota}</div>
      </div>
      <div class="metrica-barra"><div class="metrica-barra-fill" style="width:${m.nota}%;background:${corNota(m.nota)}"></div></div>
      <div class="metrica-desc">${m.desc}</div>
    </div>
  `).join('');

  const resultado = receitasMes - despesasMes;
  document.getElementById('analise-texto').textContent =
    `Sua saúde financeira ficou em ${score}/100 este mês. A taxa de poupança está em ${taxaPoupanca.toFixed(1)}%, ` +
    `${resultado >= 0 ? 'com resultado positivo' : 'com resultado negativo'} no período. ` +
    `O saldo em conta cobre cerca de ${mesesCobertura.toFixed(1)} meses de despesas` +
    (pctUso > 0 ? `, e o uso agregado do cartão está em ${pctUso.toFixed(0)}% do limite.` : '.');
}

async function init() {
  aplicarTemaSalvo();
  montarNavInferior('saude');
  configurarBotaoSair();

  const user = await requireAuth();
  if (!user) return;
  usuarioAtual = user;

  try {
    const dados = await coletarDados(usuarioAtual.id);
    const resultado = calcularMetricas(dados);
    renderTudo(resultado);
  } catch (err) {
    console.error(err);
    document.getElementById('lista-metricas').innerHTML = '<div class="conta-vazia">Não foi possível calcular seu score agora.</div>';
  }
}

init();
