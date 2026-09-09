// Conversão de moeda para contas em USD (ex: Nomad USD) — mesma cotação
// manual salva em user_settings pela tela de Investimentos (setting_key
// 'usd_brl'), reaproveitada aqui para não duplicar a lógica em cada tela
// que soma saldo de contas de moedas diferentes.

export const DEFAULT_USD_BRL = 5.15;

export async function carregarCotacaoDolar(supabase, userId) {
  const { data } = await supabase
    .from('user_settings')
    .select('setting_value')
    .eq('user_id', userId)
    .eq('setting_key', 'usd_brl')
    .maybeSingle();
  return data ? Number(data.setting_value) || DEFAULT_USD_BRL : DEFAULT_USD_BRL;
}

export function paraBRL(valor, currency, dolarAtual = DEFAULT_USD_BRL) {
  return (currency || 'BRL') === 'USD' ? Number(valor) * dolarAtual : Number(valor);
}

export function formatarMoeda(valor, currency = 'BRL') {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: currency || 'BRL' }).format(valor);
}
