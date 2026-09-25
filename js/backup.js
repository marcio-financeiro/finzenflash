import { supabase, requireAuth } from './supabaseClient.js';
import { aplicarTemaSalvo } from './temaService.js?v=3';
import { hojeISO } from './utils/datas.js';
import { gerarBackupCompleto, inspecionarBackup, restaurarBackupCompleto, TABELAS_BACKUP } from './services/backupService.js';

const NOME_TABELA = {
  accounts: 'Contas', credit_cards: 'Cartões', categories: 'Categorias', budgets: 'Orçamentos',
  transactions: 'Lançamentos', card_transactions: 'Compras no cartão', account_transfers: 'Transferências',
  exchange_transactions: 'Câmbios', investments: 'Investimentos', investment_transactions: 'Movimentações de investimento',
  dividends: 'Dividendos', patrimony_history: 'Histórico de patrimônio', offshore_cycles: 'Ciclos offshore',
  offshore_overtime: 'Horas extras offshore', certifications: 'Certificações', user_settings: 'Preferências',
};

let usuarioAtual = null;
let backupCarregado = null;

function baixarJSON(objeto, nomeArquivo) {
  const blob = new Blob([JSON.stringify(objeto, null, 2)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nomeArquivo;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

async function fazerBackup() {
  const btn = document.getElementById('btn-fazer-backup');
  const status = document.getElementById('status-backup');
  status.className = 'status-msg';
  status.textContent = '';
  btn.disabled = true;
  btn.textContent = 'Gerando...';
  try {
    const backup = await gerarBackupCompleto(supabase, usuarioAtual.id);
    baixarJSON(backup, `finzen_backup_${hojeISO()}.json`);
    status.className = 'status-msg ok';
    status.textContent = `Backup gerado com ${backup.metadata.total_registros.toLocaleString('pt-BR')} registros.`;
  } catch (err) {
    console.error(err);
    status.className = 'status-msg erro';
    status.textContent = 'Não foi possível gerar o backup. Tente novamente.';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Baixar backup completo';
  }
}

function abrirConfirmacao(resumo) {
  document.getElementById('resumo-lista').innerHTML = TABELAS_BACKUP
    .filter((t) => resumo.totalPorTabela[t] > 0)
    .map((t) => `<div class="linha"><span>${NOME_TABELA[t] || t}</span><strong>${resumo.totalPorTabela[t]}</strong></div>`)
    .join('') || '<div class="linha"><span>Nenhum registro encontrado neste arquivo.</span></div>';
  const dataTexto = resumo.geradoEm ? new Date(resumo.geradoEm).toLocaleString('pt-BR') : 'desconhecida';
  document.getElementById('resumo-total').innerHTML = `<span>Total (backup gerado em ${dataTexto})</span><span>${resumo.total}</span>`;
  document.getElementById('sheet-confirmar').hidden = false;
}

function fecharConfirmacao() {
  document.getElementById('sheet-confirmar').hidden = true;
}

async function selecionarArquivo(e) {
  const arquivo = e.target.files?.[0];
  const status = document.getElementById('status-restaurar');
  status.className = 'status-msg';
  status.textContent = '';
  e.target.value = '';
  if (!arquivo) return;

  try {
    const texto = await arquivo.text();
    const backup = JSON.parse(texto);
    const resumo = inspecionarBackup(backup);
    backupCarregado = backup;
    abrirConfirmacao(resumo);
  } catch (err) {
    console.error(err);
    status.className = 'status-msg erro';
    status.textContent = err.message?.includes('inválido') ? err.message : 'Não foi possível ler o arquivo — confira se é um .json de backup válido.';
  }
}

async function confirmarRestauracao() {
  if (!backupCarregado) return;
  const btn = document.getElementById('btn-confirmar-restaurar');
  const status = document.getElementById('status-restaurar');
  btn.disabled = true;
  btn.textContent = 'Restaurando...';
  try {
    await restaurarBackupCompleto(supabase, usuarioAtual.id, backupCarregado, (tabela, n) => {
      btn.textContent = `Restaurando ${NOME_TABELA[tabela] || tabela}...`;
    });
    fecharConfirmacao();
    status.className = 'status-msg ok';
    status.textContent = 'Restauração concluída. Recarregue o app pra ver os dados atualizados.';
  } catch (err) {
    console.error(err);
    status.className = 'status-msg erro';
    status.textContent = `Falha durante a restauração: ${err.message}`;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Restaurar agora';
    backupCarregado = null;
  }
}

async function init() {
  aplicarTemaSalvo();
  const user = await requireAuth();
  if (!user) return;
  usuarioAtual = user;

  document.getElementById('btn-fazer-backup').addEventListener('click', fazerBackup);
  document.getElementById('btn-escolher-arquivo').addEventListener('click', () => document.getElementById('input-arquivo').click());
  document.getElementById('input-arquivo').addEventListener('change', selecionarArquivo);
  document.getElementById('btn-confirmar-restaurar').addEventListener('click', confirmarRestauracao);
  document.getElementById('btn-cancelar-restaurar').addEventListener('click', () => { backupCarregado = null; fecharConfirmacao(); });
  document.getElementById('sheet-confirmar').addEventListener('click', (e) => {
    if (e.target === document.getElementById('sheet-confirmar')) { backupCarregado = null; fecharConfirmacao(); }
  });
}

init();
