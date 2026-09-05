import { supabase, requireAuth, configurarBotaoSair } from './supabaseClient.js';
import { ativarArrastarParaFechar } from './sheetGestos.js';

const fmt = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

const TIPOS_CONTA = ['Conta Corrente', 'Conta Digital', 'Conta Poupança', 'Conta Internacional', 'Carteira'];
const BANDEIRAS = ['Visa', 'Mastercard', 'Elo', 'Amex', 'Hipercard'];

let usuarioAtual = null;
let gruposColapsados = new Set();
let contas = [];
let cartoes = [];
let categorias = [];
let recorrentes = [];

const LABELS_FREQUENCIA = { mensal: 'Mensal', semanal: 'Semanal', anual: 'Anual' };

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}

function inicial(nome) {
  return escapeHtml((nome || '?').trim().charAt(0).toUpperCase());
}

const CHAVE_COLAPSO = 'flash_cadastros_colapsados';

function carregarGruposColapsados() {
  try {
    const bruto = JSON.parse(localStorage.getItem(CHAVE_COLAPSO) || '[]');
    return new Set(Array.isArray(bruto) ? bruto : []);
  } catch {
    return new Set();
  }
}

function salvarGruposColapsados() {
  try {
    localStorage.setItem(CHAVE_COLAPSO, JSON.stringify([...gruposColapsados]));
  } catch {
    // localStorage indisponível — o toggle ainda funciona nesta sessão.
  }
}

function alternarGrupo(grupo) {
  if (gruposColapsados.has(grupo)) gruposColapsados.delete(grupo);
  else gruposColapsados.add(grupo);
  document.querySelector(`.grupo-cadastro[data-grupo="${grupo}"]`)?.classList.toggle('colapsado', gruposColapsados.has(grupo));
  salvarGruposColapsados();
}

async function carregarContas(userId) {
  const { data, error } = await supabase
    .from('accounts')
    .select('id, nome, bank, tipo, currency, saldo_atual, color, active, icon')
    .eq('user_id', userId)
    .eq('account_kind', 'bank')
    .order('active', { ascending: false })
    .order('sort_order')
    .order('nome');
  if (error) throw error;
  return data ?? [];
}

async function carregarCartoes(userId) {
  const { data, error } = await supabase
    .from('credit_cards')
    .select('id, nome, banco, bandeira, limite, fechamento_dia, vencimento_dia, cor, ativo')
    .eq('user_id', userId)
    .order('ativo', { ascending: false })
    .order('sort_order')
    .order('nome');
  if (error) throw error;
  return data ?? [];
}

async function carregarCategorias(userId) {
  const { data, error } = await supabase
    .from('categories')
    .select('id, nome, tipo, icon, ativo')
    .eq('user_id', userId)
    .in('tipo', ['despesa', 'receita'])
    .order('tipo')
    .order('ativo', { ascending: false })
    .order('sort_order')
    .order('nome');
  if (error) throw error;
  return data ?? [];
}

async function carregarRecorrentes(userId) {
  const { data, error } = await supabase
    .from('transactions')
    .select('id, description, amount, type, recurrence_frequency, recurrence_active, recurrence_until')
    .eq('user_id', userId)
    .eq('is_recurring', true)
    .is('parent_transaction_id', null)
    .order('recurrence_active', { ascending: false })
    .order('description');
  if (error) throw error;
  return (data ?? []).map((r) => ({ ...r, nome: r.description }));
}

async function recarregarTudo() {
  [contas, cartoes, categorias, recorrentes] = await Promise.all([
    carregarContas(usuarioAtual.id),
    carregarCartoes(usuarioAtual.id),
    carregarCategorias(usuarioAtual.id),
    carregarRecorrentes(usuarioAtual.id),
  ]);
  renderLista();
}

