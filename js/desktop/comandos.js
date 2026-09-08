// Paleta de comando (⌘K) — navegação rápida da versão desktop, no lugar de
// um menu aninhado com grupos. Lista cresce conforme novas páginas desktop
// forem criadas nas próximas fases.

const ICONE_BUSCA = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>';

const PAGINAS = [
  { id: 'home', nome: 'Início', url: '/pages/desktop/home.html', icone: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11l9-7 9 7"/><path d="M5 10v9a1 1 0 0 0 1 1h3v-6h6v6h3a1 1 0 0 0 1-1v-9"/></svg>' },
  { id: 'cartao', nome: 'Cartão', url: '/pages/desktop/cartao.html', icone: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="14" rx="2.5"/><path d="M2 10h20"/></svg>' },
  { id: 'extrato', nome: 'Extrato', url: '/pages/desktop/extrato.html', icone: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6h16M4 12h16M4 18h10"/></svg>' },
  { id: 'lancar', nome: 'Lançar', url: '/pages/desktop/lancar.html', icone: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>' },
  { id: 'cadastros', nome: 'Cadastros', url: '/pages/desktop/cadastros.html', icone: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="6" x2="20" y2="6"/><circle cx="9" cy="6" r="2" fill="currentColor" stroke="none"/><line x1="4" y1="12" x2="20" y2="12"/><circle cx="15" cy="12" r="2" fill="currentColor" stroke="none"/><line x1="4" y1="18" x2="20" y2="18"/><circle cx="7" cy="18" r="2" fill="currentColor" stroke="none"/></svg>' },
  { id: 'investimentos', nome: 'Investimentos', url: '/pages/desktop/investimentos.html', icone: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/></svg>' },
  { id: 'relatorios', nome: 'Relatórios', url: '/pages/desktop/relatorios.html', icone: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19V9M10 19V5M16 19v-7M4 19h16"/></svg>' },
];

let selecionado = 0;
let filtradas = PAGINAS;

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}

function render() {
  const lista = document.getElementById('comandos-lista');
  if (filtradas.length === 0) {
    lista.innerHTML = '<div class="lista-vazia">Nada encontrado.</div>';
    return;
  }
  lista.innerHTML = filtradas.map((p, i) => `
    <button type="button" class="comandos-item ${i === selecionado ? 'selecionado' : ''}" data-id="${p.id}">
      ${p.icone}${escapeHtml(p.nome)}
    </button>
  `).join('');
  lista.querySelectorAll('.comandos-item').forEach((btn, i) => {
    btn.addEventListener('mouseenter', () => { selecionado = i; render(); });
    btn.addEventListener('click', () => ir(filtradas[i]));
  });
}

function ir(pagina) {
  if (pagina) window.location.href = pagina.url;
}

function filtrar(texto) {
  const q = texto.trim().toLowerCase();
  filtradas = q ? PAGINAS.filter((p) => p.nome.toLowerCase().includes(q)) : PAGINAS;
  selecionado = 0;
  render();
}

export function abrirComandos() {
  const overlay = document.getElementById('comandos-overlay');
  const input = document.getElementById('comandos-input');
  if (!overlay || !input) return;
  overlay.hidden = false;
  input.value = '';
  filtrar('');
  input.focus();
}

function fecharComandos() {
  const overlay = document.getElementById('comandos-overlay');
  if (overlay) overlay.hidden = true;
}

export function configurarComandos() {
  document.body.insertAdjacentHTML('beforeend', `
    <div class="comandos-overlay" id="comandos-overlay" hidden>
      <div class="comandos-caixa">
        <input type="text" class="comandos-input" id="comandos-input" placeholder="Ir para..." autocomplete="off">
        <div class="comandos-lista" id="comandos-lista"></div>
      </div>
    </div>
  `);

  const overlay = document.getElementById('comandos-overlay');
  const input = document.getElementById('comandos-input');

  overlay.addEventListener('click', (e) => { if (e.target === overlay) fecharComandos(); });
  input.addEventListener('input', (e) => filtrar(e.target.value));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); selecionado = Math.min(selecionado + 1, filtradas.length - 1); render(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); selecionado = Math.max(selecionado - 1, 0); render(); }
    else if (e.key === 'Enter') { e.preventDefault(); ir(filtradas[selecionado]); }
    else if (e.key === 'Escape') { fecharComandos(); }
  });

  document.addEventListener('keydown', (e) => {
    const combo = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k';
    if (combo) {
      e.preventDefault();
      if (overlay.hidden) abrirComandos(); else fecharComandos();
    }
  });
}

export { ICONE_BUSCA };
