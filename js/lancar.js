import { supabase, requireAuth } from './supabaseClient.js';
import { aplicarTemaSalvo } from './temaService.js?v=3';
import { getDescricoesRecentes, popularDatalist, encontrarSugestao } from './autocompleteService.js';
import { escapeHtml } from './utils/escapeHtml.js';
import { hojeISO } from './utils/datas.js';

let tipo = 'despesa';
let contaSelecionada = null;
let categoriaSelecionada = null;
let contas = [];
let categorias = [];
let lancamentoOriginal = null;
let descricoesRecentes = [];
let jaPagoTocadoManualmente = false;

function uuid() {
  return crypto?.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2);
}

function moedaSelecionada() {
  return contas.find((c) => c.id === contaSelecionada)?.currency || 'BRL';
}

function formatarValorDigitado(valorCentavos) {
  const valor = valorCentavos / 100;
  return valor.toLocaleString('pt-BR', { style: 'currency', currency: moedaSelecionada() });
}

function valorEmReais() {
  const digitos = document.getElementById('valor').dataset.centavos || '0';
  return Number(digitos) / 100;
}

function atualizarDisplaysValor(centavos) {
  const texto = formatarValorDigitado(Number(centavos));
  document.getElementById('valor').dataset.centavos = centavos;
  document.getElementById('valor').textContent = texto;
  document.getElementById('sheet-valor-display').textContent = texto;
}

function configurarTecladoValor() {
  atualizarDisplaysValor('0');

  document.querySelectorAll('.tecla').forEach((tecla) => {
    tecla.addEventListener('click', () => {
      const acao = tecla.dataset.acao;
      let centavos = document.getElementById('valor').dataset.centavos || '0';
      if (acao === 'apagar') {
        centavos = centavos.slice(0, -1) || '0';
      } else {
        centavos = (centavos === '0' ? '' : centavos) + acao;
        centavos = centavos.slice(0, 12);
      }
      atualizarDisplaysValor(centavos);
    });
  });

  const sheet = document.getElementById('sheet-valor');
  document.getElementById('btn-abrir-valor').addEventListener('click', () => {
    // Se outro campo (ex: Descrição) ainda está com foco e teclado do
    // celular aberto, o primeiro toque no valor só fecha esse teclado sem
    // abrir a folha — tira o foco antes, garantindo que a folha sempre abre
    // de primeira.
    document.activeElement?.blur();
    sheet.hidden = false;
  });
  document.getElementById('btn-concluir-valor').addEventListener('click', () => {
    sheet.hidden = true;
  });
  sheet.addEventListener('click', (e) => {
    if (e.target === sheet) sheet.hidden = true;
  });
}

function selecionarTipo(novoTipo) {
  tipo = novoTipo;
  document.getElementById('btn-despesa').classList.toggle('ativo-despesa', tipo === 'despesa');
  document.getElementById('btn-receita').classList.toggle('ativo-receita', tipo === 'receita');
  document.getElementById('valor').classList.toggle('cor-despesa', tipo === 'despesa');
  document.getElementById('valor').classList.toggle('cor-receita', tipo === 'receita');
  document.getElementById('sheet-valor-display').classList.toggle('cor-despesa', tipo === 'despesa');
  document.getElementById('sheet-valor-display').classList.toggle('cor-receita', tipo === 'receita');
  document.getElementById('rotulo-ja-pago').textContent = tipo === 'despesa' ? 'Já paguei' : 'Já recebi';
  renderCategorias();
}

// Padrão: marcado quando a data é hoje/passado, desmarcado quando é futura —
// mas só enquanto o usuário não mexeu no toggle manualmente (uma conta com
// vencimento hoje pode ainda não ter sido paga de fato).
function atualizarPadraoJaPago() {
  if (jaPagoTocadoManualmente) return;
  const dataEscolhida = document.getElementById('data').value || hojeISO();
  document.getElementById('chk-ja-pago').checked = dataEscolhida <= hojeISO();
}