function renderLista() {
  renderContas(document.getElementById('lista-contas'));
  renderCartoes(document.getElementById('lista-cartoes'));
  renderCategorias(document.getElementById('lista-categorias'));
  renderRecorrentes(document.getElementById('lista-recorrentes'));

  document.getElementById('contagem-contas').textContent = contas.length;
  document.getElementById('contagem-cartoes').textContent = cartoes.length;
  document.getElementById('contagem-categorias').textContent = categorias.length;
  document.getElementById('contagem-recorrentes').textContent = recorrentes.length;
}

function renderRecorrentes(container) {
  if (recorrentes.length === 0) {
    container.innerHTML = '<div class="conta-vazia">Nenhum lançamento recorrente. Crie um marcando "Repetir" ao lançar.</div>';
    return;
  }
  container.innerHTML = recorrentes.map((r) => `
    <button type="button" class="item-cadastro ${r.recurrence_active ? '' : 'item-inativo'}" data-tipo="recorrente" data-id="${r.id}">
      <div class="item-avatar" style="background:${r.type === 'receita' ? 'var(--success)' : 'var(--danger)'}">${r.type === 'receita' ? '↑' : '↓'}</div>
      <div class="item-info">
        <div class="item-nome">${escapeHtml(r.description)}${r.recurrence_active ? '' : '<span class="badge-inativo">pausada</span>'}</div>
        <div class="item-detalhe">${LABELS_FREQUENCIA[r.recurrence_frequency] || 'Mensal'} · ${fmt.format(r.amount || 0)}${r.recurrence_until ? ` · até ${r.recurrence_until.split('-').reverse().join('/')}` : ''}</div>
      </div>
    </button>
  `).join('');
  wireItens();
}

function renderContas(container) {
  if (contas.length === 0) {
    container.innerHTML = '<div class="conta-vazia">Nenhuma conta cadastrada. Toque em + para criar a primeira.</div>';
    return;
  }
  container.innerHTML = contas.map((c) => `
    <button type="button" class="item-cadastro ${c.active ? '' : 'item-inativo'}" data-tipo="conta" data-id="${c.id}">
      <div class="item-avatar" style="background:${c.color || '#4f8ef7'}">${c.icon || inicial(c.nome)}</div>
      <div class="item-info">
        <div class="item-nome">${escapeHtml(c.nome)}${c.active ? '' : '<span class="badge-inativo">inativa</span>'}</div>
        <div class="item-detalhe">${escapeHtml(c.tipo || '')}${c.bank ? ` · ${escapeHtml(c.bank)}` : ''} · ${fmt.format(c.saldo_atual || 0)}</div>
      </div>
    </button>
  `).join('');
  wireItens();
}

function renderCartoes(container) {
  if (cartoes.length === 0) {
    container.innerHTML = '<div class="conta-vazia">Nenhum cartão cadastrado. Toque em + para criar o primeiro.</div>';
    return;
  }
  container.innerHTML = cartoes.map((c) => `
    <button type="button" class="item-cadastro ${c.ativo ? '' : 'item-inativo'}" data-tipo="cartao" data-id="${c.id}">
      <div class="item-avatar" style="background:${c.cor || '#7c5cfc'}">${inicial(c.nome)}</div>
      <div class="item-info">
        <div class="item-nome">${escapeHtml(c.nome)}${c.ativo ? '' : '<span class="badge-inativo">inativo</span>'}</div>
        <div class="item-detalhe">${escapeHtml(c.banco || '')}${c.bandeira ? ` · ${escapeHtml(c.bandeira)}` : ''} · Limite ${fmt.format(c.limite || 0)} · Fecha ${c.fechamento_dia ?? '-'} / Vence ${c.vencimento_dia ?? '-'}</div>
      </div>
    </button>
  `).join('');
  wireItens();
}

