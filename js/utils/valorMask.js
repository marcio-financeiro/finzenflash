// Máscara de valor monetário para campos de texto comuns (fora do teclado
// numérico dedicado de Lançar/Comprar no cartão/Transferir, que já tem seu
// próprio padrão de "centavos digitados"). O usuário digita só números — a
// vírgula dos centavos e o ponto de milhar aparecem sozinhos, e o texto
// resultante já sai no formato que lerValorMonetario() espera ("1.234,56").

export function attachValorMask(input) {
  if (!input || input.dataset.valorMascarado) return;
  input.dataset.valorMascarado = '1';

  const formatarDigitado = () => {
    // Saldo de conta pode ser negativo (conta no vermelho) — mantém o sinal
    // se já estava lá, mas todo o resto do texto vira só dígitos.
    const negativo = input.value.trim().startsWith('-');
    const digitos = input.value.replace(/\D/g, '');
    const centavos = Number(digitos || '0');
    const formatado = (centavos / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    input.value = negativo && centavos !== 0 ? `-${formatado}` : formatado;
  };

  input.addEventListener('input', formatarDigitado);

  // Valor inicial (pré-preenchido pelo JS ao editar um registro existente) é
  // um número de verdade, não uma sequência de dígitos digitados — tratá-lo
  // como "dígitos = centavos" (a mesma lógica do digitado) erraria: "0,1"
  // viraria "0,01" e "1000" viraria "10,00". Aqui só a vírgula do valor
  // recebido é a separadora decimal (o valor nunca chega com ponto de
  // milhar, é sempre um Number.toString() com '.' trocado por ',').
  const bruto = input.value.trim();
  if (bruto) {
    const negativo = bruto.startsWith('-');
    const numero = Number(bruto.replace('-', '').replace(',', '.'));
    if (Number.isFinite(numero)) {
      const formatado = numero.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      input.value = negativo && numero !== 0 ? `-${formatado}` : formatado;
    }
  }
}
