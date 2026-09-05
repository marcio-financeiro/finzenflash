// Carrega o Chart.js sob demanda (só quando um gráfico vai ser desenhado),
// cacheando a Promise para chamadas repetidas na mesma página.
let chartPromise = null;

export function loadChart() {
  if (window.Chart) return Promise.resolve(window.Chart);
  if (chartPromise) return chartPromise;

  chartPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js';
    script.onload = () => resolve(window.Chart);
    script.onerror = () => { chartPromise = null; reject(new Error('Falha ao carregar Chart.js')); };
    document.head.appendChild(script);
  });

  return chartPromise;
}
