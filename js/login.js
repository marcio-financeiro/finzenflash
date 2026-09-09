import { supabase } from './supabaseClient.js';
import { aplicarTemaSalvo } from './temaService.js?v=3';

aplicarTemaSalvo();

const form = document.getElementById('form-login');
const btnEntrar = document.getElementById('btn-entrar');
const erroLogin = document.getElementById('erro-login');

// O link "Versão mobile/desktop" na navegação grava a última escolha do
// usuário aqui — o login lia isso mas nunca consultava, então sempre caía
// no mobile mesmo em tela de desktop. Sem preferência salva ainda (primeiro
// acesso), usa a largura da tela só pra decidir o ponto de entrada — não é
// sniffing de user-agent, e o link continua disponível pra trocar depois.
function destinoInicial() {
  let preferida;
  try { preferida = localStorage.getItem('flash_versao_preferida'); } catch { /* localStorage indisponível */ }
  if (preferida === 'desktop') return '/pages/desktop/home.html';
  if (preferida === 'mobile') return '/pages/home.html';
  return window.innerWidth >= 960 ? '/pages/desktop/home.html' : '/pages/home.html';
}

async function redirecionarSeLogado() {
  const { data } = await supabase.auth.getSession();
  if (data.session) {
    window.location.href = destinoInicial();
  }
}

function mensagemErro(error) {
  if (error.message === 'Invalid login credentials') return 'E-mail ou senha incorretos.';
  return 'Não foi possível entrar. Tente novamente.';
}

async function entrar(event) {
  event.preventDefault();
  erroLogin.textContent = '';

  const email = document.getElementById('email').value.trim();
  const senha = document.getElementById('senha').value;

  btnEntrar.disabled = true;
  btnEntrar.textContent = 'Entrando...';

  const { error } = await supabase.auth.signInWithPassword({ email, password: senha });

  if (error) {
    erroLogin.textContent = mensagemErro(error);
    btnEntrar.disabled = false;
    btnEntrar.textContent = 'Entrar';
    return;
  }

  window.location.href = destinoInicial();
}

form.addEventListener('submit', entrar);
redirecionarSeLogado();
