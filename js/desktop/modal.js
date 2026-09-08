// Modal centralizado — equivalente desktop do bottom-sheet mobile
// (js/sheetGestos.js continua exclusivo do mobile, não é tocado).

export function configurarModal(overlayId) {
  const overlay = document.getElementById(overlayId);
  if (!overlay) return;
  if (overlay.dataset.modalConfigurado) return;
  overlay.dataset.modalConfigurado = '1';

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) fecharModal(overlayId);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !overlay.hidden) fecharModal(overlayId);
  });
}

export function abrirModal(overlayId) {
  const overlay = document.getElementById(overlayId);
  if (overlay) overlay.hidden = false;
}

export function fecharModal(overlayId) {
  const overlay = document.getElementById(overlayId);
  if (overlay) overlay.hidden = true;
}
