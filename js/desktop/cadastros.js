import { supabase, requireAuth, configurarBotaoSair } from '../supabaseClient.js';
import { aplicarTemaSalvo } from '../temaService.js';
import { montarNavRail } from './navRail.js';
import { abrirComandos } from './comandos.js';
import { configurarModal, abrirModal, fecharModal } from './modal.js';

const fmt = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

const TIPOS_CONTA = ['Conta Corrente', 'Conta Digital', 'Conta Poupança', 'Conta Internacional', 'Carteira'];
const BANDEIRAS = ['Visa', 'Mastercard', 'Elo', 'Amex', 'Hipercard'];
const LABELS_FREQUENCIA = { mensal: 'Mensal', semanal: 'Semanal', anual: 'Anual' };
const CHAVE_CARTAO_PRINCIPAL = 'flash_cartao_principal';
const CHAVE_CONTA_PRINCIPAL = 'flash_conta_principal';

let usuarioAtual = null;
let contas = [];
let cartoes = [];
let categorias = [];
let recorrentes = [];
let orcamentos = [];
let orcamentoMes = '';
let orcamentoMesHerdadoDe = null;
let cartaoPrincipalId = null;
let contaPrincipalId = null;

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}

async function carregarPreferenciaPrincipal(userId, chave) {
  const { data } = await supabase
    .from('user_settings')
    .select('setting_value')
    .eq('user_id', userId)
    .eq('setting_key', chave)
    .maybeSingle();
  return data?.setting_value || null;
}

