// Modal centralizado — equivalente desktop do bottom-sheet mobile
// (js/sheetGestos.js continua exclusivo do mobile, não é tocado).

const focoAnterior = new WeakMap();
const SELETOR_FOCAVEL = 'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

function elementosFocaveis(container) {
  return Array.from(container.querySelectorAll(SELETOR_FOCAVEL)).filter((el) => el.offsetParent !== null);
}

export function configurarModal(overlayId) {
  const overlay = document.getElementById(overlayId);
  if (!overlay) return;
  if (overlay.dataset.modalConfigurado) return;
  overlay.dataset.modalConfigurado = '1';

  const caixa = overlay.querySelector('.modal-caixa');
  if (caixa) {
    caixa.setAttribute('role', 'dialog');
    caixa.setAttribute('aria-modal', 'true');
    if (!caixa.hasAttribute('tabindex')) caixa.setAttribute('tabindex', '-1');
  }

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) fecharModal(overlayId);
  });
  document.addEventListener('keydown', (e) => {
    if (overlay.hidden) return;
    if (e.key === 'Escape') { fecharModal(overlayId); return; }
    if (e.key === 'Tab' && caixa) {
      const focaveis = elementosFocaveis(caixa);
      if (!focaveis.length) return;
      const primeiro = focaveis[0];
      const ultimo = focaveis[focaveis.length - 1];
      if (e.shiftKey && document.activeElement === primeiro) {
        e.preventDefault();
        ultimo.focus();
      } else if (!e.shiftKey && document.activeElement === ultimo) {
        e.preventDefault();
        primeiro.focus();
      }
    }
  });
}

export function abrirModal(overlayId) {
  const overlay = document.getElementById(overlayId);
  if (!overlay) return;
  focoAnterior.set(overlay, document.activeElement);
  overlay.hidden = false;
  const caixa = overlay.querySelector('.modal-caixa');
  if (caixa) {
    const focaveis = elementosFocaveis(caixa);
    (focaveis[0] || caixa).focus();
  }
}

export function fecharModal(overlayId) {
  const overlay = document.getElementById(overlayId);
  if (!overlay) return;
  overlay.hidden = true;
  const anterior = focoAnterior.get(overlay);
  if (anterior && document.body.contains(anterior)) anterior.focus();
  focoAnterior.delete(overlay);
}
