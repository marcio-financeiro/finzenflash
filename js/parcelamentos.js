import { supabase, requireAuth, configurarBotaoSair } from './supabaseClient.js';
import { aplicarTemaSalvo } from './temaService.js?v=3';
import { configurarBotaoPrivacidade } from './privacidade.js?v=2';
import { addMonthsRef } from './cardService.js';
import { montarNavInferior } from './navInferior.js?v=6';

const fmt = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtMesAno = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' });
const fmtDataCurta = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });

let usuarioAtual = null;
let grupos = [];
let cartaoFiltro = '';
let mostrarQuitadas = false;
let abertos = new Set();

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}

function rotuloMes(ref) {
  const [y, m] = ref.split('-').map(Number);
  const data = new Date(y, m - 1, 1);
  return fmtMesAno.format(data).replace(/^\w/, (c) => c.toUpperCase());
}

function mesAtualRef() {
  const hoje = new Date();
  return `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}`;
}

async function carregarCartoes(userId) {
  const { data, error } = await supabase
    .from('credit_cards')
    .select('id, nome')
    .eq('user_id', userId)
    .eq('ativo', true)
    .order('sort_order');
  if (error) throw error;
  const select = document.getElementById('filtro-cartao');
  select.innerHTML = '<option value="">Todos os cartões</option>' + (data ?? []).map((c) => `<option value="${c.id}">${escapeHtml(c.nome)}</option>`).join('');
}

function chaveGrupo(row) {
  return row.purchase_group_id || `${row.card_id}|${row.parcelas}|${row.valor_total}|${row.data_compra}|${row.descricao}`;
}

async function carregarParcelamentos(userId) {
  const { data, error } = await supabase
    .from('card_transactions')
    .select('id, card_id, descricao, valor_total, valor_parcela, parcelas, parcela_atual, fatura_referencia, status, data_compra, purchase_group_id, credit_cards(nome)')
    .eq('user_id', userId)
    .gt('parcelas', 1)
    .order('data_compra', { ascending: false });
  if (error) throw error;

  const mapa = new Map();
  for (const row of data ?? []) {
    const chave = chaveGrupo(row);
    if (!mapa.has(chave)) mapa.set(chave, []);
    mapa.get(chave).push(row);
  }

  const resultado = [];
  for (const [chave, itens] of mapa) {
    itens.sort((a, b) => a.parcela_atual - b.parcela_atual);
    const abertas = itens.filter((i) => i.status !== 'paga');
    const pagas = itens.length - abertas.length;
    const quitada = abertas.length === 0;
    const proxima = abertas[0] ?? null;
    const original = itens[0];
    resultado.push({
      chave,
      cardId: original.card_id,
      cardNome: original.credit_cards?.nome ?? '',
      descricao: original.descricao,
      valorTotal: Number(original.valor_total),
      valorParcela: Number(original.valor_parcela),
      parcelas: original.parcelas,
      dataCompra: original.data_compra,
      pagas,
      quitada,
      proxima,
      itens,
    });
  }

  resultado.sort((a, b) => {
    if (a.quitada !== b.quitada) return a.quitada ? 1 : -1;
    const refA = a.proxima?.fatura_referencia ?? '9999-99';
    const refB = b.proxima?.fatura_referencia ?? '9999-99';
    return refA < refB ? -1 : refA > refB ? 1 : 0;
  });

  return resultado;
}

function gruposFiltrados() {
  return grupos.filter((g) => {
    if (cartaoFiltro && g.cardId !== cartaoFiltro) return false;
    if (!mostrarQuitadas && g.quitada) return false;
    return true;
  });
}

function renderResumo(lista) {
  const emAndamento = lista.filter((g) => !g.quitada);
  const restante = emAndamento.reduce((soma, g) => soma + g.itens.filter((i) => i.status !== 'paga').reduce((s, i) => s + Number(i.valor_parcela), 0), 0);

  const mesAtual = mesAtualRef();
  const mesProximo = addMonthsRef(mesAtual, 1);
  const comprometidoMes = (ref) => lista.reduce((soma, g) => soma + g.itens.filter((i) => i.status !== 'paga' && i.fatura_referencia === ref).reduce((s, i) => s + Number(i.valor_parcela), 0), 0);

  document.getElementById('resumo-grid').hidden = grupos.length === 0;
  document.getElementById('resumo-restante').textContent = fmt.format(restante);
  document.getElementById('resumo-qtd').textContent = String(emAndamento.length);
  document.getElementById('resumo-mes-atual-rotulo').textContent = `COMPROMETIDO ${rotuloMes(mesAtual).toUpperCase()}`;
  document.getElementById('resumo-mes-atual').textContent = fmt.format(comprometidoMes(mesAtual));
  document.getElementById('resumo-mes-proximo-rotulo').textContent = `COMPROMETIDO ${rotuloMes(mesProximo).toUpperCase()}`;
  document.getElementById('resumo-mes-proximo').textContent = fmt.format(comprometidoMes(mesProximo));
}

