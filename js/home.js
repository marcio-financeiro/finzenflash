import { supabase, requireAuth } from './supabaseClient.js';

const fmt = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtDia = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'long' });

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

async function carregarLancamentos(userId) {
  const { data, error } = await supabase
    .from('transactions')
    .select('id, type, amount, description, date, accounts(nome)')
    .eq('user_id', userId)
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

async function init() {
  const user = await requireAuth();
  if (!user) return;

  try {
    const [contas, lancamentos] = await Promise.all([
      carregarContas(user.id),
      carregarLancamentos(user.id),
    ]);

    const saldoTotal = contas.reduce((soma, c) => soma + Number(c.saldo_atual), 0);
    document.getElementById('saldo-total').textContent = fmt.format(saldoTotal);

    renderContas(contas);
    renderLancamentos(lancamentos);
  } catch (err) {
    console.error(err);
    document.getElementById('lista-lancamentos').innerHTML =
      '<div class="conta-vazia">Não foi possível carregar seus dados. Puxe pra atualizar.</div>';
  }
}

document.getElementById('btn-sair').addEventListener('click', async () => {
  await supabase.auth.signOut();
  window.location.href = '/index.html';
});

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
