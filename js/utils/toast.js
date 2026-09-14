// js/utils/toast.js — aviso curto e visível quando uma ação falha.
// Dar baixa, excluir, remover: antes, quando davam erro, só reabilitavam
// os botões sem dizer nada — o usuário tocava de novo sem saber o que
// houve. Injeta seu próprio <style> na primeira chamada, então funciona
// em qualquer página só importando esta função, sem editar HTML/CSS.

let containerEl = null;

function garantirEstilos() {
  if (document.getElementById('toast-estilos')) return;
  const style = document.createElement('style');
  style.id = 'toast-estilos';
  style.textContent = `
    #toast-container {
      position: fixed;
      left: 0;
      right: 0;
      bottom: calc(env(safe-area-inset-bottom, 0px) + 84px);
      z-index: 9999;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 8px;
      padding: 0 16px;
      pointer-events: none;
    }
    .toast-flash {
      max-width: 440px;
      width: 100%;
      padding: 12px 16px;
      border-radius: var(--radius-md, 12px);
      font-family: 'Manrope', system-ui, sans-serif;
      font-size: 13.5px;
      font-weight: 700;
      line-height: 1.35;
      box-shadow: 0 12px 28px -14px rgba(0, 0, 0, 0.4);
      pointer-events: auto;
      cursor: default;
      opacity: 0;
      transform: translateY(8px);
      transition: opacity 0.18s ease, transform 0.18s ease;
    }
    .toast-flash.mostrando { opacity: 1; transform: translateY(0); }
    .toast-flash-erro { background: var(--danger-soft, #fbe3dc); color: var(--danger, #d9583a); border: 1px solid var(--danger, #d9583a); }
    .toast-flash-sucesso { background: var(--success-soft, #dcf3ea); color: var(--success, #1e9e6e); border: 1px solid var(--success, #1e9e6e); }
    @media (prefers-reduced-motion: reduce) {
      .toast-flash { transition: none; }
    }
  `;
  document.head.appendChild(style);
}

function garantirContainer() {
  if (containerEl && document.body.contains(containerEl)) return containerEl;
  garantirEstilos();
  containerEl = document.createElement('div');
  containerEl.id = 'toast-container';
  // role=status/aria-live=polite: leitor de tela anuncia sem interromper
  // o que o usuário já está fazendo (diferente de role=alert).
  containerEl.setAttribute('role', 'status');
  containerEl.setAttribute('aria-live', 'polite');
  document.body.appendChild(containerEl);
  return containerEl;
}

/**
 * @param {string} mensagem
 * @param {'erro'|'sucesso'} tipo
 */
export function mostrarToast(mensagem, tipo = 'erro') {
  const container = garantirContainer();
  const el = document.createElement('div');
  el.className = `toast-flash toast-flash-${tipo}`;
  el.textContent = mensagem;
  el.addEventListener('click', () => el.remove());
  container.appendChild(el);
  requestAnimationFrame(() => el.classList.add('mostrando'));

  setTimeout(() => {
    el.classList.remove('mostrando');
    setTimeout(() => el.remove(), 200);
  }, 4200);
}
