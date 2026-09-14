// api/_cors.js — origem permitida pros endpoints da API.
// Arquivos com _ no início não viram endpoint na Vercel.
//
// Antes cada endpoint travava CORS só em https://finzenflash.vercel.app —
// funcionava em produção, mas qualquer deploy de preview da Vercel
// (finzenflash-git-<branch>-....vercel.app) ou teste local
// (http://localhost:xxxx) ficava sem Luna/cotações, sem aviso nenhum na
// tela (o navegador bloqueia silenciosamente por CORS).

const ORIGENS_PERMITIDAS = [
  /^https:\/\/finzenflash\.vercel\.app$/,
  // Previews da Vercel para este projeto (nome pode variar por deploy).
  /^https:\/\/finzenflash(-git-[a-z0-9-]+)?(-[a-z0-9]+)?(-[a-z0-9-]+)?\.vercel\.app$/,
  /^https?:\/\/localhost:\d+$/,
  /^https?:\/\/127\.0\.0\.1:\d+$/,
];

export function origemPermitida(req) {
  const origin = req.headers['origin'] || '';
  return ORIGENS_PERMITIDAS.some((re) => re.test(origin)) ? origin : 'https://finzenflash.vercel.app';
}

export function aplicarCors(req, res, metodos = 'GET, OPTIONS') {
  res.setHeader('Access-Control-Allow-Origin', origemPermitida(req));
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', metodos);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}
