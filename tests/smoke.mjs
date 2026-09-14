import { chromium } from 'playwright';

const BASE = 'http://127.0.0.1:8765';
const MOBILE = ['home', 'lancar', 'extrato', 'cartao', 'comprar-cartao', 'transferir', 'cadastros', 'investimentos', 'offshore', 'relatorios', 'projecao', 'saude', 'parcelamentos', 'aparencia', 'luna'];
const DESKTOP = ['home', 'lancar', 'extrato', 'cartao', 'comprar-cartao', 'transferir', 'cadastros', 'investimentos', 'offshore', 'relatorios', 'projecao', 'saude', 'parcelamentos', 'aparencia', 'luna'];

const REF = 'qgamphwnlrriwalcbhbl';
// JWT sintático (não válido no servidor) — só pra supabase.getSession() devolver
// uma sessão local e a página seguir além do requireAuth.
function fakeJwt() {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: '00000000-0000-4000-8000-000000000001', role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 })}.x`;
}
const fakeSession = {
  access_token: fakeJwt(),
  refresh_token: 'fake',
  token_type: 'bearer',
  expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  user: { id: '00000000-0000-4000-8000-000000000001', aud: 'authenticated', role: 'authenticated', email: 'teste@example.com', app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() },
};


// Stub do supabase-js servido no lugar do CDN (o sandbox não alcança
// cdn.jsdelivr.net). Toda query devolve lista vazia sem erro; single()/
// maybeSingle() devolvem null; rpc devolve ok. getSession lê o mesmo
// localStorage que o cliente real usaria.
const SUPABASE_STUB = `
function builder() {
  let unico = false;
  const p = new Proxy(function () {}, {
    get(_, k) {
      if (k === 'then') return (res, rej) => Promise.resolve({ data: unico ? null : [], error: null, count: 0 }).then(res, rej);
      if (k === 'single' || k === 'maybeSingle') return () => { unico = true; return p; };
      return () => p;
    },
  });
  return p;
}
export function createClient() {
  return {
    from: () => builder(),
    rpc: () => Promise.resolve({ data: null, error: null }),
    auth: {
      getSession: async () => {
        try {
          const raw = localStorage.getItem('sb-${REF}-auth-token');
          return { data: { session: raw ? JSON.parse(raw) : null } };
        } catch { return { data: { session: null } }; }
      },
      signOut: async () => ({ error: null }),
    },
  };
}
`;

async function instalarRotas(context) {
  await context.route(/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js/, (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: SUPABASE_STUB }));
  await context.route(/fonts\.googleapis\.com|fonts\.gstatic\.com|cdnjs\.cloudflare\.com/, (route) => route.abort());
}

const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
let falhas = 0;

async function abrir(context, url, { esperarRedirect } = {}) {
  const page = await context.newPage();
  const erros = [];
  page.on('pageerror', (e) => erros.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text();
    // 401/403 do Supabase e falha de rede da API são esperados com sessão falsa.
    if (/supabase\.co|Failed to load resource|net::ERR|api\/luna|api\/quotes|401|403|JWT|PGRST|Falha ao carregar Chart\.js/i.test(t)) return;
    erros.push(`console.error: ${t}`);
  });
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForTimeout(900);
  const finalUrl = page.url();
  return { page, erros, finalUrl };
}

const SOMENTE_REGRESSAO = process.env.SOMENTE === 'regressao';
// ── 1) Sem sessão: toda página autenticada deve redirecionar pro login sem exceção JS ──
if (!SOMENTE_REGRESSAO) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await instalarRotas(ctx);
  for (const p of MOBILE) {
    const { page, erros, finalUrl } = await abrir(ctx, `${BASE}/pages/${p}.html`);
    const ok = erros.length === 0 && finalUrl.endsWith('/index.html');
    if (!ok) falhas++;
    console.log(`${ok ? 'OK ' : 'ERR'} [sem sessão][mobile] ${p} → ${finalUrl.replace(BASE, '')} ${erros.join(' | ')}`);
    await page.close();
  }
  await ctx.close();
  const ctxD = await browser.newContext({ viewport: { width: 1366, height: 800 } });
  await instalarRotas(ctxD);
  for (const p of DESKTOP) {
    const { page, erros, finalUrl } = await abrir(ctxD, `${BASE}/pages/desktop/${p}.html`);
    const ok = erros.length === 0 && finalUrl.endsWith('/index.html');
    if (!ok) falhas++;
    console.log(`${ok ? 'OK ' : 'ERR'} [sem sessão][desktop] ${p} → ${finalUrl.replace(BASE, '')} ${erros.join(' | ')}`);
    await page.close();
  }
  await ctxD.close();
}

// ── 2) Com sessão falsa: página segue, dados falham (401) mas sem exceção JS ──
async function ctxComSessao(viewport) {
  const ctx = await browser.newContext({ viewport });
  await instalarRotas(ctx);
  await ctx.addInitScript(([key, sess]) => {
    try { localStorage.setItem(key, JSON.stringify(sess)); } catch {}
  }, [`sb-${REF}-auth-token`, fakeSession]);
  return ctx;
}
{
  const ctx = await ctxComSessao({ width: 390, height: 844 });
  for (const p of (SOMENTE_REGRESSAO ? [] : MOBILE)) {
    const { page, erros, finalUrl } = await abrir(ctx, `${BASE}/pages/${p}.html`);
    const ok = erros.length === 0 && !finalUrl.endsWith('/index.html');
    if (!ok) falhas++;
    console.log(`${ok ? 'OK ' : 'ERR'} [sessão][mobile] ${p} → ${finalUrl.replace(BASE, '')} ${erros.join(' | ')}`);
    await page.close();
  }

  // 2b) Regressão: visibilitychange não pode duplicar listeners/sheet "Mais" na Home
  const { page, erros } = await abrir(ctx, `${BASE}/pages/home.html`);
  const antes = await page.locator('#sheet-mais').count();
  await page.evaluate(() => { document.dispatchEvent(new Event('visibilitychange')); });
  await page.waitForTimeout(800);
  await page.evaluate(() => { document.dispatchEvent(new Event('visibilitychange')); });
  await page.waitForTimeout(800);
  const depois = await page.locator('#sheet-mais').count();
  const mes0 = await page.locator('#mes-atual').textContent();
  await page.click('#btn-mes-anterior');
  await page.waitForTimeout(300);
  const mes1 = await page.locator('#mes-atual').textContent();
  await page.click('#btn-mes-anterior');
  await page.waitForTimeout(300);
  const mes2 = await page.locator('#mes-atual').textContent();
  const meses = ['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];
  const idx = (t) => meses.indexOf(t.trim().toLowerCase());
  const passo1 = (idx(mes0) - idx(mes1) + 12) % 12;
  const passo2 = (idx(mes1) - idx(mes2) + 12) % 12;
  const okDup = antes === 1 && depois === 1 && passo1 === 1 && passo2 === 1 && erros.length === 0;
  if (!okDup) falhas++;
  console.log(`${okDup ? 'OK ' : 'ERR'} [regressão listeners] sheet-mais antes=${antes} depois=${depois}; mês ${mes0}→${mes1}→${mes2} (passos ${passo1},${passo2}) ${erros.join(' | ')}`);

  // 2c) Cadastros: mesmo teste com o mês do orçamento
  const c = await abrir(ctx, `${BASE}/pages/cadastros.html`);
  await c.page.evaluate(() => { document.dispatchEvent(new Event('visibilitychange')); document.dispatchEvent(new Event('visibilitychange')); });
  await c.page.waitForTimeout(800);
  const sheetsMais = await c.page.locator('#sheet-mais').count();
  const okCad = sheetsMais === 1 && c.erros.length === 0;
  if (!okCad) falhas++;
  console.log(`${okCad ? 'OK ' : 'ERR'} [regressão listeners cadastros] sheet-mais=${sheetsMais} ${c.erros.join(' | ')}`);

  // 2d) comprar-cartao com ?grupo=null não pode explodir
  const g = await abrir(ctx, `${BASE}/pages/comprar-cartao.html?grupo=null`);
  const msg = await g.page.locator('#erro-cartao').textContent();
  const okG = g.erros.length === 0 && /Compra antiga/.test(msg);
  if (!okG) falhas++;
  console.log(`${okG ? 'OK ' : 'ERR'} [comprar-cartao ?grupo=null] msg="${msg}" ${g.erros.join(' | ')}`);
  await ctx.close();

  const ctxD = await ctxComSessao({ width: 1366, height: 800 });
  for (const p of (SOMENTE_REGRESSAO ? [] : DESKTOP)) {
    const r = await abrir(ctxD, `${BASE}/pages/desktop/${p}.html`);
    const ok = r.erros.length === 0 && !r.finalUrl.endsWith('/index.html');
    if (!ok) falhas++;
    console.log(`${ok ? 'OK ' : 'ERR'} [sessão][desktop] ${p} → ${r.finalUrl.replace(BASE, '')} ${r.erros.join(' | ')}`);
    await r.page.close();
  }
  await ctxD.close();
}

await browser.close();
console.log(falhas === 0 ? '\nTODOS OS TESTES PASSARAM' : `\n${falhas} FALHA(S)`);
process.exit(falhas === 0 ? 0 : 1);
