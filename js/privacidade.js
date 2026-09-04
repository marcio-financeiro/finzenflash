const CHAVE = 'flash_modo_privado';

function modoPrivadoAtivo() {
  try {
    return localStorage.getItem(CHAVE) === '1';
  } catch {
    return false;
  }
}

function aplicarModoPrivado() {
  document.body.classList.toggle('modo-privado', modoPrivadoAtivo());
}

function alternarModoPrivado() {
  const novo = !modoPrivadoAtivo();
  try {
    localStorage.setItem(CHAVE, novo ? '1' : '0');
  } catch {
    // localStorage indisponível (modo privado do navegador etc) — o toggle
    // ainda funciona nesta sessão, só não persiste ao recarregar.
  }
  aplicarModoPrivado();
  return novo;
}

const iconeOlho = `
  <path class="olho-aberto" d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7Z"/>
  <circle class="olho-aberto" cx="12" cy="12" r="3"/>
  <path class="olho-fechado" d="M2 2l20 20M9.5 9.6a3 3 0 0 0 4.2 4.2M6.5 6.6C3.7 8.3 1 12 1 12s4 7 11 7c1.9 0 3.6-.5 5-1.2M17 5.2C15.6 4.4 13.9 4 12 4c-.6 0-1.2.05-1.8.14M20.4 8.4C21.9 10 23 12 23 12s-1 1.8-2.9 3.5"/>
`;

export function configurarBotaoPrivacidade(btnId) {
  aplicarModoPrivado();
  const btn = document.getElementById(btnId);
  if (!btn) return;

  btn.classList.toggle('ativo', modoPrivadoAtivo());
  btn.setAttribute('aria-label', modoPrivadoAtivo() ? 'Mostrar valores' : 'Ocultar valores');

  // init() em algumas páginas roda de novo em pageshow/visibilitychange —
  // sem essa trava o listener de clique duplicaria a cada vez.
  if (btn.dataset.privacidadeConfigurada) return;
  btn.dataset.privacidadeConfigurada = '1';

  btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${iconeOlho}</svg>`;

  btn.addEventListener('click', () => {
    const ativo = alternarModoPrivado();
    btn.classList.toggle('ativo', ativo);
    btn.setAttribute('aria-label', ativo ? 'Mostrar valores' : 'Ocultar valores');
  });
}
