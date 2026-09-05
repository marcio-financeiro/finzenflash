/**
 * quoteCache.js — Cache inteligente de cotações
 *
 * Dois níveis de proteção:
 * 1. Cache em memória (deduplicação): mesma requisição em voo → retorna a mesma Promise
 * 2. Cache em localStorage (TTL): cotações válidas por 15 min → não bate na API
 */

const TTL_MS       = 15 * 60 * 1000; // 15 minutos
const CACHE_KEY    = 'finzenflash_quote_cache_v1';
const _emFlight    = new Map(); // deduplicação: chave → Promise em andamento

// ── Persistência localStorage ─────────────────────────────────────────────────

function lerCache() {
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
  } catch (_) { return {}; }
}

function salvarCache(dados) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(dados));
  } catch (_) {}
}

function cacheValido(entrada) {
  return entrada && (Date.now() - entrada.ts) < TTL_MS;
}

// ── API pública ───────────────────────────────────────────────────────────────

/**
 * Busca cotações com cache inteligente.
 * @param {string[]} tickers — ex: ['PETR4', 'AAPL']
 * @param {boolean} comDolar — incluir USD-BRL
 * @param {boolean} forcar   — ignorar cache e buscar na API
 * @returns {Promise<Object>} — { TICKER: preco, 'USD-BRL': valor }
 */
export async function getCotacoes(tickers = [], comDolar = true, forcar = false) {
  const cache = lerCache();
  const resultado = {};
  const buscar   = []; // tickers que precisam ir à API

  if (!forcar) {
    if (comDolar && cacheValido(cache['USD-BRL'])) {
      resultado['USD-BRL'] = cache['USD-BRL'].v;
    } else if (comDolar) {
      buscar.push('__DOLAR__');
    }

    for (const t of tickers) {
      const key = t.toUpperCase();
      if (cacheValido(cache[key])) {
        resultado[key] = cache[key].v;
      } else {
        buscar.push(key);
      }
    }
  } else {
    if (comDolar) buscar.push('__DOLAR__');
    buscar.push(...tickers.map(t => t.toUpperCase()));
  }

  if (buscar.length === 0) {
    return resultado;
  }

  const chaveVoo = buscar.sort().join(',');

  if (_emFlight.has(chaveVoo)) {
    const dados = await _emFlight.get(chaveVoo);
    return { ...resultado, ...dados };
  }

  const params = new URLSearchParams();
  const tickersReais = buscar.filter(t => t !== '__DOLAR__');
  if (tickersReais.length) params.set('tickers', tickersReais.join(','));
  if (buscar.includes('__DOLAR__') || comDolar) params.set('dolar', 'true');

  const promise = fetch(`/api/quotes?${params}`)
    .then(r => r.ok ? r.json() : {})
    .catch(() => null)
    .finally(() => _emFlight.delete(chaveVoo));

  _emFlight.set(chaveVoo, promise);

  const dados = await promise;

  if (dados === null) {
    // Falha de rede — usar o que tiver no cache, mesmo vencido
    const cacheAntigo = lerCache();
    for (const t of tickers) {
      const key = t.toUpperCase();
      if (cacheAntigo[key]) resultado[key] = cacheAntigo[key].v;
    }
    if (comDolar && cacheAntigo['USD-BRL']) resultado['USD-BRL'] = cacheAntigo['USD-BRL'].v;
    return resultado;
  }

  const agora = Date.now();
  const cacheAtual = lerCache();
  for (const [k, v] of Object.entries(dados)) {
    cacheAtual[k] = { v, ts: agora };
  }
  salvarCache(cacheAtual);

  return { ...resultado, ...dados };
}

/**
 * Limpa o cache manualmente (ex: botão "Atualizar" forçado).
 */
export function limparCache() {
  localStorage.removeItem(CACHE_KEY);
}
