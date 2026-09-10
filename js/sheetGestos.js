// Permite fechar uma sheet (bottom sheet) arrastando ela pra baixo com o dedo.
// Só arrasta quando o conteúdo já está no topo (scrollTop 0) e o dedo desce
// — assim não rouba o scroll interno de listas longas dentro da sheet nem
// deixa a página por trás rolar junto (por isso o preventDefault, que só
// entra em ação quando o arraste pra baixo já foi confirmado).
const SELETOR_FOCAVEL = 'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function ativarArrastarParaFechar(overlayEl) {
  if (!overlayEl) return;
  const sheet = overlayEl.querySelector('.sheet');
  if (!sheet) return;

  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-modal', 'true');
  if (!sheet.hasAttribute('tabindex')) sheet.setAttribute('tabindex', '-1');

  // Foco: como cada página abre/fecha sua sheet só trocando `hidden`
  // (sem passar por uma função central, ao contrário do modal desktop),
  // observa o atributo pra mover/restaurar o foco e prender o Tab dentro
  // da sheet automaticamente, sem precisar tocar em cada página.
  let focoAnterior = null;
  const focaveis = () => Array.from(sheet.querySelectorAll(SELETOR_FOCAVEL)).filter((el) => el.offsetParent !== null);

  new MutationObserver(() => {
    if (overlayEl.hidden) {
      if (focoAnterior && document.body.contains(focoAnterior)) focoAnterior.focus();
      focoAnterior = null;
    } else {
      focoAnterior = document.activeElement;
      (focaveis()[0] || sheet).focus();
    }
  }).observe(overlayEl, { attributes: true, attributeFilter: ['hidden'] });

  document.addEventListener('keydown', (e) => {
    if (overlayEl.hidden || e.key !== 'Tab') return;
    const itens = focaveis();
    if (!itens.length) return;
    const primeiro = itens[0];
    const ultimo = itens[itens.length - 1];
    if (e.shiftKey && document.activeElement === primeiro) {
      e.preventDefault();
      ultimo.focus();
    } else if (!e.shiftKey && document.activeElement === ultimo) {
      e.preventDefault();
      primeiro.focus();
    }
  });

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