function renderCategorias(container) {
  if (categorias.length === 0) {
    container.innerHTML = '<div class="conta-vazia">Nenhuma categoria cadastrada. Toque em + para criar a primeira.</div>';
    return;
  }
  const despesas = categorias.filter((c) => c.tipo === 'despesa');
  const receitas = categorias.filter((c) => c.tipo === 'receita');

  const linha = (c) => `
    <button type="button" class="item-cadastro ${c.ativo ? '' : 'item-inativo'}" data-tipo="categoria" data-id="${c.id}">
      <div class="item-avatar" style="background:var(--surface-2)">${c.icon || '•'}</div>
      <div class="item-info">
        <div class="item-nome">${escapeHtml(c.nome)}${c.ativo ? '' : '<span class="badge-inativo">inativa</span>'}</div>
      </div>
    </button>
  `;

  let html = '';
  if (despesas.length) html += '<div class="grupo-titulo">Despesas</div>' + despesas.map(linha).join('');
  if (receitas.length) html += '<div class="grupo-titulo">Receitas</div>' + receitas.map(linha).join('');
  container.innerHTML = html;
  wireItens();
}

function wireItens() {
  document.querySelectorAll('.item-cadastro').forEach((el) => {
    el.addEventListener('click', () => {
      const item = encontrarItem(el.dataset.tipo, el.dataset.id);
      if (item) abrirSheetAcoes(el.dataset.tipo, item);
    });
  });
}

function encontrarItem(tipo, id) {
  if (tipo === 'conta') return contas.find((c) => c.id === id);
  if (tipo === 'cartao') return cartoes.find((c) => c.id === id);
  if (tipo === 'recorrente') return recorrentes.find((c) => c.id === id);
  return categorias.find((c) => c.id === id);
}

function fecharSheet(id) {
  document.getElementById(id).hidden = true;
}

function abrirSheetAcoes(tipo, item) {
  const conteudo = document.getElementById('sheet-acoes-conteudo');
  const botaoPausar = tipo === 'recorrente' ? `
    <button type="button" class="sheet-acao-btn" id="btn-pausar-item">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${item.recurrence_active ? '<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>' : '<path d="M5 3l16 9-16 9V3Z"/>'}</svg>
      ${item.recurrence_active ? 'Pausar' : 'Retomar'}
    </button>
  ` : '';
  conteudo.innerHTML = `
    <div class="sheet-titulo">${escapeHtml(item.nome)}</div>
    ${botaoPausar}
    <button type="button" class="sheet-acao-btn" id="btn-editar-item">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>
      Editar
    </button>
    <button type="button" class="sheet-acao-btn perigo" id="btn-excluir-item">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
      Excluir
    </button>
    <button type="button" class="sheet-acao-btn" id="btn-cancelar-acoes">Cancelar</button>
  `;
  document.getElementById('btn-pausar-item')?.addEventListener('click', () => alternarRecorrente(item));
  document.getElementById('btn-editar-item').addEventListener('click', () => {
    fecharSheet('sheet-acoes');
    abrirSheetForm(tipo, item);
  });
  document.getElementById('btn-excluir-item').addEventListener('click', () => confirmarExclusao(tipo, item));
  document.getElementById('btn-cancelar-acoes').addEventListener('click', () => fecharSheet('sheet-acoes'));
  document.getElementById('sheet-acoes').hidden = false;
}

async function alternarRecorrente(item) {
  const btn = document.getElementById('btn-pausar-item');
  btn.disabled = true;
  const { error } = await supabase
    .from('transactions')
    .update({ recurrence_active: !item.recurrence_active })
    .eq('id', item.id)
    .eq('user_id', usuarioAtual.id);
  if (error) {
    btn.disabled = false;
    return;
  }
  fecharSheet('sheet-acoes');
  await recarregarTudo();
}

