import { supabase } from './supabaseClient.js';

const form = document.getElementById('form-login');
const btnEntrar = document.getElementById('btn-entrar');
const erroLogin = document.getElementById('erro-login');

async function redirecionarSeLogado() {
  const { data } = await supabase.auth.getSession();
  if (data.session) {
    window.location.href = '/pages/home.html';
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

  window.location.href = '/pages/home.html';
}

form.addEventListener('submit', entrar);
redirecionarSeLogado();
