import { ativarArrastarParaFechar } from './sheetGestos.js?v=2';

const ICONE_INICIO = '<svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11l9-7 9 7"/><path d="M5 10v9a1 1 0 0 0 1 1h3v-6h6v6h3a1 1 0 0 0 1-1v-9"/></svg>';
const ICONE_CARTAO = '<svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="14" rx="2.5"/><path d="M2 10h20"/></svg>';
const ICONE_EXTRATO = '<svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6h16M4 12h16M4 18h10"/></svg>';
const ICONE_MAIS = '<svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><circle cx="5" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.4" fill="currentColor" stroke="none"/></svg>';
const ICONE_CADASTROS = '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="6" x2="20" y2="6"/><circle cx="9" cy="6" r="2" fill="currentColor" stroke="none"/><line x1="4" y1="12" x2="20" y2="12"/><circle cx="15" cy="12" r="2" fill="currentColor" stroke="none"/><line x1="4" y1="18" x2="20" y2="18"/><circle cx="7" cy="18" r="2" fill="currentColor" stroke="none"/></svg>';
const ICONE_INVESTIR = '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/></svg>';
const ICONE_OFFSHORE = '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="5" r="2"/><line x1="12" y1="7" x2="12" y2="21"/><path d="M5 13a7 7 0 0 0 14 0"/><line x1="5" y1="13" x2="3" y2="13"/><line x1="19" y1="13" x2="21" y2="13"/></svg>';
const ICONE_RELATORIOS = '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19V9M10 19V5M16 19v-7M4 19h16"/></svg>';
const ICONE_PROJECAO = '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M3 17l4-5 4 3 5-7 5 4"/></svg>';
const ICONE_SAUDE = '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8Z"/></svg>';
const ICONE_APARENCIA = '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><circle cx="9" cy="10" r="1" fill="currentColor" stroke="none"/><circle cx="13" cy="8" r="1" fill="currentColor" stroke="none"/><circle cx="16" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="11" cy="15" r="1" fill="currentColor" stroke="none"/><path d="M12 3a9 9 0 0 0 0 18c1.1 0 1.6-.7 1.6-1.5 0-.4-.2-.7-.4-1a1.4 1.4 0 0 1 1-2.4h1.4A3.4 3.4 0 0 0 19 12.6 9 9 0 0 0 12 3Z"/></svg>';
const ICONE_PARCELAMENTOS = '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="5" rx="1.5"/><rect x="3" y="10.5" width="18" height="5" rx="1.5"/><rect x="3" y="17" width="18" height="5" rx="1.5"/></svg>';
const ICONE_SAIR = '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/></svg>';

const PAGINAS_NO_MAIS = ['cadastros', 'investimentos', 'offshore', 'relatorios', 'projecao', 'saude', 'aparencia', 'parcelamentos'];

/**
 * Monta o menu inferior (Início/Cartão/Extrato/Mais) dentro de
 * #nav-inferior-slot. As demais seções (Cadastros/Investir/Offshore/Sair)
 * ficam dentro do sheet "Mais" — mantém a barra com só 4 itens fixos,
 * dá pra crescer sem espremer o menu de novo.
 */
export function montarNavInferior(paginaAtiva) {
  const slot = document.getElementById('nav-inferior-slot');
  if (!slot) return;

  const noMais = PAGINAS_NO_MAIS.includes(paginaAtiva);
  const ativo = (id) => (paginaAtiva === id ? 'ativo' : '');

  slot.innerHTML = `
    <div class="nav-inferior">
      <div class="nav-inferior-inner">
        <a class="nav-item ${ativo('home')}" href="/pages/home.html">${ICONE_INICIO}Início</a>
        <a class="nav-item ${ativo('cartao')}" href="/pages/cartao.html">${ICONE_CARTAO}Cartão</a>
        <a class="nav-item ${ativo('extrato')}" href="/pages/extrato.html">${ICONE_EXTRATO}Extrato</a>
        <button type="button" class="nav-item ${noMais ? 'ativo' : ''}" id="btn-abrir-mais">${ICONE_MAIS}Mais</button>
      </div>
    </div>
  `;

  document.body.insertAdjacentHTML('beforeend', `
    <div class="sheet-overlay" id="sheet-mais" hidden>
      <div class="sheet">
        <div class="sheet-handle"></div>
        <div class="sheet-titulo">Mais</div>
        <a class="mais-item ${ativo('cadastros')}" href="/pages/cadastros.html">${ICONE_CADASTROS}Cadastros</a>
        <a class="mais-item ${ativo('investimentos')}" href="/pages/investimentos.html">${ICONE_INVESTIR}Investimentos</a>
        <a class="mais-item ${ativo('offshore')}" href="/pages/offshore.html">${ICONE_OFFSHORE}Offshore</a>
        <a class="mais-item ${ativo('relatorios')}" href="/pages/relatorios.html">${ICONE_RELATORIOS}Relatórios</a>
        <a class="mais-item ${ativo('projecao')}" href="/pages/projecao.html">${ICONE_PROJECAO}Saldo projetado</a>
        <a class="mais-item ${ativo('saude')}" href="/pages/saude.html">${ICONE_SAUDE}Saúde Financeira</a>
        <a class="mais-item ${ativo('parcelamentos')}" href="/pages/parcelamentos.html">${ICONE_PARCELAMENTOS}Parcelamentos</a>
        <a class="mais-item ${ativo('aparencia')}" href="/pages/aparencia.html">${ICONE_APARENCIA}Aparência</a>
        <button type="button" class="mais-item perigo" id="btn-sair-nav">${ICONE_SAIR}Sair</button>
      </div>
    </div>
  `);

  const sheet = document.getElementById('sheet-mais');
  document.getElementById('btn-abrir-mais').addEventListener('click', () => { sheet.hidden = false; });
  sheet.addEventListener('click', (e) => { if (e.target === sheet) sheet.hidden = true; });
  ativarArrastarParaFechar(sheet);
}
