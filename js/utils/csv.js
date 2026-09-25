// csv.js — conversão de array de objetos pra texto CSV pronto pra abrir no
// Excel/Google Sheets. Números saem crus (sem "R$", sem separador de
// milhar), datas em ISO, valores ausentes saem como célula vazia (é assim
// que CSV representa null — não existe um "null" literal no formato).

function escaparCampo(valor) {
  if (valor === null || valor === undefined) return '';
  const texto = typeof valor === 'boolean' ? String(valor) : String(valor);
  if (/[",\n;]/.test(texto)) {
    return `"${texto.replace(/"/g, '""')}"`;
  }
  return texto;
}

/** @param {object[]} linhas @param {string[]} colunas ordem das colunas no CSV */
export function paraCSV(linhas, colunas) {
  const cabecalho = colunas.join(',');
  const corpo = linhas.map((linha) => colunas.map((col) => escaparCampo(linha[col])).join(',')).join('\n');
  // BOM UTF-8 — sem isso o Excel no Windows abre acentos quebrados.
  return '﻿' + cabecalho + '\n' + corpo;
}
