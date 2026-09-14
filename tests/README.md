# Testes

`smoke.mjs` abre todas as páginas (mobile e desktop) num Chromium headless e falha se
qualquer uma lançar exceção de JS. Não precisa de login: o supabase-js do CDN é
substituído por um stub que devolve listas vazias, e a sessão é simulada no
`localStorage`. Também cobre regressões conhecidas:

- voltar pra Home/Cadastros (visibilitychange) não pode duplicar listeners nem a sheet "Mais";
- `comprar-cartao.html?grupo=null` (compra antiga) não pode abrir como compra nova.

```bash
npm i -D playwright            # uma vez (o Chromium já vem com o pacote)
python3 -m http.server 8765    # servir o repo na porta 8765
node tests/smoke.mjs           # suíte completa (~3 min)
SOMENTE=regressao node tests/smoke.mjs   # só as regressões (~20 s)
```