function renderContas() {
  const container = document.getElementById('lista-contas-chip');
  container.innerHTML = contas.map((c) => `
    <button type="button" class="chip-conta ${c.id === contaSelecionada ? 'selecionada' : ''}" data-id="${c.id}">
      ${escapeHtml(c.nome)}
    </button>
  `).join('');
  container.querySelectorAll('.chip-conta').forEach((btn) => {
    btn.addEventListener('click', () => {
      contaSelecionada = btn.dataset.id;
      renderContas();
    });
  });

  // A conta selecionada define a moeda (ex: Nomad USD) — atualiza o símbolo
  // do valor já digitado sempre que a conta muda, sem esperar novo dígito.
  const centavosAtuais = document.getElementById('valor')?.dataset.centavos;
  if (centavosAtuais !== undefined) atualizarDisplaysValor(centavosAtuais);
}

function renderCategorias() {
  const container = document.getElementById('lista-categorias-chip');
  const filtradas = categorias.filter((c) => c.tipo === tipo);
  if (!filtradas.some((c) => c.id === categoriaSelecionada)) {
    categoriaSelecionada = filtradas[0]?.id ?? null;
  }
  container.innerHTML = filtradas.map((c) => `
    <button type="button" class="chip-categoria ${c.id === categoriaSelecionada ? 'selecionada' : ''}" data-id="${c.id}">
      ${escapeHtml(c.nome)}
    </button>
  `).join('');
  container.querySelectorAll('.chip-categoria').forEach((btn) => {
    btn.addEventListener('click', () => {
      categoriaSelecionada = btn.dataset.id;
      renderCategorias();
    });
  });
}

function aplicarSugestaoDescricao() {
  const aviso = document.getElementById('aviso-sugestao');
  aviso.textContent = '';

  const sugestao = encontrarSugestao(descricoesRecentes, document.getElementById('descricao').value);
  if (!sugestao) return;

  let preencheu = false;
  if (sugestao.categoryId && categorias.some((c) => c.id === sugestao.categoryId && c.tipo === tipo)) {
    categoriaSelecionada = sugestao.categoryId;
    renderCategorias();
    preencheu = true;
  }
  if (sugestao.source === 'conta' && sugestao.accountId && contas.some((c) => c.id === sugestao.accountId)) {
    contaSelecionada = sugestao.accountId;
    renderContas();
    preencheu = true;
  }
  if (preencheu) aviso.textContent = 'Categoria/conta preenchidas com base no último lançamento parecido.';
}

async function carregarContaPrincipal(userId) {
  const { data } = await supabase
    .from('user_settings')
    .select('setting_value')
    .eq('user_id', userId)
    .eq('setting_key', 'flash_conta_principal')
    .maybeSingle();
  return data?.setting_value || null;
}

async function carregarContasECategorias(userId) {
  const [{ data: dadosContas, error: erroContas }, { data: dadosCategorias, error: erroCategorias }, contaPrincipalId] = await Promise.all([
    supabase.from('accounts').select('id, nome, currency').eq('user_id', userId).eq('active', true).eq('account_kind', 'bank').order('sort_order'),
    supabase.from('categories').select('id, nome, tipo').eq('user_id', userId).eq('ativo', true).in('tipo', ['despesa', 'receita']).order('nome'),
    carregarContaPrincipal(userId),
  ]);

  if (erroContas) throw erroContas;
  if (erroCategorias) throw erroCategorias;

  contas = dadosContas ?? [];
  categorias = dadosCategorias ?? [];
  const principalValida = contaPrincipalId && contas.some((c) => c.id === contaPrincipalId);
  contaSelecionada = lancamentoOriginal?.account_id ?? (principalValida ? contaPrincipalId : (contas[0]?.id ?? null));

  renderContas();
  renderCategorias();
}