async function salvarPreferenciaPrincipal(userId, chave, valorId) {
  await supabase
    .from('user_settings')
    .upsert({ user_id: userId, setting_key: chave, setting_value: valorId }, { onConflict: 'user_id,setting_key' });
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

async function carregarOrcamentos(userId, mes) {
  const { data, error } = await supabase
    .from('budgets')
    .select('id, category_id, valor_planejado, categories:category_id(nome, icon)')
    .eq('user_id', userId)
    .eq('mes_referencia', mes)
    .order('valor_planejado', { ascending: false });
  if (error) throw error;
  return (data ?? []).map((o) => ({ ...o, nome: o.categories?.nome || 'Categoria' }));
}

async function recarregarOrcamentos() {
  orcamentoMesHerdadoDe = null;
  let lista = await carregarOrcamentos(usuarioAtual.id, orcamentoMes);

  if (lista.length === 0) {
    const { data: anteriores } = await supabase
      .from('budgets')
      .select('mes_referencia')
      .eq('user_id', usuarioAtual.id)
      .lt('mes_referencia', orcamentoMes)
      .order('mes_referencia', { ascending: false })
      .limit(1);
    if (anteriores?.length) orcamentoMesHerdadoDe = anteriores[0].mes_referencia;
  }

  orcamentos = lista;
  renderOrcamentos();
  document.getElementById('contagem-orcamentos').textContent = orcamentos.length;
}

async function recarregarTudo() {
  [contas, cartoes, categorias, recorrentes] = await Promise.all([
    carregarContas(usuarioAtual.id),
    carregarCartoes(usuarioAtual.id),
    carregarCategorias(usuarioAtual.id),
    carregarRecorrentes(usuarioAtual.id),
  ]);
  renderLista();
  await recarregarOrcamentos();
}

function renderLista() {
  renderContas();
  renderCartoes();
  renderCategorias();
  renderRecorrentes();
  document.getElementById('contagem-contas').textContent = contas.length;
  document.getElementById('contagem-cartoes').textContent = cartoes.length;
  document.getElementById('contagem-categorias').textContent = categorias.length;
  document.getElementById('contagem-recorrentes').textContent = recorrentes.length;
}

function renderContas() {
  const container = document.getElementById('lista-contas');
  if (contas.length === 0) {
    container.innerHTML = '<tr><td colspan="3" class="lista-vazia">Nenhuma conta cadastrada.</td></tr>';
    return;
  }
  container.innerHTML = contas.map((c) => `
    <tr class="item-cadastro ${c.active ? '' : 'item-inativo'}" data-tipo="conta" data-id="${c.id}">
      <td><div class="cad-item-nome">${escapeHtml(c.nome)}${c.id === contaPrincipalId ? '<span class="badge-principal">principal</span>' : ''}${c.active ? '' : '<span class="badge-inativo">inativa</span>'}</div></td>
      <td>${escapeHtml(c.tipo || '')}${c.bank ? ` · ${escapeHtml(c.bank)}` : ''}</td>
      <td class="num valor-sensivel">${fmt.format(c.saldo_atual || 0)}</td>
    </tr>
  `).join('');
  wireItens();
}

function renderCartoes() {
  const container = document.getElementById('lista-cartoes');
  if (cartoes.length === 0) {
    container.innerHTML = '<tr><td colspan="4" class="lista-vazia">Nenhum cartão cadastrado.</td></tr>';
    return;
  }
  container.innerHTML = cartoes.map((c) => `
    <tr class="item-cadastro ${c.ativo ? '' : 'item-inativo'}" data-tipo="cartao" data-id="${c.id}">
      <td><div class="cad-item-nome">${escapeHtml(c.nome)}${c.id === cartaoPrincipalId ? '<span class="badge-principal">principal</span>' : ''}${c.ativo ? '' : '<span class="badge-inativo">inativo</span>'}</div></td>
      <td>${escapeHtml(c.bandeira || '—')}</td>
      <td class="num valor-sensivel">${fmt.format(c.limite || 0)}</td>
      <td>${c.fechamento_dia ?? '-'} / ${c.vencimento_dia ?? '-'}</td>
    </tr>
  `).join('');
  wireItens();
}

function renderCategorias() {
  const container = document.getElementById('lista-categorias');
  if (categorias.length === 0) {
    container.innerHTML = '<tr><td colspan="2" class="lista-vazia">Nenhuma categoria cadastrada.</td></tr>';
    return;
  }
  container.innerHTML = categorias.map((c) => `
    <tr class="item-cadastro ${c.ativo ? '' : 'item-inativo'}" data-tipo="categoria" data-id="${c.id}">
      <td><div class="cad-item-nome">${c.icon || '•'} ${escapeHtml(c.nome)}${c.ativo ? '' : '<span class="badge-inativo">inativa</span>'}</div></td>
      <td>${c.tipo === 'receita' ? 'Receita' : 'Despesa'}</td>
    </tr>
  `).join('');
  wireItens();
}

function renderRecorrentes() {
  const container = document.getElementById('lista-recorrentes');
  if (recorrentes.length === 0) {
    container.innerHTML = '<tr><td colspan="3" class="lista-vazia">Nenhum lançamento recorrente.</td></tr>';
    return;
  }
  container.innerHTML = recorrentes.map((r) => `
    <tr class="item-cadastro ${r.recurrence_active ? '' : 'item-inativo'}" data-tipo="recorrente" data-id="${r.id}">
      <td><div class="cad-item-nome">${escapeHtml(r.description)}${r.recurrence_active ? '' : '<span class="badge-inativo">pausada</span>'}</div></td>
      <td>${LABELS_FREQUENCIA[r.recurrence_frequency] || 'Mensal'}${r.recurrence_until ? ` · até ${r.recurrence_until.split('-').reverse().join('/')}` : ''}</td>
      <td class="num valor-sensivel">${fmt.format(r.amount || 0)}</td>
    </tr>
  `).join('');
  wireItens();
}

function mesLabel(ym) {
  const [a, m] = ym.split('-');
  const texto = new Date(a, m - 1, 1).toLocaleString('pt-BR', { month: 'long', year: 'numeric' });
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

function mesAdicionar(ym, n) {
  const [a, m] = ym.split('-').map(Number);
  const d = new Date(a, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function renderOrcamentos() {
  document.getElementById('orcamento-mes-label').textContent = mesLabel(orcamentoMes);
  const area = document.getElementById('area-orcamentos');

  if (orcamentos.length === 0) {
    if (orcamentoMesHerdadoDe) {
      area.innerHTML = `
        <div class="lista-vazia">Nenhum orçamento para este mês.</div>
        <button type="button" class="btn-desktop" id="btn-copiar-orcamento" style="display:block;margin:12px auto 0">
          Copiar orçamento de ${mesLabel(orcamentoMesHerdadoDe)}
        </button>
      `;
      document.getElementById('btn-copiar-orcamento').addEventListener('click', copiarOrcamentoMesAnterior);
    } else {
      area.innerHTML = '<div class="lista-vazia">Nenhum orçamento cadastrado.</div>';
    }
    return;
  }

  area.innerHTML = `
    <div class="table-wrap"><table class="data-table"><thead><tr><th>Categoria</th><th class="num">Planejado</th></tr></thead><tbody id="lista-orcamentos"></tbody></table></div>
  `;
  document.getElementById('lista-orcamentos').innerHTML = orcamentos.map((o) => `
    <tr class="item-cadastro" data-tipo="orcamento" data-id="${o.id}">
      <td><div class="cad-item-nome">${o.categories?.icon || '💰'} ${escapeHtml(o.nome)}</div></td>
      <td class="num valor-sensivel">${fmt.format(o.valor_planejado || 0)}</td>
    </tr>
  `).join('');
  wireItens();
}

async function copiarOrcamentoMesAnterior() {
  const btn = document.getElementById('btn-copiar-orcamento');
  btn.disabled = true;
  btn.textContent = 'Copiando...';
  const anteriores = await carregarOrcamentos(usuarioAtual.id, orcamentoMesHerdadoDe);
  const { error } = await supabase.from('budgets').insert(
    anteriores.map((o) => ({ user_id: usuarioAtual.id, mes_referencia: orcamentoMes, category_id: o.category_id, valor_planejado: o.valor_planejado })),
  );
  if (error) { btn.disabled = false; btn.textContent = 'Copiar orçamento'; return; }
  await recarregarOrcamentos();
}

async function mudarOrcamentoMes(delta) {
  orcamentoMes = mesAdicionar(orcamentoMes, delta);
  await recarregarOrcamentos();
}

function wireItens() {
  document.querySelectorAll('.item-cadastro').forEach((el) => {
    el.addEventListener('click', () => {
      const item = encontrarItem(el.dataset.tipo, el.dataset.id);
      if (item) abrirModalAcoes(el.dataset.tipo, item);
    });
  });
}

function encontrarItem(tipo, id) {
  if (tipo === 'conta') return contas.find((c) => c.id === id);
  if (tipo === 'cartao') return cartoes.find((c) => c.id === id);
  if (tipo === 'recorrente') return recorrentes.find((c) => c.id === id);
  if (tipo === 'orcamento') return orcamentos.find((c) => c.id === id);
  return categorias.find((c) => c.id === id);
}

function abrirModalAcoes(tipo, item) {
  const conteudo = document.getElementById('modal-acoes-conteudo');
  const botaoPausar = tipo === 'recorrente'
    ? `<button type="button" class="btn-desktop" id="btn-pausar-item">${item.recurrence_active ? 'Pausar' : 'Retomar'}</button>`
    : '';
  conteudo.innerHTML = `
    <div class="modal-titulo">${escapeHtml(item.nome)}</div>
    <div style="display:flex;flex-direction:column;gap:10px;margin-top:10px">
      ${botaoPausar}
      <button type="button" class="btn-desktop primario" id="btn-editar-item">Editar</button>
      <button type="button" class="btn-desktop perigo" id="btn-excluir-item">Excluir</button>
    </div>
  `;
  document.getElementById('btn-pausar-item')?.addEventListener('click', () => alternarRecorrente(item));
  document.getElementById('btn-editar-item').addEventListener('click', () => {
    fecharModal('modal-acoes');
    abrirModalForm(tipo, item);
  });
  document.getElementById('btn-excluir-item').addEventListener('click', () => confirmarExclusao(tipo, item));
  abrirModal('modal-acoes');
}

async function alternarRecorrente(item) {
  const btn = document.getElementById('btn-pausar-item');
  btn.disabled = true;
  const { error } = await supabase
    .from('transactions')
    .update({ recurrence_active: !item.recurrence_active })
    .eq('id', item.id)
    .eq('user_id', usuarioAtual.id);
  if (error) { btn.disabled = false; return; }
  fecharModal('modal-acoes');
  await recarregarTudo();
}

function confirmarExclusao(tipo, item) {
  const conteudo = document.getElementById('modal-acoes-conteudo');
  const avisos = {
    conta: 'Todas as movimentações desta conta serão perdidas.',
    cartao: 'Faturas e compras associadas serão perdidas.',
    categoria: 'Lançamentos com essa categoria ficam sem categoria.',
    recorrente: 'Para de gerar novos lançamentos. Ocorrências já geradas continuam existindo.',
    orcamento: 'O planejamento desta categoria some do relatório do mês.',
  };
  conteudo.innerHTML = `
    <div class="modal-titulo">Excluir "${escapeHtml(item.nome)}"?</div>
    <p style="color:var(--muted);font-size:13px">${avisos[tipo]} Essa ação não pode ser desfeita.</p>
    <button type="button" class="btn-desktop perigo" id="btn-confirmar-exclusao" style="margin-top:10px">Excluir</button>
  `;
  document.getElementById('btn-confirmar-exclusao').addEventListener('click', () => excluirItem(tipo, item));
}

async function excluirItem(tipo, item) {
  const btn = document.getElementById('btn-confirmar-exclusao');
  btn.disabled = true;
  btn.textContent = 'Excluindo...';
  const tabela = { conta: 'accounts', cartao: 'credit_cards', categoria: 'categories', recorrente: 'transactions', orcamento: 'budgets' }[tipo];
  const { error } = await supabase.from(tabela).delete().eq('id', item.id).eq('user_id', usuarioAtual.id);
  if (error) { btn.disabled = false; btn.textContent = 'Excluir'; return; }
  fecharModal('modal-acoes');
  if (tipo === 'orcamento') { await recarregarOrcamentos(); return; }
  await recarregarTudo();
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
  const options = opcoes.map((o) => {
    const valor = typeof o === 'string' ? o : o.valor;
    const texto = typeof o === 'string' ? o : o.texto;
    return `<option value="${valor}" ${valor === valorAtual ? 'selected' : ''}>${texto}</option>`;
  }).join('');
  return `
    <div class="field">
      <label for="${id}">${label}</label>
      <select class="input-desktop" id="${id}">${options}</select>
    </div>
  `;
}

function abrirModalForm(tipo, item) {
  const conteudo = document.getElementById('modal-form-conteudo');
  if (tipo === 'conta') conteudo.innerHTML = formConta(item);
  else if (tipo === 'cartao') conteudo.innerHTML = formCartao(item);
  else if (tipo === 'recorrente') conteudo.innerHTML = formRecorrente(item);
  else if (tipo === 'orcamento') conteudo.innerHTML = formOrcamento(item);
  else conteudo.innerHTML = formCategoria(item);

  document.getElementById('btn-salvar-form').addEventListener('click', () => salvarForm(tipo, item));
  abrirModal('modal-form');
}

function formConta(c) {
  return `
    <div class="modal-titulo">${c ? 'Editar conta' : 'Nova conta'}</div>
    <div style="display:flex;flex-direction:column;gap:14px;margin-top:12px">
      ${campoTexto('f-nome', 'Nome da conta', c?.nome, 'Ex: Conta Principal')}
      ${campoTexto('f-banco', 'Banco (opcional)', c?.bank, 'Ex: Itaú')}
      ${campoSelect('f-tipo', 'Tipo', TIPOS_CONTA, c?.tipo)}
      <div class="form-linha">
        ${campoSelect('f-moeda', 'Moeda', [{ valor: 'BRL', texto: 'BRL — Real' }, { valor: 'USD', texto: 'USD — Dólar' }], c?.currency || 'BRL')}
        ${campoTexto('f-saldo', 'Saldo atual', c ? String(c.saldo_atual ?? 0).replace('.', ',') : '0', '0,00')}
      </div>
      <div class="form-linha">
        <div class="field"><label for="f-cor">Cor</label><input type="color" id="f-cor" value="${c?.color || '#0E7C86'}"></div>
        ${campoSelect('f-ativo', 'Status', [{ valor: 'true', texto: 'Ativa' }, { valor: 'false', texto: 'Inativa' }], String(c?.active !== false))}
      </div>
      <label class="toggle-linha">
        <span>Conta principal</span>
        <input type="checkbox" id="f-principal" ${c && c.id === contaPrincipalId ? 'checked' : ''}>
      </label>
      <div class="error-msg" id="erro-form"></div>
      <button type="button" class="btn-desktop primario" id="btn-salvar-form">Salvar</button>
    </div>
  `;
}

function formCartao(c) {
  return `
    <div class="modal-titulo">${c ? 'Editar cartão' : 'Novo cartão'}</div>
    <div style="display:flex;flex-direction:column;gap:14px;margin-top:12px">
      ${campoTexto('f-nome', 'Nome do cartão', c?.nome, 'Ex: Nubank')}
      ${campoTexto('f-banco', 'Banco / Instituição', c?.banco, 'Ex: Nubank')}
      ${campoSelect('f-bandeira', 'Bandeira', ['', ...BANDEIRAS].map((b) => ({ valor: b, texto: b || 'Selecione' })), c?.bandeira || '')}
      ${campoTexto('f-limite', 'Limite', c ? String(c.limite ?? 0).replace('.', ',') : '0', '0,00')}
      <div class="form-linha">
        ${campoTexto('f-fechamento', 'Dia de fechamento', c?.fechamento_dia, 'Ex: 20')}
        ${campoTexto('f-vencimento', 'Dia de vencimento', c?.vencimento_dia, 'Ex: 27')}
      </div>
      <div class="form-linha">
        <div class="field"><label for="f-cor">Cor</label><input type="color" id="f-cor" value="${c?.cor || '#14A3AE'}"></div>
        ${campoSelect('f-ativo', 'Status', [{ valor: 'true', texto: 'Ativo' }, { valor: 'false', texto: 'Inativo' }], String(c?.ativo !== false))}
      </div>
      <label class="toggle-linha">
        <span>Cartão principal</span>
        <input type="checkbox" id="f-principal" ${c && c.id === cartaoPrincipalId ? 'checked' : ''}>
      </label>
      <div class="error-msg" id="erro-form"></div>
      <button type="button" class="btn-desktop primario" id="btn-salvar-form">Salvar</button>
    </div>
  `;
}

function formCategoria(c) {
  return `
    <div class="modal-titulo">${c ? 'Editar categoria' : 'Nova categoria'}</div>
    <div style="display:flex;flex-direction:column;gap:14px;margin-top:12px">
      ${campoTexto('f-nome', 'Nome da categoria', c?.nome, 'Ex: Farmácia')}
      ${campoSelect('f-tipo', 'Tipo', [{ valor: 'despesa', texto: 'Despesa' }, { valor: 'receita', texto: 'Receita' }], c?.tipo || 'despesa')}
      ${campoTexto('f-icon', 'Ícone (emoji)', c?.icon, 'Ex: 💊')}
      ${campoSelect('f-ativo', 'Status', [{ valor: 'true', texto: 'Ativa' }, { valor: 'false', texto: 'Inativa' }], String(c?.ativo !== false))}
      <div class="error-msg" id="erro-form"></div>
      <button type="button" class="btn-desktop primario" id="btn-salvar-form">Salvar</button>
    </div>
  `;
}

function formRecorrente(r) {
  return `
    <div class="modal-titulo">Editar recorrência</div>
    <div style="display:flex;flex-direction:column;gap:14px;margin-top:12px">
      ${campoTexto('f-nome', 'Descrição', r?.description, 'Ex: Aluguel')}
      ${campoTexto('f-valor', 'Valor', r ? String(r.amount ?? 0).replace('.', ',') : '0', '0,00')}
      ${campoSelect('f-frequencia', 'Frequência', [{ valor: 'mensal', texto: 'Mensal' }, { valor: 'semanal', texto: 'Semanal' }, { valor: 'anual', texto: 'Anual' }], r?.recurrence_frequency || 'mensal')}
      ${campoTexto('f-ate', 'Repetir até (opcional, AAAA-MM-DD)', r?.recurrence_until, '2027-12-31')}
      <div class="error-msg" id="erro-form"></div>
      <button type="button" class="btn-desktop primario" id="btn-salvar-form">Salvar</button>
    </div>
  `;
}

function formOrcamento(o) {
  const categoriasDisponiveis = categorias.filter((c) =>
    c.tipo === 'despesa' && (o?.category_id === c.id || !orcamentos.some((x) => x.category_id === c.id)));
  const campoCategoria = o
    ? `<div class="field"><label>Categoria</label><input type="text" class="input-desktop" value="${escapeHtml(o.nome)}" disabled></div>`
    : campoSelect('f-categoria', 'Categoria', categoriasDisponiveis.map((c) => ({ valor: c.id, texto: `${c.icon || ''} ${c.nome}`.trim() })), '');
  return `
    <div class="modal-titulo">${o ? 'Editar orçamento' : 'Novo orçamento'} — ${mesLabel(orcamentoMes)}</div>
    <div style="display:flex;flex-direction:column;gap:14px;margin-top:12px">
      ${campoCategoria}
      ${campoTexto('f-valor', 'Valor planejado', o ? String(o.valor_planejado ?? 0).replace('.', ',') : '', '0,00')}
      <div class="error-msg" id="erro-form"></div>
      <button type="button" class="btn-desktop primario" id="btn-salvar-form">Salvar</button>
    </div>
  `;
}

function lerValorMonetario(id) {
  const bruto = document.getElementById(id).value.trim();
  const normalizado = bruto.replace(/\./g, '').replace(',', '.');
  const numero = Number(normalizado);
  return Number.isFinite(numero) ? numero : 0;
}

async function salvarOrcamento(item) {
  const erro = document.getElementById('erro-form');
  const btn = document.getElementById('btn-salvar-form');
  const valor = lerValorMonetario('f-valor');
  if (!valor) { erro.textContent = 'Informe o valor planejado.'; return; }

  const dados = { valor_planejado: valor };
  if (!item) {
    const categoryId = document.getElementById('f-categoria').value;
    if (!categoryId) { erro.textContent = 'Selecione a categoria.'; return; }
    dados.category_id = categoryId;
    dados.mes_referencia = orcamentoMes;
    dados.user_id = usuarioAtual.id;
  }

  btn.disabled = true;
  btn.textContent = 'Salvando...';

  const { error } = item
    ? await supabase.from('budgets').update(dados).eq('id', item.id).eq('user_id', usuarioAtual.id)
    : await supabase.from('budgets').insert(dados);

  if (error) {
    erro.textContent = 'Erro: ' + error.message;
    btn.disabled = false;
    btn.textContent = 'Salvar';
    return;
  }

  fecharModal('modal-form');
  await recarregarOrcamentos();
}

async function salvarForm(tipo, item) {
  if (tipo === 'orcamento') { await salvarOrcamento(item); return; }

  const erro = document.getElementById('erro-form');
  const btn = document.getElementById('btn-salvar-form');
  const nome = document.getElementById('f-nome').value.trim();
  if (!nome) { erro.textContent = 'Preencha o nome.'; return; }

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

  let error;
  let novoId = null;
  if (item) {
    ({ error } = await supabase.from(tabela).update(dados).eq('id', item.id).eq('user_id', usuarioAtual.id));
  } else if (tipo === 'cartao' || tipo === 'conta') {
    const { data: inserido, error: erroInsert } = await supabase.from(tabela).insert({ ...dados, user_id: usuarioAtual.id }).select('id').single();
    error = erroInsert;
    novoId = inserido?.id ?? null;
  } else {
    ({ error } = await supabase.from(tabela).insert({ ...dados, user_id: usuarioAtual.id }));
  }

  if (error) {
    erro.textContent = 'Erro: ' + error.message;
    btn.disabled = false;
    btn.textContent = 'Salvar';
    return;
  }

  if (tipo === 'cartao') {
    const cardId = item ? item.id : novoId;
    const marcarPrincipal = document.getElementById('f-principal').checked;
    if (marcarPrincipal && cardId) {
      cartaoPrincipalId = cardId;
      await salvarPreferenciaPrincipal(usuarioAtual.id, CHAVE_CARTAO_PRINCIPAL, cardId);
    } else if (!marcarPrincipal && cartaoPrincipalId === cardId) {
      cartaoPrincipalId = null;
      await salvarPreferenciaPrincipal(usuarioAtual.id, CHAVE_CARTAO_PRINCIPAL, null);
    }
  } else if (tipo === 'conta') {
    const contaId = item ? item.id : novoId;
    const marcarPrincipal = document.getElementById('f-principal').checked;
    if (marcarPrincipal && contaId) {
      contaPrincipalId = contaId;
      await salvarPreferenciaPrincipal(usuarioAtual.id, CHAVE_CONTA_PRINCIPAL, contaId);
    } else if (!marcarPrincipal && contaPrincipalId === contaId) {
      contaPrincipalId = null;
      await salvarPreferenciaPrincipal(usuarioAtual.id, CHAVE_CONTA_PRINCIPAL, null);
    }
  }

  fecharModal('modal-form');
  await recarregarTudo();
}

function configurarTabs() {
  document.querySelectorAll('.cad-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.cad-tab').forEach((t) => t.classList.toggle('ativa', t === tab));
      document.querySelectorAll('.cad-secao').forEach((s) => s.classList.toggle('ativa', s.dataset.secao === tab.dataset.tab));
    });
  });
}

