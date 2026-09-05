// api/quotes.js — Proxy de cotações (mesma lógica do FinZen original)
// Node.js serverless (não Edge — Edge bloqueia chamadas externas)
// GET /api/quotes?tickers=PETR4,AAPL&dolar=true
// Endpoint público (sem auth) — rate limit por IP evita fan-out abusivo.

import { checarLimiteIP } from './_ipRateLimit.js';

export default async function handler(req, res) {

  // ── CORS ──────────────────────────────────────────────────────────────────
  res.setHeader('Access-Control-Allow-Origin', 'https://finzenflash.vercel.app');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'public, max-age=300'); // cache 5 min no browser

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  const { permitido } = checarLimiteIP(req, { limite: 30, janelaMs: 60_000 });
  if (!permitido) {
    return res.status(429).json({ error: 'Muitas requisições, tente novamente em instantes.' });
  }

  const { tickers: tickersRaw, dolar, fundamental, change } = req.query;
  const withChange = change === 'true';
  // Validação estrita + limite: evita fan-out abusivo ao brapi e injeção na URL
  const tickers = (tickersRaw || '').split(',')
    .map(t => t.trim().toUpperCase())
    .filter(t => /^[A-Z0-9.=-]{1,12}$/.test(t))
    .slice(0, 40);
  const resultado = {};

  const BRAPI_TOKEN = process.env.BRAPI_TOKEN;

  const fetchTimeout = async (url, opts = {}, ms = 5000) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ms);
    try {
      return await fetch(url, { ...opts, signal: ctrl.signal });
    } finally {
      clearTimeout(timer);
    }
  };

  // ── Dólar — Yahoo (query1 ∥ query2 em paralelo) + awesomeapi fallback ────
  // Roda em paralelo com a busca de tickers e é aguardado no final —
  // antes eram até 10s sequenciais ANTES dos tickers (risco de timeout).
  const dolarPromise = dolar !== 'true' ? null : (async () => {
    const yahoo = async (base) => {
      const r = await fetchTimeout(`${base}/v8/finance/chart/BRL=X?interval=1d&range=1d`,
        { headers: { 'User-Agent': 'Mozilla/5.0' } });
      if (!r.ok) throw new Error('yahoo fail');
      const j = await r.json();
      const p = parseFloat(j?.chart?.result?.[0]?.meta?.regularMarketPrice || 0);
      if (p > 0) return p;
      throw new Error('sem preço');
    };
    try {
      return await Promise.any([
        yahoo('https://query1.finance.yahoo.com'),
        yahoo('https://query2.finance.yahoo.com'),
      ]);
    } catch (_) {}
    try {
      const r = await fetchTimeout('https://economia.awesomeapi.com.br/json/last/USD-BRL', {}, 4000);
      if (r.ok) {
        const j = await r.json();
        const v = parseFloat(j?.USDBRL?.bid || 0);
        if (v > 0) return v;
      }
    } catch (_) {}
    return null;
  })();

  if (!tickers.length) {
    if (dolarPromise) {
      const v = await dolarPromise;
      if (v) resultado['USD-BRL'] = v;
    }
    return res.status(200).json(resultado);
  }

  // ── Separar BR de EUA ─────────────────────────────────────────────────────
  // BR: contém número (PETR4, BBAS3, MXRF11...)
  // EUA: só letras A-Z, 1 a 5 caracteres (AAPL, VTI...)
  const tickersBR  = tickers.filter(t => /\d/.test(t));
  const tickersEUA = tickers.filter(t => /^[A-Z]{1,5}$/.test(t));

  // ── Cotações BR — brapi.dev (1 ativo por req no plano free → paralelo) ────
  if (tickersBR.length && BRAPI_TOKEN) {
    const fundParams = fundamental === 'true' ? '&fundamental=true' : '';
    // Uma tentativa extra após falha: sob carga (muitos tickers em paralelo),
    // a brapi.dev ocasionalmente falha um subconjunto aleatório (rate limit
    // transitório) — retry com pequeno atraso recupera a maioria dos casos.
    // Falha final é logada (visível nos Logs do Vercel) em vez de sumir sem rastro.
    const fetchBR = async (ticker, tentativa = 1) => {
      let motivo;
      try {
        const r = await fetchTimeout(
          `https://brapi.dev/api/quote/${encodeURIComponent(ticker)}?token=${BRAPI_TOKEN}${fundParams}`,
          { headers: { 'User-Agent': 'FinZenFlash/1.0' } }
        );
        if (!r.ok) motivo = `HTTP ${r.status}`;
        else {
          const j = await r.json();
          const item = j.results?.[0] || null;
          if (item) return item;
          motivo = 'sem resultado';
        }
      } catch (e) { motivo = e.message; }

      if (tentativa === 1) {
        await new Promise(res => setTimeout(res, 400));
        return fetchBR(ticker, 2);
      }
      console.error(`brapi.dev falhou para ${ticker}: ${motivo}`);
      return null;
    };

    const resBR = await Promise.allSettled(
      [...new Set(tickersBR)].map(t => fetchBR(t))
    );
    resBR.forEach(r => {
      if (r.status === 'fulfilled' && r.value) {
        const i = r.value;
        if (i.symbol && i.regularMarketPrice) {
          const key = i.symbol.toUpperCase();
          resultado[key] = parseFloat(i.regularMarketPrice);
          if (withChange) resultado[`${key}_chg`] = i.regularMarketChangePercent ?? null;
          if (fundamental === 'true') {
            resultado[`${key}_fund`] = {
              nome:          i.longName || i.shortName || '',
              setor:         i.sector   || '',
              pl:            i.priceEarnings              ?? null,
              pvp:           i.priceToBook                ?? null,
              dy:            i.dividendYield              ?? null,
              roe:           i.returnOnEquity             ?? null,
              margemLiquida: i.netMargin                  ?? null,
              lpa:           i.earningsPerShare           ?? null,
              vpa:           i.bookValuePerShare          ?? null,
              varPct:        i.regularMarketChangePercent ?? null,
              maxAnual:      i.fiftyTwoWeekHigh           ?? null,
              minAnual:      i.fiftyTwoWeekLow            ?? null,
              volumeMedio:   i.averageDailyVolume3Month   ?? null,
              marketCap:     i.marketCap                  ?? null,
            };
          }
        }
      }
    });
  }

  // ── Cotações EUA — Yahoo Finance (paralelo, com timeout e fallback query2) ─
  if (tickersEUA.length) {
    const YAHOO_TIMEOUT_MS = 5000;

    const fetchYahoo = async (ticker) => {
      const endpoints = [
        `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=1d`,
        `https://query2.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=1d`,
      ];
      for (const url of endpoints) {
        try {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), YAHOO_TIMEOUT_MS);
          const r = await fetch(url, {
            headers: { 'User-Agent': 'Mozilla/5.0' },
            signal: controller.signal,
          });
          clearTimeout(timer);
          if (!r.ok) continue;
          const j = await r.json();
          const meta = j?.chart?.result?.[0]?.meta;
          const p = meta?.regularMarketPrice;
          if (p) {
            const prevClose = meta?.chartPreviousClose || meta?.previousClose || meta?.regularMarketPreviousClose;
            const changePct = meta?.regularMarketChangePercent
              ?? (prevClose ? parseFloat(((p - prevClose) / prevClose * 100).toFixed(4)) : null);
            return { ticker, price: parseFloat(p), changePct };
          }
        } catch (_) {}
      }
      return null;
    };

    const resultados = await Promise.allSettled(
      [...new Set(tickersEUA)].map(t => fetchYahoo(t))
    );
    resultados.forEach(r => {
      if (r.status === 'fulfilled' && r.value) {
        resultado[r.value.ticker] = r.value.price;
        if (withChange && r.value.changePct !== null) resultado[`${r.value.ticker}_chg`] = r.value.changePct;
      }
    });
  }

  // ── Fallback brapi para tickers EUA que não vieram do Yahoo ──────────────
  const faltando = tickers.filter(t => !resultado[t] && t !== 'USD-BRL');
  if (faltando.length && BRAPI_TOKEN) {
    try {
      const lista = [...new Set(faltando)].map(encodeURIComponent).join(',');
      const r = await fetchTimeout(
        `https://brapi.dev/api/quote/${lista}?token=${BRAPI_TOKEN}`,
        { headers: { 'User-Agent': 'FinZenFlash/1.0' } }
      );
      if (r.ok) {
        const j = await r.json();
        (j.results || []).forEach(i => {
          const sym = i.symbol?.toUpperCase();
          if (sym && i.regularMarketPrice && !resultado[sym]) {
            resultado[sym] = parseFloat(i.regularMarketPrice);
            if (withChange) resultado[`${sym}_chg`] = i.regularMarketChangePercent ?? null;
          }
        });
      }
    } catch (_) {}
  }

  if (dolarPromise) {
    const v = await dolarPromise;
    if (v) resultado['USD-BRL'] = v;
  }

  return res.status(200).json(resultado);
}
