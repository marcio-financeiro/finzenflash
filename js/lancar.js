import { supabase, requireAuth } from './supabaseClient.js';
import { aplicarTemaSalvo } from './temaService.js?v=2';
import { getDescricoesRecentes, popularDatalist, encontrarSugestao } from './autocompleteService.js';

let tipo = 'despesa';
let contaSelecionada = null;
let categoriaSelecionada = null;
let contas = [];
let categorias = [];
let lancamentoOriginal = null;
let descricoesRecentes = [];

function hojeISO() {
  const hoje = new Date();
  return new Date(hoje.getTime() - hoje.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

function uuid() {
  return crypto?.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2);
}

function formatarValorDigitado(valorCentavos) {
  const reais = valorCentavos / 100;
  return reais.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
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
  renderCategorias();
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
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

async function carregarContasECategorias(userId) {
  const [{ data: dadosContas, error: erroContas }, { data: dadosCategorias, error: erroCategorias }] = await Promise.all([
    supabase.from('accounts').select('id, nome').eq('user_id', userId).eq('active', true).eq('account_kind', 'bank').order('sort_order'),
    supabase.from('categories').select('id, nome, tipo').eq('user_id', userId).eq('ativo', true).in('tipo', ['despesa', 'receita']).order('sort_order'),
  ]);

  if (erroContas) throw erroContas;
  if (erroCategorias) throw erroCategorias;

  contas = dadosContas ?? [];
  categorias = dadosCategorias ?? [];
  contaSelecionada = lancamentoOriginal?.account_id ?? (contas[0]?.id ?? null);

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
      const { error: erroUpdate } = await supabase.from('transactions').update({
        account_id: contaSelecionada,
        category_id: categoriaSelecionada,
        type: tipo,
        amount: valor,
        description: descricao,
        date: dataEscolhida,
      }).eq('id', lancamentoOriginal.id).eq('user_id', user.id);

      if (erroUpdate) {
        erroEl.textContent = 'Não foi possível salvar. Tente novamente.';
        btn.disabled = false;
        btn.textContent = textoBotaoPadrao;
        return;
      }

      // Uma conta pendente não afetou o saldo quando foi criada — editá-la
      // (sem mexer no status) não deve afetar o saldo agora também.
      if (lancamentoOriginal.status === 'pago') {
        // Desfaz o efeito do lançamento original na conta antiga e aplica o
        // novo valor/tipo na conta escolhida — cobre também troca de conta.
        const deltaReverso = lancamentoOriginal.type === 'receita' ? -Number(lancamentoOriginal.amount) : Number(lancamentoOriginal.amount);
        await supabase.rpc('increment_account_balance', { p_account_id: lancamentoOriginal.account_id, p_delta: deltaReverso });

        const deltaNovo = tipo === 'receita' ? valor : -valor;
        const { error: erroSaldo } = await supabase.rpc('increment_account_balance', { p_account_id: contaSelecionada, p_delta: deltaNovo });

        if (erroSaldo) {
          erroEl.textContent = 'Lançamento salvo, mas o saldo não pôde ser atualizado.';
          btn.disabled = false;
          btn.textContent = textoBotaoPadrao;
          return;
        }
      }

      window.location.href = '/pages/home.html';
      return;
    }

    // escopo === 'future' — aplica em todas as ocorrências do grupo a partir desta data.
    const grupoId = lancamentoOriginal.recurrence_group_id || lancamentoOriginal.id;
    const { data: alvos, error: erroAlvos } = await supabase
      .from('transactions')
      .select('id, type, amount, status, account_id')
      .eq('user_id', user.id)
      .eq('recurrence_group_id', grupoId)
      .gte('date', lancamentoOriginal.date);

    if (erroAlvos) {
      erroEl.textContent = 'Não foi possível buscar as ocorrências futuras.';
      btn.disabled = false;
      btn.textContent = textoBotaoPadrao;
      return;
    }

    const ids = (alvos || []).map((t) => t.id);
    const { error: erroUpdateFuturas } = await supabase.from('transactions').update({
      account_id: contaSelecionada,
      category_id: categoriaSelecionada,
      type: tipo,
      amount: valor,
      description: descricao,
    }).in('id', ids).eq('user_id', user.id);

    if (erroUpdateFuturas) {
      erroEl.textContent = 'Não foi possível salvar. Tente novamente.';
      btn.disabled = false;
      btn.textContent = textoBotaoPadrao;
      return;
    }

    const deltas = {};
    for (const old of alvos || []) {
      if (old.status !== 'pago') continue;
      const v = Number(old.amount || 0);
      deltas[old.account_id] = (deltas[old.account_id] || 0) + (old.type === 'receita' ? -v : v);
      deltas[contaSelecionada] = (deltas[contaSelecionada] || 0) + (tipo === 'receita' ? valor : -valor);
    }
    for (const [accId, delta] of Object.entries(deltas)) {
      if (!delta) continue;
      await supabase.rpc('increment_account_balance', { p_account_id: accId, p_delta: delta });
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
    // nem 'pendente' — some do Mapa de calor, Metas e Pendências.
    status: dataEscolhida > hojeISO() ? 'pendente' : 'pago',
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

  const { error: erroInsercao } = await supabase.from('transactions').insert(dadosNovo);

  if (erroInsercao) {
    erroEl.textContent = 'Não foi possível salvar. Tente novamente.';
    btn.disabled = false;
    btn.textContent = textoBotaoPadrao;
    return;
  }

  // Conta pendente (data futura) só entra no saldo quando for paga de fato.
  if (dadosNovo.status === 'pago') {
    const delta = tipo === 'receita' ? valor : -valor;
    const { error: erroSaldo } = await supabase.rpc('increment_account_balance', {
      p_account_id: contaSelecionada,
      p_delta: delta,
    });

    if (erroSaldo) {
      erroEl.textContent = 'Lançamento salvo, mas o saldo não pôde ser atualizado.';
      btn.disabled = false;
      btn.textContent = textoBotaoPadrao;
      return;
    }
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

  getDescricoesRecentes(supabase, user.id).then((lista) => {
    descricoesRecentes = lista;
    popularDatalist(document.getElementById('lista-descricoes'), lista);
  }).catch(() => {});

  const idUrl = new URLSearchParams(window.location.search).get('id');
  if (idUrl) {
    // Editar uma ocorrência específica não deveria virar um novo "modelo"
    // de recorrência — some com a opção nesse caso.
    document.getElementById('secao-recorrencia').hidden = true;
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

  try {
    await carregarContasECategorias(user.id);
  } catch (err) {
    console.error(err);
    document.getElementById('erro-lancar').textContent = 'Não foi possível carregar contas/categorias.';
  }
}

init();
