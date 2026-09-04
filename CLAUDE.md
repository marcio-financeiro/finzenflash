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
- `accounts` (filtrar `account_kind = 'bank'`, `active = true` — exclui contas de corretora tipo Rico/Nomad)
- `transactions` — **atenção:** o FinZen projeta lançamentos recorrentes com data futura (contas fixas já lançadas meses à frente). Sempre filtrar `date <= hoje` em listas de "últimos lançamentos", senão entradas futuras aparecem antes das reais.
- `categories` (tipo `despesa`/`receita`, `ativo = true`)
- Ajuste de saldo: RPC `increment_account_balance(p_account_id, p_delta)` — mesma RPC atômica do FinZen, nunca fazer SELECT→soma→UPDATE manual.

## Padrões de código

```js
// Auth no topo de toda página autenticada:
import { requireAuth } from './supabaseClient.js';
const user = await requireAuth();
```

- Escrever HTML/CSS/JS próprios — não copiar arquivos do repo do FinZen, só reaproveitar tabelas/RPCs do banco.
- `js/config.js` tem as mesmas credenciais Supabase do FinZen (client-side, uso pessoal).
