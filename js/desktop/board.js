import { supabase } from '../supabaseClient.js';

// Colunas de widgets reposicionáveis — arrastar pra reordenar, só dentro
// da própria coluna. Cada coluna é uma pilha simples (flex column, ver
// .board-col em css/desktop/components.css) — como nunca depende da
// altura da coluna vizinha, nunca sobra vão em branco embaixo de um
// widget mais curto (o problema que o antigo board de grade única tinha).

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

function lerLayoutAtual(containers) {
  const layout = {};
  for (const [nome, container] of Object.entries(containers)) {
    layout[nome] = [...container.querySelectorAll('.widget')].map((w) => w.dataset.widgetId);
  }
  return layout;
}

async function persistir(pagina, containers, userId) {
  const layout = lerLayoutAtual(containers);
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

function aplicarLayout(containers, layout) {
  if (!layout) return;
  for (const [nome, container] of Object.entries(containers)) {
    const ids = layout[nome];
    if (!ids) continue;
    const widgets = new Map([...container.querySelectorAll('.widget')].map((w) => [w.dataset.widgetId, w]));
    ids.forEach((id) => {
      const w = widgets.get(id);
      if (w) container.appendChild(w);
    });
  }
}

/**
 * @param {Object<string,string>} containerIds — ex: { principal: 'board-principal', lateral: 'board-lateral' }
 * @param {string} pagina — chave de persistência (ex: 'home')
 * @param {string} userId
 */
export async function inicializarBoard(containerIds, pagina, userId) {
  const containers = {};
  for (const [nome, id] of Object.entries(containerIds)) {
    const el = document.getElementById(id);
    if (el) containers[nome] = el;
  }
  if (Object.keys(containers).length === 0) return;

  const layoutSalvo = await carregarLayoutSalvo(pagina, userId);
  aplicarLayout(containers, layoutSalvo);

  let arrastando = null;

  Object.values(containers).forEach((container) => {
    container.querySelectorAll('.widget').forEach((widget) => {
      widget.setAttribute('draggable', 'true');

      widget.addEventListener('dragstart', () => {
        arrastando = widget;
        widget.classList.add('arrastando');
      });
      widget.addEventListener('dragend', () => {
        widget.classList.remove('arrastando');
        arrastando = null;
        persistir(pagina, containers, userId);
      });
      widget.addEventListener('dragover', (e) => {
        e.preventDefault();
        // Só reordena dentro da mesma coluna — mover "Contas" pra dentro
        // da coluna principal não faz sentido nesse layout por zonas.
        if (!arrastando || arrastando === widget || arrastando.parentElement !== container) return;
        const rect = widget.getBoundingClientRect();
        const depois = e.clientY > rect.top + rect.height / 2;
        container.insertBefore(arrastando, depois ? widget.nextSibling : widget);
      });
    });
  });
}