function escolherEscopoEdicao() {
  return new Promise((resolve) => {
    const overlay = document.getElementById('sheet-escopo-recorrencia');
    const conteudo = document.getElementById('sheet-escopo-conteudo');
    conteudo.innerHTML = `
      <div class="sheet-titulo">Alterar recorrência</div>
      <div class="sheet-aviso">Este lançamento faz parte de uma recorrência. Como deseja aplicar a alteração?</div>
      <button type="button" class="sheet-acao-btn" id="btn-escopo-only">Alterar somente esta ocorrência</button>
      <button type="button" class="sheet-acao-btn" id="btn-escopo-future">Alterar esta e futuras</button>
      <button type="button" class="sheet-acao-btn" id="btn-escopo-cancelar">Cancelar</button>
    `;

    const finalizar = (valor) => {
      overlay.hidden = true;
      resolve(valor);
    };
    document.getElementById('btn-escopo-only').addEventListener('click', () => finalizar('only'));
    document.getElementById('btn-escopo-future').addEventListener('click', () => finalizar('future'));
    document.getElementById('btn-escopo-cancelar').addEventListener('click', () => finalizar(null));

    overlay.hidden = false;
  });
}

async function salvar(user) {
  const valor = valorEmReais();
  const descricao = document.getElementById('descricao').value.trim();
  const erroEl = document.getElementById('erro-lancar');
  erroEl.textContent = '';

  if (valor <= 0) {
    erroEl.textContent = 'Informe um valor maior que zero.';
    return;
  }
  if (!descricao) {
    erroEl.textContent = 'Informe uma descrição.';
    return;
  }
  if (!contaSelecionada) {
    erroEl.textContent = 'Cadastre uma conta no FinZen antes de lançar.';
    return;
  }

  const btn = document.getElementById('btn-salvar');
  const textoBotaoPadrao = lancamentoOriginal ? 'Salvar alterações' : 'Salvar lançamento';
  btn.disabled = true;
  btn.textContent = 'Salvando...';

  const dataEscolhida = document.getElementById('data').value || hojeISO();

  if (lancamentoOriginal) {
    const recorrente = Boolean(lancamentoOriginal.is_recurring || lancamentoOriginal.recurrence_group_id);
    let escopo = 'only';
    if (recorrente) {
      escopo = await escolherEscopoEdicao();
      if (!escopo) {
        btn.disabled = false;
        btn.textContent = textoBotaoPadrao;
        return;
      }
    }

    if (escopo === 'only') {
      // RPC atômica (update + reconciliação de saldo, cobrindo troca de
      // conta) numa transação só do banco — antes eram update + 2 chamadas
      // de increment_account_balance separadas.
      const { error: erroEditar } = await supabase.rpc('fz_editar_transacao', {
        p_transaction_id: lancamentoOriginal.id,
        p_account_id: contaSelecionada,
        p_category_id: categoriaSelecionada,
        p_type: tipo,
        p_amount: valor,
        p_description: descricao,
        p_date: dataEscolhida,
      });

      if (erroEditar) {
        erroEl.textContent = 'Não foi possível salvar. Tente novamente.';
        btn.disabled = false;
        btn.textContent = textoBotaoPadrao;
        return;
      }

      window.location.href = '/pages/home.html';
      return;
    }

    // escopo === 'future' — aplica em todas as ocorrências do grupo a partir
    // desta data (mesma RPC, numa chamada só pra todo o lote).
    const grupoId = lancamentoOriginal.recurrence_group_id || lancamentoOriginal.id;
    const { error: erroFuturas } = await supabase.rpc('fz_editar_transacoes_futuras', {
      p_recurrence_group_id: grupoId,
      p_from_date: lancamentoOriginal.date,
      p_account_id: contaSelecionada,
      p_category_id: categoriaSelecionada,
      p_type: tipo,
      p_amount: valor,
      p_description: descricao,
    });

    if (erroFuturas) {
      erroEl.textContent = 'Não foi possível salvar. Tente novamente.';
      btn.disabled = false;
      btn.textContent = textoBotaoPadrao;
      return;
    }

    window.location.href = '/pages/home.html';
    return;
  }

  const dadosNovo = {
    user_id: user.id,
    account_id: contaSelecionada,
    category_id: categoriaSelecionada,
    type: tipo,
    amount: valor,
    description: descricao,
    date: dataEscolhida,
    // Data futura = conta que ainda não venceu: fica pendente até ser paga.
    // Sem isso o banco usa o default 'confirmado', que não é nem 'pago'
    // nem 'pendente' — some do Mapa de calor, Metas e Pendências. O toggle
    // "já paguei/recebi" deixa o usuário desmarcar mesmo com data <= hoje
    // (ex: conta vencendo hoje que ainda não foi debitada).
    status: document.getElementById('chk-ja-pago').checked ? 'pago' : 'pendente',
  };

  // O cron diário do FinZen (api/recurring-cron.js) gera as ocorrências
  // futuras a partir desse lançamento "modelo" — não precisa de nada além
  // dessas flags, o resto é automático e compartilhado entre os dois apps.
  if (document.getElementById('chk-recorrente')?.checked) {
    dadosNovo.is_recurring = true;
    dadosNovo.recurrence_active = true;
    dadosNovo.recurrence_frequency = document.getElementById('recorrencia-frequencia').value;
    dadosNovo.recurrence_until = document.getElementById('recorrencia-ate').value || null;
    dadosNovo.recurrence_group_id = uuid();
  }

  // RPC atômica do FinZen: insere o lançamento e, se já estiver pago,
  // ajusta o saldo da conta na mesma transação do banco. (Conta pendente,
  // com data futura, só entra no saldo quando for paga de fato.) Antes eram
  // insert + increment_account_balance separados — uma falha no segundo
  // deixava o lançamento salvo sem mexer no saldo.
  const { error: erroInsercao } = await supabase.rpc('fz_lancar_transacao', { p: dadosNovo });

  if (erroInsercao) {
    erroEl.textContent = 'Não foi possível salvar. Tente novamente.';
    btn.disabled = false;
    btn.textContent = textoBotaoPadrao;
    return;
  }

  window.location.href = '/pages/home.html';
}

