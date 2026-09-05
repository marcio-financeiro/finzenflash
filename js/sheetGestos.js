// Permite fechar uma sheet (bottom sheet) arrastando ela pra baixo com o dedo.
// Só arrasta quando o conteúdo já está no topo (scrollTop 0) e o dedo desce
// — assim não rouba o scroll interno de listas longas dentro da sheet nem
// deixa a página por trás rolar junto (por isso o preventDefault, que só
// entra em ação quando o arraste pra baixo já foi confirmado).
export function ativarArrastarParaFechar(overlayEl) {
  if (!overlayEl) return;
  const sheet = overlayEl.querySelector('.sheet');
  if (!sheet) return;

  let podeArrastar = false;
  let arrastando = false;
  let inicioY = 0;
  let deslocamento = 0;

  function iniciar(y) {
    podeArrastar = sheet.scrollTop <= 0;
    arrastando = false;
    inicioY = y;
    deslocamento = 0;
  }

  function mover(y, evento) {
    if (!podeArrastar) return;
    const dy = y - inicioY;
    if (dy <= 0) {
      arrastando = false;
      return;
    }
    arrastando = true;
    evento.preventDefault();
    deslocamento = dy;
    sheet.style.transition = 'none';
    sheet.style.transform = `translateY(${deslocamento}px)`;
  }

  function soltar() {
    if (!arrastando) return;
    arrastando = false;
    podeArrastar = false;
    sheet.style.transition = 'transform 0.2s ease';
    if (deslocamento > 90) {
      overlayEl.hidden = true;
    }
    sheet.style.transform = '';
    deslocamento = 0;
  }

  sheet.addEventListener('touchstart', (e) => iniciar(e.touches[0].clientY), { passive: true });
  sheet.addEventListener('touchmove', (e) => mover(e.touches[0].clientY, e), { passive: false });
  sheet.addEventListener('touchend', soltar);
  sheet.addEventListener('touchcancel', soltar);
}
