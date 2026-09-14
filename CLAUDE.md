# CLAUDE.md — FinZen Flash

## Estilo de trabalho
- **Não pedir autorização antes de corrigir bugs ou implementar o que foi pedido** — pode fazer a mudança, testar e reportar direto (diferente do FinZen, que exige confirmação prévia).
- Testar antes de reportar como pronto: rodar localmente quando possível (Playwright), verificar contra o banco real quando a dúvida for de dado, e pedir confirmação do Márcio no celular só quando o teste exigir sessão autenticada real.
- Preferir soluções simples — evitar complexidade desnecessária.

## Contexto do projeto

App mobile-only de lançamento rápido (receita/despesa/cartão), companheiro do FinZen. Ver especificação completa publicada como Artifact (link com o Márcio) para escopo e decisões de design.

- **Produção:** finzenflash.vercel.app
- **Repo:** github.com/marcio-financeiro/finzenflash
- **Banco:** mesmo projeto Supabase do FinZen (`qgamphwnlrriwalcbhbl`) — dados compartilhados, código independente
- **Local no PC do Márcio:** `D:\FinzenFlash` (não usado nas sessões remotas, apenas referência)

## Arquitetura

```
index.html       → Login (Supabase Auth, mesma conta do FinZen)
pages/home.html  → Início (saldo + últimos lançamentos)
pages/lancar.html → Lançar receita/despesa
js/              → Um .js por página, ES Modules, sem build step
css/variables.css → Paleta B "Azul Petróleo" (accent #0E7C86), claro/escuro via prefers-color-scheme
img/logo-mark.png, img/logo-full.png → Logo real do Márcio (não recriar/recortar sem pedir)
icons/           → Ícones PWA/iOS (180/192/512), gerados a partir da logo
manifest.json    → PWA standalone, instalável no iOS
vercel.json      → Cache-Control must-revalidate em /js e /*.html (evita servir versão antiga após deploy)
```

## Banco de dados

Usa só estas tabelas do FinZen (já existentes, RLS `auth.uid() = user_id`):
- `accounts` (filtrar `account_kind = 'bank'`, `active = true` — Rico e Nomad USD são `bank` também, usadas como conta corrente além de receber dividendos; `account_kind = 'broker'` hoje não tem nenhuma conta, é só para o caso de existir uma conta só de corretora no futuro)
- `transactions` — **atenção:** o FinZen projeta lançamentos recorrentes com data futura (contas fixas já lançadas meses à frente). Sempre filtrar `date <= hoje` em listas de "últimos lançamentos", senão entradas futuras aparecem antes das reais.
- `categories` (tipo `despesa`/`receita`, `ativo = true`)
- Ajuste de saldo: RPC `increment_account_balance(p_account_id, p_delta)` — mesma RPC atômica do FinZen, nunca fazer SELECT→soma→UPDATE manual.
- RPCs atômicas (todas validam `auth.uid()`, `security definer`, sem `execute` pra `anon`): `fz_lancar_transacao(p jsonb)` (insere + ajusta saldo se `status='pago'`), `fz_marcar_pago(p_transaction_id)`, `fz_desfazer_baixa(p_transaction_id)`, `fz_excluir_transacoes(p_transaction_ids uuid[])` (exclui um lote — client já filtra o escopo only/future/series antes de chamar — revertendo saldo dos que estavam pagos), `fz_editar_transacao(...)` (edita 1 lançamento, escopo "só esta"), `fz_editar_transacoes_futuras(p_recurrence_group_id, p_from_date, ...)` (edita "esta e futuras" de uma recorrência), `create_account_transfer`, `delete_account_transfer`, `create_currency_exchange`. Preferir sempre a RPC a fazer update + increment em duas chamadas.
- `card_transactions`: uma linha por parcela, todas com a mesma `data_compra`. Em listas por data filtrar `parcela_atual = 1` e usar `valor_total`; em somas por mês usar `fatura_referencia` e `valor_parcela`. Todo registro tem `purchase_group_id` (backfill aplicado em set/2026).
- `fz_pagar_fatura(p_card_id, p_fatura_referencia, p_account_id, p_category_id, p_descricao)` e `fz_reabrir_fatura(p_card_id, p_fatura_referencia)` — exclusivas do Flash (criadas em set/2026, não existem no FinZen). Pagar marca as parcelas + insere a transação + desconta o saldo numa transação só; a transação de pagamento grava em `notes` a chave `fz_pagar_fatura:card_id=...;fatura=...`, que é como reabrir localiza o pagamento (mais confiável que casar pela descrição, que quebra se o cartão for renomeado). **Fatura paga antes dessa RPC existir** não tem essa chave — `cartaoHub.js`/`desktop/cartao.js` caem num fallback manual (busca por descrição) só pra esses casos legados.

## Padrões de código

```js
// Auth no topo de toda página autenticada:
import { requireAuth } from './supabaseClient.js';
const user = await requireAuth();
```

