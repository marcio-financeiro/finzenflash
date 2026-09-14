import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.112.4/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Registra o service worker (cache do app shell pra abrir sem tela branca
// quando não tem sinal) — feito aqui porque todo .js de página autenticada
// já importa este módulo, então cobre o app inteiro sem editar cada HTML.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

export async function requireAuth() {
  const { data } = await supabase.auth.getSession();
  if (!data.session) {
    window.location.href = '/index.html';
    return null;
  }
  return data.session.user;
}

export function configurarBotaoSair() {
  document.getElementById('btn-sair-nav')?.addEventListener('click', async () => {
    await supabase.auth.signOut();
    window.location.href = '/index.html';
  });
}
