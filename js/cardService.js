// Cálculo de referência de fatura — mesma regra usada no FinZen
// (database/schema.sql + js/services/cardService.js), reimplementada aqui
// para as duas contas gerarem a mesma fatura para a mesma compra.
// Compra após o fechamento → cai na próxima fatura.
// Vencimento antes do fechamento → fatura vence no mês seguinte.

export function invoiceRef(dateISO, closingDay, dueDay) {
  const [y, m, d] = dateISO.split('-').map(Number);
  let date = new Date(y, m - 1, 1);
  if (d > Number(closingDay || 1)) {
    date = new Date(y, m, 1);
  }
  if (dueDay && Number(dueDay) < Number(closingDay)) {
    date = new Date(date.getFullYear(), date.getMonth() + 1, 1);
  }
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

export function addMonthsRef(ref, months) {
  const [y, m] = ref.split('-').map(Number);
  const date = new Date(y, m - 1 + months, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

export function novoGrupoCompra() {
  return crypto?.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2);
}
