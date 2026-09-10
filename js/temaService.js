// Permite trocar a cor de destaque do app (--accent/--accent-grad-*/--accent-soft)
// sem tocar em --bg/--surface/--text — só a "cor da marca" muda, o resto do
// tema claro/escuro continua vindo normalmente de css/variables.css.
export const TEMAS = [
  { id: 'padrao', nome: 'Esmeralda', light: { accent: '#0E7C86', grad1: '#0E7C86', grad2: '#14A3AE', soft: '#dcf3ef' }, dark: { accent: '#22B8B0', grad1: '#0E7C86', grad2: '#1AA6A0', soft: '#163330' } },
  { id: 'azul', nome: 'Azul Oceano', light: { accent: '#1D4ED8', grad1: '#1D4ED8', grad2: '#3B82F6', soft: '#dbe7fb' }, dark: { accent: '#5B9DFF', grad1: '#2F6FE0', grad2: '#7AB2FF', soft: '#16232f' } },
  { id: 'roxo', nome: 'Roxo Ametista', light: { accent: '#7C3AED', grad1: '#7C3AED', grad2: '#A78BFA', soft: '#ece3fc' }, dark: { accent: '#A78BFA', grad1: '#7C3AED', grad2: '#C4B5FD', soft: '#241f38' } },
  { id: 'laranja', nome: 'Laranja Vivo', light: { accent: '#EA580C', grad1: '#EA580C', grad2: '#FB923C', soft: '#fde6d3' }, dark: { accent: '#FB923C', grad1: '#EA580C', grad2: '#FDBA74', soft: '#33220f' } },
  { id: 'rosa', nome: 'Rosa Coral', light: { accent: '#DB2777', grad1: '#DB2777', grad2: '#F472B6', soft: '#fbdce9' }, dark: { accent: '#F472B6', grad1: '#DB2777', grad2: '#F9A8D4', soft: '#331822' } },
  { id: 'dourado', nome: 'Dourado', light: { accent: '#CA8A04', grad1: '#CA8A04', grad2: '#FACC15', soft: '#fdf2cf' }, dark: { accent: '#FACC15', grad1: '#CA8A04', grad2: '#FDE047', soft: '#332b12' } },
  { id: 'grafite', nome: 'Ardósia', light: { accent: '#475569', grad1: '#475569', grad2: '#64748B', soft: '#e2e8ef' }, dark: { accent: '#94A3B8', grad1: '#475569', grad2: '#CBD5E1', soft: '#1e2530' } },
  { id: 'indigo', nome: 'Índigo', light: { accent: '#4338CA', grad1: '#4338CA', grad2: '#6366F1', soft: '#e2e1fb' }, dark: { accent: '#818CF8', grad1: '#4338CA', grad2: '#A5B4FC', soft: '#211f38' } },
  { id: 'ciano', nome: 'Ciano', light: { accent: '#0891B2', grad1: '#0891B2', grad2: '#22D3EE', soft: '#d3f3fa' }, dark: { accent: '#22D3EE', grad1: '#0891B2', grad2: '#67E8F9', soft: '#0f2c33' } },
  { id: 'verde', nome: 'Verde Musgo', light: { accent: '#4D7C0F', grad1: '#4D7C0F', grad2: '#84CC16', soft: '#e3f2ce' }, dark: { accent: '#A3E635', grad1: '#4D7C0F', grad2: '#BEF264', soft: '#26300f' } },
  { id: 'vinho', nome: 'Vinho', light: { accent: '#9F1239', grad1: '#9F1239', grad2: '#E11D48', soft: '#fbdce3' }, dark: { accent: '#FB7185', grad1: '#9F1239', grad2: '#FDA4AF', soft: '#33121a' } },
  { id: 'cafe', nome: 'Café', light: { accent: '#78350F', grad1: '#78350F', grad2: '#A16207', soft: '#ece0cf' }, dark: { accent: '#D4A373', grad1: '#78350F', grad2: '#E3B778', soft: '#2c2013' } },
  { id: 'petroleo', nome: 'Azul Petróleo', light: { accent: '#1E3A5F', grad1: '#1E3A5F', grad2: '#2C5282', soft: '#dbe6f0' }, dark: { accent: '#7DA3D0', grad1: '#1E3A5F', grad2: '#4A7AB5', soft: '#16202e' } },
  { id: 'tiffany', nome: 'Tiffany', light: { accent: '#16A66B', grad1: '#16A66B', grad2: '#21F1A8', soft: '#d7fbe9' }, dark: { accent: '#21F1A8', grad1: '#16A66B', grad2: '#6FFFC4', soft: '#0f2e22' } },
  { id: 'lima', nome: 'Lime Sprout', light: { accent: '#6B9E2A', grad1: '#6B9E2A', grad2: '#E4FD97', soft: '#f2fbd9' }, dark: { accent: '#C4E86B', grad1: '#7CB518', grad2: '#E4FD97', soft: '#232b1c' } },
  { id: 'cyprus', nome: 'Cyprus', light: { accent: '#004741', grad1: '#004741', grad2: '#0B6B63', soft: '#dcece9' }, dark: { accent: '#2FA89C', grad1: '#004741', grad2: '#5FCBBF', soft: '#0e2624' } },
  { id: 'truepink', nome: 'True Pink', light: { accent: '#E01238', grad1: '#E01238', grad2: '#FD1843', soft: '#ffe1e6' }, dark: { accent: '#FD1843', grad1: '#C10E31', grad2: '#FF5C7A', soft: '#331018' } },
  { id: 'turmeric', nome: 'Turmeric', light: { accent: '#C9930A', grad1: '#C9930A', grad2: '#FFBE0B', soft: '#fdf0cf' }, dark: { accent: '#FFBE0B', grad1: '#C9930A', grad2: '#FFD65C', soft: '#2a2312' } },
  { id: 'vulcanico', nome: 'Vulcânico', light: { accent: '#E23A02', grad1: '#E23A02', grad2: '#FF4103', soft: '#ffe1d3' }, dark: { accent: '#FF4103', grad1: '#C93300', grad2: '#FF7A47', soft: '#001621' } },
  { id: 'skintone', nome: 'Skin Tone', light: { accent: '#9C2C43', grad1: '#741A2F', grad2: '#C4536B', soft: '#fbe3e2' }, dark: { accent: '#FFC6A8', grad1: '#C4536B', grad2: '#FFDCC4', soft: '#2c1319' } },
];

