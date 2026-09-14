// api/_aiRateLimit.js — limite diário de chamadas de IA por usuário.
// Arquivos com _ no início não viram endpoint na Vercel.
// Usa a tabela ai_usage (mesmo banco do FinZen original — o limite diário é
// compartilhado entre os dois apps, já que o usuário é o mesmo). Se a tabela
// não existir, NÃO bloqueia (fail-open — proteção de custo, não de acesso).

import { SUPABASE_URL } from '../js/config.js';

const LIMITE_PADRAO = 50;

export async function checarLimiteIA(userId, endpoint) {
  const SB_KEY = process.env.SUPABASE_SERVICE_KEY;
  const limite = Number(process.env.AI_LIMITE_DIARIO || LIMITE_PADRAO);
  const headers = {
    apikey: SB_KEY,
    Authorization: `Bearer ${SB_KEY}`,
    'Content-Type': 'application/json',
  };

  try {
    // Data no fuso de Brasília — o comentário original dizia que isso
    // corrigia a virada, mas comparar com "T00:00:00Z" ainda usa meia-noite
    // em UTC, não em Brasília: a janela seguia abrindo 3h cedo (21h do dia
    // anterior, horário de Brasília). Brasil não tem mais horário de verão
    // desde 2019, então America/Sao_Paulo é sempre UTC-3 — meia-noite lá é
    // 03:00 em UTC.
    const hoje = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
    const inicioDoDiaUTC = `${hoje}T03:00:00Z`;
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/ai_usage?user_id=eq.${userId}&created_at=gte.${inicioDoDiaUTC}&select=id`,
      { headers: { ...headers, Prefer: 'count=exact', Range: '0-0' } }
    );
    if (!r.ok) return { permitido: true }; // tabela ausente → não bloqueia

    const total = Number((r.headers.get('content-range') || '0/0').split('/')[1] || 0);
    if (total >= limite) {
      return { permitido: false, total, limite };
    }

    await fetch(`${SUPABASE_URL}/rest/v1/ai_usage`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ user_id: userId, endpoint }),
    }).catch(() => {});

    return { permitido: true, total: total + 1, limite };
  } catch (_) {
    return { permitido: true };
  }
}
