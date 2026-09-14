// sw.js — cache do app shell (HTML/CSS/JS/CDN) pra evitar tela branca sem
// sinal. Estratégia network-first: online, sempre busca a versão nova (não
// briga com o Cache-Control: must-revalidate do vercel.json); offline, cai
// pro que foi cacheado na última visita com sinal.
//
// NUNCA cacheia *.supabase.co nem /api/* — são dados financeiros e
// respostas de IA, sempre precisam vir frescos da rede, nunca de um cache
// que pode estar desatualizado ou (pior) enganar o usuário com saldo velho.
const CACHE = 'finzenflash-shell-v3';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((chaves) => Promise.all(chaves.filter((c) => c !== CACHE).map((c) => caches.delete(c))))
      .then(() => self.clients.claim()),
  );
});

function devePassarDireto(url) {
  return url.pathname.startsWith('/api/') || url.hostname.endsWith('.supabase.co');
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (devePassarDireto(url)) return;

  event.respondWith(
    fetch(req)
      .then((res) => {
        // res.ok cobre same-origin/CORS normal; type 'opaque' é o caso
        // esperado de recurso cross-origin sem CORS (ex: Google Fonts via
        // <link>, sem crossorigin) — não dá pra checar status, mas não é erro.
        if (res && (res.ok || res.type === 'opaque')) {
          const copia = res.clone();
          // waitUntil segura o service worker vivo até a escrita terminar —
          // sem isso, requisições rápidas (JS pequeno) respondiam a tempo
          // mas perdiam a gravação no cache porque o SW já tinha sido
          // encerrado antes da Promise de cache.put() resolver.
          event.waitUntil(caches.open(CACHE).then((cache) => cache.put(req, copia)).catch(() => {}));
        }
        return res;
      })
      .catch(() => caches.match(req).then((resp) => {
        if (resp) return resp;
        if (req.mode === 'navigate') return caches.match('/index.html');
        // Nunca devolver undefined pro FetchEvent — sem cache nem rede,
        // um 504 explícito é mais seguro que violar o contrato do respondWith.
        return new Response('', { status: 504, statusText: 'Offline' });
      })),
  );
});