function renderLista() {
  const container = document.getElementById('lista-parcelamentos');
  const lista = gruposFiltrados();

  if (lista.length === 0) {
    container.innerHTML = '<div class="conta-vazia">Nenhuma compra parcelada encontrada.</div>';
    return;
  }

  container.innerHTML = lista.map((g) => {
    const pct = Math.round((g.pagas / g.parcelas) * 100);
    const statusTexto = g.quitada ? 'Quitada' : `Próxima: ${rotuloMes(g.proxima.fatura_referencia)}`;
    const aberto = abertos.has(g.chave);
    return `
      <div class="parcela-card" data-chave="${escapeHtml(g.chave)}">
        <div class="parcela-header">
          <div class="parcela-topo">
            <div>
              <div class="parcela-desc">${escapeHtml(g.descricao)}</div>
              <div class="parcela-origem">${escapeHtml(g.cardNome)} · ${fmtDataCurta.format(new Date(g.dataCompra + 'T00:00:00'))}</div>
            </div>
            <div>
              <div class="parcela-total valor-sensivel">${fmt.format(g.valorTotal)}</div>
              <div class="parcela-sub valor-sensivel">${g.pagas}/${g.parcelas} pagas · ${fmt.format(g.valorParcela)}/mês</div>
            </div>
          </div>
          <div class="parcela-barra"><div class="parcela-barra-fill ${g.quitada ? 'quitada' : ''}" style="width:${pct}%"></div></div>
          <div class="parcela-status ${g.quitada ? 'quitada' : 'andamento'}">${statusTexto}</div>
        </div>
        <div class="parcela-detalhe ${aberto ? 'aberto' : ''}">
          ${g.itens.map((i) => `
            <div class="parcela-linha-detalhe">
              <div class="parcela-linha-num">${i.parcela_atual}/${i.parcelas}</div>
              <div class="parcela-linha-fatura">${rotuloMes(i.fatura_referencia)}</div>
              <div class="parcela-linha-valor valor-sensivel">${fmt.format(Number(i.valor_parcela))}</div>
              <div class="parcela-linha-check ${i.status === 'paga' ? 'paga' : 'aberta'}">${i.status === 'paga' ? '✅ Paga' : '⏳ Em aberto'}</div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }).join('');

  container.querySelectorAll('.parcela-header').forEach((header) => {
    header.addEventListener('click', () => {
      const card = header.closest('.parcela-card');
      const chave = card.dataset.chave;
      if (abertos.has(chave)) abertos.delete(chave);
      else abertos.add(chave);
      card.querySelector('.parcela-detalhe').classList.toggle('aberto');
    });
  });
}

async function recarregar() {
  try {
    grupos = await carregarParcelamentos(usuarioAtual.id);
    renderResumo(gruposFiltrados());
    renderLista();
  } catch (err) {
    console.error(err);
    document.getElementById('lista-parcelamentos').innerHTML = '<div class="conta-vazia">Não foi possível carregar os parcelamentos.</div>';
  }
}

async function init() {
  aplicarTemaSalvo();
  montarNavInferior('parcelamentos');
  configurarBotaoSair();
  configurarBotaoPrivacidade('btn-privacidade');

  const user = await requireAuth();
  if (!user) return;
  usuarioAtual = user;

  document.getElementById('filtro-cartao').addEventListener('change', (e) => {
    cartaoFiltro = e.target.value;
    renderResumo(gruposFiltrados());
    renderLista();
  });
  document.getElementById('chk-mostrar-quitadas').addEventListener('change', (e) => {
    mostrarQuitadas = e.target.checked;
    renderLista();
  });

  try {
    await carregarCartoes(user.id);
  } catch (err) {
    console.error(err);
  }
  await recarregar();
}

init();
