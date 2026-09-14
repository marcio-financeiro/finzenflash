import { supabase } from './supabaseClient.js';
import { aplicarTemaSalvo } from './temaService.js?v=3';

aplicarTemaSalvo();

const form = document.getElementById('form-login');
const btnEntrar = document.getElementById('btn-entrar');
const erroLogin = document.getElementById('erro-login');
const avisoLogin = document.getElementById('aviso-login');

const ICONE_OLHO_ABERTO = '<path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7Z"/><circle cx="12" cy="12" r="3"/>';
const ICONE_OLHO_FECHADO = '<path d="M17.94 17.94A10.94 10.94 0 0 1 12 20c-7 0-11-7-11-7a20.3 20.3 0 0 1 5.06-5.94M9.9 4.24A10.5 10.5 0 0 1 12 4c7 0 11 7 11 7a20.3 20.3 0 0 1-3.22 4.19M14.12 14.12a3 3 0 1 1-4.24-4.24"/><path d="M1 1l22 22"/>';

function alternarMostrarSenha() {
  const input = document.getElementById('senha');
  const btn = document.getElementById('btn-mostrar-senha');
  const mostrando = input.type === 'text';
  input.type = mostrando ? 'password' : 'text';
  btn.setAttribute('aria-pressed', String(!mostrando));
  btn.setAttribute('aria-label', mostrando ? 'Mostrar senha' : 'Ocultar senha');
  btn.querySelector('svg').innerHTML = mostrando ? ICONE_OLHO_ABERTO : ICONE_OLHO_FECHADO;
}

async function esqueciSenha() {
  erroLogin.textContent = '';
  avisoLogin.textContent = '';
  const email = document.getElementById('email').value.trim();
  if (!email) {
    erroLogin.textContent = 'Informe seu e-mail acima para receber o link de redefinição.';
    return;
  }

  const btn = document.getElementById('btn-esqueci-senha');
  btn.disabled = true;
  const { error } = await supabase.auth.resetPasswordForEmail(email);
  btn.disabled = false;

  if (error) {
    erroLogin.textContent = 'Não foi possível enviar o e-mail. Tente novamente.';
    return;
  }
  avisoLogin.textContent = 'Se o e-mail estiver cadastrado, você vai receber um link para redefinir a senha.';
}

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
document.getElementById('btn-mostrar-senha').addEventListener('click', alternarMostrarSenha);
document.getElementById('btn-esqueci-senha').addEventListener('click', esqueciSenha);
redirecionarSeLogado();
