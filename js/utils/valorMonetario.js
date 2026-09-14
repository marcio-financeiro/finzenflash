// Lê um valor digitado no formato "1.234,56" (máscara de campo monetário
// PT-BR — ver utils/valorMask.js) e devolve o número (ou 0 se inválido).
export function lerValorMonetario(bruto) {
  const normalizado = String(bruto ?? '').trim().replace(/\./g, '').replace(',', '.');
  const numero = Number(normalizado);
  return Number.isFinite(numero) ? numero : 0;
}

export function lerValorMonetarioPorId(id) {
  return lerValorMonetario(document.getElementById(id).value);
}
