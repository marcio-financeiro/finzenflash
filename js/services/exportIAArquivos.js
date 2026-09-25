// exportIAArquivos.js — materializa o pacote de exportação em arquivos de
// verdade: CSV, JSON, ZIP (JSZip) e um HTML pronto pra impressão em PDF
// (via window.print(), com layout dedicado — não é a tela de cards).
import { paraCSV } from '../utils/csv.js';
import { loadJSZip } from '../loadJSZip.js';
import { escapeHtml } from '../utils/escapeHtml.js';

const COLUNAS_MOVIMENTACOES = ['id', 'data', 'mes_referencia', 'tipo', 'descricao', 'valor', 'moeda', 'categoria', 'subcategoria', 'conta', 'forma_pagamento', 'fixo_variavel', 'essencial_nao_essencial', 'parcelado', 'parcela_atual', 'total_parcelas', 'valor_parcela', 'recorrente', 'tags', 'observacao', 'status'];
const COLUNAS_MONTHLY = ['mes', 'receita_total', 'despesa_total', 'saldo', 'despesas_fixas', 'despesas_variaveis', 'despesas_essenciais', 'despesas_nao_essenciais', 'investimentos_realizados', 'resgates', 'dividas_pagas', 'novas_dividas', 'patrimonio_inicio', 'patrimonio_fim'];
const COLUNAS_PATRIMONIO = ['mes', 'ativos', 'investimentos', 'disponibilidade', 'imoveis', 'veiculos', 'outros_ativos', 'passivos', 'dividas', 'patrimonio_liquido'];
const COLUNAS_INVESTIMENTOS = ['id', 'ticker', 'nome', 'classe', 'quantidade', 'preco_medio', 'preco_atual', 'valor_investido', 'valor_atual', 'rentabilidade', 'dividendos_recebidos', 'percentual_carteira', 'corretora', 'data_primeira_compra', 'data_ultima_movimentacao', 'ativo'];

export function montarArquivos(pacote) {
  const { movimentos, monthly, patrimonio, investimentosCsv, indicadores, dimensoes, qualidade, metadata, dicionario } = pacote;
  return {
    'finzen_movimentacoes.csv': paraCSV(movimentos, COLUNAS_MOVIMENTACOES),
    'finzen_monthly.csv': paraCSV(monthly, COLUNAS_MONTHLY),
    'finzen_patrimonio.csv': paraCSV(patrimonio, COLUNAS_PATRIMONIO),
    'finzen_investimentos.csv': paraCSV(investimentosCsv, COLUNAS_INVESTIMENTOS),
    'finzen_indicadores.json': JSON.stringify(indicadores, null, 2),
    'finzen_carteira.json': JSON.stringify(dimensoes, null, 2),
    'finzen_data_quality.json': JSON.stringify(qualidade, null, 2),
    'finzen_metadata.json': JSON.stringify(metadata, null, 2),
    'finzen_data_dictionary.json': JSON.stringify(dicionario, null, 2),
    'finzen_prompt_sugerido.txt': gerarPromptSugerido(pacote),
  };
}

// ── Prompt sugerido ───────────────────────────────────────────────────────
// A exportação existe pra ser lida por outra IA (não a Luna do próprio
// FinZen) — esse texto poupa o usuário de ter que descrever o pacote toda
// vez que for colar os arquivos numa conversa nova.
function gerarPromptSugerido(pacote) {
  const { metadata } = pacote;
  return `FinZen — prompt sugerido para análise com IA
Cole este texto junto com os arquivos do pacote (ou o conteúdo deles) em uma conversa com a IA de sua escolha (ChatGPT, Gemini, outra instância do Claude, etc).

---

Você é um consultor financeiro pessoal. Os arquivos anexados são meus dados financeiros reais, extraídos do app FinZen — o formato de cada campo está descrito em finzen_data_dictionary.json. Os CSVs (finzen_movimentacoes, finzen_monthly, finzen_patrimonio, finzen_investimentos) são a fonte de verdade; os JSONs (finzen_indicadores, finzen_carteira) são indicadores já calculados a partir deles, só de apoio.

Por favor:
1. Analise minha taxa de poupança e a estrutura das minhas despesas (fixo vs. variável, essencial vs. não essencial) e aponte os 3 pontos mais importantes.
2. Em finzen_indicadores.json há "periodo_atual" e "periodo_anterior" (mesmo intervalo de dias, imediatamente antes) — compare os dois e diga se minha situação está melhorando ou piorando, e em quê.
3. Aponte até 3 categorias de despesa onde eu poderia cortar gasto sem comprometer o essencial.
4. Avalie minha liquidez/reserva de emergência e diga se ela é suficiente pro meu padrão de gasto.
5. Se algo em finzen_data_quality.json indicar problema, me avise antes de tirar conclusões — não invente dado que não está nos arquivos.

Não resuma tudo isso em um único "score financeiro" — quero entender cada dimensão separadamente (fluxo de caixa, liquidez, poupança, endividamento, patrimônio, investimentos), como já vem estruturado em finzen_carteira.json.

Período analisado: ${metadata.period_start} a ${metadata.period_end}.
`;
}

