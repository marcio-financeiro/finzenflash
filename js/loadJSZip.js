// Carrega o JSZip sob demanda — mesmo padrão de loadChart.js.
let jszipPromise = null;

export function loadJSZip() {
  if (window.JSZip) return Promise.resolve(window.JSZip);
  if (jszipPromise) return jszipPromise;

  jszipPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
    script.onload = () => resolve(window.JSZip);
    script.onerror = () => { jszipPromise = null; reject(new Error('Falha ao carregar JSZip')); };
    document.head.appendChild(script);
  });

  return jszipPromise;
}
