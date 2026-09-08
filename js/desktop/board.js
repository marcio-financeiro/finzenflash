import { supabase } from '../supabaseClient.js';

// Board de widgets reposicionáveis — arrastar pra reordenar, clicar no
// canto pra alternar largura (3/6/8/12 de 12 colunas). Estende o mesmo
// princípio do `flash_home_cards_order` do mobile (reordenar/ocultar
// cards), mas com posição livre + tamanho em vez de só ordem/visibilidade.

const TAMANHOS = [4, 6, 8, 12];

function chaveLayout(pagina) {
  return `flash_desktop_board_${pagina}`;
}

function lerLayoutLocal(pagina) {
  try {
    const bruto = localStorage.getItem(chaveLayout(pagina));
    return bruto ? JSON.parse(bruto) : null;
  } catch {
    return null;
  }
}

function salvarLayoutLocal(pagina, layout) {
  try { localStorage.setItem(chaveLayout(pagina), JSON.stringify(layout)); } catch { /* localStorage indisponível */ }
}

function lerLayoutAtual(container) {
  return [...container.querySelectorAll('.widget')].map((w) => ({
    id: w.dataset.widgetId,
    cols: Number(getComputedStyle(w).getPropertyValue('--widget-cols')) || 12,
  }));
}

async function persistir(pagina, container, userId) {
  const layout = lerLayoutAtual(container);
  salvarLayoutLocal(pagina, layout);
  if (!userId) return;
  await supabase.from('user_settings').upsert(
    { user_id: userId, setting_key: chaveLayout(pagina), setting_value: JSON.stringify(layout) },
    { onConflict: 'user_id,setting_key' },
  );
}

async function carregarLayoutSalvo(pagina, userId) {
  const local = lerLayoutLocal(pagina);
  if (local) return local;
  if (!userId) return null;
  try {
    const { data } = await supabase
      .from('user_settings')
      .select('setting_value')
      .eq('user_id', userId)
      .eq('setting_key', chaveLayout(pagina))
      .maybeSingle();
    if (data?.setting_value) return JSON.parse(data.setting_value);
  } catch { /* segue sem layout salvo */ }
  return null;
}

function aplicarLayout(container, layout) {
  if (!layout || !layout.length) return;
  const widgets = new Map([...container.querySelectorAll('.widget')].map((w) => [w.dataset.widgetId, w]));
  layout.forEach(({ id, cols }) => {
    const w = widgets.get(id);
    if (!w) return;
    w.style.setProperty('--widget-cols', cols);
    container.appendChild(w);
  });
}

function proximoTamanho(atual) {
  const idx = TAMANHOS.indexOf(atual);
  return TAMANHOS[(idx + 1) % TAMANHOS.length] ?? TAMANHOS[0];
}

export async function inicializarBoard(containerId, pagina, userId) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const layoutSalvo = await carregarLayoutSalvo(pagina, userId);
  aplicarLayout(container, layoutSalvo);

  let arrastando = null;

  container.querySelectorAll('.widget').forEach((widget) => {
    widget.setAttribute('draggable', 'true');

    widget.addEventListener('dragstart', () => {
      arrastando = widget;
      widget.classList.add('arrastando');
    });
    widget.addEventListener('dragend', () => {
      widget.classList.remove('arrastando');
      arrastando = null;
      persistir(pagina, container, userId);
    });
    widget.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (!arrastando || arrastando === widget) return;
      const rect = widget.getBoundingClientRect();
      const depois = e.clientX > rect.left + rect.width / 2;
      widget.parentElement.insertBefore(arrastando, depois ? widget.nextSibling : widget);
    });

    const alca = widget.querySelector('.widget-redimensionar');
    if (alca) {
      alca.addEventListener('click', () => {
        const atual = Number(getComputedStyle(widget).getPropertyValue('--widget-cols')) || 12;
        widget.style.setProperty('--widget-cols', proximoTamanho(atual));
        persistir(pagina, container, userId);
      });
    }
  });
}