function baixarBlob(blob, nomeArquivo) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nomeArquivo;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function baixarArquivoTexto(nomeArquivo, conteudo, mime) {
  baixarBlob(new Blob([conteudo], { type: `${mime};charset=utf-8` }), nomeArquivo);
}

export async function baixarZip(arquivos) {
  const JSZip = await loadJSZip();
  const zip = new JSZip();
  Object.entries(arquivos).forEach(([nome, conteudo]) => zip.file(nome, conteudo));
  const blob = await zip.generateAsync({ type: 'blob' });
  baixarBlob(blob, 'finzen_ai_export.zip');
}

export function baixarTodosCsvSeparados(arquivos) {
  Object.entries(arquivos).filter(([nome]) => nome.endsWith('.csv')).forEach(([nome, conteudo]) => baixarArquivoTexto(nome, conteudo, 'text/csv'));
}

export function baixarTodosJsonSeparados(arquivos) {
  Object.entries(arquivos).filter(([nome]) => nome.endsWith('.json')).forEach(([nome, conteudo]) => baixarArquivoTexto(nome, conteudo, 'application/json'));
}

// ── PDF (relatório resumido, legível por humano) ─────────────────────────
const fmtBRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtPct = (v) => (v === null || v === undefined ? '—' : `${(v * 100).toFixed(1)}%`);
const fmtBRLouTraco = (v) => (v === null || v === undefined ? '—' : fmtBRL.format(v));

export function gerarHtmlRelatorioPDF(pacote) {
  const { metadata, monthly, patrimonio, investimentosCsv, indicadores: indicadoresPacote } = pacote;
  const indicadores = indicadoresPacote.periodo_atual || indicadoresPacote;
  const ultimoMes = monthly[monthly.length - 1];
  const ultimoPatrimonio = patrimonio[patrimonio.length - 1];

  const linhasMonthly = monthly.map((m) => `
    <tr><td>${m.mes}</td><td>${fmtBRLouTraco(m.receita_total)}</td><td>${fmtBRLouTraco(m.despesa_total)}</td>
    <td class="${m.saldo >= 0 ? 'pos' : 'neg'}">${fmtBRLouTraco(m.saldo)}</td></tr>
  `).join('');

  const linhasInvestimentos = investimentosCsv.filter((i) => i.ativo).map((i) => `
    <tr><td>${escapeHtml(i.ticker)}</td><td>${escapeHtml(i.classe)}</td><td>${fmtBRLouTraco(i.valor_atual)}</td>
    <td>${fmtPct(i.rentabilidade)}</td><td>${i.percentual_carteira ? i.percentual_carteira.toFixed(1) + '%' : '—'}</td></tr>
  `).join('');

  return `
    <div class="relatorio-ia-pdf">
      <h1>FinZen — Relatório financeiro</h1>
      <p class="periodo">${metadata.period_start} a ${metadata.period_end} · gerado em ${new Date(metadata.gerado_em).toLocaleString('pt-BR')}</p>

      <h2>Resumo do período</h2>
      <div class="kpis">
        <div><span>Receita média mensal</span><strong>${fmtBRLouTraco(indicadores.fluxo_de_caixa.receita_media_mensal.valor)}</strong></div>
        <div><span>Despesa média mensal</span><strong>${fmtBRLouTraco(indicadores.fluxo_de_caixa.despesa_media_mensal.valor)}</strong></div>
        <div><span>Taxa de poupança</span><strong>${fmtPct(indicadores.poupanca_e_investimento.taxa_poupanca.valor)}</strong></div>
        <div><span>Reserva (meses de cobertura)</span><strong>${indicadores.liquidez.reserva_em_meses.valor !== null ? indicadores.liquidez.reserva_em_meses.valor.toFixed(1) : '—'}</strong></div>
        <div><span>Patrimônio líquido atual</span><strong>${fmtBRLouTraco(ultimoPatrimonio?.patrimonio_liquido)}</strong></div>
        <div><span>Crescimento patrimonial</span><strong>${fmtPct(indicadores.poupanca_e_investimento.crescimento_patrimonial.valor)}</strong></div>
      </div>

      <h2>Receita x Despesa por mês</h2>
      <table><thead><tr><th>Mês</th><th>Receita</th><th>Despesa</th><th>Saldo</th></tr></thead><tbody>${linhasMonthly}</tbody></table>

      ${investimentosCsv.length ? `
      <h2>Carteira de investimentos</h2>
      <table><thead><tr><th>Ativo</th><th>Classe</th><th>Valor atual</th><th>Rentabilidade</th><th>% carteira</th></tr></thead><tbody>${linhasInvestimentos}</tbody></table>
      ` : ''}

      <p class="rodape">Pacote completo (dados brutos, indicadores e dicionário de dados) disponível em finzen_ai_export.zip — feito pra análise por Inteligência Artificial.</p>
    </div>
  `;
}
