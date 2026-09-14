// Toque-segurar: abre o menu de ações (editar/excluir) de um cartão de
// lançamento/compra ao pressionar e segurar (500ms) — o toque curto normal
// não faz nada, é só pra permitir rolar a lista sem abrir menu sem querer.
//
// Mouse/touch não é o único jeito de "ativar" um elemento: teclado (Tab +
// Enter/Espaço) e leitores de tela disparam um evento `click` direto, sem
// passar por mousedown/touchstart — sem esse handler, quem navega por
// teclado nunca conseguia abrir o menu (não dá pra "segurar" o Enter).
// Por isso o elemento precisa ser um <button> de verdade (focável) e este
// módulo escuta 'click' pra cobrir ativação por teclado/acessibilidade,
// sem duplicar a ação quando o click vem de um mouseup que o toque-segurar
// já tratou (usamos um pequeno cooldown pra isso).
export function attachToqueSegurar(el, aoAcionar) {
  let timer = null;
  let moveu = false;
  let acionadoAgora = false;

  const iniciar = () => {
    moveu = false;
    timer = setTimeout(() => {
      if (!moveu) {
        el.classList.remove('pressionando');
        acionadoAgora = true;
        aoAcionar();
        setTimeout(() => { acionadoAgora = false; }, 400);
      }
    }, 500);
    el.classList.add('pressionando');
  };
  const cancelar = () => {
    clearTimeout(timer);
    timer = null;
    el.classList.remove('pressionando');
  };
  const mover = () => { moveu = true; cancelar(); };

  el.addEventListener('touchstart', iniciar, { passive: true });
  el.addEventListener('touchend', cancelar);
  el.addEventListener('touchmove', mover, { passive: true });
  el.addEventListener('touchcancel', cancelar);
  el.addEventListener('mousedown', iniciar);
  el.addEventListener('mouseup', cancelar);
  el.addEventListener('mouseleave', cancelar);

  // Ativação por teclado/leitor de tela — dispara na hora, sem segurar.
  // O `acionadoAgora` evita rodar de novo se esse mesmo gesto de toque
  // longo já tiver chamado aoAcionar() um instante atrás.
  el.addEventListener('click', (e) => {
    if (acionadoAgora) return;
    if (e.detail !== 0) return; // detail=0 é o sinal de clique sintético (teclado/AT), não de mouse
    aoAcionar();
  });
}