function confirmarExclusao(tipo, item) {
  const conteudo = document.getElementById('sheet-acoes-conteudo');
  const avisos = {
    conta: 'Todas as movimentações desta conta serão perdidas.',
    cartao: 'Faturas e compras associadas serão perdidas.',
    categoria: 'Lançamentos com essa categoria ficam sem categoria.',
    recorrente: 'Para de gerar novos lançamentos. Ocorrências já geradas continuam existindo.',
  };
  conteudo.innerHTML = `
    <div class="sheet-titulo">Excluir "${escapeHtml(item.nome)}"?</div>
    <div class="sheet-aviso">${avisos[tipo]} Essa ação não pode ser desfeita.</div>
    <button type="button" class="sheet-acao-btn perigo" id="btn-confirmar-exclusao">Excluir</button>
    <button type="button" class="sheet-acao-btn" id="btn-cancelar-acoes">Cancelar</button>
  `;
  document.getElementById('btn-confirmar-exclusao').addEventListener('click', () => excluirItem(tipo, item));
  document.getElementById('btn-cancelar-acoes').addEventListener('click', () => fecharSheet('sheet-acoes'));
}

async function excluirItem(tipo, item) {
  const btn = document.getElementById('btn-confirmar-exclusao');
  btn.disabled = true;
  btn.textContent = 'Excluindo...';
  const tabela = { conta: 'accounts', cartao: 'credit_cards', categoria: 'categories', recorrente: 'transactions' }[tipo];
  const { error } = await supabase.from(tabela).delete().eq('id', item.id).eq('user_id', usuarioAtual.id);
  if (error) {
    btn.disabled = false;
    btn.textContent = 'Excluir';
    return;
  }
  fecharSheet('sheet-acoes');
  await recarregarTudo();
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
  const options = opcoes.map((o) => {
    const valor = typeof o === 'string' ? o : o.valor;
    const texto = typeof o === 'string' ? o : o.texto;
    return `<option value="${valor}" ${valor === valorAtual ? 'selected' : ''}>${texto}</option>`;
  }).join('');
  return `
    <div class="field">
      <label for="${id}">${label}</label>
      <select id="${id}">${options}</select>
    </div>
  `;
}

function abrirSheetForm(tipo, item) {
  const conteudo = document.getElementById('sheet-form-conteudo');
  if (tipo === 'conta') conteudo.innerHTML = formConta(item);
  else if (tipo === 'cartao') conteudo.innerHTML = formCartao(item);
  else if (tipo === 'recorrente') conteudo.innerHTML = formRecorrente(item);
  else conteudo.innerHTML = formCategoria(item);

  document.getElementById('btn-cancelar-form').addEventListener('click', () => fecharSheet('sheet-form'));
  document.getElementById('btn-salvar-form').addEventListener('click', () => salvarForm(tipo, item));
  document.getElementById('sheet-form').hidden = false;
}

function formConta(c) {
  return `
    <div class="sheet-titulo">${c ? 'Editar conta' : 'Nova conta'}</div>
    ${campoTexto('f-nome', 'Nome da conta', c?.nome, 'Ex: Conta Principal')}
    ${campoTexto('f-banco', 'Banco (opcional)', c?.bank, 'Ex: Itaú')}
    ${campoSelect('f-tipo', 'Tipo', TIPOS_CONTA, c?.tipo)}
    ${campoSelect('f-moeda', 'Moeda', [{ valor: 'BRL', texto: 'BRL — Real' }, { valor: 'USD', texto: 'USD — Dólar' }], c?.currency || 'BRL')}
    ${campoTexto('f-saldo', 'Saldo atual', c ? String(c.saldo_atual ?? 0).replace('.', ',') : '0', '0,00')}
    <div class="form-linha">
      <div class="field"><label for="f-cor">Cor</label><input type="color" id="f-cor" value="${c?.color || '#4f8ef7'}"></div>
      ${campoSelect('f-ativo', 'Status', [{ valor: 'true', texto: 'Ativa' }, { valor: 'false', texto: 'Inativa' }], String(c?.active !== false))}
    </div>
    <div class="error-msg" id="erro-form"></div>
    <button type="button" class="btn-primary" id="btn-salvar-form">Salvar</button>
    <button type="button" class="sheet-acao-btn" id="btn-cancelar-form">Cancelar</button>
  `;
}

