import { abrirComandos, configurarComandos } from './comandos.js';
import { configurarBotaoPrivacidade } from '../privacidade.js';

const ICONE_INICIO = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11l9-7 9 7"/><path d="M5 10v9a1 1 0 0 0 1 1h3v-6h6v6h3a1 1 0 0 0 1-1v-9"/></svg>';
const ICONE_CARTAO = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="14" rx="2.5"/><path d="M2 10h20"/></svg>';
const ICONE_EXTRATO = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6h16M4 12h16M4 18h10"/></svg>';
const ICONE_LANCAR = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>';
const ICONE_CADASTROS = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="6" x2="20" y2="6"/><circle cx="9" cy="6" r="2" fill="currentColor" stroke="none"/><line x1="4" y1="12" x2="20" y2="12"/><circle cx="15" cy="12" r="2" fill="currentColor" stroke="none"/><line x1="4" y1="18" x2="20" y2="18"/><circle cx="7" cy="18" r="2" fill="currentColor" stroke="none"/></svg>';
const ICONE_MAIS = '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>';
const ICONE_MOBILE = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><rect x="7" y="2" width="10" height="20" rx="2"/><line x1="11" y1="18" x2="13" y2="18"/></svg>';
const ICONE_SAIR = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/></svg>';

const ITENS = [
  { id: 'home', label: 'Início', href: '/pages/desktop/home.html', icone: ICONE_INICIO },
  { id: 'cartao', label: 'Cartão', href: '/pages/desktop/cartao.html', icone: ICONE_CARTAO },
  { id: 'extrato', label: 'Extrato', href: '/pages/desktop/extrato.html', icone: ICONE_EXTRATO },
  { id: 'lancar', label: 'Lançar', href: '/pages/desktop/lancar.html', icone: ICONE_LANCAR },
  { id: 'cadastros', label: 'Cadastros', href: '/pages/desktop/cadastros.html', icone: ICONE_CADASTROS },
];

export function montarNavRail(paginaAtiva) {
  const slot = document.getElementById('rail-slot');
  if (!slot) return;

  slot.innerHTML = `
    <div class="rail">
      <div class="rail-logo">FZ</div>
      <div class="rail-itens">
        ${ITENS.map((item) => `
          <a class="rail-item ${item.id === paginaAtiva ? 'ativo' : ''}" href="${item.href}" aria-label="${item.label}">
            ${item.icone}
            <span class="rail-tooltip">${item.label}</span>
          </a>
        `).join('')}
        <button type="button" class="rail-item" id="btn-abrir-comandos" aria-label="Mais páginas (Ctrl+K)">
          ${ICONE_MAIS}
          <span class="rail-tooltip">Mais páginas (Ctrl+K)</span>
        </button>
      </div>
      <div class="rail-rodape">
        <button type="button" class="rail-item btn-privacidade" id="btn-privacidade-nav" aria-label="Ocultar valores"></button>
        <a class="rail-item" href="/pages/home.html" id="link-versao-mobile" aria-label="Versão mobile">
          ${ICONE_MOBILE}
          <span class="rail-tooltip">Versão mobile</span>
        </a>
        <button type="button" class="rail-item" id="btn-sair-nav" aria-label="Sair">
          ${ICONE_SAIR}
          <span class="rail-tooltip">Sair</span>
        </button>
      </div>
    </div>
  `;

  configurarComandos();
  configurarBotaoPrivacidade('btn-privacidade-nav');
  // configurarBotaoPrivacidade() substitui o innerHTML do botão pelo ícone —
  // o tooltip precisa ser adicionado depois, não no template original.
  document.getElementById('btn-privacidade-nav')
    ?.insertAdjacentHTML('beforeend', '<span class="rail-tooltip">Ocultar/mostrar valores</span>');
  document.getElementById('btn-abrir-comandos').addEventListener('click', abrirComandos);
  document.getElementById('link-versao-mobile').addEventListener('click', () => {
    try { localStorage.setItem('flash_versao_preferida', 'mobile'); } catch { /* localStorage indisponível */ }
  });
}