const CHAVE_LOCAL = 'flash_tema_cor';
// Cache das 2 variantes (clara/escura) já resolvidas, em JSON — o script
// inline no <head> de cada página lê só essa chave (sem precisar duplicar
// TEMAS lá) pra aplicar a cor antes do primeiro paint, sem flash da cor padrão.
const CHAVE_CORES = 'flash_tema_cores';
const SETTING_KEY = 'flash_tema_cor';

let temaAtualId = 'padrao';
let mediaEscuro = null;

function temaPorId(id) {
  return TEMAS.find((t) => t.id === id) || TEMAS[0];
}

function salvarCacheCores() {
  try {
    if (temaAtualId === 'padrao') {
      localStorage.removeItem(CHAVE_CORES);
      return;
    }
    const tema = temaPorId(temaAtualId);
    localStorage.setItem(CHAVE_CORES, JSON.stringify({ light: tema.light, dark: tema.dark }));
  } catch { /* localStorage indisponível — segue só na sessão atual */ }
}

function aplicarPeloEsquema() {
  const raiz = document.documentElement.style;
  if (temaAtualId === 'padrao') {
    raiz.removeProperty('--accent');
    raiz.removeProperty('--accent-grad-1');
    raiz.removeProperty('--accent-grad-2');
    raiz.removeProperty('--accent-soft');
    return;
  }
  const cor = mediaEscuro?.matches ? temaPorId(temaAtualId).dark : temaPorId(temaAtualId).light;
  raiz.setProperty('--accent', cor.accent);
  raiz.setProperty('--accent-grad-1', cor.grad1);
  raiz.setProperty('--accent-grad-2', cor.grad2);
  raiz.setProperty('--accent-soft', cor.soft);
}

// Chamar uma vez, o quanto antes, em toda página — aplica a cor salva
// localmente (instantâneo) e passa a reagir a troca de tema claro/escuro
// do sistema enquanto o app estiver aberto.
export function aplicarTemaSalvo() {
  try {
    temaAtualId = temaPorId(localStorage.getItem(CHAVE_LOCAL) || 'padrao').id;
  } catch {
    temaAtualId = 'padrao';
  }
  salvarCacheCores();
  if (!mediaEscuro) {
    mediaEscuro = window.matchMedia('(prefers-color-scheme: dark)');
    mediaEscuro.addEventListener('change', aplicarPeloEsquema);
  }
  aplicarPeloEsquema();
}

export function temaAtual() {
  return temaAtualId;
}

export function definirTema(id) {
  temaAtualId = temaPorId(id).id;
  aplicarPeloEsquema();
  salvarCacheCores();
  try { localStorage.setItem(CHAVE_LOCAL, temaAtualId); } catch { /* localStorage indisponível — segue só na sessão atual */ }
}

// Sincroniza com o que está salvo no banco (outro aparelho pode ter mudado
// a cor) — chamar depois do login, sem bloquear o resto da página.
export async function carregarTemaDoBanco(supabase, userId) {
  const { data } = await supabase.from('user_settings').select('setting_value').eq('user_id', userId).eq('setting_key', SETTING_KEY).maybeSingle();
  if (data?.setting_value && data.setting_value !== temaAtualId) definirTema(data.setting_value);
}

export async function salvarTemaNoBanco(supabase, userId, id) {
  definirTema(id);
  await supabase.from('user_settings').upsert(
    { user_id: userId, setting_key: SETTING_KEY, setting_value: id },
    { onConflict: 'user_id,setting_key' },
  );
}
