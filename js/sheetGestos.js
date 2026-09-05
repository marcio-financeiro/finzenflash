// Permite fechar uma sheet (bottom sheet) arrastando ela pra baixo com o dedo.
// Só inicia o arraste quando o conteúdo já está no topo (scrollTop 0), pra
// não brigar com o scroll interno de listas longas dentro da sheet.
export function ativarArrastarParaFechar(overlayEl) {
  if (!overlayEl) return;
  const sheet = overlayEl.querySelector('.sheet');
  if (!sheet) return;

  let arrastando = false;
  let inicioY = 0;
  let deslocamento = 0;

  function iniciar(y) {
    if (sheet.scrollTop > 0) return;
    arrastando = true;
    inicioY = y;
    sheet.style.transition = 'none';
  }

  function mover(y) {
    if (!arrastando) return;
    deslocamento = Math.max(0, y - inicioY);
    sheet.style.transform = `translateY(${deslocamento}px)`;
  }

  function soltar() {
    if (!arrastando) return;
    arrastando = false;
    sheet.style.transition = 'transform 0.2s ease';
    if (deslocamento > 90) {
      overlayEl.hidden = true;
    }
    sheet.style.transform = '';
    deslocamento = 0;
  }

  sheet.addEventListener('touchstart', (e) => iniciar(e.touches[0].clientY), { passive: true });
  sheet.addEventListener('touchmove', (e) => mover(e.touches[0].clientY), { passive: true });
  sheet.addEventListener('touchend', soltar);
  sheet.addEventListener('touchcancel', soltar);
}