async function iniciar() {
  aplicarTemaSalvo();
  const user = await requireAuth();
  if (!user) return;
  usuarioAtual = user;

  montarNavRail('cadastros');
  configurarBotaoSair();
  document.getElementById('btn-topbar-busca').addEventListener('click', abrirComandos);

  configurarModal('modal-acoes');
  configurarModal('modal-form');
  document.getElementById('btn-fechar-modal-acoes').addEventListener('click', () => fecharModal('modal-acoes'));
  document.getElementById('btn-fechar-modal-form').addEventListener('click', () => fecharModal('modal-form'));

  configurarTabs();

  document.querySelectorAll('[data-add-grupo]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const tipo = btn.dataset.addGrupo;
      if (tipo === 'recorrente') {
        window.location.href = '/pages/desktop/lancar.html';
        return;
      }
      abrirModalForm(tipo, null);
    });
  });

  if (!orcamentoMes) {
    const hoje = new Date();
    orcamentoMes = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}`;
  }
  document.getElementById('btn-orcamento-mes-anterior').addEventListener('click', () => mudarOrcamentoMes(-1));
  document.getElementById('btn-orcamento-mes-proximo').addEventListener('click', () => mudarOrcamentoMes(1));

  try {
    [cartaoPrincipalId, contaPrincipalId] = await Promise.all([
      carregarPreferenciaPrincipal(user.id, CHAVE_CARTAO_PRINCIPAL),
      carregarPreferenciaPrincipal(user.id, CHAVE_CONTA_PRINCIPAL),
    ]);
  } catch (err) {
    console.error(err);
  }

  try {
    await recarregarTudo();
  } catch (err) {
    console.error(err);
  }
}

iniciar();
