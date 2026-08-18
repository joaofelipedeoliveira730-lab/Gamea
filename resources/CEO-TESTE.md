# Conta CEO de teste

**Usuário:** `Teste CEO`

A senha fornecida para o teste **não foi gravada no código nem no relatório**, para evitar que uma credencial apareça no GitHub.

Configure a conta pelo fluxo normal de cadastro/login e atribua a role CEO/admin diretamente no PostgreSQL/Render.

A sala exclusiva de teste deve usar:
- Chave: `Velho202026`
- CEO pode iniciar sozinho.
- Bots podem preencher a partida para teste.
- Jogadores comuns não podem iniciar essa sala.

## Conta com tudo
Para ter uma conta com todos os cosméticos, use um seed/admin server-side que marque `player_items.owned=true` para todos os `shop_items`. Não faça isso pelo navegador.
