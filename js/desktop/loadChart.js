// js/desktop/loadChart.js — mesmo Chart.js do mobile (js/loadChart.js), só que
// aplicando a tipografia/curva padrão da versão desktop na primeira vez que
// carrega. Não mexe em js/loadChart.js pra não afetar os gráficos do mobile.
import { loadChart as loadChartBase } from '../loadChart.js';

let aplicado = false;

export async function loadChart() {
  const Chart = await loadChartBase();
  if (!aplicado) {
    aplicado = true;
    const muted = getComputedStyle(document.documentElement).getPropertyValue('--muted').trim();
    Chart.defaults.font.family = "'Inter', -apple-system, sans-serif";
    if (muted) Chart.defaults.color = muted;
    Chart.defaults.elements.line.tension = 0.35;
    Chart.defaults.elements.line.borderWidth = 2.5;
    Chart.defaults.elements.point.hoverRadius = 5;
  }
  return Chart;
}