async function init() {
  aplicarTemaSalvo();
  const user = await requireAuth();
  if (!user) return;

  configurarTecladoValor();
  document.getElementById('btn-despesa').addEventListener('click', () => selecionarTipo('despesa'));
  document.getElementById('btn-receita').addEventListener('click', () => selecionarTipo('receita'));
  document.getElementById('btn-salvar').addEventListener('click', () => salvar(user));
  document.getElementById('chk-recorrente').addEventListener('change', (e) => {
    document.getElementById('opcoes-recorrencia').hidden = !e.target.checked;
  });
  document.getElementById('descricao').addEventListener('blur', aplicarSugestaoDescricao);
  document.getElementById('data').addEventListener('change', atualizarPadraoJaPago);
  document.getElementById('chk-ja-pago').addEventListener('change', () => {
    jaPagoTocadoManualmente = true;
  });

  getDescricoesRecentes(supabase, user.id).then((lista) => {
    descricoesRecentes = lista;
    popularDatalist(document.getElementById('lista-descricoes'), lista);
  }).catch(() => {});

  const idUrl = new URLSearchParams(window.location.search).get('id');
  if (idUrl) {
    // Editar uma ocorrência específica não deveria virar um novo "modelo"
    // de recorrência — some com a opção nesse caso. O status (pago/pendente)
    // de um lançamento existente se muda por "dar baixa"/"desfazer baixa",
    // não por aqui — some o toggle também.
    document.getElementById('secao-recorrencia').hidden = true;
    document.getElementById('secao-ja-pago').hidden = true;
    const { data, error } = await supabase
      .from('transactions')
      .select('id, account_id, category_id, type, amount, description, date, status, is_recurring, recurrence_group_id')
      .eq('id', idUrl)
      .eq('user_id', user.id)
      .single();

    if (!error && data) {
      lancamentoOriginal = data;
      document.getElementById('topo-titulo').textContent = 'Editar lançamento';
      document.getElementById('btn-salvar').textContent = 'Salvar alterações';
      document.getElementById('descricao').value = data.description ?? '';
      document.getElementById('data').value = data.date ?? hojeISO();
      categoriaSelecionada = data.category_id;
      atualizarDisplaysValor(String(Math.round(Number(data.amount) * 100)));
    }
  }

  if (!lancamentoOriginal) {
    document.getElementById('data').value = hojeISO();
  }

  selecionarTipo(lancamentoOriginal?.type ?? 'despesa');
  atualizarPadraoJaPago();

  try {
    await carregarContasECategorias(user.id);
  } catch (err) {
    console.error(err);
    document.getElementById('erro-lancar').textContent = 'Não foi possível carregar contas/categorias.';
  }
}

init();
