// api/luna-chat.js — Proxy Claude AI para o chat da Luna
// Node.js serverless (não Edge — Edge bloqueia chamadas externas)

import { SUPABASE_URL } from '../js/config.js';
import { checarLimiteIA } from './_aiRateLimit.js';

export default async function handler(req, res) {

  // ── CORS ──────────────────────────────────────────────────────────────────
  res.setHeader('Access-Control-Allow-Origin', 'https://finzenflash.vercel.app');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // ── Autenticação JWT Supabase ─────────────────────────────────────────────
  const auth = req.headers['authorization'];
  if (!auth?.startsWith('Bearer ')) return res.status(403).json({ error: 'Forbidden' });
  const token = auth.slice(7);
  const authRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { Authorization: `Bearer ${token}`, apikey: process.env.SUPABASE_SERVICE_KEY },
  });
  if (!authRes.ok) return res.status(403).json({ error: 'Forbidden' });

  // Rate limiting: protege o custo da API Anthropic (AI_LIMITE_DIARIO/dia,
  // compartilhado com o FinZen original — mesmo usuário, mesma cota)
  const usuario = await authRes.json().catch(() => null);
  if (usuario?.id) {
    const limite = await checarLimiteIA(usuario.id, 'luna_chat');
    if (!limite.permitido) {
      return res.status(429).json({ error: `Limite diário de IA atingido (${limite.limite} chamadas). Tente novamente amanhã.` });
    }
  }

  try {
    const { prompt, system, history } = req.body;

    if (!prompt) {
      return res.status(400).json({ error: 'prompt é obrigatório' });
    }

    const messages = [];
    if (history && Array.isArray(history)) {
      history.slice(0, -1).forEach((h) => {
        messages.push({ role: h.role, content: h.content });
      });
    }
    messages.push({ role: 'user', content: prompt });

    const requestBody = {
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      stream: true,
      messages,
    };

    if (system) requestBody.system = system;

    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(requestBody),
    });

    if (!anthropicRes.ok) {
      const err = await anthropicRes.text();
      return res.status(anthropicRes.status).json({ error: err });
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');

    const reader = anthropicRes.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(decoder.decode(value));
    }

    res.end();

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Erro interno' });
  }
}
