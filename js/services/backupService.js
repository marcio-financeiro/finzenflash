// backupService.js — backup completo do FinZen Flash. Diferente da
// exportação "para análise com IA" (que seleciona/transforma os dados pra
// leitura por uma IA), isto é um dump 1:1 de todas as tabelas que o Flash
// usa — pensado pra restaurar o estado exato do app depois (troca de
// aparelho, ou desfazer um erro grave). Nada é filtrado, arredondado ou
// recalculado aqui.

// Ordem de dependência (FK) — tabela referenciada antes de quem a
// referencia. categories tem auto-referência (parent_id), mas dentro de um
// único upsert multi-linha o Postgres só valida as FKs no fim do
// statement (constraint IMMEDIATE), então uma tabela = uma chamada basta,
// não precisa de duas passadas.
export const TABELAS_BACKUP = [
  'accounts',
  'credit_cards',
  'categories',
  'budgets',
  'transactions',
  'card_transactions',
  'account_transfers',
  'exchange_transactions',
  'investments',
  'investment_transactions',
  'dividends',
  'patrimony_history',
  'offshore_cycles',
  'offshore_overtime',
  'certifications',
  'user_settings',
];

const SCHEMA_VERSION = '1.0';
const TAMANHO_LOTE = 300;

function lotes(array, tamanho) {
  const out = [];
  for (let i = 0; i < array.length; i += tamanho) out.push(array.slice(i, i + tamanho));
  return out;
}

export async function gerarBackupCompleto(supabase, userId) {
  const dados = {};
  const totalPorTabela = {};

  for (const tabela of TABELAS_BACKUP) {
    const { data, error } = await supabase.from(tabela).select('*').eq('user_id', userId);
    if (error) throw new Error(`Falha ao ler "${tabela}": ${error.message}`);
    dados[tabela] = data || [];
    totalPorTabela[tabela] = dados[tabela].length;
  }

  return {
    metadata: {
      produto: 'FinZen Flash — backup completo',
      aviso: 'Este arquivo contém TODOS os seus dados financeiros em texto puro. Guarde num lugar seguro — não é o mesmo pacote da "Exportar para análise com IA".',
      schema_version: SCHEMA_VERSION,
      gerado_em: new Date().toISOString(),
      total_registros: Object.values(totalPorTabela).reduce((s, n) => s + n, 0),
      total_por_tabela: totalPorTabela,
    },
    dados,
  };
}

// Lê só os metadados/contagens de um arquivo de backup sem restaurar nada —
// usado pra mostrar o resumo antes do usuário confirmar a restauração.
export function inspecionarBackup(backup) {
  if (!backup || typeof backup !== 'object' || typeof backup.dados !== 'object' || !backup.dados) {
    throw new Error('Arquivo inválido — não parece ser um backup do FinZen Flash (falta o campo "dados").');
  }
  const totalPorTabela = {};
  let total = 0;
  for (const tabela of TABELAS_BACKUP) {
    const n = Array.isArray(backup.dados[tabela]) ? backup.dados[tabela].length : 0;
    totalPorTabela[tabela] = n;
    total += n;
  }
  return { geradoEm: backup.metadata?.gerado_em ?? null, total, totalPorTabela };
}

// Restaura por upsert (nunca apaga nada): linhas com o mesmo id são
// sobrescritas pelo conteúdo do backup, linhas novas são inseridas. Não
// remove registros criados depois do backup — pra isso o usuário teria que
// apagar manualmente, o restore aqui nunca é destrutivo por conta própria.
export async function restaurarBackupCompleto(supabase, userId, backup, onProgresso) {
  const resumo = inspecionarBackup(backup);
  const resultado = {};

  for (const tabela of TABELAS_BACKUP) {
    const linhas = Array.isArray(backup.dados[tabela]) ? backup.dados[tabela] : [];
    if (linhas.length === 0) { resultado[tabela] = 0; continue; }

    // Nunca confia no user_id que veio dentro do arquivo — força sempre o
    // dono da sessão atual (RLS já bloquearia diferente, mas evita
    // qualquer ambiguidade se o arquivo vier de outra conta).
    const linhasDaConta = linhas.map((l) => ({ ...l, user_id: userId }));

    for (const lote of lotes(linhasDaConta, TAMANHO_LOTE)) {
      const { error } = await supabase.from(tabela).upsert(lote, { onConflict: 'id' });
      if (error) throw new Error(`Falha ao restaurar "${tabela}": ${error.message}`);
    }
    resultado[tabela] = linhasDaConta.length;
    if (onProgresso) onProgresso(tabela, linhasDaConta.length, resumo.totalPorTabela);
  }
  return resultado;
}