function formCartao(c) {
  return `
    <div class="sheet-titulo">${c ? 'Editar cartão' : 'Novo cartão'}</div>
    ${campoTexto('f-nome', 'Nome do cartão', c?.nome, 'Ex: Nubank')}
    ${campoTexto('f-banco', 'Banco / Instituição', c?.banco, 'Ex: Nubank')}
    ${campoSelect('f-bandeira', 'Bandeira', ['', ...BANDEIRAS].map((b) => ({ valor: b, texto: b || 'Selecione' })), c?.bandeira || '')}
    ${campoTexto('f-limite', 'Limite', c ? String(c.limite ?? 0).replace('.', ',') : '0', '0,00')}
    <div class="form-linha">
      ${campoTexto('f-fechamento', 'Dia de fechamento', c?.fechamento_dia, 'Ex: 20')}
      ${campoTexto('f-vencimento', 'Dia de vencimento', c?.vencimento_dia, 'Ex: 27')}
    </div>
    <div class="form-linha">
      <div class="field"><label for="f-cor">Cor</label><input type="color" id="f-cor" value="${c?.cor || '#7c5cfc'}"></div>
      ${campoSelect('f-ativo', 'Status', [{ valor: 'true', texto: 'Ativo' }, { valor: 'false', texto: 'Inativo' }], String(c?.ativo !== false))}
    </div>
    <div class="error-msg" id="erro-form"></div>
    <button type="button" class="btn-primary" id="btn-salvar-form">Salvar</button>
    <button type="button" class="sheet-acao-btn" id="btn-cancelar-form">Cancelar</button>
  `;
}

function formCategoria(c) {
  return `
    <div class="sheet-titulo">${c ? 'Editar categoria' : 'Nova categoria'}</div>
    ${campoTexto('f-nome', 'Nome da categoria', c?.nome, 'Ex: Farmácia')}
    ${campoSelect('f-tipo', 'Tipo', [{ valor: 'despesa', texto: 'Despesa' }, { valor: 'receita', texto: 'Receita' }], c?.tipo || 'despesa')}
    ${campoTexto('f-icon', 'Ícone (emoji)', c?.icon, 'Ex: 💊')}
    ${campoSelect('f-ativo', 'Status', [{ valor: 'true', texto: 'Ativa' }, { valor: 'false', texto: 'Inativa' }], String(c?.ativo !== false))}
    <div class="error-msg" id="erro-form"></div>
    <button type="button" class="btn-primary" id="btn-salvar-form">Salvar</button>
    <button type="button" class="sheet-acao-btn" id="btn-cancelar-form">Cancelar</button>
  `;
}

function formRecorrente(r) {
  return `
    <div class="sheet-titulo">Editar recorrência</div>
    ${campoTexto('f-nome', 'Descrição', r?.description, 'Ex: Aluguel')}
    ${campoTexto('f-valor', 'Valor', r ? String(r.amount ?? 0).replace('.', ',') : '0', '0,00')}
    ${campoSelect('f-frequencia', 'Frequência', [{ valor: 'mensal', texto: 'Mensal' }, { valor: 'semanal', texto: 'Semanal' }, { valor: 'anual', texto: 'Anual' }], r?.recurrence_frequency || 'mensal')}
    ${campoTexto('f-ate', 'Repetir até (opcional, AAAA-MM-DD)', r?.recurrence_until, '2027-12-31')}
    <div class="error-msg" id="erro-form"></div>
    <button type="button" class="btn-primary" id="btn-salvar-form">Salvar</button>
    <button type="button" class="sheet-acao-btn" id="btn-cancelar-form">Cancelar</button>
  `;
}

function lerValorMonetario(id) {
  const bruto = document.getElementById(id).value.trim();
  const normalizado = bruto.replace(/\./g, '').replace(',', '.');
  const numero = Number(normalizado);
  return Number.isFinite(numero) ? numero : 0;
}

