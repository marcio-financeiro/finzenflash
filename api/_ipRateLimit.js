// api/_ipRateLimit.js — limite simples por IP para endpoints públicos (sem auth).
// Arquivos com _ no início não viram endpoint na Vercel.
//
// Em memória, por instância Lambda — não é um limite global exato (cada
// instância tem sua própria contagem, e reinicia em cold start), mas é
// suficiente para conter abuso básico sem precisar de tabela/infra nova
// (projeto é zero-build, sem KV). Serve pra api/quotes.js, que é público.

const janelas = new Map(); // ip -> { count, resetAt }

export function checarLimiteIP(req, { limite = 30, janelaMs = 60_000 } = {}) {
  const ip = (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'desconhecido')
    .toString().split(',')[0].trim();

  const agora = Date.now();
  let janela = janelas.get(ip);
  if (!janela || janela.resetAt < agora) {
    janela = { count: 0, resetAt: agora + janelaMs };
    janelas.set(ip, janela);
  }
  janela.count++;

  // Limpeza oportunista pra não crescer indefinidamente
  if (janelas.size > 500) {
    for (const [k, v] of janelas) if (v.resetAt < agora) janelas.delete(k);
  }

  return { permitido: janela.count <= limite, restante: Math.max(0, limite - janela.count) };
}
