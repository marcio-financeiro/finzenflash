import { escapeHtml } from './escapeHtml.js';

// `desktop = true` adiciona a classe usada pelos campos das páginas
// desktop — o resto do HTML é igual em mobile e desktop.
export function campoTexto(id, label, valor, placeholder = '', desktop = false) {
  return `
    <div class="field">
      <label for="${id}">${label}</label>
      <input type="text" ${desktop ? 'class="input-desktop" ' : ''}id="${id}" value="${escapeHtml(valor ?? '')}" placeholder="${placeholder}">
    </div>
  `;
}

// `opcoes` aceita string simples ou { valor, texto }.
export function campoSelect(id, label, opcoes, valorAtual, desktop = false) {
  const options = opcoes.map((o) => {
    const valor = typeof o === 'string' ? o : o.valor;
    const texto = typeof o === 'string' ? o : o.texto;
    return `<option value="${escapeHtml(valor)}" ${valor === valorAtual ? 'selected' : ''}>${escapeHtml(texto)}</option>`;
  }).join('');
  return `
    <div class="field">
      <label for="${id}">${label}</label>
      <select ${desktop ? 'class="input-desktop" ' : ''}id="${id}">${options}</select>
    </div>
  `;
}
