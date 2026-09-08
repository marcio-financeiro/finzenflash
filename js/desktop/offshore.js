import { supabase, requireAuth, configurarBotaoSair } from '../supabaseClient.js';
import { aplicarTemaSalvo } from '../temaService.js';
import { montarNavRail } from './navRail.js';
import { abrirComandos } from './comandos.js';
import { configurarModal, abrirModal, fecharModal } from './modal.js';

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
const PRESET_CURSOS = ['HUET', 'OPITO BOSIET', 'OPITO FOET', 'NR-33', 'NR-35', 'NR-37', 'STCW', 'H2S', 'Primeiros Socorros'];

let usuarioAtual = null;
let ciclos = [];
let horas = [];
let cursos = [];

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
      <input type="text" class="input-desktop" id="${id}" value="${escapeHtml(valor ?? '')}" placeholder="${placeholder}">
    </div>
  `;
}

function campoSelect(id, label, opcoes, valorAtual) {
  const options = opcoes.map((o) => `<option value="${o.valor}" ${o.valor === valorAtual ? 'selected' : ''}>${o.texto}</option>`).join('');
  return `
    <div class="field">
      <label for="${id}">${label}</label>
      <select class="input-desktop" id="${id}">${options}</select>
    </div>
  `;
}

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

async function carregarCursos(userId) {
  const { data, error } = await supabase
    .from('certifications')
    .select('*')
    .eq('user_id', userId)
    .order('data_vencimento', { ascending: true, nullsFirst: false });
  if (error) throw error;
  cursos = data ?? [];
}

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

function renderCiclos() {
  const container = document.getElementById('lista-ciclos');
  if (ciclos.length === 0) {
    container.innerHTML = '<div class="lista-vazia">Nenhum ciclo cadastrado ainda.</div>';
    return;
  }

  container.innerHTML = ciclos.map((c) => {
    const cor = STATUS_COR[c.status] || '#8ea198';
    const dias = c.data_desembarque ? diasEntre(c.data_embarque, c.data_desembarque) : null;
    return `
      <div class="item-linha" data-id="${c.id}">
        <div class="status-ponto" style="background:${cor}"></div>
        <div class="item-info">
          <div>${escapeHtml(c.plataforma || 'Sem plataforma')}</div>
          <div class="item-detalhe">
            ${fmtData(c.data_embarque)} → ${c.data_desembarque ? fmtData(c.data_desembarque) : 'Em andamento'} · ${c.regime || '—'}
            ${c.empresa ? ` · ${escapeHtml(c.empresa)}` : ''}
          </div>
        </div>
        <div class="item-direita">${dias !== null ? `${dias}d` : STATUS_CICLO.find((s) => s.valor === c.status)?.texto || c.status}</div>
      </div>
    `;
  }).join('');

  container.querySelectorAll('.item-linha').forEach((el) => {
    const ciclo = ciclos.find((c) => c.id === el.dataset.id);
    if (ciclo) el.addEventListener('click', () => abrirModalAcaoCiclo(ciclo));
  });
}

function abrirModalAcaoCiclo(ciclo) {
  const conteudo = document.getElementById('modal-acao-ciclo-conteudo');
  conteudo.innerHTML = `
    <div class="modal-titulo">${escapeHtml(ciclo.plataforma || 'Ciclo')}</div>
    <div style="display:flex;flex-direction:column;gap:10px;margin-top:10px">
      <button type="button" class="btn-desktop primario" id="btn-editar-ciclo">Editar</button>
      <button type="button" class="btn-desktop perigo" id="btn-excluir-ciclo">Excluir ciclo</button>
    </div>
  `;
  document.getElementById('btn-editar-ciclo').addEventListener('click', () => abrirModalFormCiclo(ciclo));
  document.getElementById('btn-excluir-ciclo').addEventListener('click', () => confirmarExclusaoCiclo(ciclo));
  abrirModal('modal-acao-ciclo');
}

function confirmarExclusaoCiclo(ciclo) {
  const conteudo = document.getElementById('modal-acao-ciclo-conteudo');
  conteudo.innerHTML = `
    <div class="modal-titulo">Excluir ${escapeHtml(ciclo.plataforma || 'este ciclo')}?</div>
    <p style="color:var(--muted);font-size:13px">Os registros de horas extras vinculados a ele também são removidos. Essa ação não pode ser desfeita.</p>
    <button type="button" class="btn-desktop perigo" id="btn-confirmar-excluir-ciclo" style="margin-top:10px">Excluir</button>
  `;
  document.getElementById('btn-confirmar-excluir-ciclo').addEventListener('click', async () => {
    const btn = document.getElementById('btn-confirmar-excluir-ciclo');
    btn.disabled = true;
    btn.textContent = 'Excluindo...';
    const { error } = await supabase.from('offshore_cycles').delete().eq('id', ciclo.id).eq('user_id', usuarioAtual.id);
    if (error) { btn.disabled = false; btn.textContent = 'Excluir'; return; }
    fecharModal('modal-acao-ciclo');
    await Promise.all([carregarCiclos(usuarioAtual.id), carregarHE(usuarioAtual.id)]);
    renderTudo();
  });
}

function abrirModalFormCiclo(ciclo = null) {
  const conteudo = document.getElementById('modal-form-conteudo');
  conteudo.innerHTML = `
    <div class="modal-titulo">${ciclo ? 'Editar ciclo' : 'Novo ciclo'}</div>
    <div style="display:flex;flex-direction:column;gap:14px;margin-top:12px">
      <div class="form-linha">
        <div class="field"><label for="f-embarque">Embarque</label><input type="date" class="input-desktop" id="f-embarque" value="${ciclo?.data_embarque || hojeISO()}"></div>
        <div class="field"><label for="f-desembarque">Desembarque</label><input type="date" class="input-desktop" id="f-desembarque" value="${ciclo?.data_desembarque || ''}"></div>
      </div>
      ${campoTexto('f-plataforma', 'Plataforma / Local', ciclo?.plataforma, 'Ex: P-51, FPSO Cidade de Paraty')}
      ${campoTexto('f-empresa', 'Empresa', ciclo?.empresa, 'Ex: Petrobras, SBM')}
      ${campoTexto('f-contrato', 'Contrato / OS', ciclo?.contrato, 'Número do contrato')}
      <div class="form-linha">
        ${campoSelect('f-regime', 'Regime', REGIMES, ciclo?.regime || '14x21')}
        ${campoSelect('f-status', 'Status', STATUS_CICLO, ciclo?.status || 'planejado')}
      </div>
      <div class="field"><label for="f-obs">Observações</label><textarea class="input-desktop" id="f-obs" rows="2">${escapeHtml(ciclo?.observacoes || '')}</textarea></div>
      <div class="error-msg" id="erro-form"></div>
      <button type="button" class="btn-desktop primario" id="btn-salvar-form">Salvar</button>
    </div>
  `;
  document.getElementById('btn-salvar-form').addEventListener('click', () => salvarCiclo(ciclo?.id ?? null));
  fecharModal('modal-acao-ciclo');
  abrirModal('modal-form');
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

  fecharModal('modal-form');
  await carregarCiclos(usuarioAtual.id);
  renderTudo();
}

function renderHE() {
  const container = document.getElementById('lista-he');
  if (horas.length === 0) {
    container.innerHTML = '<div class="lista-vazia">Nenhum registro de horas extras ainda.</div>';
    return;
  }

  container.innerHTML = horas.map((h) => {
    const total = h.valor_hora ? Number(h.horas_extras || 0) * Number(h.valor_hora) : null;
    return `
      <div class="item-linha" data-id="${h.id}">
        <div class="item-info">
          <div>${fmtData(h.data)} · ${Number(h.horas_extras || 0).toFixed(1)}h${h.sobreaviso ? ' · Sobreaviso' : ''}</div>
          <div class="item-detalhe">${escapeHtml(h.descricao || '—')}</div>
        </div>
        <div class="item-direita valor-sensivel">${total !== null ? fmt.format(total) : '—'}</div>
      </div>
    `;
  }).join('');

  container.querySelectorAll('.item-linha').forEach((el) => {
    const he = horas.find((h) => h.id === el.dataset.id);
    if (he) el.addEventListener('click', () => confirmarExclusaoHE(he));
  });
}

function confirmarExclusaoHE(he) {
  const conteudo = document.getElementById('modal-acao-he-conteudo');
  conteudo.innerHTML = `
    <div class="modal-titulo">Excluir registro de ${fmtData(he.data)}?</div>
    <button type="button" class="btn-desktop perigo" id="btn-confirmar-excluir-he" style="margin-top:10px">Excluir</button>
  `;
  document.getElementById('btn-confirmar-excluir-he').addEventListener('click', async () => {
    const btn = document.getElementById('btn-confirmar-excluir-he');
    btn.disabled = true;
    btn.textContent = 'Excluindo...';
    const { error } = await supabase.from('offshore_overtime').delete().eq('id', he.id).eq('user_id', usuarioAtual.id);
    if (error) { btn.disabled = false; btn.textContent = 'Excluir'; return; }
    fecharModal('modal-acao-he');
    await carregarHE(usuarioAtual.id);
    renderTudo();
  });
  abrirModal('modal-acao-he');
}

function abrirModalFormHE() {
  const conteudo = document.getElementById('modal-form-conteudo');
  const opcoesCiclo = [{ valor: '', texto: 'Sem vínculo' }, ...ciclos.map((c) => ({ valor: c.id, texto: `${c.plataforma || 'Sem plataforma'} — ${fmtData(c.data_embarque)}` }))];
  conteudo.innerHTML = `
    <div class="modal-titulo">Registrar horas</div>
    <div style="display:flex;flex-direction:column;gap:14px;margin-top:12px">
      ${campoSelect('f-he-ciclo', 'Ciclo', opcoesCiclo, '')}
      <div class="form-linha">
        <div class="field"><label for="f-he-data">Data</label><input type="date" class="input-desktop" id="f-he-data" value="${hojeISO()}"></div>
        ${campoTexto('f-he-horas', 'Horas extras', '', '0')}
      </div>
      <div class="form-linha">
        ${campoTexto('f-he-valor-hora', 'Valor/hora (R$)', '', '0,00')}
        <label class="toggle-linha" style="flex:1;align-self:center">
          <span>Sobreaviso</span>
          <input type="checkbox" id="f-he-sobreaviso">
        </label>
      </div>
      ${campoTexto('f-he-desc', 'Descrição', '', 'Ex: trabalho noturno, emergência')}
      <div class="error-msg" id="erro-form"></div>
      <button type="button" class="btn-desktop primario" id="btn-salvar-form">Salvar</button>
    </div>
  `;
  document.getElementById('btn-salvar-form').addEventListener('click', salvarHE);
  abrirModal('modal-form');
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

  fecharModal('modal-form');
  await carregarHE(usuarioAtual.id);
  renderTudo();
}

function statusCurso(dataVencimento) {
  if (!dataVencimento) return { cor: '#8ea198', texto: 'Sem vencimento' };
  const dias = diasEntre(hojeISO(), dataVencimento);
  if (dias < 0) return { cor: '#d9705a', texto: `Vencida há ${Math.abs(dias)}d` };
  if (dias === 0) return { cor: '#c9963f', texto: 'Vence hoje!' };
  if (dias <= 90) return { cor: '#c9963f', texto: `Vence em ${dias}d` };
  return { cor: '#1E9E6E', texto: `Vence em ${dias}d` };
}

function renderCursos() {
  const container = document.getElementById('lista-cursos');
  if (cursos.length === 0) {
    container.innerHTML = '<div class="lista-vazia">Nenhum curso cadastrado ainda.</div>';
    return;
  }

  container.innerHTML = cursos.map((c) => {
    const st = statusCurso(c.data_vencimento);
    const detalhe = [c.entidade, c.data_vencimento ? `Venc. ${fmtData(c.data_vencimento)}` : 'Sem vencimento'].filter(Boolean).join(' · ');
    return `
      <div class="item-linha" data-id="${c.id}">
        <div class="status-ponto" style="background:${st.cor}"></div>
        <div class="item-info">
          <div>${escapeHtml(c.nome)}</div>
          <div class="item-detalhe">${escapeHtml(detalhe)}</div>
        </div>
        <div class="item-direita" style="color:${st.cor}">${st.texto}</div>
      </div>
    `;
  }).join('');

  container.querySelectorAll('.item-linha').forEach((el) => {
    const curso = cursos.find((c) => c.id === el.dataset.id);
    if (curso) el.addEventListener('click', () => abrirModalAcaoCurso(curso));
  });
}

function abrirModalAcaoCurso(curso) {
  const conteudo = document.getElementById('modal-acao-curso-conteudo');
  conteudo.innerHTML = `
    <div class="modal-titulo">${escapeHtml(curso.nome)}</div>
    <div style="display:flex;flex-direction:column;gap:10px;margin-top:10px">
      <button type="button" class="btn-desktop primario" id="btn-editar-curso">Editar</button>
      <button type="button" class="btn-desktop perigo" id="btn-excluir-curso">Excluir curso</button>
    </div>
  `;
  document.getElementById('btn-editar-curso').addEventListener('click', () => abrirModalFormCurso(curso));
  document.getElementById('btn-excluir-curso').addEventListener('click', () => confirmarExclusaoCurso(curso));
  abrirModal('modal-acao-curso');
}

function confirmarExclusaoCurso(curso) {
  const conteudo = document.getElementById('modal-acao-curso-conteudo');
  conteudo.innerHTML = `
    <div class="modal-titulo">Excluir ${escapeHtml(curso.nome)}?</div>
    <p style="color:var(--muted);font-size:13px">Essa ação não pode ser desfeita.</p>
    <button type="button" class="btn-desktop perigo" id="btn-confirmar-excluir-curso" style="margin-top:10px">Excluir</button>
  `;
  document.getElementById('btn-confirmar-excluir-curso').addEventListener('click', async () => {
    const btn = document.getElementById('btn-confirmar-excluir-curso');
    btn.disabled = true;
    btn.textContent = 'Excluindo...';
    const { error } = await supabase.from('certifications').delete().eq('id', curso.id).eq('user_id', usuarioAtual.id);
    if (error) { btn.disabled = false; btn.textContent = 'Excluir'; return; }
    fecharModal('modal-acao-curso');
    await carregarCursos(usuarioAtual.id);
    renderTudo();
  });
  abrirModal('modal-acao-curso');
}

function abrirModalFormCurso(curso = null) {
  const conteudo = document.getElementById('modal-form-conteudo');
  conteudo.innerHTML = `
    <div class="modal-titulo">${curso ? 'Editar curso' : 'Novo curso'}</div>
    <div style="display:flex;flex-direction:column;gap:14px;margin-top:12px">
      <div class="field">
        <label for="f-curso-nome">Nome do curso</label>
        <input type="text" class="input-desktop" id="f-curso-nome" list="lista-nomes-curso" value="${escapeHtml(curso?.nome ?? '')}" placeholder="Ex: HUET, NR-35...">
        <datalist id="lista-nomes-curso">${PRESET_CURSOS.map((n) => `<option value="${n}">`).join('')}</datalist>
      </div>
      <div class="form-linha">
        ${campoTexto('f-curso-numero', 'Número / código', curso?.numero, 'Opcional')}
        ${campoTexto('f-curso-entidade', 'Entidade emissora', curso?.entidade, 'Ex: OPITO')}
      </div>
      <div class="form-linha">
        <div class="field"><label for="f-curso-emissao">Emissão</label><input type="date" class="input-desktop" id="f-curso-emissao" value="${curso?.data_emissao || ''}"></div>
        <div class="field"><label for="f-curso-vencimento">Vencimento</label><input type="date" class="input-desktop" id="f-curso-vencimento" value="${curso?.data_vencimento || ''}"></div>
      </div>
      <div class="field"><label for="f-curso-obs">Observações</label><textarea class="input-desktop" id="f-curso-obs" rows="2">${escapeHtml(curso?.observacoes || '')}</textarea></div>
      <div class="error-msg" id="erro-form"></div>
      <button type="button" class="btn-desktop primario" id="btn-salvar-form">Salvar</button>
    </div>
  `;
  document.getElementById('btn-salvar-form').addEventListener('click', () => salvarCurso(curso?.id ?? null));
  fecharModal('modal-acao-curso');
  abrirModal('modal-form');
}

async function salvarCurso(id) {
  const erroEl = document.getElementById('erro-form');
  erroEl.textContent = '';

  const nome = document.getElementById('f-curso-nome').value.trim();
  const vencimento = document.getElementById('f-curso-vencimento').value;
  if (!nome) { erroEl.textContent = 'Informe o nome do curso.'; return; }
  if (!vencimento) { erroEl.textContent = 'Informe a data de vencimento.'; return; }

  const payload = {
    user_id: usuarioAtual.id,
    nome,
    numero: document.getElementById('f-curso-numero').value.trim() || null,
    entidade: document.getElementById('f-curso-entidade').value.trim() || null,
    data_emissao: document.getElementById('f-curso-emissao').value || null,
    data_vencimento: vencimento,
    observacoes: document.getElementById('f-curso-obs').value.trim() || null,
  };

  const btn = document.getElementById('btn-salvar-form');
  btn.disabled = true;
  btn.textContent = 'Salvando...';

  const { error } = id
    ? await supabase.from('certifications').update(payload).eq('id', id).eq('user_id', usuarioAtual.id)
    : await supabase.from('certifications').insert(payload);

  if (error) {
    erroEl.textContent = 'Não foi possível salvar. Tente novamente.';
    btn.disabled = false;
    btn.textContent = 'Salvar';
    return;
  }

  fecharModal('modal-form');
  await carregarCursos(usuarioAtual.id);
  renderTudo();
}

function renderHistorico() {
  const container = document.getElementById('lista-historico');
  const porPlataforma = new Map();
  for (const c of ciclos) {
    if (!c.plataforma) continue;
    if (!porPlataforma.has(c.plataforma)) porPlataforma.set(c.plataforma, []);
    porPlataforma.get(c.plataforma).push(c);
  }

  if (porPlataforma.size === 0) {
    container.innerHTML = '<div class="lista-vazia">Nenhum ciclo com plataforma cadastrada ainda.</div>';
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
    <div class="table-wrap">
      <table class="data-table">
        <thead><tr><th>Plataforma</th><th>Empresa</th><th>Embarques</th><th>Dias total</th><th>Último</th></tr></thead>
        <tbody>${linhas}</tbody>
      </table>
    </div>
  `;
}

