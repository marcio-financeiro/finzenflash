import { supabase, requireAuth, configurarBotaoSair } from './supabaseClient.js';
import { configurarBotaoPrivacidade } from './privacidade.js?v=2';
import { ativarArrastarParaFechar } from './sheetGestos.js?v=2';

const fmt = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtDataCurta = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });

const REGIMES = [
  { valor: '14x14', texto: '14x14' },
  { valor: '14x21', texto: '14x21' },
  { valor: '21x21', texto: '21x21' },
  { valor: '28x28', texto: '28x28' },
  { valor: 'variavel', texto: 'Variável' },
];
const STATUS_CICLO = [
  { valor: 'planejado', texto: 'Planejado' },
  { valor: 'embarcado', texto: 'Embarcado' },
  { valor: 'concluido', texto: 'Concluído' },
  { valor: 'cancelado', texto: 'Cancelado' },
];
const STATUS_COR = {
  planejado: '#4b84f3',
  embarcado: '#c9963f',
  concluido: '#1E9E6E',
  cancelado: '#8ea198',
};

let usuarioAtual = null;
let ciclos = [];
let horas = [];

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}

function hojeISO() {
  const hoje = new Date();
  return new Date(hoje.getTime() - hoje.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

function lerValorMonetario(bruto) {
  const normalizado = String(bruto ?? '').trim().replace(/\./g, '').replace(',', '.');
  const numero = Number(normalizado);
  return Number.isFinite(numero) ? numero : 0;
}

function fmtData(iso) {
  if (!iso) return '—';
  return fmtDataCurta.format(new Date(iso + 'T00:00:00'));
}

function diasEntre(d1, d2) {
  if (!d1 || !d2) return 0;
  return Math.round((new Date(d2 + 'T00:00:00') - new Date(d1 + 'T00:00:00')) / 86400000);
}

function campoTexto(id, label, valor, placeholder = '') {
  return `
    <div class="field">
      <label for="${id}">${label}</label>
      <input type="text" id="${id}" value="${escapeHtml(valor ?? '')}" placeholder="${placeholder}">
    </div>
  `;
}

function campoSelect(id, label, opcoes, valorAtual) {
  const options = opcoes.map((o) => `<option value="${o.valor}" ${o.valor === valorAtual ? 'selected' : ''}>${o.texto}</option>`).join('');
  return `
    <div class="field">
      <label for="${id}">${label}</label>
      <select id="${id}">${options}</select>
    </div>
  `;
}

// ── Carregar dados ──────────────────────────────────────
async function carregarCiclos(userId) {
  const { data, error } = await supabase
    .from('offshore_cycles')
    .select('*')
    .eq('user_id', userId)
    .order('data_embarque', { ascending: false });
  if (error) throw error;
  ciclos = data ?? [];
}

async function carregarHE(userId) {
  const { data, error } = await supabase
    .from('offshore_overtime')
    .select('*')
    .eq('user_id', userId)
    .order('data', { ascending: false })
    .limit(50);
  if (error) throw error;
  horas = data ?? [];
}

// ── KPIs ────────────────────────────────────────────────
function renderKpis() {
  const anoAtual = new Date().getFullYear();
  const inicio = `${anoAtual}-01-01`;
  const fim = `${anoAtual}-12-31`;

  const diasEmb = ciclos
    .filter((c) => c.data_embarque >= inicio && c.data_embarque <= fim)
    .reduce((s, c) => s + Math.max(diasEntre(c.data_embarque, c.data_desembarque || hojeISO()), 0), 0);

  const diasAno = diasEntre(inicio, fim);
  const diasCasa = Math.max(diasAno - diasEmb, 0);
  const ciclosConcluidos = ciclos.filter((c) => c.status === 'concluido').length;

  const cicloAtual = ciclos.find((c) => c.status === 'embarcado');
  const heAtual = cicloAtual
    ? horas.filter((h) => h.cycle_id === cicloAtual.id).reduce((s, h) => s + Number(h.horas_extras || 0), 0)
    : 0;

  document.getElementById('kpi-dias-emb').textContent = `${diasEmb}d`;
  document.getElementById('kpi-dias-casa').textContent = `${diasCasa}d`;
  document.getElementById('kpi-ciclos').textContent = ciclosConcluidos;
  document.getElementById('kpi-he').textContent = `${heAtual.toFixed(1)}h`;
}

// ── Ciclos ──────────────────────────────────────────────
function renderCiclos() {
  const container = document.getElementById('lista-ciclos');
  if (ciclos.length === 0) {
    container.innerHTML = '<div class="conta-vazia">Nenhum ciclo cadastrado ainda.</div>';
    return;
  }

  container.innerHTML = ciclos.map((c) => {
    const cor = STATUS_COR[c.status] || '#8ea198';
    const dias = c.data_desembarque ? diasEntre(c.data_embarque, c.data_desembarque) : null;
    return `
      <button type="button" class="ciclo-item" data-id="${c.id}">
        <div class="ciclo-status-ponto" style="background:${cor}"></div>
        <div class="ciclo-info">
          <div class="ciclo-plataforma">${escapeHtml(c.plataforma || 'Sem plataforma')}</div>
          <div class="ciclo-detalhe">
            ${fmtData(c.data_embarque)} → ${c.data_desembarque ? fmtData(c.data_desembarque) : 'Em andamento'} · ${c.regime || '—'}
            ${c.empresa ? ` · ${escapeHtml(c.empresa)}` : ''}
          </div>
        </div>
        <div class="ciclo-dias">${dias !== null ? `${dias}d` : STATUS_CICLO.find((s) => s.valor === c.status)?.texto || c.status}</div>
      </button>
    `;
  }).join('');

  container.querySelectorAll('.ciclo-item').forEach((el) => {
    const ciclo = ciclos.find((c) => c.id === el.dataset.id);
    if (ciclo) el.addEventListener('click', () => abrirSheetAcaoCiclo(ciclo));
  });
}

function abrirSheetAcaoCiclo(ciclo) {
  const conteudo = document.getElementById('sheet-acao-ciclo-conteudo');
  conteudo.innerHTML = `
    <div class="sheet-titulo">${escapeHtml(ciclo.plataforma || 'Ciclo')}</div>
    <button type="button" class="sheet-acao-btn" id="btn-editar-ciclo">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>
      Editar
    </button>
    <button type="button" class="sheet-acao-btn perigo" id="btn-excluir-ciclo">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
      Excluir ciclo
    </button>
    <button type="button" class="sheet-acao-btn" id="btn-cancelar-acao-ciclo">Cancelar</button>
  `;
  document.getElementById('btn-editar-ciclo').addEventListener('click', () => abrirSheetFormCiclo(ciclo));
  document.getElementById('btn-excluir-ciclo').addEventListener('click', () => confirmarExclusaoCiclo(ciclo));
  document.getElementById('btn-cancelar-acao-ciclo').addEventListener('click', () => { document.getElementById('sheet-acao-ciclo').hidden = true; });
  document.getElementById('sheet-acao-ciclo').hidden = false;
}

function confirmarExclusaoCiclo(ciclo) {
  const conteudo = document.getElementById('sheet-acao-ciclo-conteudo');
  conteudo.innerHTML = `
    <div class="sheet-titulo">Excluir ${escapeHtml(ciclo.plataforma || 'este ciclo')}?</div>
    <div class="sheet-aviso">Os registros de horas extras vinculados a ele também são removidos. Essa ação não pode ser desfeita.</div>
    <button type="button" class="sheet-acao-btn perigo" id="btn-confirmar-excluir-ciclo">Excluir</button>
    <button type="button" class="sheet-acao-btn" id="btn-cancelar-acao-ciclo">Cancelar</button>
  `;
  document.getElementById('btn-confirmar-excluir-ciclo').addEventListener('click', async () => {
    const btn = document.getElementById('btn-confirmar-excluir-ciclo');
    btn.disabled = true;
    btn.textContent = 'Excluindo...';
    const { error } = await supabase.from('offshore_cycles').delete().eq('id', ciclo.id).eq('user_id', usuarioAtual.id);
    if (error) { btn.disabled = false; btn.textContent = 'Excluir'; return; }
    document.getElementById('sheet-acao-ciclo').hidden = true;
    await Promise.all([carregarCiclos(usuarioAtual.id), carregarHE(usuarioAtual.id)]);
    renderTudo();
  });
  document.getElementById('btn-cancelar-acao-ciclo').addEventListener('click', () => { document.getElementById('sheet-acao-ciclo').hidden = true; });
}

function abrirSheetFormCiclo(ciclo = null) {
  const conteudo = document.getElementById('sheet-form-conteudo');
  conteudo.innerHTML = `
    <div class="sheet-titulo">${ciclo ? 'Editar ciclo' : 'Novo ciclo'}</div>
    <div class="form-linha">
      <div class="field"><label for="f-embarque">Embarque</label><input type="date" id="f-embarque" value="${ciclo?.data_embarque || hojeISO()}"></div>
      <div class="field"><label for="f-desembarque">Desembarque</label><input type="date" id="f-desembarque" value="${ciclo?.data_desembarque || ''}"></div>
    </div>
    ${campoTexto('f-plataforma', 'Plataforma / Local', ciclo?.plataforma, 'Ex: P-51, FPSO Cidade de Paraty')}
    ${campoTexto('f-empresa', 'Empresa', ciclo?.empresa, 'Ex: Petrobras, SBM')}
    ${campoTexto('f-contrato', 'Contrato / OS', ciclo?.contrato, 'Número do contrato')}
    <div class="form-linha">
      ${campoSelect('f-regime', 'Regime', REGIMES, ciclo?.regime || '14x21')}
      ${campoSelect('f-status', 'Status', STATUS_CICLO, ciclo?.status || 'planejado')}
    </div>
    <div class="field"><label for="f-obs">Observações</label><textarea id="f-obs" rows="2">${escapeHtml(ciclo?.observacoes || '')}</textarea></div>
    <div class="error-msg" id="erro-form"></div>
    <button type="button" class="btn-primary" id="btn-salvar-form">Salvar</button>
    <button type="button" class="sheet-acao-btn" id="btn-cancelar-form">Cancelar</button>
  `;
  document.getElementById('btn-cancelar-form').addEventListener('click', () => { document.getElementById('sheet-form').hidden = true; });
  document.getElementById('btn-salvar-form').addEventListener('click', () => salvarCiclo(ciclo?.id ?? null));
  document.getElementById('sheet-acao-ciclo').hidden = true;
  document.getElementById('sheet-form').hidden = false;
}

async function salvarCiclo(id) {
  const erroEl = document.getElementById('erro-form');
  erroEl.textContent = '';

  const embarque = document.getElementById('f-embarque').value;
  if (!embarque) { erroEl.textContent = 'Informe a data de embarque.'; return; }

  const payload = {
    user_id: usuarioAtual.id,
    data_embarque: embarque,
    data_desembarque: document.getElementById('f-desembarque').value || null,
    plataforma: document.getElementById('f-plataforma').value.trim() || null,
    empresa: document.getElementById('f-empresa').value.trim() || null,
    contrato: document.getElementById('f-contrato').value.trim() || null,
    regime: document.getElementById('f-regime').value,
    status: document.getElementById('f-status').value,
    observacoes: document.getElementById('f-obs').value.trim() || null,
  };

  const btn = document.getElementById('btn-salvar-form');
  btn.disabled = true;
  btn.textContent = 'Salvando...';

  const { error } = id
    ? await supabase.from('offshore_cycles').update(payload).eq('id', id).eq('user_id', usuarioAtual.id)
    : await supabase.from('offshore_cycles').insert(payload);

  if (error) {
    erroEl.textContent = 'Não foi possível salvar. Tente novamente.';
    btn.disabled = false;
    btn.textContent = 'Salvar';
    return;
  }

  document.getElementById('sheet-form').hidden = true;
  await carregarCiclos(usuarioAtual.id);
  renderTudo();
}

// ── Horas extras ────────────────────────────────────────
function renderHE() {
  const container = document.getElementById('lista-he');
  if (horas.length === 0) {
    container.innerHTML = '<div class="conta-vazia">Nenhum registro de horas extras ainda.</div>';
    return;
  }

  container.innerHTML = horas.map((h) => {
    const total = h.valor_hora ? Number(h.horas_extras || 0) * Number(h.valor_hora) : null;
    return `
      <button type="button" class="he-item" data-id="${h.id}">
        <div class="he-info">
          <div class="he-data">${fmtData(h.data)} · ${Number(h.horas_extras || 0).toFixed(1)}h${h.sobreaviso ? ' · Sobreaviso' : ''}</div>
          <div class="he-detalhe">${escapeHtml(h.descricao || '—')}</div>
        </div>
        <div class="he-valor">${total !== null ? fmt.format(total) : '—'}</div>
      </button>
    `;
  }).join('');

  container.querySelectorAll('.he-item').forEach((el) => {
    const he = horas.find((h) => h.id === el.dataset.id);
    if (he) el.addEventListener('click', () => confirmarExclusaoHE(he));
  });
}

function confirmarExclusaoHE(he) {
  const conteudo = document.getElementById('sheet-acao-he-conteudo');
  conteudo.innerHTML = `
    <div class="sheet-titulo">Excluir registro de ${fmtData(he.data)}?</div>
    <button type="button" class="sheet-acao-btn perigo" id="btn-confirmar-excluir-he">Excluir</button>
    <button type="button" class="sheet-acao-btn" id="btn-cancelar-acao-he">Cancelar</button>
  `;
  document.getElementById('btn-confirmar-excluir-he').addEventListener('click', async () => {
    const btn = document.getElementById('btn-confirmar-excluir-he');
    btn.disabled = true;
    btn.textContent = 'Excluindo...';
    const { error } = await supabase.from('offshore_overtime').delete().eq('id', he.id).eq('user_id', usuarioAtual.id);
    if (error) { btn.disabled = false; btn.textContent = 'Excluir'; return; }
    document.getElementById('sheet-acao-he').hidden = true;
    await carregarHE(usuarioAtual.id);
    renderTudo();
  });
  document.getElementById('btn-cancelar-acao-he').addEventListener('click', () => { document.getElementById('sheet-acao-he').hidden = true; });
  document.getElementById('sheet-acao-he').hidden = false;
}

function abrirSheetFormHE() {
  const conteudo = document.getElementById('sheet-form-conteudo');
  const opcoesCiclo = [{ valor: '', texto: 'Sem vínculo' }, ...ciclos.map((c) => ({ valor: c.id, texto: `${c.plataforma || 'Sem plataforma'} — ${fmtData(c.data_embarque)}` }))];
  conteudo.innerHTML = `
    <div class="sheet-titulo">Registrar horas</div>
    ${campoSelect('f-he-ciclo', 'Ciclo', opcoesCiclo, '')}
    <div class="form-linha">
      <div class="field"><label for="f-he-data">Data</label><input type="date" id="f-he-data" value="${hojeISO()}"></div>
      ${campoTexto('f-he-horas', 'Horas extras', '', '0')}
    </div>
    <div class="form-linha">
      ${campoTexto('f-he-valor-hora', 'Valor/hora (R$)', '', '0,00')}
      <label class="toggle-linha" style="flex:1;">
        <span>Sobreaviso</span>
        <input type="checkbox" id="f-he-sobreaviso">
      </label>
    </div>
    ${campoTexto('f-he-desc', 'Descrição', '', 'Ex: trabalho noturno, emergência')}
    <div class="error-msg" id="erro-form"></div>
    <button type="button" class="btn-primary" id="btn-salvar-form">Salvar</button>
    <button type="button" class="sheet-acao-btn" id="btn-cancelar-form">Cancelar</button>
  `;
  document.getElementById('btn-cancelar-form').addEventListener('click', () => { document.getElementById('sheet-form').hidden = true; });
  document.getElementById('btn-salvar-form').addEventListener('click', salvarHE);
  document.getElementById('sheet-form').hidden = false;
}

async function salvarHE() {
  const erroEl = document.getElementById('erro-form');
  erroEl.textContent = '';

  const data = document.getElementById('f-he-data').value;
  if (!data) { erroEl.textContent = 'Informe a data.'; return; }

  const payload = {
    user_id: usuarioAtual.id,
    cycle_id: document.getElementById('f-he-ciclo').value || null,
    data,
    horas_extras: lerValorMonetario(document.getElementById('f-he-horas').value) || 0,
    valor_hora: lerValorMonetario(document.getElementById('f-he-valor-hora').value) || null,
    sobreaviso: document.getElementById('f-he-sobreaviso').checked,
    descricao: document.getElementById('f-he-desc').value.trim() || null,
  };

  const btn = document.getElementById('btn-salvar-form');
  btn.disabled = true;
  btn.textContent = 'Salvando...';

  const { error } = await supabase.from('offshore_overtime').insert(payload);
  if (error) {
    erroEl.textContent = 'Não foi possível salvar. Tente novamente.';
    btn.disabled = false;
    btn.textContent = 'Salvar';
    return;
  }

  document.getElementById('sheet-form').hidden = true;
  await carregarHE(usuarioAtual.id);
  renderTudo();
}

// ── Histórico por plataforma ────────────────────────────
function renderHistorico() {
  const container = document.getElementById('lista-historico');
  const porPlataforma = new Map();
  for (const c of ciclos) {
    if (!c.plataforma) continue;
    if (!porPlataforma.has(c.plataforma)) porPlataforma.set(c.plataforma, []);
    porPlataforma.get(c.plataforma).push(c);
  }

  if (porPlataforma.size === 0) {
    container.innerHTML = '<div class="conta-vazia">Nenhum ciclo com plataforma cadastrada ainda.</div>';
    return;
  }

  const linhas = [...porPlataforma.entries()].map(([plataforma, lista]) => {
    const totalDias = lista.reduce((s, c) => s + Math.max(diasEntre(c.data_embarque, c.data_desembarque || hojeISO()), 0), 0);
    const ultimo = [...lista].sort((a, b) => b.data_embarque.localeCompare(a.data_embarque))[0];
    return `
      <tr>
        <td><strong>${escapeHtml(plataforma)}</strong></td>
        <td>${escapeHtml(ultimo.empresa || '—')}</td>
        <td>${lista.length}</td>
        <td>${totalDias}d</td>
        <td>${fmtData(ultimo.data_embarque)}</td>
      </tr>
    `;
  }).join('');

  container.innerHTML = `
    <div class="historico-tabela-wrap">
      <table class="historico-tabela">
        <thead><tr><th>Plataforma</th><th>Empresa</th><th>Embarques</th><th>Dias total</th><th>Último</th></tr></thead>
        <tbody>${linhas}</tbody>
      </table>
    </div>
  `;
}

function renderTudo() {
  renderKpis();
  renderCiclos();
  renderHE();
  renderHistorico();
}

async function init() {
  configurarBotaoSair();
  configurarBotaoPrivacidade('btn-privacidade');

  const user = await requireAuth();
  if (!user) return;
  usuarioAtual = user;

  document.getElementById('btn-novo-ciclo').addEventListener('click', () => abrirSheetFormCiclo());
  document.getElementById('btn-novo-ciclo-fab').addEventListener('click', (e) => { e.preventDefault(); abrirSheetFormCiclo(); });
  document.getElementById('btn-nova-he').addEventListener('click', abrirSheetFormHE);

  const sheetForm = document.getElementById('sheet-form');
  sheetForm.addEventListener('click', (e) => { if (e.target === sheetForm) sheetForm.hidden = true; });
  ativarArrastarParaFechar(sheetForm);

  const sheetAcaoCiclo = document.getElementById('sheet-acao-ciclo');
  sheetAcaoCiclo.addEventListener('click', (e) => { if (e.target === sheetAcaoCiclo) sheetAcaoCiclo.hidden = true; });
  ativarArrastarParaFechar(sheetAcaoCiclo);

  const sheetAcaoHE = document.getElementById('sheet-acao-he');
  sheetAcaoHE.addEventListener('click', (e) => { if (e.target === sheetAcaoHE) sheetAcaoHE.hidden = true; });
  ativarArrastarParaFechar(sheetAcaoHE);

  try {
    await Promise.all([carregarCiclos(user.id), carregarHE(user.id)]);
    renderTudo();
  } catch (err) {
    console.error(err);
    document.getElementById('lista-ciclos').innerHTML = '<div class="conta-vazia">Não foi possível carregar os dados.</div>';
  }
}

init();
