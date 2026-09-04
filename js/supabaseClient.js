import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.112.4/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

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