async function salvarForm(tipo, item) {
  const erro = document.getElementById('erro-form');
  const btn = document.getElementById('btn-salvar-form');
  const nome = document.getElementById('f-nome').value.trim();
  if (!nome) {
    erro.textContent = 'Preencha o nome.';
    return;
  }

  let tabela;
  let dados;

  if (tipo === 'conta') {
    tabela = 'accounts';
    const tipoConta = document.getElementById('f-tipo').value;
    if (!tipoConta) { erro.textContent = 'Selecione o tipo da conta.'; return; }
    dados = {
      nome,
      bank: document.getElementById('f-banco').value.trim() || null,
      tipo: tipoConta,
      account_kind: 'bank',
      currency: document.getElementById('f-moeda').value,
      saldo_atual: lerValorMonetario('f-saldo'),
      color: document.getElementById('f-cor').value,
      active: document.getElementById('f-ativo').value === 'true',
      icon: item?.icon || null,
    };
  } else if (tipo === 'cartao') {
    tabela = 'credit_cards';
    const fechamento = Number(document.getElementById('f-fechamento').value) || null;
    const vencimento = Number(document.getElementById('f-vencimento').value) || null;
    dados = {
      nome,
      banco: document.getElementById('f-banco').value.trim() || null,
      bandeira: document.getElementById('f-bandeira').value || null,
      limite: lerValorMonetario('f-limite'),
      fechamento_dia: fechamento,
      vencimento_dia: vencimento,
      cor: document.getElementById('f-cor').value,
      ativo: document.getElementById('f-ativo').value === 'true',
    };
  } else if (tipo === 'recorrente') {
    tabela = 'transactions';
    dados = {
      description: nome,
      amount: lerValorMonetario('f-valor'),
      recurrence_frequency: document.getElementById('f-frequencia').value,
      recurrence_until: document.getElementById('f-ate').value.trim() || null,
    };
  } else {
    tabela = 'categories';
    dados = {
      nome,
      tipo: document.getElementById('f-tipo').value,
      icon: document.getElementById('f-icon').value.trim() || null,
      ativo: document.getElementById('f-ativo').value === 'true',
    };
  }

  btn.disabled = true;
  btn.textContent = 'Salvando...';

  const { error } = item
    ? await supabase.from(tabela).update(dados).eq('id', item.id).eq('user_id', usuarioAtual.id)
    : await supabase.from(tabela).insert({ ...dados, user_id: usuarioAtual.id });

  if (error) {
    erro.textContent = 'Erro: ' + error.message;
    btn.disabled = false;
    btn.textContent = 'Salvar';
    return;
  }

  fecharSheet('sheet-form');
  await recarregarTudo();
}

async function init() {
  configurarBotaoSair();

  const user = await requireAuth();
  if (!user) return;
  usuarioAtual = user;

  gruposColapsados = carregarGruposColapsados();
  document.querySelectorAll('.grupo-cadastro').forEach((el) => {
    el.classList.toggle('colapsado', gruposColapsados.has(el.dataset.grupo));
  });

  document.querySelectorAll('[data-toggle-grupo]').forEach((btn) => {
    btn.addEventListener('click', () => alternarGrupo(btn.dataset.toggleGrupo));
  });

  document.querySelectorAll('[data-add-grupo]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const tipo = btn.dataset.addGrupo;
      if (tipo === 'recorrente') {
        window.location.href = '/pages/lancar.html';
        return;
      }
      abrirSheetForm(tipo, null);
    });
  });

  const sheetForm = document.getElementById('sheet-form');
  sheetForm.addEventListener('click', (e) => { if (e.target === sheetForm) sheetForm.hidden = true; });
  ativarArrastarParaFechar(sheetForm);

  const sheetAcoes = document.getElementById('sheet-acoes');
  sheetAcoes.addEventListener('click', (e) => { if (e.target === sheetAcoes) sheetAcoes.hidden = true; });
  ativarArrastarParaFechar(sheetAcoes);

  try {
    await recarregarTudo();
  } catch (err) {
    console.error(err);
  }
}

init();

window.addEventListener('pageshow', (event) => {
  if (event.persisted) init();
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') init();
});