- Escrever HTML/CSS/JS próprios — não copiar arquivos do repo do FinZen, só reaproveitar tabelas/RPCs do banco.
- `js/config.js` tem as mesmas credenciais Supabase do FinZen (client-side, uso pessoal).
- `js/utils/` — módulos compartilhados entre páginas mobile e desktop:
  - `toqueSegurar.js`: gesto de pressionar-e-segurar (500ms) pra abrir o menu de ações de um card de lançamento/compra. O elemento precisa ser um `<button>` de verdade (não `<div>`) — o módulo também escuta `click` pra cobrir ativação por teclado/leitor de tela (que não "segura" nada).
  - `toast.js`: `mostrarToast(mensagem, 'erro'|'sucesso')` — aviso visível quando uma ação falha (dar baixa, excluir, editar, pagar/reabrir fatura). Injeta seu próprio CSS na primeira chamada, então basta importar, sem editar `<style>` de cada página.
  - `valorMask.js`: já existia — máscara de campo monetário fora do teclado numérico dedicado.
  - `escapeHtml.js`, `datas.js` (`hojeISO`, `limitesMes`), `valorMonetario.js` (`lerValorMonetario(bruto)`, `lerValorMonetarioPorId(id)`), `campos.js` (`campoTexto`/`campoSelect`, com um 5º parâmetro `desktop` que adiciona a classe `input-desktop`) — helpers que antes estavam copiados em ~20 arquivos. Páginas desktop que usavam `campoTexto`/`campoSelect` sem o `input-desktop` importam com alias e um wrapper de 1 linha que já passa `desktop=true` (ver `js/desktop/cadastros.js`), pra não precisar mudar todo call site.
- `api/_cors.js`: `aplicarCors(req, res, metodos)` — origem permitida pra produção, previews da Vercel e localhost. Usar em qualquer endpoint novo em vez de hardcodar `Access-Control-Allow-Origin`.
- Economia mensal (Home), Relatórios/Saúde e as sub-métricas Reserva/Regularidade da Saúde Financeira usam a MESMA base de cálculo (competência: só `status='pago'`, exclui a categoria "Fatura de Cartão", inclui compras no cartão pela `fatura_referencia` do mês) — não deixar divergir de novo. `js/saude.js`/`desktop/saude.js`: Reserva usa a média de despesa dos últimos 3 meses fechados nessa base (não caixa/data de pagamento da fatura); Regularidade conta dias com lançamento em conta OU compra no cartão (`parcela_atual = 1`, pela `data_compra`), não só conta.
- `fatura_referencia` de `card_transactions` já é o MÊS DE VENCIMENTO real (não o de fechamento) — `invoiceRef()` em `js/cardService.js` já soma +1 mês quando `vencimento_dia < fechamento_dia` na hora de gravar. Não recalcular isso em outro lugar comparando com o mês calendário puro.
- `js/lancar.js`/`desktop/lancar.js`: toggle "Já paguei/recebi" ao lançar — data `<= hoje` só marca `status='pago'` por padrão, mas o usuário pode desmarcar pra deixar pendente (ex: conta vencendo hoje ainda não debitada). Some no modo de edição (status muda só por dar baixa/desfazer).
- `js/parcelamentos.js`/`desktop/parcelamentos.js`: gráfico "Variação mês a mês" (`loadChart.js`, igual Investimentos) soma `valor_parcela` de `card_transactions` por `fatura_referencia`, separado em paga/aberta (barra empilhada), com o total de cada mês desenhado direto na barra (plugin `rotuloTotalPlugin`, sem precisar de hover). Usa `gruposParaGrafico()` — só respeita o filtro de cartão, ignora "mostrar quitadas" de propósito (o gráfico precisa da curva completa passado+futuro, não só o que ainda está em andamento). Clicar numa barra (`onClick` do Chart.js) seta `mesFiltro` e troca a lista abaixo pra `renderListaPorMes()` — parcelas ainda em aberto daquele mês, juntando compras diferentes; clicar de novo na mesma barra limpa o filtro (também tem botão "Ver todas").
- `js/transferir.js`/`desktop/transferir.js`: transferência entre contas de moedas diferentes usa `create_currency_exchange(p_from_account_id, p_to_account_id, p_source_amount, p_exchange_rate, ...)` em vez de `create_account_transfer` — aparece um campo de cotação (pré-preenchido via `quoteCache.js`) quando origem/destino têm `currency` diferente. `p_source_amount` é sempre no valor da moeda de ORIGEM.
- Modelos da IA (`api/luna-chat.js`, `api/luna-insights.js`): `claude-sonnet-5` (chat) e `claude-haiku-4-5-20251001` (insights) — revisar se a Anthropic lançar uma família nova.
- `index.html`: "Esqueci minha senha" chama `supabase.auth.resetPasswordForEmail(email)` sem `redirectTo` — usa o Site URL configurado no projeto Supabase (compartilhado com o FinZen), que já tem a tela de redefinição. Não construir uma tela de reset no Flash pra isso.
- `.github/workflows/smoke.yml` roda `tests/smoke.mjs` a cada push/PR (`npm ci` + `playwright install` + `python3 -m http.server 8765`). `package.json` só existe pra fixar a versão do Playwright do teste — o app em si continua sem build step.
- `sw.js` (service worker, registrado em `js/supabaseClient.js` — cobre o app inteiro sem editar cada HTML): cache do app shell (HTML/CSS/JS/imagens/CDN) pra não dar tela branca sem sinal. Estratégia network-first (busca a rede primeiro, só cai pro cache se a rede falhar) — não briga com o `must-revalidate` do `vercel.json`. **Nunca cacheia** `*.supabase.co` nem `/api/*` (dados financeiros/IA sempre frescos). Escopo real: garante que o shell estático (HTML/CSS) renderize offline em vez de tela branca; a funcionalidade dinâmica (login, dados) continua exigindo rede, como esperado — não é um modo "offline completo". Precisa ter aberto o app com sinal pelo menos uma vez antes (cache vazio no primeiro acesso).
