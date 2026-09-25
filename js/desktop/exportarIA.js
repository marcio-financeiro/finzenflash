import { supabase, requireAuth } from '../supabaseClient.js';
import { aplicarTemaSalvo } from '../temaService.js';
import { montarNavRail } from './navRail.js';
import { abrirComandos } from './comandos.js';
import { hojeISO } from '../utils/datas.js';
import { coletarDados, construirMovimentacoes, construirMonthly, construirPatrimonio, construirInvestimentos, periodoAnterior, anonimizarMovimentos } from '../services/exportIA.js';
import { calcularIndicadores, calcularDimensoes } from '../services/exportIAIndicadores.js';
import { validarQualidade, montarMetadata, DATA_DICTIONARY } from '../services/exportIAQualidade.js';
import { montarArquivos, baixarZip, baixarTodosCsvSeparados, baixarTodosJsonSeparados, gerarHtmlRelatorioPDF } from '../services/exportIAArquivos.js';

let usuarioAtual = null;
let ultimoPacote = null;
let ultimosArquivos = null;

function rotuloQualidade(status) {
  return { ok: 'Boa', warning: 'Atenção', attention: 'Problemas' }[status] || '—';
}

async function carregarResumo() {
  const inicio = document.getElementById('periodo-inicio').value;
  const fim = document.getElementById('periodo-fim').value;
  if (!inicio || !fim) return;

  const dados = await coletarDados(supabase, usuarioAtual.id, { inicio, fim });
  const movimentos = construirMovimentacoes(dados);
  const qualidade = validarQualidade(dados, movimentos);

  document.getElementById('resumo-movimentacoes').textContent = movimentos.length.toLocaleString('pt-BR');
  document.getElementById('resumo-contas').textContent = dados.accounts.length;
  document.getElementById('resumo-investimentos').textContent = dados.investments.length;
  const elQualidade = document.getElementById('resumo-qualidade');
  elQualidade.textContent = rotuloQualidade(qualidade.status);
  elQualidade.className = `valor qualidade-${qualidade.status}`;
}

async function gerarExportacao() {
  const btn = document.getElementById('btn-gerar');
  const erroEl = document.getElementById('erro-exportar');
  erroEl.textContent = '';
  btn.disabled = true;
  btn.textContent = 'Gerando...';
  document.getElementById('downloads').classList.remove('visivel');

  try {
    const inicio = document.getElementById('periodo-inicio').value;
    const fim = document.getElementById('periodo-fim').value;
    const inicioYM = inicio.slice(0, 7);
    const fimYM = fim.slice(0, 7);

    const dados = await coletarDados(supabase, usuarioAtual.id, { inicio, fim });
    const movimentos = construirMovimentacoes(dados);
    const monthly = construirMonthly(movimentos, dados.patrimonyHistory, inicioYM, fimYM);
    const patrimonio = construirPatrimonio(dados.patrimonyHistory.filter((p) => {
      const m = String(p.reference_month).slice(0, 7);
      return m >= inicioYM && m <= fimYM;
    }));
    const investimentosCsv = construirInvestimentos(dados);
    const indicadoresAtual = calcularIndicadores(movimentos, monthly, patrimonio, inicioYM, fimYM);
    const dimensoes = calcularDimensoes(indicadoresAtual, investimentosCsv);
    const qualidade = validarQualidade(dados, movimentos);
    const metadata = montarMetadata({ inicio, fim, movimentos, dados, qualidade, appVersion: null });

    // Período anterior (mesmo tamanho, imediatamente antes) — só pra
    // comparação nos indicadores, não entra em finzen_movimentacoes.csv.
    const { inicio: inicioAnt, fim: fimAnt } = periodoAnterior(inicio, fim);
    const inicioAntYM = inicioAnt.slice(0, 7);
    const fimAntYM = fimAnt.slice(0, 7);
    const dadosAnt = await coletarDados(supabase, usuarioAtual.id, { inicio: inicioAnt, fim: fimAnt });
    const movimentosAnt = construirMovimentacoes(dadosAnt);
    const monthlyAnt = construirMonthly(movimentosAnt, dadosAnt.patrimonyHistory, inicioAntYM, fimAntYM);
    const patrimonioAnt = construirPatrimonio(dadosAnt.patrimonyHistory.filter((p) => {
      const m = String(p.reference_month).slice(0, 7);
      return m >= inicioAntYM && m <= fimAntYM;
    }));
    const indicadoresAnterior = calcularIndicadores(movimentosAnt, monthlyAnt, patrimonioAnt, inicioAntYM, fimAntYM);
    const indicadores = {
      periodo_atual: indicadoresAtual,
      periodo_anterior: indicadoresAnterior,
      periodo_anterior_datas: { inicio: inicioAnt, fim: fimAnt },
    };

    const anonimizar = document.getElementById('chk-anonimizar')?.checked;
    const movimentosExport = anonimizar ? anonimizarMovimentos(movimentos) : movimentos;

    ultimoPacote = { movimentos: movimentosExport, monthly, patrimonio, investimentosCsv, indicadores, dimensoes, qualidade, metadata, dicionario: DATA_DICTIONARY };
    ultimosArquivos = montarArquivos(ultimoPacote);

    document.getElementById('downloads').classList.add('visivel');
  } catch (err) {
    console.error(err);
    erroEl.textContent = 'Não foi possível gerar a exportação. Tente novamente.';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Gerar exportação';
  }
}

function imprimirPDF() {
  if (!ultimoPacote) return;
  document.getElementById('area-impressao-pdf').innerHTML = gerarHtmlRelatorioPDF(ultimoPacote);
  document.body.classList.add('modo-impressao-pdf');
  const limpar = () => document.body.classList.remove('modo-impressao-pdf');
  window.addEventListener('afterprint', limpar, { once: true });
  window.print();
  setTimeout(limpar, 2000);
}

async function iniciar() {
  aplicarTemaSalvo();
  const user = await requireAuth();
  if (!user) return;
  usuarioAtual = user;

  montarNavRail('exportar-ia');
  document.getElementById('btn-topbar-busca').addEventListener('click', abrirComandos);

  const fim = hojeISO();
  const inicioData = new Date();
  inicioData.setMonth(inicioData.getMonth() - 12);
  const inicio = new Date(inicioData.getTime() - inicioData.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  document.getElementById('periodo-inicio').value = inicio;
  document.getElementById('periodo-fim').value = fim;

  document.getElementById('periodo-inicio').addEventListener('change', carregarResumo);
  document.getElementById('periodo-fim').addEventListener('change', carregarResumo);
  document.getElementById('btn-gerar').addEventListener('click', gerarExportacao);
  document.getElementById('btn-baixar-zip').addEventListener('click', () => ultimosArquivos && baixarZip(ultimosArquivos));
  document.getElementById('btn-baixar-csv').addEventListener('click', () => ultimosArquivos && baixarTodosCsvSeparados(ultimosArquivos));
  document.getElementById('btn-baixar-json').addEventListener('click', () => ultimosArquivos && baixarTodosJsonSeparados(ultimosArquivos));
  document.getElementById('btn-baixar-pdf').addEventListener('click', imprimirPDF);

  try {
    await carregarResumo();
  } catch (err) {
    console.error(err);
  }
}

iniciar();