function renderTudo() {
  renderKpis();
  renderCiclos();
  renderCursos();
  renderHE();
  renderHistorico();
}

function configurarTabs() {
  document.querySelectorAll('.off-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.off-tab').forEach((t) => t.classList.toggle('ativo', t === tab));
      document.querySelectorAll('.off-secao').forEach((s) => s.classList.toggle('ativo', s.dataset.secao === tab.dataset.tab));
    });
  });
}

async function iniciar() {
  aplicarTemaSalvo();
  const user = await requireAuth();
  if (!user) return;
  usuarioAtual = user;

  montarNavRail('offshore');
  configurarBotaoSair();
  document.getElementById('btn-topbar-busca').addEventListener('click', abrirComandos);

  ['modal-acao-ciclo', 'modal-acao-he', 'modal-acao-curso', 'modal-form'].forEach((id) => configurarModal(id));
  document.querySelectorAll('[data-fechar-modal]').forEach((btn) => {
    btn.addEventListener('click', () => fecharModal(btn.dataset.fecharModal));
  });

  configurarTabs();

  document.getElementById('btn-novo-ciclo').addEventListener('click', () => abrirModalFormCiclo());
  document.getElementById('btn-nova-he').addEventListener('click', abrirModalFormHE);
  document.getElementById('btn-novo-curso').addEventListener('click', () => abrirModalFormCurso());

  try {
    await Promise.all([carregarCiclos(user.id), carregarHE(user.id), carregarCursos(user.id)]);
    renderTudo();
  } catch (err) {
    console.error(err);
    document.getElementById('lista-ciclos').innerHTML = '<div class="lista-vazia">Não foi possível carregar os dados.</div>';
  }
}

iniciar();
