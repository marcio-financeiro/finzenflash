import { escapeHtml } from './utils/escapeHtml.js';
// autocompleteService.js — sugestões de descrição baseadas em lançamentos
// anteriores do usuário (transações normais + compras de cartão), pra
// autocompletar o campo Descrição e pré-preencher categoria/conta.
// Porta direta do FinZen original (js/services/autocompleteService.js).

export async function getDescricoesRecentes(supabase, userId) {
  const [{ data: tx }, { data: card }] = await Promise.all([
    supabase.from('transactions')
      .select('description,category_id,account_id,date')
      .eq('user_id', userId)
      .not('description', 'is', null)
      .order('date', { ascending: false })
      .limit(300),
    supabase.from('card_transactions')
      .select('descricao,category_id,data_compra')
      .eq('user_id', userId)
      .eq('parcela_atual', 1)
      .not('descricao', 'is', null)
      .order('data_compra', { ascending: false })
      .limit(300),
  ]);

  const map = new Map();

  (tx || []).forEach((t) => {
    const desc = (t.description || '').trim();
    if (!desc) return;
    const key = desc.toLowerCase();
    if (!map.has(key)) {
      map.set(key, { description: desc, categoryId: t.category_id || null, accountId: t.account_id || null, source: 'conta' });
    }
  });

  (card || []).forEach((c) => {
    const desc = (c.descricao || '').trim();
    if (!desc) return;
    const key = desc.toLowerCase();
    if (!map.has(key)) {
      map.set(key, { description: desc, categoryId: c.category_id || null, accountId: null, source: 'cartao' });
    }
  });

  return Array.from(map.values());
}

/** Popula um <datalist> com as descrições (sem duplicar valores). */
export function popularDatalist(datalistEl, descricoes) {
  if (!datalistEl) return;
  datalistEl.innerHTML = descricoes
    .map((d) => `<option value="${escapeHtml(d.description)}"></option>`)
    .join('');
}

/** Busca a sugestão cujo texto bate exatamente (case-insensitive) com o valor digitado. */
export function encontrarSugestao(descricoes, valorDigitado) {
  const alvo = (valorDigitado || '').trim().toLowerCase();
  if (!alvo) return null;
  return descricoes.find((d) => d.description.toLowerCase() === alvo) || null;
}

// <datalist> não tem suporte real no Safari iOS (não mostra dropdown
// nenhum ao digitar) — sem isso, autocompletar na prática só funcionava no
// Android/desktop. Essa lista alimenta um dropdown próprio, renderizado em
// JS, que funciona em qualquer navegador.
export function filtrarSugestoes(descricoes, valorDigitado, limite = 6) {
  const alvo = (valorDigitado || '').trim().toLowerCase();
  if (!alvo) return [];
  return descricoes.filter((d) => d.description.toLowerCase().includes(alvo)).slice(0, limite);
}
